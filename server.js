/**
 * Server entry point for tool-web-socket-express.
 *
 * Single HTTP server on PORT:
 *   - GET /          → static chat UI (served by Express)
 *   - GET /healthz  → health check
 *   - WS  /ws       → realtime chat hub
 *
 * Environment variables:
 *   PORT=3000        - HTTP/WS port (default: 3000)
 *   HOST=0.0.0.0    - bind address  (default: 0.0.0.0)
 *   WS_PATH=/ws      - WebSocket path (default: /ws)
 */

'use strict';

const http = require('node:http');
const path = require('node:path');

const { createChatHub } = require('./src/hub');
const { createApp } = require('./src/app');

// ── Configuration ──────────────────────────────────────────────────────────────
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const WS_PATH = process.env.WS_PATH ?? '/ws';
const CLIENT_DIR = path.join(__dirname, 'client');

// ── Bootstrap ──────────────────────────────────────────────────────────────────
const app = createApp({ staticDir: CLIENT_DIR });
const server = http.createServer(app);

const hub = createChatHub({ server, path: WS_PATH });

// ── Start ──────────────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  const addr = server.address();
  console.log(`[HTTP] Server running at http://localhost:${addr.port}`);
  console.log(`[WS]   Chat hub at          ws://localhost:${addr.port}${WS_PATH}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
/**
 * @param {string} signal
 */
function shutdown(signal) {
  console.log(`\n[Server] ${signal} received, shutting down gracefully...`);
  hub.close();
  server.close(() => {
    console.log('[Server] Closed');
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => {
    console.error('[Server] Forced exit after timeout');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
