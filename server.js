/**
 * Server entry point for tool-web-socket-express.
 *
 * Single HTTP server on PORT:
 *   - GET /          → static chat UI (served by Express)
 *   - GET /healthz  → health check (lightweight)
 *   - GET /health   → health details (uptime, WS clients, memory)
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
const SHUTDOWN_TIMEOUT_MS = 5_000;
let shuttingDown = false;

/**
 * Graceful shutdown on SIGTERM/SIGINT:
 *   1. stop accepting new work and close every WS connection with close
 *      code 1001 (Going Away) so clients can reconnect elsewhere,
 *   2. close the HTTP server (waits for in-flight requests),
 *   3. exit cleanly with code 0.
 * A hard timeout guards against hung connections.
 *
 * @param {string} signal
 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Server] ${signal} received, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    console.error('[Server] Forced exit after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  if (forceExit.unref) forceExit.unref();

  try {
    await hub.close(); // WS clients receive close frame 1001
    server.closeIdleConnections?.();
    await new Promise((resolve) => server.close(resolve));
    console.log('[Server] Closed');
    process.exit(0);
  } catch (err) {
    console.error('[Server] Shutdown error:', err?.message ?? err);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
