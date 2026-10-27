/**
 * Express application factory — static file serving and health endpoint.
 */

'use strict';

const express = require('express');

const isProd = process.env.NODE_ENV === 'production';

/**
 * Create and configure the Express app.
 *
 * @param {{ staticDir: string }} options
 * @returns {import('express').Express}
 */
function createApp({ staticDir }) {
  const app = express();

  // Security: hide Express signature
  app.disable('x-powered-by');

  // Trust proxy (useful when behind nginx/load balancer)
  app.set('trust proxy', 1);

  // Health check — no body to stay lightweight
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
  });

  // Static client files
  app.use(express.static(staticDir, {
    maxAge: isProd ? '1d' : 0,
    etag: true,
    index: ['index.html'],
  }));

  // SPA fallback: serve index.html for non-API routes
  app.get(/^\/(?!healthz|ws).*/, (_req, res) => {
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
