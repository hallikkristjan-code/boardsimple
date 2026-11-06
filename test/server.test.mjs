import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import http from "node:http";
import { startServer } from "../src/server.mjs";

const root = await mkdtemp(join(tmpdir(), "boardsimple-srv-"));
await mkdir(join(root, "screens", "õhtu menüü"), { recursive: true });
await writeFile(join(root, "screens", "õhtu menüü", "1.html"), "<title>Üks</title><p>tere</p>");
await writeFile(join(root, "secret.txt"), "salajane");
const srv = await startServer({ root, port: 0 });
after(() => srv.close());
const u = (p) => srv.url + p;

const note = {
  file: "screens/õhtu menüü/1.html",
  fileHash: "b".repeat(64),
  box: { x: 1, y: 2, w: 3, h: 4 },
  text: "märkus",
  elements: [],
};
const json = (method, body, headers = {}) => ({
  method,
  headers: { "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("GET /api/screens lists screens with root", async () => {
  const r = await (await fetch(u("/api/screens"))).json();
  assert.equal(r.root, root);
  assert.equal(r.screens.length, 1);
  assert.equal(r.screens[0].title, "Üks");
});

test("GET encoded unicode screen path serves the file", async () => {
  const r = await fetch(u("/screens/%C3%B5htu%20men%C3%BC%C3%BC/1.html"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.match(await r.text(), /tere/);
});

// Raw request so the client does not normalise ".." away.
function rawGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: srv.port, path, method: "GET" }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
}

test("path traversal is refused", async () => {
  assert.equal(await rawGet("/screens/..%2f..%2fsecret.txt"), 404);
  assert.equal(await rawGet("/screens/../secret.txt"), 404);
  assert.equal(await rawGet("/screens/%2e%2e/secret.txt"), 404);
});

test("annotation CRUD round trip", async () => {
  const c = await fetch(u("/api/annotations"), json("POST", note));
  assert.equal(c.status, 201);
  const created = await c.json();
  const doc = await (await fetch(u("/api/annotations"))).json();
  assert.ok(doc.notes.some((n) => n.id === created.id));
  const p = await fetch(u(`/api/annotations/${created.id}`), json("PATCH", { status: "done" }));
  assert.equal(p.status, 200);
  assert.equal((await p.json()).status, "done");
  assert.equal((await fetch(u(`/api/annotations/${created.id}`), { method: "DELETE" })).status, 204);
  assert.equal((await fetch(u(`/api/annotations/${created.id}`), { method: "DELETE" })).status, 404);
});

test("bad JSON is 400 and invalid status is 400", async () => {
  assert.equal((await fetch(u("/api/annotations"), json("POST", "{bad"))).status, 400);
  const created = await (await fetch(u("/api/annotations"), json("POST", note))).json();
  assert.equal((await fetch(u(`/api/annotations/${created.id}`), json("PATCH", { status: "x" }))).status, 400);
});

test("body over 1 MB is 413", async () => {
  const big = { ...note, text: "x".repeat(1024 * 1024 + 10) };
  assert.equal((await fetch(u("/api/annotations"), json("POST", big))).status, 413);
});

test("foreign Origin on write is 403", async () => {
  const r = await fetch(u("/api/annotations"), json("POST", note, { origin: "https://evil.example" }));
  assert.equal(r.status, 403);
});

test("own Origin on write is allowed", async () => {
  const r = await fetch(u("/api/annotations"), json("POST", note, { origin: srv.url }));
  assert.equal(r.status, 201);
});

test("foreign Host header is 421 (DNS rebinding)", async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: srv.port, path: "/api/annotations", headers: { host: "evil.example" } },
      (res) => { res.resume(); resolve(res.statusCode); },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 421);
});

async function waitForEvent(name, trigger) {
  const ctrl = new AbortController();
  const res = await fetch(u("/api/events"), { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  await trigger();
  const deadline = Date.now() + 3000;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r({ value: undefined, done: false }), 200)),
      ]);
      if (done) break;
      if (value) buf += dec.decode(value);
      if (buf.includes(`event: ${name}`)) return true;
    }
    return false;
  } finally {
    ctrl.abort();
  }
}

test("SSE emits screens event on screen change", async () => {
  const ok = await waitForEvent("screens", async () => {
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(join(root, "screens", "uus.html"), "<p>uus</p>");
  });
  assert.ok(ok);
});

test("SSE emits annotations event on file change", async () => {
  const ok = await waitForEvent("annotations", async () => {
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(join(root, ".canvas", "annotations.json"), JSON.stringify({ version: 1, notes: [] }));
  });
  assert.ok(ok);
});

