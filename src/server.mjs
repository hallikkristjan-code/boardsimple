import http from "node:http";
import { watch } from "node:fs";
import { appendFile, readFile, mkdir, stat } from "node:fs/promises";
import { join, resolve, sep, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanScreens } from "./scan.mjs";
import { createStore } from "./annotations.mjs";

const DEFAULT_PORT = 4477;
const PORT_TRIES = 11; // 4477..4487
const MAX_BODY = 1024 * 1024;
const DEBOUNCE_MS = 100;
const PING_MS = 25_000;
// Screens share the canvas origin (needed for the element hit-test); block remote
// code so a CDN script in a screen cannot drive the annotations API.
// Remote fonts, styles and images stay allowed (common in mockups); scripts do not.
const SCREEN_CSP = [
  "default-src 'self' 'unsafe-inline' data: blob:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https:",
  "font-src 'self' data: https:",
  "img-src 'self' data: blob: https:",
].join("; ");
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Resolve URL path segments under base; null if it escapes base. */
function safeResolve(base, rawRest) {
  let segments;
  try {
    segments = rawRest.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.some((s) => s.includes("\0"))) return null;
  const target = resolve(base, ...segments);
  return target.startsWith(base + sep) ? target : null;
}

async function sendFile(res, path, extraHeaders = {}) {
  try {
    if (!(await stat(path)).isFile()) throw new HttpError(404, "not found");
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
      ...extraHeaders,
    });
    res.end(body);
  } catch (e) {
    if (e instanceof HttpError || e.code === "ENOENT" || e.code === "EISDIR") throw new HttpError(404, "not found");
    throw e;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    let tooBig = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) tooBig = true;
      else chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) return reject(new HttpError(413, "body too large"));
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function logLine(b) {
  if (!b || typeof b.event !== "string" || !/^[a-z-]{1,40}$/.test(b.event)) throw new HttpError(400, "invalid event");
  const entry = { at: new Date().toISOString(), event: b.event };
  for (const k of ["scale", "loaded", "boards"]) if (typeof b[k] === "number") entry[k] = b[k];
  return `${JSON.stringify(entry)}\n`;
}

const SHAPES = new Set(["ring", "box", "line", "arrow"]);
const MAX_POINTS = 2000;
const isPoint = (p) => typeof p?.x === "number" && typeof p?.y === "number";

function validateNote(b) {
  const shape = b?.shape ?? "ring";
  const drawn = shape === "line" || shape === "arrow";
  const ok =
    SHAPES.has(shape) &&
    (b?.color == null || /^#[0-9a-f]{6}$/.test(b.color)) &&
    (!drawn || (Array.isArray(b.points) && b.points.length >= 2 && b.points.length <= MAX_POINTS && b.points.every(isPoint))) &&
    b && typeof b === "object" &&
    typeof b.file === "string" &&
    typeof b.text === "string" &&
    b.box && ["x", "y", "w", "h"].every((k) => typeof b.box[k] === "number") &&
    (b.elements === undefined || Array.isArray(b.elements));
  if (!ok) throw new HttpError(400, "invalid note");
  return {
    file: b.file,
    fileHash: typeof b.fileHash === "string" ? b.fileHash : null,
    box: { x: b.box.x, y: b.box.y, w: b.box.w, h: b.box.h },
    text: b.text,
    elements: b.elements ?? [],
    shape,
    color: b.color ?? null,
    ...(drawn && { points: b.points.map(({ x, y }) => ({ x, y })) }),
    ...(shape === "line" && { closed: b.closed === true }),
  };
}

function debounced(fn) {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, DEBOUNCE_MS);
  };
}

/**
 * Watch <root>/<name>. A persistent non-recursive watcher on root re-creates the
 * inner watcher whenever <name> is created, deleted or replaced (Windows emits no
 * error when a watched folder is removed).
 */
function watchDir(root, name, { recursive }, onChange) {
  const dir = join(root, name);
  let inner = null;
  const arm = () => {
    inner?.close();
    inner = null;
    try {
      inner = watch(dir, { recursive }, onChange);
      inner.on("error", () => { inner?.close(); inner = null; });
    } catch { /* folder missing; the root watcher re-arms when it appears */ }
  };
  const rootWatcher = watch(root, (_ev, changed) => {
    if (changed === name) { arm(); onChange(); }
  });
  rootWatcher.on("error", () => {});
  arm();
  return () => { inner?.close(); rootWatcher.close(); };
}

