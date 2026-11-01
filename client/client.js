/**
 * Chat client: WebSocket connection with auto-reconnect, connection status UI,
 * notifications, and dark mode support.
 */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────────
let socket = null;
let uId = null;
let input = null;
let chatBox = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let myIp = '';

let bannerTimer = null;

// ── Boot ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  input = document.getElementById('message-input');
  chatBox = document.getElementById('chat-box');
  uId = generateUUID();
  myIp = await getIp() ?? 'unknown';
  bindSendEvents(); // also binds the theme-toggle button
  connect();
  requestNotification();
});

// ── Network ────────────────────────────────────────────────────────────────────

/** Derive the WS URL from the current page location (works on localhost and LAN). */
function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

/** Open a WebSocket connection with automatic reconnection. */
function connect() {
  clearTimeout(reconnectTimer);
  setStatus('connecting');
  socket = new WebSocket(wsUrl());

  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
    setStatus('connected');
    hideBanner();
    wsSend({ ip: myIp, message: `New User Join: ${myIp} - ${uId}` });
  });

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'pong') return; // heartbeat reply — nothing to show
      if (data.error) { showError(data.error); return; }
      displayMessage(data.message ?? '', data.ip ?? '', data.uId ?? '');
      showNotification(data.message ?? '');
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  });

  socket.addEventListener('close', () => {
    setStatus('disconnected');
    scheduleReconnect();
  });

  socket.addEventListener('error', (err) => {
    console.error('WebSocket error:', err);
    setStatus('disconnected');
  });
}

/** Reconnect with exponential backoff (capped) and a countdown banner. */
function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Reconnect.nextReconnectDelay(reconnectAttempts);
  reconnectAttempts += 1;
  showError(`Connection lost — reconnecting in ${Math.round(delay / 1000)}s…`, 0);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

/**
 * Send a message over the socket (no-op when disconnected).
 * @param {{ ip?: string, message?: string, uId?: string }} payload
 */
function wsSend({ ip = myIp, message = '', uId: id = uId } = {}) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ ip, message, uId: id }));
  } else {
    showError('Not connected — message not sent.');
  }
}

// ── UI helpers ─────────────────────────────────────────────────────────────────

/**
 * Update the connection status indicator.
 * @param {'connected'|'connecting'|'disconnected'} state
 */
function setStatus(state) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  if (!dot || !label) return;
  dot.className = `status-dot ${state}`;
  label.textContent = state === 'connected' ? 'Connected'
    : state === 'connecting' ? 'Connecting…' : 'Disconnected';
}

/**
 * Show a banner. Rate-limit and validation errors auto-hide after 4s;
 * pass durationMs = 0 to keep the banner until hideBanner() is called.
 * @param {string} text
 * @param {number} [durationMs] - auto-hide delay; 0 keeps it visible
 */
function showError(text, durationMs = 4000) {
  const banner = document.getElementById('error-banner');
  if (!banner) return;
  banner.textContent = text;
  banner.classList.add('visible');
  clearTimeout(bannerTimer);
  if (durationMs > 0) {
    bannerTimer = setTimeout(() => banner.classList.remove('visible'), durationMs);
  }
}

/** Hide the banner (e.g. once the socket reconnects). */
function hideBanner() {
  clearTimeout(bannerTimer);
  bannerTimer = null;
  const banner = document.getElementById('error-banner');
  if (banner) banner.classList.remove('visible');
}

/**
 * Append a message bubble to the chat box.
 * @param {string} message
 * @param {string} ip
 * @param {string} wsuId
 */
function displayMessage(message = '', ip = '', wsuId = '') {
  if (!message) return;
  const el = document.createElement('div');
  el.className = ip && uId === wsuId ? 'my-message' : 'other-message';
  el.textContent = message;
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ── Events ─────────────────────────────────────────────────────────────────────

function bindSendEvents() {
  const send = () => {
    const message = input.value.trim();
    if (!message) return;
    wsSend({ message });
    input.value = '';
    input.focus();
  };
  document.getElementById('input-form').addEventListener('submit', (event) => {
    event.preventDefault();
    send();
  });

  const themeToggle = document.getElementById('theme-toggle');
  themeToggle.addEventListener('click', toggleTheme);
}

// ── Notifications ─────────────────────────────────────────────────────────────

function requestNotification() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

/**
 * @param {string} message
 */
function showNotification(message) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification('New Message', { body: message });
  } catch {
    // Notification API can throw in some browsers — ignore silently
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

/** Fetch the public IP (best effort). */
async function getIp() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip;
  } catch (err) {
    console.warn('Could not determine public IP:', err);
    return null;
  }
}

/** Generate a UUID, preferring the native crypto API. */
function generateUUID() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Theme ──────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('chat-theme', theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') ?? 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// Restore saved or system-preferred theme on load
(function initTheme() {
  const saved = localStorage.getItem('chat-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ?? (prefersDark ? 'dark' : 'light'));
})();
