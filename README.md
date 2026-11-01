# tool-web-socket-express

Realtime chat over WebSockets, served by **Express 5** — a standalone variant of [tool-web-socket](../tool-web-socket).

## Sự khác biệt với `tool-web-socket` (gốc)

| Tiêu chí | `tool-web-socket` (gốc) | `tool-web-socket-express` (repo này) |
|---|---|---|
| HTTP server | Không (chỉ WS) | Express phục vụ static UI |
| Port | WS :8080 riêng | HTTP + WS **cùng 1 port** (`/ws`) |
| UI | Thư mục `ui/` tách rời | Được Express serve tại `/` |
| Deploy | Docker | Node thuần |
| Logic broadcast | `server/app.js` | `src/hub.js` |

> **Lý do giữ 2 repo tách biệt:** mô hình triển khai khác nhau (Docker + WS thuần vs Node + Express). Logic chat được giữ riêng trong `src/hub.js` của repo này — không duplicate với repo gốc, mỗi repo tự chủ vòng đời của mình.

## Features

- **Single port** — HTTP static + WebSocket cùng server (path `/ws`)
- **Heartbeat / ping-pong** — tự động ngắt kết nối "chết" (WS protocol + app-level `{ type: "ping" }` → `{ type: "pong" }`)
- **Rate limiting** — giới hạn 30 tin nhắn/kết nối mỗi 10 giây (cấu hình được)
- **Origin check** — allowlist origin cho WS upgrade qua listener `server.on('upgrade')` (mặc định cho phép tất cả; cảnh báo khi production dùng `'*'`)
- **Auto-reconnect** — client thử lại với exponential backoff, banner hiển thị đếm ngược
- **Graceful shutdown** — SIGINT/SIGTERM: đóng WS clients với close code 1001, đóng HTTP server, exit 0 (force-exit sau 5s)
- **Health check** — `GET /healthz` (nhẹ) và `GET /health` (uptime, số WS client, memory)
- **Dark mode** — tự động theo hệ thống, có nút bật/tắt, lưu localStorage
- **Responsive & accessible** — aria-live, sr-only labels, mobile-friendly
- **Notifications** — thông báo trình duyệt khi có tin nhắn mới
- **ESLint** — `npm run lint` (flat config, ESLint 9)

## Cài đặt & chạy

```bash
npm install
npm start          # production
npm run dev        # dev với auto-reload
npm test           # chạy test (node --test)
npm run lint       # ESLint
npm run smoke      # smoke test end-to-end
```

Biến môi trường:

| Biến | Mặc định | Mô tả |
|---|---|---|
| `PORT` | `3000` | Cổng HTTP + WS |
| `HOST` | `0.0.0.0` | Địa chỉ bind |
| `WS_PATH` | `/ws` | Đường dẫn WebSocket |
| `WS_ALLOWED_ORIGINS` | `*` | Allowlist Origin cho browser client, phân tách bằng dấu phẩy (vd: `https://a.com,https://b.com`); `*` = không kiểm tra (non-browser luôn được phép) |
| `NODE_ENV` | – | `production` → cache static 1 ngày; dùng `'*'` cho Origin ở production sẽ log cảnh báo |

## Cấu trúc

```
server.js          # Entry point: HTTP + WS + graceful shutdown
eslint.config.js   # ESLint 9 flat config
src/
  hub.js           # Chat hub: broadcast, heartbeat, rate limit, origin check (upgrade listener), JSON handling
  app.js           # Express app: static, /healthz, /health, error handling
client/            # Chat UI (HTML/CSS/JS)
  reconnect.js     # Backoff dùng chung client + tests
test/              # Unit + vận hành tests (node:test)
```

## API

- `WS /ws` — nhận `{ ip, uId, message }`, broadcast lại cho tất cả client
- `WS /ws` nhận `{ type: "ping" }` → trả `{ type: "pong" }` (không broadcast)
- `WS /ws` trả `{ error: "Invalid JSON format" }` nếu payload không hợp lệ
- `WS /ws` trả `{ error: "Rate limit exceeded. ..." }` khi vượt 30 tin nhắn/10s mỗi kết nối
- `WS /ws` đóng kết nối với HTTP 403 khi `Origin` không nằm trong allowlist; 404 cho path lạ; 503 khi hub đã đóng
- `GET /healthz` — `{ status: "ok", uptime: <seconds> }`
- `GET /health` — `{ status, uptime, wsClients, memory: { rss, heapUsed } }`

### Graceful shutdown

Nhận `SIGTERM`/`SIGINT` (Ctrl+C) → server:

1. gửi WebSocket close frame **1001 (Going Away)** cho mọi client — client thấy "Server going away" và tự reconnect;
2. đóng HTTP server, chờ request đang dở dang;
3. thoát với exit code **0**. Force-exit sau 5s nếu có kết nối treo.

## Bảo mật

| Cơ chế | Mô tả |
|---|---|
| `maxPayload` 16 KB | Frame WS vượt giới hạn bị đóng với code 1009 |
| Message validation | `message` phải là chuỗi không rỗng ≤ 4 KB |
| Rate limiting | 30 tin nhắn/kết nối mỗi 10 giây (tuỳ chọn `rateLimitMax: 0` để tắt) |
| Origin allowlist | `allowedOrigins: ['https://example.com']` hoặc env `WS_ALLOWED_ORIGINS` — mặc định `'*'` (không kiểm tra, cảnh báo ở production); client không gửi `Origin` (non-browser) luôn được phép; kiểm tra chạy trong listener `server.on('upgrade')` (thay `verifyClient` deprecated) |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Resource-Policy` |
| Path traversal | `express.static` chặn `..`, `dotfiles: 'ignore'` |
