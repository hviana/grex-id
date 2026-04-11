// =============================================================================
// Camera Network Manager — Deno Server
// =============================================================================
// A single-page web application for connecting to network cameras via RTSP.
// All persistent data is stored in a local JSON file.
// =============================================================================

import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_FILE = join(Deno.cwd(), "data.json");
const HTML_FILE = join(Deno.cwd(), "index.html");
const RECONNECT_DELAY_MS = 5_000;
const RECONNECT_MAX_ATTEMPTS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CameraInfo {
  name: string;
  ip: string;
  mac: string;
}

interface Connection {
  id: string;
  cameraName: string;
  username: string;
  password: string;
  ip: string;
  port: string;
  path: string;
  mac: string;
}

interface AppData {
  token: string | null;
  connections: Connection[];
}

// ---------------------------------------------------------------------------
// Data persistence helpers
// ---------------------------------------------------------------------------

async function readData(): Promise<AppData> {
  try {
    const raw = await Deno.readTextFile(DATA_FILE);
    return JSON.parse(raw) as AppData;
  } catch {
    const defaults: AppData = { token: null, connections: [] };
    await writeData(defaults);
    return defaults;
  }
}

async function writeData(data: AppData): Promise<void> {
  await Deno.writeTextFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Skeleton async functions (business-logic stubs)
// ---------------------------------------------------------------------------

/** Simulates authentication — returns a fictitious token after 2 s. */
async function login(_user: string, _pass: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 2000));
  return "tk_" + crypto.randomUUID();
}

/** Simulates fetching the camera list — returns one camera after 2 s. */
async function list(): Promise<CameraInfo[]> {
  await new Promise((r) => setTimeout(r, 2000));
  return [
    { name: "Living Room", ip: "192.168.100.106", mac: "fc:23:cd:46:33:89" },
  ];
}

/**
 * Processes a single video frame (skeleton).
 * In production this could run analytics, motion detection, etc.
 */
async function process(frame: Uint8Array): Promise<Uint8Array> {
  // Stub — returns the frame unchanged.
  await Promise.resolve();
  return frame;
}

// ---------------------------------------------------------------------------
// Active RTSP stream management
// ---------------------------------------------------------------------------

interface StreamHandle {
  connectionId: string;
  proc: Deno.ChildProcess | null;
  sockets: Set<WebSocket>;
  status: "connecting" | "connected" | "error" | "reconnecting";
  error: string;
  reconnectAttempts: number;
  abortController: AbortController;
}

const activeStreams = new Map<string, StreamHandle>();

/** Build an RTSP URL from connection parameters. */
function buildRtspUrl(c: Connection): string {
  return `rtsp://${encodeURIComponent(c.username)}:${
    encodeURIComponent(c.password)
  }@${c.ip}:${c.port}/${c.path}`;
}

/** Parse MJPEG boundaries from an FFmpeg stdout stream. */
async function readMjpegFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handle: StreamHandle,
) {
  const SOI = 0xff_d8; // JPEG Start-Of-Image
  const EOI = 0xff_d9; // JPEG End-Of-Image
  let buffer = new Uint8Array(0);

  const concat = (a: Uint8Array, b: Uint8Array) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = concat(buffer, value);

      // Extract complete JPEG frames from the buffer.
      while (true) {
        // Find SOI marker.
        let soiIdx = -1;
        for (let i = 0; i < buffer.length - 1; i++) {
          if (buffer[i] === 0xff && buffer[i + 1] === 0xd8) {
            soiIdx = i;
            break;
          }
        }
        if (soiIdx === -1) break;

        // Find EOI marker after SOI.
        let eoiIdx = -1;
        for (let i = soiIdx + 2; i < buffer.length - 1; i++) {
          if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) {
            eoiIdx = i + 2;
            break;
          }
        }
        if (eoiIdx === -1) break;

        // Complete JPEG frame found.
        const frame = buffer.slice(soiIdx, eoiIdx);
        buffer = buffer.slice(eoiIdx);

        // Run through the process function.
        const processed = await process(frame);

        // Broadcast to connected WebSocket clients.
        const b64 = btoa(
          String.fromCharCode(...processed),
        );
        const msg = JSON.stringify({ type: "frame", data: b64 });
        for (const ws of handle.sockets) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
          }
        }

        // Mark as connected on first successful frame.
        if (handle.status !== "connected") {
          handle.status = "connected";
          handle.error = "";
          handle.reconnectAttempts = 0;
          broadcastStatus(handle);
        }
      }
    }
  } catch (err) {
    if (!handle.abortController.signal.aborted) {
      handle.status = "error";
      handle.error = String(err);
      broadcastStatus(handle);
    }
  }
}

