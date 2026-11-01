/**
 * Express application factory — static file serving and health endpoint.
 */

'use strict';

const express = require('express');

const isProd = process.env.NODE_ENV === 'production';

/**
 * Create and configure the Express app.
 *
 * @param {{ staticDir: string, getStats?: () => object }} options
 *   getStats (optional) supplies live stats for GET /health, e.g. the number
 *   of connected WS clients; called on every /health request.
 * @returns {import('express').Express}
 */
function createApp({ staticDir, getStats } = {}) {
  const app = express();

  // Security: hide Express signature
  app.disable('x-powered-by');

  // Trust proxy (useful when behind nginx/load balancer)
  app.set('trust proxy', 1);

  // ── Security headers ────────────────────────────────────────────────────────
  // CORS: this app is same-origin by design (the client is served by this very
  // server), so no Access-Control-Allow-* headers are set on purpose. Any
  // cross-origin consumption must go through a reverse proxy that adds them.
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });

  // Health check — no body to stay lightweight
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
  });

  // Detailed health check: uptime, live WS client count, memory usage.
  app.get('/health', (_req, res) => {
    const stats = typeof getStats === 'function' ? getStats() : {};
    const memory = process.memoryUsage();
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      wsClients: stats.wsClients ?? null,
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
      },
    });
  });

  // Static client files.
  // Path traversal safety: express.static normalises '..' segments and refuses
  // to serve files resolving outside staticDir; the SPA fallback below only
  // ever sends a fixed, app-controlled path (no user input reaches sendFile).
  // Request body size limit: the app has no body-parsing middleware (GET-only
  // surface), so there is no HTTP payload to limit; WS payloads are capped in
  // src/hub.js via maxPayload.
  app.use(express.static(staticDir, {
    maxAge: isProd ? '1d' : 0,
    etag: true,
    index: ['index.html'],
    dotfiles: 'ignore',
  }));

  // SPA fallback: serve index.html for non-API routes
  app.get(/^\/(?!healthz|health|ws).*/, (_req, res) => {
    res.sendFile(require('path').join(staticDir, 'index.html'));
  });

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Global error handler
  app.use((err, _req, res, _next) => {
    console.error(`[HTTP] Unhandled error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
