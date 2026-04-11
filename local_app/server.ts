// =============================================================================
// Grex-ID Camera Bridge — Deno Server
// =============================================================================
// Local bridge between on-premise RTSP cameras and a remote Grex-ID instance.
// All persistent data (grex-id token, base URL and saved camera connections)
// is stored in a local JSON file.
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
  locationId: string;
  locationName: string;
}

interface AppData {
  grexBaseUrl: string;
  grexToken: string | null;
  connections: Connection[];
}

const DEFAULTS: AppData = {
  grexBaseUrl: "",
  grexToken: null,
  connections: [],
};

// ---------------------------------------------------------------------------
// Data persistence helpers
// ---------------------------------------------------------------------------

async function readData(): Promise<AppData> {
  try {
    const raw = await Deno.readTextFile(DATA_FILE);
    const parsed = JSON.parse(raw) as Partial<AppData>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    await writeData(DEFAULTS);
    return { ...DEFAULTS };
  }
}

async function writeData(data: AppData): Promise<void> {
  await Deno.writeTextFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Local network camera discovery stub
// ---------------------------------------------------------------------------

/** Fake local network scan — returns a hardcoded camera after a short delay. */
async function list(): Promise<CameraInfo[]> {
  await new Promise((r) => setTimeout(r, 2000));
  return [
    { name: "Living Room", ip: "192.168.100.106", mac: "fc:23:cd:46:33:89" },
  ];
}

/**
 * Per-frame processing stub. This is where face detection / embedding
 * extraction would run in production. Returns the frame unchanged.
 */
async function process(frame: Uint8Array): Promise<Uint8Array> {
  await Promise.resolve();
  return frame;
}

// ---------------------------------------------------------------------------
// Grex-ID API helpers
// ---------------------------------------------------------------------------

function grexHeaders(token: string): HeadersInit {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function grexBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Validate grex-id connectivity by hitting the locations endpoint. */
async function checkGrexConnection(): Promise<{
  ok: boolean;
  status: number;
  message: string;
}> {
  const d = await readData();
  if (!d.grexToken || !d.grexBaseUrl) {
    return {
      ok: false,
      status: 0,
      message: "Grex-ID is not configured yet.",
    };
  }
  try {
    const res = await fetch(
      `${grexBase(d.grexBaseUrl)}/api/systems/grex-id/locations?limit=1`,
      { headers: grexHeaders(d.grexToken) },
    );
    if (res.ok) {
      return { ok: true, status: res.status, message: "Connection OK" };
    }
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error?.message) msg = `${msg} — ${body.error.message}`;
    } catch { /* ignore */ }
    return { ok: false, status: res.status, message: msg };
  } catch (err) {
    return { ok: false, status: 0, message: String(err) };
  }
}

