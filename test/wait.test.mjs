import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { startServer } from "../src/server.mjs";
import { findBoard, runWait } from "../src/wait.mjs";

async function board(t, root) {
  root ??= await mkdtemp(join(tmpdir(), "boardsimple-wait-"));
  await mkdir(join(root, "screens"), { recursive: true });
  const srv = await startServer({ root, port: 0 });
  t.after(() => srv.close());
  return { root, srv };
}

const state = async (srv) => (await fetch(srv.url + "/api/agent")).json();
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 10)); }
  return false;
}
const post = (srv, p, body) => fetch(srv.url + p, {
  method: "POST", headers: { origin: srv.url, "content-type": "application/json" }, body: JSON.stringify(body),
});
const addNote = (srv) => post(srv, "/api/annotations", {
  file: "screens/a.html", text: "Bigger heading", box: { x: 1, y: 1, w: 10, h: 10 },
}).then((r) => r.json());
const collect = () => { const lines = []; const f = (...a) => lines.push(a.join(" ")); f.lines = lines; return f; };
const noStart = () => { throw new Error("startBoard must not be called"); };

test("findBoard matches the project folder however it is spelled", async (t) => {
  const { root, srv } = await board(t);
  const spellings = [root, root + path.sep];
  if (process.platform === "win32") {
    const flipped = root[0] === root[0].toUpperCase() ? root[0].toLowerCase() : root[0].toUpperCase();
    spellings.push(flipped + root.slice(1));
  }
  const link = join(await mkdtemp(join(tmpdir(), "boardsimple-link-")), "link");
  try { symlinkSync(root, link, "junction"); spellings.push(link); } catch { /* links unavailable */ }
  for (const spelling of spellings) {
    const found = await findBoard({ root: spelling, port: srv.port });
    assert.equal(found?.url, srv.url, spelling);
  }
});

test("findBoard recognises an older board without attaching", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "boardsimple-old-"));
  const old = http.createServer((req, res) => {
    if (req.url === "/api/screens") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ root })); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => old.listen(0, "127.0.0.1", r));
  t.after(() => old.close());
  const port = old.address().port;
  const found = await findBoard({ root, port });
  assert.deepEqual(found, { outdated: true, url: `http://127.0.0.1:${port}` });
  const err = collect();
  assert.equal(await runWait({ root, port, open: false, startBoard: noStart, out: collect(), err }), 2);
  assert.match(err.lines.join("\n"), /cannot hand feedback to an agent \(HTTP old version\)/);
});

test("wait opens a window only when the board has none", async (t) => {
  const { root, srv } = await board(t);
  const opened = [];
  const openWindow = (url) => opened.push(url);
  const run = (open) => runWait({ root, port: srv.port, timeoutSeconds: 1, open, openWindow, startBoard: noStart, out: collect(), err: collect() });
  assert.equal(await run(true), 0);
  assert.deepEqual(opened, [srv.url]);

  const events = http.get(srv.url + "/api/events", { agent: false });
  events.on("error", () => {});
  t.after(() => events.destroy());
  assert.ok(await until(async () => (await state(srv)).windows === 1));
  opened.length = 0;
  assert.equal(await run(true), 0);
  assert.deepEqual(opened, []);
  events.destroy();
  assert.ok(await until(async () => (await state(srv)).windows === 0));
  assert.equal(await run(false), 0);
  assert.deepEqual(opened, []);
});

test("findBoard ignores another project's board", async (t) => {
  const { srv } = await board(t);
  const other = await mkdtemp(join(tmpdir(), "boardsimple-other-"));
  assert.equal(await findBoard({ root: other, port: srv.port }), null);
});

test("wait prints the snapshot and instructions, then exits 0", async (t) => {
  const { root, srv } = await board(t);
  const out = collect();
  const running = runWait({ root, port: srv.port, open: false, startBoard: noStart, out, err: collect() });
  assert.ok(await until(async () => (await state(srv)).listening));
  const note = await addNote(srv);
  assert.equal((await post(srv, "/api/agent/send", {})).status, 200);
  assert.equal(await running, 0);
  const lines = out.lines.join("\n").split("\n");
  assert.equal(lines[0], "BoardSimple feedback: 1 open note(s).");
  const snapshot = lines.find((l) => l.startsWith("Snapshot: ")).slice(10);
  assert.ok(existsSync(snapshot));
  assert.equal(JSON.parse(readFileSync(snapshot, "utf8")).notes[0].id, note.id);
  assert.equal(lines.at(-1), "When you are done, run `boardsimple wait` again to keep listening.");
});

