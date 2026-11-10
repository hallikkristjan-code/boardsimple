import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.mjs";

async function fixture(t, agentOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "boardsimple-agent-"));
  await mkdir(join(root, "screens"));
  const srv = await startServer({ root, port: 0, agentOptions });
  t.after(() => srv.close());
  const request = (path, method = "GET", body, headers = {}) => fetch(srv.url + path, {
    method, headers: { origin: srv.url, "content-type": "application/json", ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const add = (text = "Make the heading larger") => request("/api/annotations", "POST", {
    file: "screens/example.html", text, box: { x: 10, y: 10, w: 80, h: 30 },
  }).then((r) => r.json());
  const send = () => request("/api/agent/send", "POST", {});
  // Plays the agent: a plain node:http request, as `boardsimple wait` makes it.
  const wait = (headers = {}) => {
    let res;
    let raw = "";
    let ended;
    // Listeners go on in the response callback: a short response can end
    // before a promise continuation would run.
    const done = new Promise((ok) => { ended = ok; });
    const ready = new Promise((ok, fail) => {
      http.get(srv.url + "/api/agent/wait", { agent: false, headers }, (r) => {
        res = r;
        r.setEncoding("utf8");
        r.on("data", (d) => { raw += d; });
        const finish = () => {
          const line = raw.split("\n").filter((l) => l.trim()).at(-1);
          ended(line ? JSON.parse(line) : null);
        };
        r.on("end", finish);
        r.on("close", finish);
        r.on("error", () => ended(null));
        ok(r);
      }).on("error", fail);
    });
    return { ready, done, get res() { return res; }, raw: () => raw };
  };
  const listening = async (expected = true) => {
    for (let i = 0; i < 200; i++) {
      if ((await (await request("/api/agent")).json()).listening === expected) return expected;
      await new Promise((r) => setTimeout(r, 10));
    }
    return !expected;
  };
  const snapshots = async () => (await readdir(join(root, ".canvas"))).filter((f) => /^feedback-.*\.json$/.test(f));
  return { root, srv, request, add, send, wait, listening, snapshots };
}

test("without a listening agent nothing is sent and the reason is machine-readable", async (t) => {
  const { request, add } = await fixture(t);
  await add();
  const state = await (await request("/api/agent")).json();
  assert.equal(state.listening, false);
  assert.equal(typeof state.root, "string");
  const res = await request("/api/agent/send", "POST", {});
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "not-listening");
});

test("removed configuration and channel endpoints are gone", async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request("/api/agent", "PUT", { provider: "t3", target: "x" })).status, 404);
  assert.equal((await request("/api/agent/channel")).status, 404);
});

test("foreign or missing Origin cannot trigger a send", async (t) => {
  const { request, srv } = await fixture(t);
  assert.equal((await request("/api/agent/send", "POST", {}, { origin: "https://evil.example" })).status, 403);
  assert.equal((await fetch(srv.url + "/api/agent/send", { method: "POST", body: "{}" })).status, 403);
});

test("a waiting agent receives an immutable snapshot of open notes only", async (t) => {
  const { root, request, add, send, wait, listening } = await fixture(t);
  const open = await add('Quoted "text"; $(do not execute)');
  const done = await add("already done");
  await request(`/api/annotations/${done.id}`, "PATCH", { status: "done" });
  const w = wait();
  assert.equal(await listening(true), true);
  const res = await send();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { delivery: "sent", count: 1 });
  const line = await w.done;
  assert.equal(line.status, "feedback");
  assert.equal(line.count, 1);
  assert.equal(line.root, root);
  const snap = JSON.parse(await readFile(line.snapshot, "utf8"));
  assert.equal(snap.version, 1);
  assert.equal(typeof snap.createdAt, "string");
  assert.equal(snap.root, root);
  assert.deepEqual(snap.notes.map((n) => n.id), [open.id]);
  await request(`/api/annotations/${open.id}`, "PATCH", { text: "changed later" });
  assert.equal(JSON.parse(await readFile(line.snapshot, "utf8")).notes[0].text, open.text);
  assert.equal(await listening(false), false);
});

test("send without open notes keeps the agent waiting", async (t) => {
  const { request, send, wait, listening, snapshots } = await fixture(t);
  wait();
  await listening(true);
  const res = await send();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "no-notes");
  assert.equal((await (await request("/api/agent")).json()).listening, true);
  assert.deepEqual(await snapshots(), []);
});

