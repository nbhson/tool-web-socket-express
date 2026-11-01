/**
 * Operational test: boots the real server (server.js) as a child process,
 * connects a WS client, checks /health, then sends SIGTERM and verifies a
 * clean graceful shutdown (WS close code 1001, exit code 0).
 *
 * Run with: node --test
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { WebSocket } = require('ws');

const SERVER_JS = path.join(__dirname, '..', 'server.js');

/** Collect stdout/stderr chunks of a child process. */
function capture(child) {
  const out = [];
  child.stdout.on('data', (c) => out.push(c));
  child.stderr.on('data', (c) => out.push(c));
  return () => out.join('');
}

test('real server: SIGTERM → WS close 1001, HTTP closed, exit 0', { timeout: 20_000 }, async () => {
  const child = spawn(process.execPath, [SERVER_JS], {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const dump = capture(child);

  try {
    // 1. Wait for the listen log and extract the ephemeral port.
    const port = await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`server did not listen: ${dump()}`)), 10_000);
      const onData = (chunk) => {
        const match = String(chunk).match(/Server running at http:\/\/localhost:(\d+)/);
        if (match) {
          clearTimeout(timer);
          child.stdout.off('data', onData);
          res(Number(match[1]));
        }
      };
      child.stdout.on('data', onData);
    });
    const base = `http://127.0.0.1:${port}`;
    assert.ok(port > 0, 'should bind to an ephemeral port');

    // 2. Connect a WS client and verify broadcast.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const broadcast = new Promise((res) => ws.on('message', (d) => {
      const parsed = JSON.parse(d);
      if (parsed.message) res(parsed);
    }));
    ws.send(JSON.stringify({ ip: '1.2.3.4', uId: 'uid-ops', message: 'hello ops' }));
    assert.strictEqual((await broadcast).message, 'hello ops');

    // 3. /health returns 200 with details.
    const health = await fetch(`${base}/health`);
    assert.strictEqual(health.status, 200);
    const body = await health.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.wsClients, 1);

    // 4. SIGTERM → client sees close code 1001 (Going Away).
    const wsClosed = new Promise((res) => ws.on('close', (code, reason) => res({ code, reason })));
    const exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal })));
    child.kill('SIGTERM');

    const closeInfo = await wsClosed;
    assert.strictEqual(closeInfo.code, 1001, 'WS clients must receive close code 1001');
    assert.strictEqual(closeInfo.reason.toString(), 'Server going away');

    // 5. Process exits cleanly with code 0 and shutdown logs.
    const exit = await exited;
    assert.strictEqual(exit.code, 0, `expected exit code 0, got ${exit.code} (${exit.signal})`);
    assert.strictEqual(exit.signal, null);
    const output = dump();
    assert.ok(output.includes('SIGTERM received, shutting down gracefully'), 'shutdown log missing');
    assert.ok(output.includes('[WS] Hub closed'), 'hub close log missing');
    assert.ok(output.includes('[Server] Closed'), 'server closed log missing');
  } finally {
    // Never leave a stray server behind.
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise((res) => child.on('exit', res));
    }
  }
});
