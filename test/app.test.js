/**
 * Tests for src/app.js — Express application.
 *
 * Run with: node --test
 */

'use strict';

const { describe, beforeEach, afterEach, test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { createApp } = require('../src/app.js');

const CLIENT_DIR = require('path').join(__dirname, '..', 'client');

describe('createApp', () => {
  /** @type {{ server: import('http').Server, port: number }} */
  let ctx;

  beforeEach(async () => {
    const app = createApp({ staticDir: CLIENT_DIR });
    ctx = await new Promise((res) => {
      const server = http.createServer(app).listen(0, '127.0.0.1', () => {
        res({ server, port: server.address().port });
      });
    });
  });

  afterEach(() => new Promise((res) => { ctx.server.closeAllConnections?.(); ctx.server.close(res); }));

  test('GET /healthz returns 200 and JSON status', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/healthz`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.ok(typeof body.uptime === 'number');
  });

  test('GET / serves index.html', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('<!DOCTYPE html'), 'should serve HTML');
  });

  test('GET /client.js serves the chat client script', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/client.js`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('wsUrl'), 'should contain client code');
  });

  test('SPA fallback: unknown route serves index.html', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/some-unknown-page`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('<!DOCTYPE html'));
  });
});
