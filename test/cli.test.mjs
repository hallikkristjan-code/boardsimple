import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(repo, "bin", "boardsimple.mjs");

test("boardsimple starts on a folder and serves its screens", async () => {
  const child = spawn(process.execPath, [bin, join(repo, "examples", "demo"), "--no-open", "--port", "0"]);
  try {
    const url = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error(`no URL in: ${out}`)), 5000);
      child.stdout.on("data", (d) => {
        out += d;
        const m = out.match(/BoardSimple: (http:\/\/127\.0\.0\.1:\d+)/);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      child.on("exit", (code) => reject(new Error(`exited ${code}: ${out}`)));
    });
    const data = await (await fetch(`${url}/api/screens`)).json();
    assert.ok(data.screens.length >= 3);
  } finally {
    child.kill();
  }
});

test("boardsimple exits 1 for a missing folder", async () => {
  let err = "";
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, join(repo, "pole-olemas"), "--no-open"]);
    child.stderr.on("data", (d) => { err += d; });
    child.on("exit", resolve);
  });
  assert.equal(code, 1);
  assert.match(err, /Kausta ei leitud/);
});

test("boardsimple prints a friendly error when no port is free", async (t) => {
  const net = await import("node:net");
  const blocker = net.createServer();
  const ok = await new Promise((r) => {
    blocker.once("error", () => r(false));
    blocker.listen(65535, "127.0.0.1", () => r(true));
  });
  if (!ok) return t.skip("port 65535 in use by a parallel test");
  let err = "";
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, join(repo, "examples", "demo"), "--no-open", "--port", "65535"]);
    child.stderr.on("data", (d) => { err += d; });
    child.on("exit", resolve);
  });
  blocker.close();
  assert.equal(code, 1);
  assert.match(err, /Vaba porti ei leitud/);
  assert.doesNotMatch(err, /at .*server\.mjs/);
});
