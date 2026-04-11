// =============================================================================
// Grex-ID Camera Bridge — Deno Server
// =============================================================================
// Local bridge between on-premise RTSP cameras and a remote Grex-ID instance.
// All persistent data (grex-id token, base URL and saved camera connections)
// is stored in a local JSON file.
// =============================================================================

import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import Human from "npm:@vladmandic/human";

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
// ONVIF WS-Discovery (local network camera scan)
// ---------------------------------------------------------------------------
// Discovers ONVIF-compatible cameras on the LAN by replicating the strategy
// used by node-onvif (https://github.com/GuilhermeC18/node-onvif):
//
//   1. Open a UDP socket on an ephemeral port.
//   2. Send a SOAP WS-Discovery Probe to the multicast group
//      239.255.255.250:3702. Three probe types are sent
//      (NetworkVideoTransmitter, Device, NetworkVideoDisplay), each retried
//      DISCOVERY_RETRY_MAX times with DISCOVERY_INTERVAL_MS between rounds.
//   3. Listen for ProbeMatch responses for DISCOVERY_WAIT_MS, dedupe by the
//      EndpointReference URN, and pull the device URL from <XAddrs> and
//      the friendly name from the onvif://.../name/<value> scope.
//   4. Close the socket and look up each device's MAC in the kernel ARP
//      cache (populated as a side-effect of the inbound UDP responses).

const ONVIF_MULTICAST_ADDRESS = "239.255.255.250";
const ONVIF_DISCOVERY_PORT = 3702;
const DISCOVERY_INTERVAL_MS = 150;
const DISCOVERY_RETRY_MAX = 3;
const DISCOVERY_WAIT_MS = 3000;
const ONVIF_PROBE_TYPES = [
  "NetworkVideoTransmitter",
  "Device",
  "NetworkVideoDisplay",
] as const;

interface ProbeMatch {
  urn: string;
  xaddrs: string[];
  scopes: string[];
}

/** Build a WS-Discovery Probe SOAP envelope for the given ONVIF device type. */
function buildOnvifProbe(type: string): string {
  const uuid = crypto.randomUUID();
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"` +
    ` xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">` +
    `<s:Header>` +
    `<a:Action s:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>` +
    `<a:MessageID>uuid:${uuid}</a:MessageID>` +
    `<a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>` +
    `<a:To s:mustUnderstand="1">urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>` +
    `</s:Header>` +
    `<s:Body>` +
    `<Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery">` +
    `<d:Types xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"` +
    ` xmlns:dp0="http://www.onvif.org/ver10/network/wsdl">dp0:${type}</d:Types>` +
    `</Probe>` +
    `</s:Body>` +
    `</s:Envelope>`;
}

/**
 * Extract the URN, XAddrs and Scopes from a ProbeMatch SOAP response. Uses
 * regex with an optional namespace-prefix group because vendors disagree on
 * which prefix to emit (`wsa:` vs `a:`, `d:` vs `wsd:`, etc.).
 */
function parseProbeMatch(xml: string): ProbeMatch | null {
  const localTag = (name: string) =>
    new RegExp(
      `<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`,
      "i",
    );

  const xaddrsMatch = xml.match(localTag("XAddrs"));
  if (!xaddrsMatch) return null;

  const epRefMatch = xml.match(
    /<(?:[\w-]+:)?EndpointReference\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?EndpointReference>/i,
  );
  if (!epRefMatch) return null;
  const addrMatch = epRefMatch[1].match(localTag("Address"));
  if (!addrMatch) return null;

  const scopesMatch = xml.match(localTag("Scopes"));

  return {
    urn: addrMatch[1].trim(),
    xaddrs: xaddrsMatch[1].trim().split(/\s+/).filter(Boolean),
    scopes: scopesMatch
      ? scopesMatch[1].trim().split(/\s+/).filter(Boolean)
      : [],
  };
}