function listen(server, port) {
  return new Promise((ok, fail) => {
    const onErr = (e) => { server.off("listening", onOk); fail(e); };
    const onOk = () => { server.off("error", onErr); ok(server.address().port); };
    server.once("error", onErr);
    server.once("listening", onOk);
    server.listen(port, "127.0.0.1");
  });
}

export async function startServer({ root, port, appDir = APP_DIR }) {
  root = resolve(root);
  const screensDir = join(root, "screens");
  const canvasDir = join(root, ".canvas");
  await mkdir(canvasDir, { recursive: true });
  const store = createStore(root);
  const clients = new Set();
  let actualPort = 0;

  const broadcast = (event) => {
    for (const res of clients) res.write(`event: ${event}\ndata: {}\n\n`);
  };

  const allowedHosts = () => new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
  const allowedOrigins = () => new Set([`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`]);

  async function route(req, res) {
    if (!allowedHosts().has(req.headers.host ?? "")) throw new HttpError(421, "unexpected host");
    const isWrite = !["GET", "HEAD"].includes(req.method);
    const origin = req.headers.origin;
    if (isWrite && origin !== undefined && !allowedOrigins().has(origin)) throw new HttpError(403, "foreign origin");

    const rawPath = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && rawPath === "/") return sendFile(res, join(appDir, "index.html"));
    if (req.method === "GET" && rawPath.startsWith("/app/")) {
      const p = safeResolve(resolve(appDir), rawPath.slice(5));
      if (!p) throw new HttpError(404, "not found");
      return sendFile(res, p);
    }
    if (req.method === "GET" && rawPath.startsWith("/screens/")) {
      const p = safeResolve(screensDir, rawPath.slice(9));
      if (!p) throw new HttpError(404, "not found");
      return sendFile(res, p, { "content-security-policy": SCREEN_CSP });
    }
    if (req.method === "GET" && rawPath === "/api/screens") {
      return sendJson(res, 200, { root, screens: await scanScreens(root) });
    }
    if (req.method === "GET" && rawPath === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (rawPath === "/api/annotations") {
      if (req.method === "GET") return sendJson(res, 200, await store.read());
      if (req.method === "POST") return sendJson(res, 201, await store.add(validateNote(await readJson(req))));
    }
    if (rawPath === "/api/client-log" && req.method === "POST") {
      await appendFile(join(canvasDir, "client.log"), logLine(await readJson(req)));
      res.writeHead(204);
      return res.end();
    }
    const m = rawPath.match(/^\/api\/annotations\/([A-Za-z0-9-]+)$/);
    if (m && req.method === "PATCH") {
      const body = await readJson(req);
      let note;
      try {
        note = await store.update(m[1], { text: body?.text, status: body?.status });
      } catch (e) {
        if (e instanceof TypeError) throw new HttpError(400, e.message);
        throw e;
      }
      if (!note) throw new HttpError(404, "not found");
      return sendJson(res, 200, note);
    }
    if (m && req.method === "DELETE") {
      if (!(await store.remove(m[1]))) throw new HttpError(404, "not found");
      res.writeHead(204);
      return res.end();
    }
    throw new HttpError(404, "not found");
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (status === 413) req.resume();
      if (!res.headersSent) sendJson(res, status, { error: e.message });
      else res.end();
    });
  });

  const first = port ?? DEFAULT_PORT;
  const last = first === 0 ? 0 : Math.min(65535, first + PORT_TRIES - 1);
  for (let p = first; ; p++) {
    try {
      actualPort = await listen(server, p);
      break;
    } catch (e) {
      // EACCES: Windows reserves port ranges (Hyper-V/WSL/Docker) — treat like busy.
      if (!["EADDRINUSE", "EACCES"].includes(e.code)) throw e;
      if (p >= last) {
        const err = new Error(`Vaba porti ei leitud vahemikus ${first}–${last}. Proovi: boardsimple --port 5000`);
        err.code = "EBOARDSIMPLE_PORT";
        throw err;
      }
    }
  }

  const stopScreens = watchDir(root, "screens", { recursive: true }, debounced(() => broadcast("screens")));
  const stopCanvas = watchDir(root, ".canvas", { recursive: false }, debounced(() => broadcast("annotations")));
  const ping = setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, PING_MS);

  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    async close() {
      clearInterval(ping);
      stopScreens();
      stopCanvas();
      for (const c of clients) c.end();
      clients.clear();
      server.closeAllConnections();
      await new Promise((r) => server.close(() => r()));
    },
  };
}