/** Notify all WebSocket clients of the stream status. */
function broadcastStatus(handle: StreamHandle) {
  const msg = JSON.stringify({
    type: "status",
    connectionId: handle.connectionId,
    status: handle.status,
    error: handle.error,
  });
  for (const ws of handle.sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

/** Try to resolve a new IP for a camera by its MAC address. */
async function resolveIpByMac(mac: string): Promise<string | null> {
  const cameras = await list();
  const match = cameras.find((c) => c.mac === mac);
  return match ? match.ip : null;
}

/** Start (or restart) an RTSP stream for a connection. */
async function startStream(connection: Connection): Promise<StreamHandle> {
  let handle = activeStreams.get(connection.id);
  if (handle) {
    // Kill any existing process.
    try {
      handle.proc?.kill("SIGTERM");
    } catch { /* ignore */ }
    handle.abortController.abort();
  }

  const ac = new AbortController();
  handle = {
    connectionId: connection.id,
    proc: null,
    sockets: handle?.sockets ?? new Set(),
    status: "connecting",
    error: "",
    reconnectAttempts: 0,
    abortController: ac,
  };
  activeStreams.set(connection.id, handle);
  broadcastStatus(handle);

  await spawnFfmpeg(connection, handle);
  return handle;
}

/** Spawn the FFmpeg process that converts RTSP → MJPEG on stdout. */
async function spawnFfmpeg(connection: Connection, handle: StreamHandle) {
  const url = buildRtspUrl(connection);

  try {
    const cmd = new Deno.Command("ffmpeg", {
      args: [
        "-rtsp_transport",
        "tcp",
        "-i",
        url,
        "-f",
        "mjpeg",
        "-q:v",
        "5",
        "-r",
        "15",
        "-an",
        "pipe:1",
      ],
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });

    const proc = cmd.spawn();
    handle.proc = proc;

    // Read stderr in background so it doesn't block.
    const stderrReader = proc.stderr.getReader();
    (async () => {
      const decoder = new TextDecoder();
      let stderrText = "";
      try {
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          stderrText += decoder.decode(value, { stream: true });
        }
      } catch { /* ignore */ }

      // If process ended and we didn't abort, it's an error.
      if (
        !handle.abortController.signal.aborted && handle.status !== "connected"
      ) {
        handle.status = "error";
        // Extract meaningful error from ffmpeg output.
        const lines = stderrText.split("\n").filter((l) => l.trim());
        handle.error = lines.slice(-3).join(" ") ||
          "FFmpeg exited unexpectedly";
        broadcastStatus(handle);
      }
    })();

    // Read MJPEG frames from stdout.
    const stdoutReader = proc.stdout.getReader();
    readMjpegFrames(stdoutReader, handle).then(async () => {
      // Stream ended — attempt reconnect if not explicitly stopped.
      if (!handle.abortController.signal.aborted) {
        handle.status = "reconnecting";
        handle.error = "Stream ended — attempting reconnect…";
        broadcastStatus(handle);
        await attemptReconnect(connection, handle);
      }
    });
  } catch (err) {
    handle.status = "error";
    handle.error = `Failed to launch FFmpeg: ${err}`;
    broadcastStatus(handle);
    if (!handle.abortController.signal.aborted) {
      await attemptReconnect(connection, handle);
    }
  }
}

/** Reconnection loop with exponential back-off and IP re-resolution. */
async function attemptReconnect(connection: Connection, handle: StreamHandle) {
  while (
    handle.reconnectAttempts < RECONNECT_MAX_ATTEMPTS &&
    !handle.abortController.signal.aborted
  ) {
    handle.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * handle.reconnectAttempts;
    handle.status = "reconnecting";
    handle.error =
      `Reconnect attempt ${handle.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS} in ${
        delay / 1000
      }s…`;
    broadcastStatus(handle);

    await new Promise((r) => setTimeout(r, delay));
    if (handle.abortController.signal.aborted) return;

    // Try to resolve a new IP in case it changed.
    const newIp = await resolveIpByMac(connection.mac);
    if (newIp && newIp !== connection.ip) {
      connection.ip = newIp;
      // Persist the updated IP.
      const data = await readData();
      const idx = data.connections.findIndex((c) => c.id === connection.id);
      if (idx !== -1) {
        data.connections[idx].ip = newIp;
        await writeData(data);
      }
      handle.error = `IP changed to ${newIp} — reconnecting…`;
      broadcastStatus(handle);
    }

    handle.status = "connecting";
    broadcastStatus(handle);

    await spawnFfmpeg(connection, handle);
    // If spawnFfmpeg didn't immediately error, break out — the read loop handles the rest.
    if (handle.status === "connecting" || handle.status === "connected") return;
  }

  if (!handle.abortController.signal.aborted) {
    handle.status = "error";
    handle.error = "Max reconnect attempts reached. Please reconnect manually.";
    broadcastStatus(handle);
  }
}

/** Stop a stream gracefully. */
function stopStream(connectionId: string) {
  const handle = activeStreams.get(connectionId);
  if (!handle) return;
  handle.abortController.abort();
  try {
    handle.proc?.kill("SIGTERM");
  } catch { /* ignore */ }
  activeStreams.delete(connectionId);
}

// ---------------------------------------------------------------------------
// Auto-start streams on server boot
// ---------------------------------------------------------------------------

async function autoStartStreams() {
  const data = await readData();
  if (!data.token || data.connections.length === 0) return;
  console.log(`[boot] Auto-starting ${data.connections.length} stream(s)…`);
  for (const conn of data.connections) {
    startStream({ ...conn });
  }
}

// Fire-and-forget on module load.
autoStartStreams();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // --- Serve the single-page frontend ----------------------------------
  if (path === "/" && method === "GET") {
    try {
      const content = await Deno.readTextFile(HTML_FILE);
      return html(content);
    } catch {
      return new Response("index.html not found", { status: 500 });
    }
  }

  // --- Auth status -----------------------------------------------------
  if (path === "/api/status" && method === "GET") {
    const data = await readData();
    return json({ loggedIn: !!data.token });
  }

  // --- Login -----------------------------------------------------------
  if (path === "/api/login" && method === "POST") {
    const { username, password } = await request.json();
    const token = await login(username, password);
    const data = await readData();
    data.token = token;
    await writeData(data);
    return json({ ok: true, token });
  }

  // --- Logout ----------------------------------------------------------
  if (path === "/api/logout" && method === "POST") {
    // Stop all active streams.
    for (const [id] of activeStreams) stopStream(id);
    const data = await readData();
    data.token = null;
    await writeData(data);
    return json({ ok: true });
  }

  // --- List cameras ----------------------------------------------------
  if (path === "/api/cameras" && method === "GET") {
    const cameras = await list();
    return json({ cameras });
  }

  // --- Get saved connections -------------------------------------------
  if (path === "/api/connections" && method === "GET") {
    const data = await readData();
    // Attach live status to each connection.
    const enriched = data.connections.map((c) => {
      const handle = activeStreams.get(c.id);
      return {
        ...c,
        streamStatus: handle?.status ?? "disconnected",
        streamError: handle?.error ?? "",
      };
    });
    return json({ connections: enriched });
  }

  // --- Save a new connection -------------------------------------------
  if (path === "/api/connections" && method === "POST") {
    const body = await request.json() as Connection;
    body.id = body.id || crypto.randomUUID();
    const data = await readData();
    // Upsert.
    const idx = data.connections.findIndex((c) => c.id === body.id);
    if (idx !== -1) {
      data.connections[idx] = body;
    } else {
      data.connections.push(body);
    }
    await writeData(data);
    // Auto-start the stream.
    startStream({ ...body });
    return json({ ok: true, connection: body });
  }

  // --- Delete a connection ---------------------------------------------
  if (path === "/api/connections" && method === "DELETE") {
    const { id } = await request.json();
    stopStream(id);
    const data = await readData();
    data.connections = data.connections.filter((c) => c.id !== id);
    await writeData(data);
    return json({ ok: true });
  }

  // --- WebSocket for live stream ---------------------------------------
  if (path.startsWith("/api/stream/") && method === "GET") {
    const connectionId = path.split("/api/stream/")[1];
    const upgrade = request.headers.get("upgrade") || "";
    if (upgrade.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const { socket, response } = Deno.upgradeWebSocket(request);

    socket.onopen = () => {
      const handle = activeStreams.get(connectionId);
      if (handle) {
        handle.sockets.add(socket);
        // Send current status immediately.
        socket.send(JSON.stringify({
          type: "status",
          connectionId: handle.connectionId,
          status: handle.status,
          error: handle.error,
        }));
      } else {
        socket.send(JSON.stringify({
          type: "status",
          connectionId,
          status: "disconnected",
          error: "No active stream for this connection.",
        }));
      }
    };

    socket.onclose = () => {
      const handle = activeStreams.get(connectionId);
      if (handle) handle.sockets.delete(socket);
    };

    socket.onerror = () => {
      const handle = activeStreams.get(connectionId);
      if (handle) handle.sockets.delete(socket);
    };

    // Allow clients to send commands (e.g., manual reconnect).
    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "reconnect") {
          const data = await readData();
          const conn = data.connections.find((c) => c.id === connectionId);
          if (conn) startStream({ ...conn });
        }
      } catch { /* ignore bad messages */ }
    };

    return response;
  }

  // --- 404 fallback ----------------------------------------------------
  return new Response("Not Found", { status: 404 });
}

// ---------------------------------------------------------------------------
// Deno Serve Export
// ---------------------------------------------------------------------------

export default {
  fetch(request: Request): Promise<Response> | Response {
    return handleRequest(request);
  },
} satisfies Deno.ServeDefaultExport;
