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

for (const [lang, message] of [["et", /Kausta ei leitud/], ["en", /Folder not found/]]) {
  test(`boardsimple exits 1 for a missing folder (${lang})`, async () => {
    let err = "";
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [bin, join(repo, "pole-olemas"), "--no-open"], {
        env: { ...process.env, BOARDSIMPLE_LANG: lang },
      });
      child.stderr.on("data", (d) => { err += d; });
      child.on("exit", resolve);
    });
    assert.equal(code, 1);
    assert.match(err, message);
  });
}

test("boardsimple --help is translated", async () => {
  let out = "";
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, "--help"], { env: { ...process.env, BOARDSIMPLE_LANG: "en" } });
    child.stdout.on("data", (d) => { out += d; });
    child.on("exit", resolve);
  });
  assert.match(out, /^Usage: boardsimple/);
});

test("the removed --claude option is refused", async () => {
  let err = "";
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, "--claude", "--no-open", "--port", "0"]);
    child.stderr.on("data", (data) => { err += data; });
    child.on("exit", resolve);
  });
  assert.equal(code, 1);
  assert.match(err, /Unknown option '--claude'/);
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
    const child = spawn(process.execPath, [bin, join(repo, "examples", "demo"), "--no-open", "--port", "65535"], {
      env: { ...process.env, BOARDSIMPLE_LANG: "en" },
    });
    child.stderr.on("data", (d) => { err += d; });
    child.on("exit", resolve);
  });
  blocker.close();
  assert.equal(code, 1);
  assert.match(err, /No free port between 65535 and 65535/);
  assert.doesNotMatch(err, /at .*server\.mjs/);
});

function run(args, { env = {}, timeout = 10_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { ...process.env, ...env } });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => child.kill(), timeout);
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

function startBoardProcess(args) {
  const child = spawn(process.execPath, [bin, ...args]);
  const url = new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/BoardSimple: (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) resolve(m[1]);
    });
    child.on("exit", (code) => reject(new Error(`exited ${code}: ${out}`)));
  });
  return { child, url };
}

test("boardsimple wait rejects bad input", async () => {
  for (const args of [["wait", "--timeout", "abc"], ["wait", "--port", "0"], ["wait", join(repo, "pole-olemas")],
    ["wait", "--idle-exit", "5"], ["--timeout", "5", "--no-open"]]) {
    const { code } = await run([...args, "--no-open"]);
    assert.equal(code, 1, args.join(" "));
  }
});

async function waitOnRunningBoard(env) {
  const { child, url } = startBoardProcess([join(repo, "examples", "demo"), "--no-open", "--port", "0"]);
  try {
    const port = new URL(await url).port;
    return await run(["wait", join(repo, "examples", "demo"), "--port", port, "--timeout", "1", "--no-open"], { env });
  } finally { child.kill(); }
}

test("boardsimple wait attaches to a running board from the command line", async () => {
  const { code, out } = await waitOnRunningBoard({});
  assert.equal(code, 0);
  assert.match(out, /no feedback after 1 s/);
});

test("wait output is English whatever the language", async () => {
  const { code, out } = await waitOnRunningBoard({ BOARDSIMPLE_LANG: "et" });
  assert.equal(code, 0);
  assert.match(out, /no feedback after 1 s/);
});

test("a board with --idle-exit stops once nobody uses it", async () => {
  const first = startBoardProcess([join(repo, "examples", "demo"), "--no-open", "--port", "0", "--idle-exit", "1"]);
  await first.url;
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { first.child.kill(); reject(new Error("still running")); }, 5000);
    first.child.on("exit", (c) => { clearTimeout(timer); resolve(c); });
  });
  assert.equal(code, 0);

  const second = startBoardProcess([join(repo, "examples", "demo"), "--no-open", "--port", "0", "--idle-exit", "1"]);
  const url = await second.url;
  let exited = false;
  second.child.on("exit", () => { exited = true; });
  const http = await import("node:http");
  const req = http.get(url + "/api/agent/wait", { agent: false });
  req.on("error", () => {});
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(exited, false);
  req.destroy();
  const stopped = await new Promise((resolve) => {
    if (exited) return resolve(true);
    const timer = setTimeout(() => resolve(false), 5000);
    second.child.on("exit", () => { clearTimeout(timer); resolve(true); });
  });
  if (!stopped) second.child.kill();
  assert.equal(stopped, true);
});

test("a board started by wait outlives the waiting command", { timeout: 30_000 }, async (t) => {
  const { mkdtemp, mkdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const net = await import("node:net");
  const root = await mkdtemp(join(tmpdir(), "boardsimple-outlive-"));
  await mkdir(join(root, "screens"));
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const free = s.address().port;
  await new Promise((r) => s.close(r));

  const win = process.platform === "win32";
  const waiter = spawn(process.execPath, [bin, "wait", root, "--port", String(free), "--no-open"], { detached: !win });
  let err = "";
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no wait line: ${err}`)), 15_000);
    waiter.stderr.on("data", (d) => {
      err += d;
      const m = err.match(/waiting for feedback at (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
  });
  const port = new URL(url).port;
  t.after(async () => {
    const { execFileSync } = await import("node:child_process");
    try {
      if (win) {
        const pid = execFileSync("netstat", ["-ano"], { encoding: "utf8" }).split("\n")
          .find((l) => l.includes(`127.0.0.1:${port} `) && l.includes("LISTENING"))?.trim().split(/\s+/).at(-1);
        if (pid) execFileSync("taskkill", ["/pid", pid, "/T", "/F"], { stdio: "ignore" });
      } else {
        const pids = execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
        for (const pid of pids) process.kill(Number(pid));
      }
    } catch { /* already gone */ }
  });
  for (let i = 0; i < 100; i++) {
    if ((await (await fetch(url + "/api/agent")).json()).listening) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const exited = new Promise((r) => waiter.on("exit", r));
  if (win) (await import("node:child_process")).execFileSync("taskkill", ["/pid", String(waiter.pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(-waiter.pid, "SIGKILL");
  await exited;
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch(url + "/api/agent");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).listening, false);
});
