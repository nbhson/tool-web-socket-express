/**
 * Shared WebSocket chat hub with broadcast, heartbeat, JSON handling,
 * payload size limits, and message validation.
 *
 * @module hub
 */

'use strict';

const { WebSocketServer } = require('ws');

/** Default heartbeat interval: 30 seconds */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Default maximum WebSocket frame payload size (bytes).
 * Frames larger than this are rejected by the server (close code 1009).
 * @type {number}
 */
const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB

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
 */

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
} = {}) {
  /** @type {WebSocketServer} */
  const wss = new WebSocketServer({
    server,
    path,
    // maxPayload enforces the WebSocket frame size limit at protocol level.
    // Frames exceeding this limit cause the server to close the connection
    // with code 1009 (Message Too Big).
    maxPayload: maxPayloadBytes,
  });

  /** @type {Set<import('ws').WebSocket>} */
  const clients = new Set();

  wss.on('connection', (socket, _request) => {
    // Initialise alive flag and register client.
    socket.isAlive = true;
    clients.add(socket);
    console.log(`[WS] Client connected (total: ${clients.size})`);

    // Heartbeat pong: mark client alive when it responds.
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (raw) => {
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

  /** Close the hub cleanly. */
  function close() {
    clearInterval(heartbeat);
    for (const client of clients) {
      client.terminate();
    }
    wss.close(() => {
      console.log('[WS] Hub closed');
    });
  }

  return { wss, broadcast, close };
}

module.exports = { createChatHub, DEFAULT_HEARTBEAT_INTERVAL_MS, MAX_MESSAGE_LENGTH };
