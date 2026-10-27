/**
 * Tests for src/hub.js — the WebSocket chat hub.
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

/** Start a test HTTP server on an ephemeral port. */
function createTestServer() {
  return new Promise((res) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      res({ server, port });
    });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('createChatHub', () => {
  /** @type {{ server: import('http').Server, port: number }} */
  let ctx;
  /** @type {Array<{ close: () => void }>} */
  let hubs;

  beforeEach(async () => {
    ctx = await createTestServer();
    hubs = [];
  });

  afterEach(async () => {
    // Terminate all hub clients so server.close() does not hang
    for (const hub of hubs) hub.close();
    await new Promise((res) => { ctx.server.closeAllConnections?.(); ctx.server.close(res); });
  });

  /** Create a hub that is auto-closed in afterEach. */
  function createAutoHub(options) {
    const hub = createChatHub({ server: ctx.server, ...options });
    hubs.push(hub);
    return hub;
  }

  test('attaches a WebSocket server to the HTTP server', async () => {
    const hub = createAutoHub({ path: '/ws-a' });
    const url = `ws://127.0.0.1:${ctx.port}/ws-a`;
    const ws = new WebSocket(url);
    await waitForOpen(ws);
    ws.close();
    assert.ok(true, 'WS server accepted connection');
  });

  test('broadcasts valid JSON messages to all connected clients', async () => {
    const hub = createAutoHub({ path: '/ws-b' });
    const url = `ws://127.0.0.1:${ctx.port}/ws-b`;

    const [a, b] = [new WebSocket(url), new WebSocket(url)];
    await Promise.all([waitForOpen(a), waitForOpen(b)]);

    const receivedA = [];
    const receivedB = [];
    a.on('message', (data) => receivedA.push(JSON.parse(data)));
    b.on('message', (data) => receivedB.push(JSON.parse(data)));

    // Simulate server-side broadcast
    hub.broadcast({ ip: '10.0.0.1', uId: 'uid-123', message: 'hello world' });

    // Wait for messages
    await new Promise((res) => setTimeout(res, 100));

    assert.strictEqual(receivedA.length, 1);
    assert.strictEqual(receivedA[0].message, 'hello world');
    assert.strictEqual(receivedB.length, 1);
    assert.strictEqual(receivedB[0].ip, '10.0.0.1');

    await Promise.all([waitForClose(a), waitForClose(b)]);
  });

  test('returns error JSON when client sends malformed JSON', async () => {
    const hub = createAutoHub({ path: '/ws-c' });
    const url = `ws://127.0.0.1:${ctx.port}/ws-c`;

    const ws = new WebSocket(url);
    await waitForOpen(ws);

    const errors = [];
    ws.on('message', (data) => {
      const d = JSON.parse(data);
      if (d.error) errors.push(d.error);
    });

    ws.send('not valid json {');
    await new Promise((res) => setTimeout(res, 100));

    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('Invalid JSON'));

    ws.close();
  });

  test('removes client from pool on disconnect', async () => {
    const hub = createAutoHub({ path: '/ws-d' });
    const url = `ws://127.0.0.1:${ctx.port}/ws-d`;

    const ws = new WebSocket(url);
    await waitForOpen(ws);
    const initialSize = hub.wss.clients.size;
    ws.close();
    await waitForClose(ws);

    // Allow close event to propagate to the server side
    await new Promise((res) => setTimeout(res, 200));
    assert.strictEqual(hub.wss.clients.size, initialSize - 1);
  });

  test('terminates dead clients on next heartbeat round', async () => {
    // Use a very short heartbeat interval
    const hub = createAutoHub({ path: '/ws-e', heartbeatIntervalMs: 50 });
    const url = `ws://127.0.0.1:${ctx.port}/ws-e`;

    const ws = new WebSocket(url);
    await waitForOpen(ws);

    // Simulate a dead client by marking it not alive and not responding to pings
    for (const client of hub.wss.clients) {
      client.isAlive = false;
    }

    // Wait for heartbeat to fire twice (50ms interval × 2)
    await new Promise((res) => setTimeout(res, 150));

    // ws should be terminated now
    assert.strictEqual(ws.readyState, WebSocket.CLOSED);
    assert.strictEqual(hub.wss.clients.size, 0);

  });

  test('close() terminates all clients and clears heartbeat', async () => {
    const hub = createAutoHub({ path: '/ws-f' });
    const url = `ws://127.0.0.1:${ctx.port}/ws-f`;

    const [a, b] = [new WebSocket(url), new WebSocket(url)];
    await Promise.all([waitForOpen(a), waitForOpen(b)]);

    // Close the hub, which should terminate all clients
    hub.close();

    // Close events should have been sent to clients
    await Promise.all([waitForClose(a), waitForClose(b)]);
    // Allow server-side close events to propagate
    await new Promise((res) => setTimeout(res, 200));
    assert.strictEqual(hub.wss.clients.size, 0);
  });
});
