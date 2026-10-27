/**
 * Shared WebSocket chat hub with broadcast, heartbeat, and JSON handling.
 * Used by the server entry point; designed for unit-testing with a real WS server.
 */

'use strict';

const { WebSocketServer } = require('ws');

/** Default heartbeat interval: 30 seconds */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * @typedef {Object} HubOptions
 * @property {import('http').Server} server - HTTP server to attach WS to
 * @property {string} [path='/ws'] - WebSocket upgrade path
 * @property {number} [heartbeatIntervalMs] - Heartbeat ping interval
 */

/**
 * Create a chat hub attached to an HTTP server.
 *
 * @param {HubOptions} options
 * @returns {{ wss: WebSocketServer, broadcast: (data: object) => void, close: () => void }}
 */
function createChatHub({ server, path = '/ws', heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS } = {}) {
  const wss = new WebSocketServer({ server, path });
  /** @type {Set<import('ws').WebSocket>} */
  const clients = new Set();

  wss.on('connection', (socket, request) => {
    // Mark alive and add to pool
    socket.isAlive = true;
    clients.add(socket);
    console.log(`[WS] Client connected (total: ${clients.size})`);

    // Heartbeat pong
    socket.on('pong', () => { socket.isAlive = true; });

    socket.on('message', (raw) => {
      /** @type {string} */
      const rawStr = raw.toString();
      let payload;
      try {
        payload = JSON.parse(rawStr);
      } catch {
        socket.send(JSON.stringify({ error: 'Invalid JSON format' }));
        return;
      }
      broadcast({ ip: payload.ip, uId: payload.uId, message: payload.message });
    });

    socket.on('close', () => {
      clients.delete(socket);
      console.log(`[WS] Client disconnected (total: ${clients.size})`);
    });

    socket.on('error', (err) => {
      console.error(`[WS] Client socket error: ${err.message}`);
      clients.delete(socket);
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
        console.log(`[WS] Terminating unresponsive client (total: ${clients.size - 1})`);
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

module.exports = { createChatHub, DEFAULT_HEARTBEAT_INTERVAL_MS };