test("a wait that is replaced during a send hands the feedback to the newer wait", async (t) => {
  let a, b;
  const ctx = await fixture(t, { afterSnapshot: async () => { b = ctx.wait(); await a.done; } });
  const { add, send, wait, listening, snapshots } = ctx;
  a = wait();
  await listening(true);
  await add();
  assert.equal((await send()).status, 200);
  assert.deepEqual(await a.done, { status: "replaced" });
  const line = await b.done;
  assert.equal(line.status, "feedback");
  assert.equal(line.count, 1);
  assert.equal((await snapshots()).length, 1);
});

test("a wait that drops during a send is not reported as sent", async (t) => {
  let w;
  const ctx = await fixture(t, { afterSnapshot: async () => {
    w.res.destroy();
    for (let i = 0; i < 100; i++) {
      if (!(await (await ctx.request("/api/agent")).json()).listening) break;
      await new Promise((r) => setTimeout(r, 10));
    }
  } });
  const { request, add, send, wait, listening, snapshots } = ctx;
  w = wait();
  await w.ready;
  await listening(true);
  await add();
  const res = await send();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "not-listening");
  assert.deepEqual(await snapshots(), []);
  const again = await send();
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, "not-listening");
  assert.equal((await request("/api/agent")).status, 200);
});

test("a newer wait replaces the older one", async (t) => {
  const { add, send, wait, listening } = await fixture(t);
  const a = wait();
  await a.ready;
  await listening(true);
  const b = wait();
  assert.deepEqual(await a.done, { status: "replaced" });
  await b.ready;
  await add();
  assert.equal((await send()).status, 200);
  assert.equal((await b.done).status, "feedback");
});

test("a dropped wait stops counting as listening", async (t) => {
  const { add, send, wait, listening, snapshots } = await fixture(t);
  const w = wait();
  await w.ready;
  await listening(true);
  w.res.destroy();
  assert.equal(await listening(false), false);
  await add();
  const res = await send();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "not-listening");
  assert.deepEqual(await snapshots(), []);
});

test("browsers cannot pose as the waiting agent", async (t) => {
  const { srv, request, wait } = await fixture(t);
  for (const headers of [{ origin: srv.url }, { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }]) {
    const w = wait(headers);
    const res = await w.ready;
    assert.equal(res.statusCode, 403);
    assert.equal((await (await request("/api/agent")).json()).listening, false);
  }
});

test("concurrent sends and repeated clicks deliver once", async (t) => {
  const { add, send, wait, listening, snapshots } = await fixture(t);
  wait();
  await listening(true);
  await add();
  const statuses = (await Promise.all([send(), send()])).map((r) => r.status).sort();
  assert.ok(["200,409", "200,429"].includes(statuses.join(",")), statuses.join(","));
  assert.equal((await snapshots()).length, 1);
  const third = await send();
  assert.equal(third.status, 429);
  assert.equal((await third.json()).code, "cooldown");
});

test("a quiet wait is kept alive with heartbeats", async (t) => {
  const { wait } = await fixture(t, { pingMs: 50 });
  const w = wait();
  const res = await w.ready;
  await new Promise((r) => setTimeout(r, 300));
  assert.ok((w.raw().match(/\n/g) ?? []).length >= 3, JSON.stringify(w.raw()));
  assert.equal(res.complete, false);
});

test("closing the board ends the wait cleanly", async () => {
  for (let i = 0; i < 20; i++) {
    const root = await mkdtemp(join(tmpdir(), "boardsimple-close-"));
    const srv = await startServer({ root, port: 0 });
    const raw = await new Promise((ok, fail) => {
      let text = "";
      http.get(srv.url + "/api/agent/wait", { agent: false }, (r) => {
        r.setEncoding("utf8");
        r.on("data", (d) => { text += d; });
        r.on("close", () => ok(text));
        r.on("error", () => ok(text));
        const poll = async () => {
          const s = await (await fetch(srv.url + "/api/agent")).json();
          if (s.listening) srv.close(); else setTimeout(poll, 5);
        };
        poll();
      }).on("error", fail);
    });
    assert.deepEqual(JSON.parse(raw.split("\n").filter((l) => l.trim()).at(-1)), { status: "closed" }, `round ${i}`);
  }
});
