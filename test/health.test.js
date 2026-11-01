/**
 * Tests for the /health endpoint and the app-level ping/pong message type.
 *
 * Run with: node --test
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { WebSocket } = require('ws');

const { createApp } = require('../src/app.js');
const { createChatHub } = require('../src/hub.js');

const CLIENT_DIR = path.join(__dirname, '..', 'client');

describe('GET /health', () => {
  /** @type {{ server: import('http').Server, port: number }} */
  let ctx;
  /** @type {{ close: (opts?: object) => Promise<void>}|null} */
  let hub = null;

  beforeEach(async () => {
    const app = createApp({
      staticDir: CLIENT_DIR,
      getStats: () => ({ wsClients: hub ? hub.clientCount : 0 }),
    });
    ctx = await new Promise((res) => {
      const server = http.createServer(app).listen(0, '127.0.0.1', () => {
        res({ server, port: server.address().port });
      });
    });
    hub = null;
  });

  afterEach(async () => {
    if (hub) await hub.close();
    await new Promise((res) => { ctx.server.closeAllConnections?.(); ctx.server.close(res); });
  });

  test('returns status, uptime, wsClients and memory', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.ok(typeof body.uptime === 'number' && body.uptime >= 0);
    assert.strictEqual(body.wsClients, 0);
    assert.ok(typeof body.memory.rss === 'number' && body.memory.rss > 0);
    assert.ok(typeof body.memory.heapUsed === 'number' && body.memory.heapUsed > 0);
  });

  test('wsClients reflects live WS connections', async () => {
    hub = createChatHub({ server: ctx.server, path: '/ws', heartbeatIntervalMs: 60_000 });
    const url = `ws://127.0.0.1:${ctx.port}/ws`;

    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.on('open', res);
      ws.on('error', rej);
    });

    const res = await fetch(`http://127.0.0.1:${ctx.port}/health`);
    const body = await res.json();
    assert.strictEqual(body.wsClients, 1);

    ws.close();
    await new Promise((res) => ws.on('close', res));
  });

  test('GET /healthz stays lightweight and unchanged', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/healthz`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.ok(typeof body.uptime === 'number');
    assert.strictEqual(body.wsClients, undefined);
  });

  test('SPA fallback does not swallow /health', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/health`);
    assert.ok((await res.json()).status === 'ok');
  });
});

describe('app-level ping/pong', () => {
  /** @type {{ server: import('http').Server, port: number }} */
  let ctx;
  /** @type {{ close: (opts?: object) => Promise<void>}} */
  let hub;

  beforeEach(async () => {
    ctx = await new Promise((res) => {
      const server = http.createServer().listen(0, '127.0.0.1', () => {
        res({ server, port: server.address().port });
      });
    });
    hub = createChatHub({ server: ctx.server, path: '/ws' });
  });

  afterEach(async () => {
    await hub.close();
    await new Promise((res) => { ctx.server.closeAllConnections?.(); ctx.server.close(res); });
  });

  test('replies { type: "pong" } to { type: "ping" } without broadcasting', async () => {
    const url = `ws://127.0.0.1:${ctx.port}/ws`;
    const a = new WebSocket(url);
    const b = new WebSocket(url);
    await Promise.all([
      new Promise((r) => a.on('open', r)),
      new Promise((r) => b.on('open', r)),
    ]);

    const receivedA = [];
    a.on('message', (d) => receivedA.push(JSON.parse(d)));
    const receivedB = [];
    b.on('message', (d) => receivedB.push(JSON.parse(d)));

    a.send(JSON.stringify({ type: 'ping' }));
    await new Promise((r) => setTimeout(r, 100));

    assert.deepStrictEqual(receivedA, [{ type: 'pong' }], 'sender gets exactly one pong');
    assert.deepStrictEqual(receivedB, [], 'pong is not broadcast to other clients');

    a.close();
    b.close();
  });
});
