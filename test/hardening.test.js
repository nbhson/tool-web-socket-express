/**
 * Hardening tests for src/hub.js (payload limits, message validation)
 * and src/app.js (path traversal, security headers).
 *
 * Run with: node --test
 */

'use strict';

const { test, describe, beforeEach, afterEach, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { WebSocket } = require('ws');

const { createChatHub } = require('../src/hub.js');
const { createApp } = require('../src/app.js');

const CLIENT_DIR = require('path').join(__dirname, '..', 'client');

/** Resolve once the WebSocket is open. */
const waitForOpen = (ws) =>
  new Promise((res, rej) => {
    if (ws.readyState === WebSocket.OPEN) { res(); return; }
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

/** Resolve once the WebSocket is closed (with close code). */
const waitForClose = (ws, timeoutMs = 2000) =>
  new Promise((res) => {
    const timer = setTimeout(() => res({ code: null }), timeoutMs);
    ws.addEventListener('close', (e) => { clearTimeout(timer); res({ code: e.code }); }, { once: true });
  });

// ── Hub hardening (WS payload limits) ──────────────────────────────────────────

describe('hub hardening', () => {
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

  test('closes connection when a WS frame exceeds maxPayload (1009)', async () => {
    const hub = createAutoHub({ path: '/ws-big', maxPayloadBytes: 1024 });
    const url = `ws://127.0.0.1:${ctx.port}/ws-big`;

    const ws = new WebSocket(url);
    await waitForOpen(ws);

    const closed = waitForClose(ws);
    // 4 KB frame > 1 KB maxPayload
    ws.send(JSON.stringify({ ip: 'x', uId: 'u', message: 'a'.repeat(4096) }));

    const { code } = await closed;
    assert.strictEqual(code, 1009, 'server must close with Message Too Big');
  });

  test('rejects messages that are not non-empty strings', async () => {
    const hub = createAutoHub({ path: '/ws-val' });
    const url = `ws://127.0.0.1:${ctx.port}/ws-val`;

    const ws = new WebSocket(url);
    await waitForOpen(ws);

    const errors = [];
    ws.on('message', (data) => {
      const d = JSON.parse(data);
      if (d.error) errors.push(d.error);
    });

    ws.send(JSON.stringify({ ip: 'x', uId: 'u', message: 42 }));
    ws.send(JSON.stringify({ ip: 'x', uId: 'u', message: '' }));
    ws.send(JSON.stringify({ ip: 'x', uId: 'u' }));
    await new Promise((res) => setTimeout(res, 150));

    assert.strictEqual(errors.length, 3, 'all three invalid payloads must be rejected');
    assert.ok(errors.every((e) => e.includes('Message must be')));

    ws.close();
  });

  test('rejects messages exceeding MAX_MESSAGE_LENGTH', async () => {
    const hub = createAutoHub({ path: '/ws-len' });
    const url = `ws://127.0.0.1:${ctx.port}/ws-len`;

    const ws = new WebSocket(url);
    await waitForOpen(ws);

    const received = [];
    ws.on('message', (data) => received.push(JSON.parse(data)));

    // 5 KB string > 4 KB MAX_MESSAGE_LENGTH, but < maxPayload (16 KB) so the
    // frame is accepted and rejected at application level.
    ws.send(JSON.stringify({ ip: 'x', uId: 'u', message: 'a'.repeat(5 * 1024) }));
    await new Promise((res) => setTimeout(res, 150));

    assert.strictEqual(received.length, 1);
    assert.ok(received[0].error.includes('Message must be'));

    ws.close();
  });
});

// ── App hardening (traversal, headers) ─────────────────────────────────────────

describe('app hardening', () => {
  /** @type {{ server: import('http').Server, port: number }} */
  let ctx;
  /** @type {string} */
  let fixtureDir;

  before(async () => {
    // Fixture dir with a secret dotfile to prove dotfiles/traversal never leak.
    const fs = require('node:fs');
    const os = require('node:os');
    fixtureDir = fs.mkdtempSync(require('node:path').join(os.tmpdir(), 'wsx-fix-'));
    fs.writeFileSync(require('path').join(fixtureDir, 'index.html'), '<!DOCTYPE html>fixture');
    fs.writeFileSync(require('path').join(fixtureDir, '.secret'), 'SECRET_DOTFILE_CONTENT');
  });

  after(() => {
    require('node:fs').rmSync(fixtureDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const app = createApp({ staticDir: fixtureDir });
    ctx = await new Promise((res) => {
      const server = http.createServer(app).listen(0, '127.0.0.1', () => {
        res({ server, port: server.address().port });
      });
    });
  });

  afterEach(() => new Promise((res) => { ctx.server.closeAllConnections?.(); ctx.server.close(res); }));

  test('path traversal attempts never leak files outside staticDir', async () => {
    // fetch normalises some of these; the raw paths below reach the server.
    const paths = [
      '/../../package.json',
      '/..%2f..%2fpackage.json',
      '/%2e%2e/%2e%2e/package.json',
      '/client/../../package.json',
    ];
    for (const p of paths) {
      const res = await fetch(`http://127.0.0.1:${ctx.port}${p}`);
      const text = await res.text();
      assert.ok(
        !text.includes('"name"'),
        `traversal via ${p} must not serve package.json`
      );
    }
  });

  test('sets baseline security headers on responses', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/healthz`);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
  });

  test('hidden dotfiles are not served', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/.secret`);
    const text = await res.text();
    assert.ok(
      !text.includes('SECRET_DOTFILE_CONTENT'),
      'dotfiles must never be served'
    );
  });
});
