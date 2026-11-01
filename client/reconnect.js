/**
 * Reconnect backoff helpers — shared between the browser client and tests.
 *
 * Loaded as a classic script in the browser (top-level `const Reconnect` is
 * visible to later scripts) and as a CommonJS module in Node (tests).
 */

'use strict';

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

/**
 * Exponential backoff with a cap: base * 2^attempt, clamped to max.
 *
 * @param {number} attempt - zero-based attempt number
 * @param {number} [baseMs] - delay for the first attempt
 * @param {number} [maxMs] - maximum delay
 * @returns {number} delay in milliseconds
 */
function nextReconnectDelay(
  attempt,
  baseMs = BASE_RECONNECT_DELAY_MS,
  maxMs = MAX_RECONNECT_DELAY_MS
) {
  return Math.min(baseMs * 2 ** Math.max(0, attempt), maxMs);
}

const Reconnect = { nextReconnectDelay, BASE_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS };

// Node (tests) exports the module; the browser gets the top-level binding.
if (typeof module !== 'undefined') {
  module.exports = Reconnect;
}