/** Pull a value from an `onvif://www.onvif.org/<category>/<value>` scope. */
function pickScopeValue(scopes: string[], category: string): string | null {
  const prefix = `onvif://www.onvif.org/${category}/`;
  for (const scope of scopes) {
    if (scope.toLowerCase().startsWith(prefix)) {
      const raw = scope.slice(prefix.length);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

function extractHostFromXAddr(xaddr: string): string | null {
  try {
    return new URL(xaddr).hostname;
  } catch {
    return null;
  }
}

/**
 * Resolve the MAC address for an IPv4 host from the kernel ARP cache. The
 * cache is populated passively when the kernel processes inbound packets,
 * so by the time we call this the discovery responses have already taught
 * the kernel each camera's MAC. Falls back to `ip neigh` if /proc/net/arp
 * is unavailable.
 */
async function resolveMacByIp(ip: string): Promise<string> {
  try {
    const text = await Deno.readTextFile("/proc/net/arp");
    // Columns: IP address, HW type, Flags, HW address, Mask, Device
    const lines = text.split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4 && parts[0] === ip) {
        const mac = parts[3];
        if (mac && mac !== "00:00:00:00:00:00") return mac.toLowerCase();
      }
    }
  } catch { /* not linux, unreadable, or no entry */ }

  try {
    const cmd = new Deno.Command("ip", {
      args: ["neigh", "show", ip],
      stdout: "piped",
      stderr: "null",
    });
    const { stdout } = await cmd.output();
    const out = new TextDecoder().decode(stdout);
    const m = out.match(/lladdr\s+([0-9a-fA-F:]{17})/);
    if (m) return m[1].toLowerCase();
  } catch { /* ignore */ }

  return "";
}

/** Local network ONVIF camera discovery via WS-Discovery multicast. */
async function list(): Promise<CameraInfo[]> {
  let conn: Deno.DatagramConn;
  try {
    conn = Deno.listenDatagram({
      port: 0,
      transport: "udp",
      hostname: "0.0.0.0",
    });
  } catch (err) {
    console.error("[onvif] failed to bind UDP socket:", err);
    return [];
  }

  const found = new Map<string, CameraInfo>();
  let active = true;

  // Sender loop: send each probe type DISCOVERY_RETRY_MAX times, spaced
  // by DISCOVERY_INTERVAL_MS. Mirrors node-onvif's startProbe scheduling.
  const sender = (async () => {
    for (let attempt = 0; attempt < DISCOVERY_RETRY_MAX && active; attempt++) {
      for (const type of ONVIF_PROBE_TYPES) {
        if (!active) return;
        try {
          await conn.send(
            new TextEncoder().encode(buildOnvifProbe(type)),
            {
              transport: "udp",
              hostname: ONVIF_MULTICAST_ADDRESS,
              port: ONVIF_DISCOVERY_PORT,
            },
          );
        } catch {
          // Socket closed by the discovery-window timeout — stop sending.
          return;
        }
      }
      await new Promise((r) => setTimeout(r, DISCOVERY_INTERVAL_MS));
    }
  })();

  // Receiver loop: read ProbeMatch responses until the socket is closed.
  const receiver = (async () => {
    while (active) {
      try {
        const [data, addr] = await conn.receive();
        const xml = new TextDecoder().decode(data);
        const match = parseProbeMatch(xml);
        if (!match || found.has(match.urn)) continue;

        const ip = match.xaddrs.map(extractHostFromXAddr).find((h) => h) ??
          (addr as Deno.NetAddr).hostname;
        const name = pickScopeValue(match.scopes, "name") ??
          `ONVIF Device (${ip})`;

        found.set(match.urn, { name, ip, mac: "" });
      } catch {
        return; // receive() throws once the socket is closed
      }
    }
  })();

  // Discovery window — then close the socket to unblock the receiver.
  await new Promise((r) => setTimeout(r, DISCOVERY_WAIT_MS));
  active = false;
  try {
    conn.close();
  } catch { /* already closed */ }
  await Promise.allSettled([sender, receiver]);

  // Resolve MAC addresses from the ARP cache populated by the responses.
  const cameras = Array.from(found.values());
  await Promise.all(
    cameras.map(async (cam) => {
      cam.mac = await resolveMacByIp(cam.ip);
    }),
  );

  return cameras;
}

// ---------------------------------------------------------------------------
// Face detection (Human)
// ---------------------------------------------------------------------------
// Lazily loaded singleton. Models download on first use and the first detect
// call pays the warm-up cost; subsequent frames reuse the cached weights.

const humanConfig = {
  backend: "tensorflow",
  modelBasePath: "https://vladmandic.github.io/human-models/models/",
  cacheModels: true,
  debug: false,
  face: {
    enabled: true,
    detector: { rotation: false, maxDetected: 10, minConfidence: 0.5 },
    description: { enabled: true },
    mesh: { enabled: false },
    iris: { enabled: false },
    emotion: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false },
};

// deno-lint-ignore no-explicit-any
let humanInstance: any = null;
// deno-lint-ignore no-explicit-any
let humanLoadPromise: Promise<any> | null = null;

// deno-lint-ignore no-explicit-any
function getHuman(): Promise<any> {
  if (humanInstance) return Promise.resolve(humanInstance);
  if (!humanLoadPromise) {
    humanLoadPromise = (async () => {
      // deno-lint-ignore no-explicit-any
      const instance = new (Human as any)(humanConfig);
      await instance.load();
      await instance.warmup();
      humanInstance = instance;
      console.log("[human] models loaded and warmed up");
      return instance;
    })();
  }
  return humanLoadPromise;
}

/**
 * Decode a JPEG frame and run Human face detection. Returns the frame
 * untouched plus the 1024-d embeddings of every detected face. Errors are
 * swallowed so a single bad frame never tears down the stream.
 */
async function process(
  frame: Uint8Array,
): Promise<{ frame: Uint8Array; embeddings: number[][] }> {
  try {
    const human = await getHuman();
    const tensor = human.tf.node.decodeJpeg(frame, 3);
    const result = await human.detect(tensor);
    tensor.dispose();
    const embeddings: number[][] = (result.face ?? [])
      .map((f: { embedding?: number[] }) => f.embedding)
      .filter((e: number[] | undefined): e is number[] =>
        Array.isArray(e) && e.length > 0
      );
    return { frame, embeddings };
  } catch (err) {
    console.error("[human] detection failed:", err);
    return { frame, embeddings: [] };
  }
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

// Face detection tunables — safe to edit.
const DETECT_EVERY_N_FRAMES = 15; // Skip intermediate frames; Human is expensive.
const FACE_DEDUP_SIMILARITY_THRESHOLD = 0.6; // Cosine sim above which two embeddings are the same person.
const FACE_DEDUP_TTL_MS = 45_000; // A tracked face stays silent until unseen for at least this long.
const FACE_BATCH_WINDOW_MS = 500; // Coalesce new uniques detected within this window into a single POST.

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function readMjpegFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handle: StreamHandle,
  connection: Connection,
) {
  let buffer = new Uint8Array(0);
  let frameCounter = 0;

  // Per-stream face dedup + batching state. Reset on every (re)spawn so a
  // reconnect gives everyone a fresh chance to be reported.
  const trackedFaces: { embedding: number[]; lastSeen: number }[] = [];
  let pendingBatch: number[][] = [];
  let batchTimer: number | null = null;

  const flushBatch = () => {
    batchTimer = null;
    if (pendingBatch.length === 0) return;
    const toSend = pendingBatch;
    pendingBatch = [];
    sendDetection(toSend, connection.locationId).catch((err) => {
      console.error(
        `[detect] ${connection.id} → ${connection.locationId} failed:`,
        err,
      );
    });
  };

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

        frameCounter++;
        const shouldDetect = frameCounter % DETECT_EVERY_N_FRAMES === 0;
        const { frame: processed, embeddings } = shouldDetect
          ? await process(frame)
          : { frame, embeddings: [] as number[][] };

        if (embeddings.length > 0) {
          const now = Date.now();
          // Drop tracked faces we haven't seen in a while so returning
          // visitors trigger a new detection event.
          for (let i = trackedFaces.length - 1; i >= 0; i--) {
            if (now - trackedFaces[i].lastSeen > FACE_DEDUP_TTL_MS) {
              trackedFaces.splice(i, 1);
            }
          }
          for (const embedding of embeddings) {
            let matched = false;
            for (const tracked of trackedFaces) {
              if (
                cosineSimilarity(embedding, tracked.embedding) >=
                  FACE_DEDUP_SIMILARITY_THRESHOLD
              ) {
                // Same person still in frame — just refresh their TTL.
                tracked.lastSeen = now;
                matched = true;
                break;
              }
            }
            if (!matched) {
              trackedFaces.push({ embedding, lastSeen: now });
              pendingBatch.push(embedding);
            }
          }
          if (pendingBatch.length > 0 && batchTimer === null) {
            batchTimer = setTimeout(flushBatch, FACE_BATCH_WINDOW_MS);
          }
        }

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
    readMjpegFrames(stdoutReader, handle, connection).then(async () => {
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