/** Search locations on grex-id. Returns a normalized [{id, name}] list. */
async function listGrexLocations(
  search: string,
): Promise<{ id: string; name: string }[]> {
  const d = await readData();
  if (!d.grexToken || !d.grexBaseUrl) {
    throw new Error("Grex-ID is not configured.");
  }
  const url = new URL(
    `${grexBase(d.grexBaseUrl)}/api/systems/grex-id/locations`,
  );
  url.searchParams.set("limit", "20");
  if (search) url.searchParams.set("search", search);

  const res = await fetch(url, { headers: grexHeaders(d.grexToken) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows
    .map((r: Record<string, unknown>) => ({
      id: String(r.id ?? ""),
      name: String(r.name ?? ""),
    }))
    .filter((r) => r.id);
}

/**
 * Send a batch of face embeddings (each length 1024) and a location ID to
 * the grex-id detect endpoint using the configured Bearer token.
 */
async function sendDetection(
  embeddings: number[][],
  locationId: string,
): Promise<unknown> {
  const d = await readData();
  if (!d.grexToken || !d.grexBaseUrl) {
    throw new Error("Grex-ID is not configured.");
  }
  const res = await fetch(
    `${grexBase(d.grexBaseUrl)}/api/systems/grex-id/detect`,
    {
      method: "POST",
      headers: grexHeaders(d.grexToken),
      body: JSON.stringify({ locationId, embeddings }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
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

function buildRtspUrl(c: Connection): string {
  return `rtsp://${encodeURIComponent(c.username)}:${
    encodeURIComponent(c.password)
  }@${c.ip}:${c.port}/${c.path}`;
}

async function readMjpegFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handle: StreamHandle,
) {
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

      while (true) {
        let soiIdx = -1;
        for (let i = 0; i < buffer.length - 1; i++) {
          if (buffer[i] === 0xff && buffer[i + 1] === 0xd8) {
            soiIdx = i;
            break;
          }
        }
        if (soiIdx === -1) break;

        let eoiIdx = -1;
        for (let i = soiIdx + 2; i < buffer.length - 1; i++) {
          if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) {
            eoiIdx = i + 2;
            break;
          }
        }
        if (eoiIdx === -1) break;

        const frame = buffer.slice(soiIdx, eoiIdx);
        buffer = buffer.slice(eoiIdx);

        const processed = await process(frame);

        const b64 = btoa(String.fromCharCode(...processed));
        const msg = JSON.stringify({ type: "frame", data: b64 });
        for (const ws of handle.sockets) {
          if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }

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

async function resolveIpByMac(mac: string): Promise<string | null> {
  const cameras = await list();
  const match = cameras.find((c) => c.mac === mac);
  return match ? match.ip : null;
}

async function startStream(connection: Connection): Promise<StreamHandle> {
  let handle = activeStreams.get(connection.id);
  if (handle) {
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

      if (
        !handle.abortController.signal.aborted && handle.status !== "connected"
      ) {
        handle.status = "error";
        const lines = stderrText.split("\n").filter((l) => l.trim());
        handle.error = lines.slice(-3).join(" ") ||
          "FFmpeg exited unexpectedly";
        broadcastStatus(handle);
      }
    })();

    const stdoutReader = proc.stdout.getReader();
    readMjpegFrames(stdoutReader, handle).then(async () => {
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

    const newIp = await resolveIpByMac(connection.mac);
    if (newIp && newIp !== connection.ip) {
      connection.ip = newIp;
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
    if (handle.status === "connecting" || handle.status === "connected") return;
  }

  if (!handle.abortController.signal.aborted) {
    handle.status = "error";
    handle.error = "Max reconnect attempts reached. Please reconnect manually.";
    broadcastStatus(handle);
  }
}

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
  if (
    !data.grexToken || !data.grexBaseUrl || data.connections.length === 0
  ) return;
  console.log(`[boot] Auto-starting ${data.connections.length} stream(s)…`);
  for (const conn of data.connections) {
    startStream({ ...conn });
  }
}

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

  // Serve the single-page frontend.
  if (path === "/" && method === "GET") {
    try {
      const content = await Deno.readTextFile(HTML_FILE);
      return html(content);
    } catch {
      return new Response("index.html not found", { status: 500 });
    }
  }

  // --- Configuration (grex-id base URL + token) ---
  if (path === "/api/config" && method === "GET") {
    const d = await readData();
    return json({
      grexBaseUrl: d.grexBaseUrl,
      grexToken: d.grexToken ?? "",
      configured: !!(d.grexBaseUrl && d.grexToken),
    });
  }

  if (path === "/api/config" && method === "POST") {
    const body = await request.json();
    const grexBaseUrl = String(body.grexBaseUrl ?? "").trim();
    const grexToken = String(body.grexToken ?? "").trim();
    if (!grexBaseUrl || !grexToken) {
      return json(
        { ok: false, error: "grexBaseUrl and grexToken are required." },
        400,
      );
    }
    const d = await readData();
    d.grexBaseUrl = grexBaseUrl;
    d.grexToken = grexToken;
    await writeData(d);
    // Restart all streams under the new configuration.
    for (const [id] of activeStreams) stopStream(id);
    for (const conn of d.connections) startStream({ ...conn });
    return json({ ok: true });
  }

  // --- Grex-ID: connection health check ---
  if (path === "/api/grex/check" && method === "GET") {
    const result = await checkGrexConnection();
    return json(result);
  }

  // --- Grex-ID: searchable location list ---
  if (path === "/api/grex/locations" && method === "GET") {
    const search = url.searchParams.get("search") ?? "";
    try {
      const locations = await listGrexLocations(search);
      return json({ ok: true, locations });
    } catch (err) {
      return json(
        { ok: false, error: String(err), locations: [] },
        502,
      );
    }
  }

  // --- Grex-ID: detect (programmatic bridge endpoint) ---
  if (path === "/api/grex/detect" && method === "POST") {
    try {
      const { embeddings, locationId } = await request.json();
      const data = await sendDetection(embeddings, locationId);
      return json({ ok: true, data });
    } catch (err) {
      return json({ ok: false, error: String(err) }, 502);
    }
  }

  // --- Local network camera discovery ---
  if (path === "/api/cameras" && method === "GET") {
    const cameras = await list();
    return json({ cameras });
  }

  // --- Saved connections ---
  if (path === "/api/connections" && method === "GET") {
    const data = await readData();
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

  if (path === "/api/connections" && method === "POST") {
    const body = await request.json() as Connection;
    body.id = body.id || crypto.randomUUID();
    if (!body.locationId || !body.locationName) {
      return json(
        { ok: false, error: "locationId and locationName are required." },
        400,
      );
    }
    const data = await readData();
    const idx = data.connections.findIndex((c) => c.id === body.id);
    if (idx !== -1) {
      data.connections[idx] = body;
    } else {
      data.connections.push(body);
    }
    await writeData(data);
    startStream({ ...body });
    return json({ ok: true, connection: body });
  }

  if (path === "/api/connections" && method === "DELETE") {
    const { id } = await request.json();
    stopStream(id);
    const data = await readData();
    data.connections = data.connections.filter((c) => c.id !== id);
    await writeData(data);
    return json({ ok: true });
  }

  // --- WebSocket for live stream ---
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
