/**
 * Tests for hub security features added in P2:
 *   - per-connection message rate limiting
 *   - WebSocket upgrade origin allowlist
 *
 * Run with: node --test
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { WebSocket } = require('ws');

const { createChatHub } = require('../src/hub.js');

/** Resolve once the WebSocket is open. */
const waitForOpen = (ws) =>
  new Promise((res, rej) => {
    if (ws.readyState === WebSocket.OPEN) { res(); return; }
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

/** Resolve once the WebSocket is closed. */
const waitForClose = (ws, timeoutMs = 2000) =>
  new Promise((res) => {
    const timer = setTimeout(res, timeoutMs);
    ws.addEventListener('close', () => { clearTimeout(timer); res(); }, { once: true });
  });

/** Collect error messages received on a socket. */
function collectErrors(ws, onMessage) {
  const errors = [];
  ws.on('message', (data) => {
    const d = JSON.parse(data);
    if (d.error) errors.push(d.error);
    onMessage?.(d);
  });
  return errors;
}

describe('hub rate limiting', () => {
  /** @type {{ server: import('http').Server, port: number }} */
  let ctx;
  /** @type {Array<{ close: () => void }>} */
  let hubs;

  beforeEach(async () => {
    ctx = await new Promise((res) => {
      const server = http.createServer();
      server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
    });
    hubs = [];
  });

  afterEach(async () => {
    for (const hub of hubs) hub.close();
    await new Promise((res) => { ctx.server.closeAllConnections?.(); ctx.server.close(res); });
  });

  function createAutoHub(options) {
    const hub = createChatHub({ server: ctx.server, ...options });
    hubs.push(hub);
    return hub;
  }

  test('rejects messages beyond the rate limit without broadcasting them', async () => {
    const max = 5;
    createAutoHub({ path: '/ws-rl', rateLimitMax: max, rateLimitWindowMs: 60_000 });
    const url = `ws://127.0.0.1:${ctx.port}/ws-rl`;

    const ws = new WebSocket(url);
    await waitForOpen(ws);

    const broadcast = [];
    const errors = collectErrors(ws, (d) => { if (!d.error) broadcast.push(d); });

    // Send max+3 messages; the last 3 must be rejected.
    for (let i = 0; i < max + 3; i++) {
      ws.send(JSON.stringify({ ip: 'x', uId: 'u', message: `msg-${i}` }));
    }
    await new Promise((res) => setTimeout(res, 250));

    assert.strictEqual(errors.length, 3, 'exactly 3 messages must be rate-limited');
    assert.ok(errors.every((e) => e.includes('Rate limit')));
    assert.strictEqual(broadcast.length, max, 'only the first N messages are broadcast');

    ws.close();
    await waitForClose(ws);
  });

  test('rate limit window resets after the window elapses', async () => {
    const max = 2;
    createAutoHub({ path: '/ws-rl2', rateLimitMax: max, rateLimitWindowMs: 150 });
    const url = `ws://127.0.0.1:${ctx.port}/ws-rl2`;

    const ws = new WebSocket(url);
    await waitForOpen(ws);

    const broadcast = [];
    const errors = collectErrors(ws, (d) => { if (!d.error) broadcast.push(d); });

    ws.send(JSON.stringify({ ip: 'x', uId: 'u', message: 'one' }));
    ws.send(JSON.stringify({ ip: 'x', uId: 'u', message: 'two' }));
    await new Promise((res) => setTimeout(res, 250)); // > window (150ms)
    ws.send(JSON.stringify({ ip: 'x', uId: 'u', message: 'three' }));
    await new Promise((res) => setTimeout(res, 250));

    assert.strictEqual(errors.length, 0, 'no message should be rate-limited after reset');
    assert.strictEqual(broadcast.length, max + 1);

    ws.close();
    await waitForClose(ws);
  });

  test('rate limiting can be disabled with rateLimitMax: 0', async () => {
    createAutoHub({ path: '/ws-rl3', rateLimitMax: 0 });
    const url = `ws://127.0.0.1:${ctx.port}/ws-rl3`;

    const ws = new WebSocket(url);
    await waitForOpen(ws);

    const broadcast = [];
    const errors = collectErrors(ws, (d) => { if (!d.error) broadcast.push(d); });

    for (let i = 0; i < 50; i++) {
      ws.send(JSON.stringify({ ip: 'x', uId: 'u', message: `msg-${i}` }));
    }
    await new Promise((res) => setTimeout(res, 250));

    assert.strictEqual(errors.length, 0);
    assert.strictEqual(broadcast.length, 50);

    ws.close();
    await waitForClose(ws);
  });
});

describe('hub origin check', () => {
  /** @type {{ server: import('http').Server, port: number }} */
  let ctx;
  /** @type {Array<{ close: () => void }>} */
  let hubs;

  beforeEach(async () => {
    ctx = await new Promise((res) => {
      const server = http.createServer();
      server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
    });
    hubs = [];
  });

  afterEach(async () => {
    for (const hub of hubs) hub.close();
    await new Promise((res) => { ctx.server.closeAllConnections?.(); ctx.server.close(res); });
  });

  function createAutoHub(options) {
    const hub = createChatHub({ server: ctx.server, ...options });
    hubs.push(hub);
    return hub;
  }

  test('allows connections when allowedOrigins is "*" (default)', async () => {
    createAutoHub({ path: '/ws-og-a' });
    const url = `ws://127.0.0.1:${ctx.port}/ws-og-a`;

    const ws = new WebSocket(url, { origin: 'https://evil.example' });
    await waitForOpen(ws);
    ws.close();
    await waitForClose(ws);
  });

  test('rejects browser origins outside the allowlist', async () => {
    createAutoHub({ path: '/ws-og-b', allowedOrigins: ['http://good.example'] });
    const url = `ws://127.0.0.1:${ctx.port}/ws-og-b`;

    const ws = new WebSocket(url, { origin: 'https://evil.example' });
    await assert.rejects(waitForOpen(ws), undefined, 'disallowed origin must not connect');
    assert.strictEqual(hubs[0].wss.clients.size, 0);
  });

  test('allows origins inside the allowlist', async () => {
    createAutoHub({ path: '/ws-og-c', allowedOrigins: ['https://good.example'] });
    const url = `ws://127.0.0.1:${ctx.port}/ws-og-c`;

    const ws = new WebSocket(url, { origin: 'https://good.example' });
    await waitForOpen(ws);
    ws.close();
    await waitForClose(ws);
  });

  test('allows non-browser clients that send no Origin header', async () => {
    createAutoHub({ path: '/ws-og-d', allowedOrigins: ['https://good.example'] });
    const url = `ws://127.0.0.1:${ctx.port}/ws-og-d`;

    // ws sends no Origin header unless explicitly configured.
    const ws = new WebSocket(url);
    await waitForOpen(ws);
    ws.close();
    await waitForClose(ws);
  });
});
