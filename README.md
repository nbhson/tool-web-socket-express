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
- **Heartbeat / ping-pong** — tự động ngắt kết nối "chết"
- **Rate limiting** — giới hạn 30 tin nhắn/kết nối mỗi 10 giây (cấu hình được)
- **Origin check** — allowlist origin cho WS upgrade (mặc định cho phép tất cả)
- **Auto-reconnect** — client thử lại với exponential backoff
- **Graceful shutdown** — SIGINT/SIGTERM
- **Health check** — `GET /healthz`
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
| `NODE_ENV` | – | `production` → cache static 1 ngày |

## Cấu trúc

```
server.js          # Entry point: HTTP + WS + graceful shutdown
eslint.config.js   # ESLint 9 flat config
src/
  hub.js           # Chat hub: broadcast, heartbeat, rate limit, origin check, JSON handling
  app.js           # Express app: static, healthz, error handling
client/            # Chat UI (HTML/CSS/JS)
test/              # Unit tests (node:test)
```

## API

- `WS /ws` — nhận `{ ip, uId, message }`, broadcast lại cho tất cả client
- `WS /ws` trả `{ error: "Invalid JSON format" }` nếu payload không hợp lệ
- `WS /ws` trả `{ error: "Rate limit exceeded. ..." }` khi vượt 30 tin nhắn/10s mỗi kết nối
- `WS /ws` đóng kết nối với HTTP 401 khi `Origin` không nằm trong allowlist
- `GET /healthz` — `{ status: "ok", uptime: <seconds> }`

## Bảo mật

| Cơ chế | Mô tả |
|---|---|
| `maxPayload` 16 KB | Frame WS vượt giới hạn bị đóng với code 1009 |
| Message validation | `message` phải là chuỗi không rỗng ≤ 4 KB |
| Rate limiting | 30 tin nhắn/kết nối mỗi 10 giây (tuỳ chọn `rateLimitMax: 0` để tắt) |
| Origin allowlist | `allowedOrigins: ['https://example.com']` — mặc định `'*'` (không kiểm tra); client không gửi `Origin` (non-browser) luôn được phép |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Resource-Policy` |
| Path traversal | `express.static` chặn `..`, `dotfiles: 'ignore'` |
