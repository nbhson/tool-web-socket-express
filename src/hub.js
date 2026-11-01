/**
 * Shared WebSocket chat hub with broadcast, heartbeat, JSON handling,
 * payload size limits, and message validation.
 *
 * @module hub
 */

'use strict';

const { WebSocket, WebSocketServer } = require('ws');

/**
 * Registry of WS paths already claimed by a hub, keyed by HTTP server.
 * Lets multiple hubs share one HTTP server and lets each upgrade listener
 * decide whether a path is handled by another hub or truly unknown.
 * @type {WeakMap<import('http').Server, Set<string>>}
 */
const claimedPaths = new WeakMap();

/**
 * Extract the pathname of an upgrade request URL.
 * @param {import('http').IncomingMessage} request
 * @returns {string}
 */
function upgradePathname(request) {
  const url = request.url ?? '/';
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url;
  }
}

/** Default heartbeat interval: 30 seconds */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Default grace period (ms) for clients to finish the close handshake
 * during shutdown before they are force-terminated.
 * @type {number}
 */
const DEFAULT_CLOSE_GRACE_MS = 1_000;

/**
 * Default maximum WebSocket frame payload size (bytes).
 * Frames larger than this are rejected by the server (close code 1009).
 * @type {number}
 */
const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB

/**
 * Default per-connection message rate limit.
 * A client may send at most this many messages per rate-limit window;
 * excess messages receive an error JSON and are not broadcast.
 * Set `rateLimitMax` to 0 to disable.
 * @type {number}
 */
const DEFAULT_RATE_LIMIT_MAX = 30;

/**
 * Default rate-limit window in milliseconds.
 * @type {number}
 */
const DEFAULT_RATE_LIMIT_WINDOW_MS = 10_000;

/**
 * Maximum broadcast message string length.
 * Prevents clients from publishing extremely large chat messages.
 * @type {number}
 */
const MAX_MESSAGE_LENGTH = 4 * 1024; // 4 KB

/**
 * @typedef {Object} HubOptions
 * @property {import('http').Server} server - HTTP server to attach WS to
 * @property {string} [path='/ws'] - WebSocket upgrade path
 * @property {number} [heartbeatIntervalMs] - Heartbeat ping interval
 * @property {number} [maxPayloadBytes] - Max WebSocket frame size in bytes
 * @property {number} [rateLimitMax=30] - Max messages per connection per
 *   window; 0 disables rate limiting
 * @property {number} [rateLimitWindowMs=10000] - Rate-limit window length (ms)
 * @property {string[]|'*'} [allowedOrigins='*'] - Browser origins allowed to
 *   connect. '*' disables the check (non-browser clients send no Origin and
 *   are always allowed). Same-origin deployments can pass e.g.
 *   ['http://localhost:3000']. Origin checks run in a `server.on('upgrade')`
 *   listener (not the legacy `verifyClient`), rejecting bad origins with 403.
 */

/**
 * Check the Origin header of an upgrade request against an allowlist.
 *
 * @param {import('http').IncomingMessage} request
 * @param {string[]|'*'|undefined} allowedOrigins
 * @returns {boolean} true when the request is allowed
 */
function isOriginAllowed(request, allowedOrigins) {
  if (!allowedOrigins || allowedOrigins === '*') return true;
  const origin = request.headers.origin;
  // Non-browser clients (curl, tests, native apps) send no Origin — allow them.
  if (!origin) return true;
  return Array.isArray(allowedOrigins) && allowedOrigins.includes(origin);
}

/**
 * Create a chat hub attached to an HTTP server.
 *
 * @param {HubOptions} options
 * @returns {{ wss: WebSocketServer, broadcast: (data: object) => void, close: () => void }}
 */
