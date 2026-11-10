import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
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
  return { root, srv, request, add, send };
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
