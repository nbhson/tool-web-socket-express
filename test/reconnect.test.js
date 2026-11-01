/**
 * Tests for client/reconnect.js — exponential backoff with a cap.
 *
 * Run with: node --test
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const Reconnect = require('../client/reconnect.js');

describe('Reconnect.nextReconnectDelay', () => {
  test('doubles the delay per attempt', () => {
    assert.strictEqual(Reconnect.nextReconnectDelay(0), 1_000);
    assert.strictEqual(Reconnect.nextReconnectDelay(1), 2_000);
    assert.strictEqual(Reconnect.nextReconnectDelay(2), 4_000);
    assert.strictEqual(Reconnect.nextReconnectDelay(3), 8_000);
  });

  test('caps at maxMs', () => {
    assert.strictEqual(Reconnect.nextReconnectDelay(4), 10_000);
    assert.strictEqual(Reconnect.nextReconnectDelay(10), 10_000);
    assert.strictEqual(Reconnect.nextReconnectDelay(1_000), 10_000);
  });

  test('supports custom base and max', () => {
    assert.strictEqual(Reconnect.nextReconnectDelay(0, 250, 2_000), 250);
    assert.strictEqual(Reconnect.nextReconnectDelay(2, 250, 2_000), 1_000);
    assert.strictEqual(Reconnect.nextReconnectDelay(5, 250, 2_000), 2_000);
  });

  test('clamps negative attempts to the base delay', () => {
    assert.strictEqual(Reconnect.nextReconnectDelay(-3), 1_000);
  });

  test('exports its default constants', () => {
    assert.strictEqual(Reconnect.BASE_RECONNECT_DELAY_MS, 1_000);
    assert.strictEqual(Reconnect.MAX_RECONNECT_DELAY_MS, 10_000);
  });
});