function createChatHub({
  server,
  path = '/ws',
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
  rateLimitMax = DEFAULT_RATE_LIMIT_MAX,
  rateLimitWindowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
  allowedOrigins = '*',
} = {}) {
  /** @type {WebSocketServer} */
  const wss = new WebSocketServer({
    noServer: true,
    // maxPayload enforces the WebSocket frame size limit at protocol level.
    // Frames exceeding this limit cause the server to close the connection
    // with code 1009 (Message Too Big).
    maxPayload: maxPayloadBytes,
  });

  // Register this hub's path so co-located hubs on the same HTTP server do
  // not destroy each other's upgrades (see the shared listener below).
  let paths = claimedPaths.get(server);
  if (!paths) {
    paths = new Set();
    claimedPaths.set(server, paths);
  }
  paths.add(path);

  /** Whether hub.close() has run — further upgrades are refused. */
  let closed = false;

  // Origin allowlist + path routing in an 'upgrade' listener (replaces the
  // legacy `verifyClient` option, which ws deprecated in favour of this).
  server.on('upgrade', (request, socket, head) => {
    const pathname = upgradePathname(request);

    // Unknown WS path: no hub on this server claims it — reject with 404.
    if (!paths.has(pathname)) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    // Another hub on this server owns this path — leave it to that listener.
    if (pathname !== path) return;

    // Hub already shut down — refuse with 503.
    if (closed) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    // Browser origins outside the allowlist are rejected with 403.
    // Non-browser clients (no Origin header) are always allowed.
    if (!isOriginAllowed(request, allowedOrigins)) {
      console.warn(`[WS] Rejected upgrade: origin not allowed (${request.headers.origin ?? 'no Origin'})`);
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  /** @type {Set<import('ws').WebSocket>} */
  const clients = new Set();

  wss.on('connection', (socket, _request) => {
    // Initialise alive flag and register client.
    socket.isAlive = true;
    clients.add(socket);
    console.log(`[WS] Client connected (total: ${clients.size})`);

    // Per-connection rate limiting: fixed-window counter.
    // Excess messages are rejected with an error JSON, never broadcast.
    let rateCount = 0;
    let rateWindowStart = Date.now();
    /**
     * @returns {boolean} true when the message is within the rate limit
     */
    function isWithinRateLimit() {
      if (rateLimitMax <= 0) return true;
      const now = Date.now();
      if (now - rateWindowStart >= rateLimitWindowMs) {
        rateWindowStart = now;
        rateCount = 0;
      }
      rateCount += 1;
      return rateCount <= rateLimitMax;
    }

    // Heartbeat pong: mark client alive when it responds.
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (raw) => {
      // Rate limit first: cheap check, protects JSON parsing as well.
      if (!isWithinRateLimit()) {
        socket.send(
          JSON.stringify({
            error: 'Rate limit exceeded. Slow down and retry later.',
          })
        );
        return;
      }

      /** @type {string} Raw frame payload as string */
      const rawStr = raw.toString();

      /** @type {object|undefined} Parsed JSON payload */
      let payload;
      try {
        payload = JSON.parse(rawStr);
      } catch {
        socket.send(JSON.stringify({ error: 'Invalid JSON format' }));
        return;
      }

      // Guard: reject non-object payloads.
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        socket.send(JSON.stringify({ error: 'Payload must be a JSON object' }));
        return;
      }

      const { ip, uId, message } = payload;

      // Guard: validate message field — must be a non-empty string
      // within MAX_MESSAGE_LENGTH. Broadcast only valid chat messages.
      if (
        typeof message !== 'string' ||
        message.trim().length === 0 ||
        message.length > MAX_MESSAGE_LENGTH
      ) {
        socket.send(
          JSON.stringify({
            error: `Message must be a non-empty string ≤ ${MAX_MESSAGE_LENGTH} characters.`,
          })
        );
        return;
      }

      broadcast({ ip, uId, message: message.trim() });
    });

    socket.on('close', () => {
      clients.delete(socket);
      console.log(`[WS] Client disconnected (total: ${clients.size})`);
    });

    socket.on('error', (err) => {
      console.error(`[WS] Client socket error: ${err.message}`);
      // ws guarantee: 'close' fires after 'error', so clients.delete in close handler.
    });
  });

  wss.on('error', (err) => {
    console.error(`[WS] Server error: ${err.message}`);
  });

  /**
   * Broadcast an object to all connected clients.
   * @param {object} data
   */
  function broadcast(data) {
    const json = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(json);
      }
    }
  }

  /** Periodically ping connected clients; terminate unresponsive ones. */
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.isAlive === false) {
        console.log(
          `[WS] Terminating unresponsive client (total: ${clients.size - 1})`
        );
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, heartbeatIntervalMs);
  if (heartbeat.unref) heartbeat.unref();

  /**
   * Close the hub cleanly:
   *   1. stop the heartbeat,
   *   2. send a WebSocket close frame (1001 Going Away) to every client so
   *      they can reconnect elsewhere instead of seeing an aborted socket,
   *   3. force-terminate clients that ignore the close frame after a grace
   *      period,
   *   4. wait for the WebSocketServer to finish closing.
   *
   * @param {{ code?: number, reason?: string, graceMs?: number }} [options]
   * @returns {Promise<void>} resolves once the WS server is fully closed
   */
  function close({
    code = 1001,
    reason = 'Server going away',
    graceMs = DEFAULT_CLOSE_GRACE_MS,
  } = {}) {
    if (closed) return Promise.resolve();
    closed = true;
    clearInterval(heartbeat);

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close(code, reason);
      }
    }

    // Safety net: force-terminate clients that never finish the handshake.
    const force = setTimeout(() => {
      for (const client of clients) {
        if (client.readyState !== WebSocket.CLOSED) client.terminate();
      }
    }, graceMs);
    if (force.unref) force.unref();

    // With noServer, wss.close() resolves after every client disconnects.
    return new Promise((resolve) => {
      wss.close(() => {
        console.log('[WS] Hub closed');
        resolve();
      });
    });
  }

  return {
    wss,
    broadcast,
    close,
    /** Number of currently connected WS clients. */
    get clientCount() {
      return clients.size;
    },
  };
}

module.exports = {
  createChatHub,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_CLOSE_GRACE_MS,
  MAX_MESSAGE_LENGTH,
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
};
