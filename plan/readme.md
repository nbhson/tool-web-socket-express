# Plan — tool-web-socket-express

WebSocket + Express server (`server.js`, `src/`), node --test, có UI client.

## Baseline audit (00:44, 28-10-2026)
- Tests: ✅ **11 pass** (healthz, static UI, broadcast + error handling, smoke)
- Cấu trúc: server.js + src/ + client/ + test/

## P1 #3 (28-10-2026) — Hardening
### Issues fixed
- **[Bug]** No WebSocket payload limit: added `maxPayload: 16 KB` (configurable) to
  `WebSocketServer`. Frame size close code 1009.
- **[Bug]** No message validation: hub now rejects non-string / empty / oversized
  (> 4 KB) `message` fields with an error JSON. Previously broadcast any value
  including objects and non-string types.
- **[Bug]** XSS: both UI files use `textContent` (safe).
- **[Hardening]** Security headers: added `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Resource-Policy: same-origin` via lightweight middleware (no extra deps).
- **[Comment]** CORS note: app is same-origin by design — no CORS needed; cross-origin
  use must go through reverse proxy.
- **[Comment]** Path traversal safety: express.static blocks '..'; SPA fallback only
  sends a fixed, app-controlled path.
- **[Comment]** Express body: app has no body-parsing (GET-only surface); no HTTP
  payload to limit.
- **[Hardening]** `dotfiles: 'ignore'` in static config — prevents accidental dotfile exposure.

### Tests added (test/hardening.test.js — 6 tests, all pass)
- WS frame > maxPayload → close 1009.
- WS message validation: number, empty string, missing field → error JSON.
- WS message > 4 KB MAX_MESSAGE_LENGTH (but < maxPayload) → error JSON.
- HTTP security headers: `x-content-type-options`, `x-frame-options`, `referrer-policy`.
- Path traversal: `../../package.json`, encoded paths → never leaks package.json.
- Dotfile `.secret` never served.

### Final test count: **17/17** ✅ (was 11, now 17)

## npm audit
- ✅ No vulnerabilities (express ^5.0.0, ws ^8.0.0)

## Roadmap
### P0
- [x] Review server.js: error handling, limit kết nối, payload size, CORS

### P1 (chất lượng)
- [x] Bổ sung tests: disconnect, malformed WS frame, static path traversal
- [x] Kiểm tra deps cũ/lỗ hổng (`npm audit`)

### P2 (hardening)
- [ ] CI workflow
- [ ] README sync

## Self-review log
- _0:44_ Audit lần 1: 11/11 pass.
- _1:16_ P1 #3 hardened: maxPayload, message validation, security headers, 17/17 pass. No audit issues.
