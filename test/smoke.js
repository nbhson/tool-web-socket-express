/**
 * Smoke test: boots the real server on an ephemeral port, connects a WS client,
 * sends a message, and verifies broadcast + HTTP endpoints work end-to-end.
 *
 * Run manually: node test/smoke.js
 */

'use strict';

const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert');
const { WebSocket } = require('ws');

const { createChatHub } = require('../src/hub.js');
const { createApp } = require('../src/app.js');

async function main() {
  const app = createApp({ staticDir: path.join(__dirname, '..', 'client') });
  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();

  const hub = createChatHub({ server, path: '/ws', heartbeatIntervalMs: 100 });

  // 1. HTTP health check
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  const healthBody = await health.json();
  assert.strictEqual(health.status, 200);
  assert.strictEqual(healthBody.status, 'ok');
  console.log('✔ healthz OK');

  // 2. Static UI served
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.strictEqual(page.status, 200);
  assert.ok((await page.text()).includes('WebSocket Chat'));
  console.log('✔ static UI OK');

  // 3. WS broadcast end-to-end
  const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const wsB = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await Promise.all([
    new Promise((r) => wsA.on('open', r)),
    new Promise((r) => wsB.on('open', r)),
  ]);

  const gotMessage = new Promise((res) => {
    let count = 0;
    const check = () => { if (++count === 2) res(); };
    wsA.on('message', check);
    wsB.on('message', check);
  });

  wsA.send(JSON.stringify({ ip: '1.2.3.4', uId: 'uid-1', message: 'hello from A' }));
  await gotMessage;

  // 4. Invalid JSON → error response
  const errorReply = new Promise((res) => wsB.on('message', (d) => {
    const parsed = JSON.parse(d);
    if (parsed.error) res(parsed.error);
  }));
  wsB.send('broken json');
  assert.ok((await errorReply).includes('Invalid JSON'));
  console.log('✔ broadcast + error handling OK');

  // Cleanup
  wsA.close();
  wsB.close();
  hub.close();
  server.closeAllConnections?.();
  await new Promise((res) => server.close(res));
  console.log('✔ smoke test passed');
  process.exit(0);
}

main().catch((err) => {
  console.error('✖ smoke test failed:', err);
  process.exit(1);
});
