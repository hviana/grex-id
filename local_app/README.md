# 📡 Camera Network Manager

A single-page Deno web application for connecting to and managing network
cameras via RTSP.

## Requirements

- **Deno** (v1.40+ recommended)
- **FFmpeg** installed and available in PATH (for RTSP → MJPEG decoding)

## Quick Start

```bash
# Navigate to the project directory
cd camera-app

# Start the server
deno serve --allow-net --allow-read --allow-write --allow-run server.ts
```

The application will be available at `http://localhost:8000`.

## Architecture

```
camera-app/
├── server.ts     # Deno server — API routes, RTSP streaming, JSON storage
├── index.html    # Single-page frontend — login, camera list, stream viewer
├── data.json     # Persistent storage (auto-created)
└── README.md
```

### API Routes

| Method | Path               | Description                       |
| ------ | ------------------ | --------------------------------- |
| GET    | `/`                | Serve the HTML frontend           |
| GET    | `/api/status`      | Check authentication status       |
| POST   | `/api/login`       | Authenticate (stub: 2s delay)     |
| POST   | `/api/logout`      | Clear token and stop all streams  |
| GET    | `/api/cameras`     | List available cameras (stub)     |
| GET    | `/api/connections` | Get saved connections with status |
| POST   | `/api/connections` | Save/update a connection          |
| DELETE | `/api/connections` | Remove a connection               |
| GET    | `/api/stream/:id`  | WebSocket for live RTSP frames    |

### Skeleton Functions

Three async functions serve as integration points for real implementations:

- **`login(user, pass)`** — Returns a fictitious token after a 2-second delay.
- **`list()`** — Returns a sample camera ("Living Room") after a 2-second delay.
- **`process(frame)`** — Receives each JPEG frame before it's sent to clients.
  Placeholder for analytics, motion detection, etc.

### RTSP Streaming Pipeline

1. FFmpeg spawns with `-f mjpeg` to convert RTSP → MJPEG on stdout
2. Server parses JPEG SOI/EOI markers from the byte stream
3. Each complete frame passes through the `process()` function
4. Frames are base64-encoded and sent to connected WebSocket clients
5. The browser draws each frame on a `<canvas>` element

### Reconnection Logic

- Streams are continuously monitored
- On stream drop: automatic reconnect with exponential back-off (up to 10
  attempts)
- If IP change is detected, `list()` is called to resolve the new IP by MAC
  address
- Updated IPs are persisted to `data.json`

## Notes

- All data is stored in `data.json` (token + connections)
- The interface is mobile-first with a dark glassmorphism theme
- Emojis are used instead of icon libraries
- No external frontend dependencies — pure HTML, CSS, and JavaScript