test("wait gives up quietly after its timeout", async (t) => {
  const { root, srv } = await board(t);
  const out = collect();
  const started = Date.now();
  assert.equal(await runWait({ root, port: srv.port, timeoutSeconds: 1, open: false, startBoard: noStart, out, err: collect() }), 0);
  assert.ok(Date.now() - started < 3000);
  assert.match(out.lines.join("\n"), /no feedback after 1 s/);
  assert.ok(await until(async () => !(await state(srv)).listening));
});

test("a replaced wait exits 3", async (t) => {
  const { root, srv } = await board(t);
  const err = collect();
  const first = runWait({ root, port: srv.port, open: false, startBoard: noStart, out: collect(), err });
  assert.ok(await until(async () => (await state(srv)).listening));
  const second = runWait({ root, port: srv.port, timeoutSeconds: 1, open: false, startBoard: noStart, out: collect(), err: collect() });
  assert.equal(await first, 3);
  assert.match(err.lines.join("\n"), /another agent started waiting/);
  await second;
});

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

test("wait starts the board when none is running", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "boardsimple-start-"));
  await mkdir(join(root, "screens"));
  const port = await freePort();
  let calls = 0;
  let srv;
  const startBoard = async () => { calls++; srv = await startServer({ root, port }); t.after(() => srv.close()); };
  const running = runWait({ root, port, open: false, startBoard, out: collect(), err: collect() });
  assert.ok(await until(async () => srv && (await state(srv)).listening, 5000));
  await addNote(srv);
  assert.equal((await post(srv, "/api/agent/send", {})).status, 200);
  assert.equal(await running, 0);
  assert.equal(calls, 1);
});

test("two waits that start at once start one board", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "boardsimple-twice-"));
  await mkdir(join(root, "screens"));
  const port = await freePort();
  let calls = 0;
  const startBoard = async () => {
    if (++calls > 1) return;
    await new Promise((r) => setTimeout(r, 300));
    const srv = await startServer({ root, port });
    t.after(() => srv.close());
  };
  const run = () => runWait({ root, port, timeoutSeconds: 1, open: false, startBoard, out: collect(), err: collect() });
  await Promise.all([run(), run()]);
  assert.equal(calls, 1);
  assert.equal(existsSync(join(root, ".canvas", "wait-start.lock")), false);
});

test("wait reports an unreachable board with exit 2", async () => {
  const root = await mkdtemp(join(tmpdir(), "boardsimple-none-"));
  const port = await freePort();
  const err = collect();
  assert.equal(await runWait({ root, port, open: false, startBoard: () => {}, startTimeoutMs: 500, out: collect(), err }), 2);
  assert.match(err.lines.join("\n"), /no board is reachable for/);
});

test("a wait on a board that closes says so instead of blaming a sandbox", async (t) => {
  const { root, srv } = await board(t);
  const err = collect();
  const running = runWait({ root, port: srv.port, open: false, startBoard: noStart, out: collect(), err });
  assert.ok(await until(async () => (await state(srv)).listening));
  await srv.close();
  assert.equal(await running, 2);
  const text = err.lines.join("\n");
  assert.match(text, /the board at http:\/\/127\.0\.0\.1:\d+ was closed/);
  assert.doesNotMatch(text, /sandbox/);
});

test("a wait whose parent process died stops listening", async (t) => {
  const { root, srv } = await board(t);
  let parentAlive = true;
  const running = runWait({ root, port: srv.port, open: false, startBoard: noStart, out: collect(), err: collect(),
    parentAlive: () => parentAlive, parentCheckMs: 20 });
  assert.ok(await until(async () => (await state(srv)).listening));
  parentAlive = false;
  assert.equal(await running, 2);
  assert.ok(await until(async () => !(await state(srv)).listening));
});