test("SSE survives screens folder delete and recreate", async () => {
  await rm(join(root, "screens"), { recursive: true, force: true });
  await new Promise((r) => setTimeout(r, 300));
  const ok = await waitForEvent("screens", async () => {
    await mkdir(join(root, "screens"), { recursive: true });
    await new Promise((r) => setTimeout(r, 300));
    await writeFile(join(root, "screens", "taas.html"), "<p>taas</p>");
  });
  assert.ok(ok);
});

test("screen responses carry a CSP that blocks remote scripts", async () => {
  await mkdir(join(root, "screens"), { recursive: true });
  await writeFile(join(root, "screens", "csp.html"), "<p>csp</p>");
  const r = await fetch(u("/screens/csp.html"));
  assert.equal(r.status, 200);
  const csp = r.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self' 'unsafe-inline'(;|$)/);
  assert.match(csp, /font-src [^;]*https:/);
});

test("busy port falls through to next", async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, "127.0.0.1", r));
  const busy = blocker.address().port;
  const s2 = await startServer({ root, port: busy });
  try {
    assert.equal(s2.port, busy + 1);
  } finally {
    await s2.close();
    blocker.close();
  }
});

test("busy last port gives a friendly error instead of a bad-port crash", async (t) => {
  const blocker = net.createServer();
  const ok = await new Promise((r) => {
    blocker.once("error", () => r(false));
    blocker.listen(65535, "127.0.0.1", () => r(true));
  });
  if (!ok) return t.skip("port 65535 not available for the test");
  try {
    await assert.rejects(startServer({ root, port: 65535 }), (e) => {
      assert.equal(e.code, "EBOARDSIMPLE_PORT");
      assert.match(e.message, /no free port/);
      assert.equal(e.first, 65535);
      return true;
    });
  } finally {
    blocker.close();
  }
});

test("the app declares an icon and the server serves it as PNG", async () => {
  const html = await (await fetch(u("/"))).text();
  assert.match(html, /<link rel="icon"[^>]*href="\/app\/icon\.png"/);
  const r = await fetch(u("/app/icon.png"));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...bytes.slice(1, 4)], [0x50, 0x4e, 0x47]);
});

test("client log appends one line and keeps only known fields", async () => {
  const body = { event: "gpu-context-lost", scale: 0.05, loaded: 146, boards: 146, extra: "x" };
  assert.equal((await fetch(u("/api/client-log"), json("POST", body))).status, 204);
  const lines = (await readFile(join(root, ".canvas", "client.log"), "utf8")).trim().split("\n");
  const entry = JSON.parse(lines.at(-1));
  assert.equal(entry.event, "gpu-context-lost");
  assert.equal(entry.loaded, 146);
  assert.ok(!Number.isNaN(Date.parse(entry.at)));
  assert.equal(entry.extra, undefined);
});

test("client log rejects a bad event", async () => {
  assert.equal((await fetch(u("/api/client-log"), json("POST", { event: "x\ny" }))).status, 400);
  assert.equal((await fetch(u("/api/client-log"), json("POST", "[]"))).status, 400);
});

test("client log refuses a foreign origin", async () => {
  const r = await fetch(u("/api/client-log"), json("POST", { event: "gpu-context-lost" }, { origin: "https://evil.example" }));
  assert.equal(r.status, 403);
});

test("note keeps its shape, points and colour", async () => {
  const points = [{ x: 1, y: 2 }, { x: 30, y: 2 }];
  const r = await fetch(u("/api/annotations"), json("POST", { ...note, shape: "line", closed: false, points, color: "#16a34a" }));
  const created = await r.json();
  assert.equal(created.shape, "line");
  assert.equal(created.closed, false);
  assert.deepEqual(created.points, points);
  assert.equal(created.color, "#16a34a");
});

test("note without a shape stays a ring", async () => {
  const created = await (await fetch(u("/api/annotations"), json("POST", note))).json();
  assert.equal(created.shape, "ring");
  assert.equal(created.color, null);
});

test("note with a bad shape, colour or points is rejected", async () => {
  for (const bad of [{ shape: "star" }, { color: "red;x" }, { shape: "line", points: "x" }, { shape: "line", points: [{ x: "1", y: 2 }] }]) {
    assert.equal((await fetch(u("/api/annotations"), json("POST", { ...note, ...bad }))).status, 400, JSON.stringify(bad));
  }
});
