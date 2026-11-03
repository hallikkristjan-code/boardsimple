import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { findAppBrowser, openCommand } from "../src/browser.mjs";

const PF = "C:\\Program Files";
const PF86 = "C:\\Program Files (x86)";
const winEnv = { ProgramFiles: PF, "ProgramFiles(x86)": PF86, LOCALAPPDATA: "C:\\Users\\k\\AppData\\Local" };
const chrome = join(PF, "Google", "Chrome", "Application", "chrome.exe");
const edge = join(PF86, "Microsoft", "Edge", "Application", "msedge.exe");

test("findAppBrowser prefers Chrome, then Edge on Windows", () => {
  const has = (set) => (p) => set.has(p);
  assert.equal(findAppBrowser({ platform: "win32", env: winEnv, exists: has(new Set([chrome, edge])) }), chrome);
  assert.equal(findAppBrowser({ platform: "win32", env: winEnv, exists: has(new Set([edge])) }), edge);
  assert.equal(findAppBrowser({ platform: "win32", env: winEnv, exists: () => false }), null);
});

test("findAppBrowser looks in PATH on Linux", () => {
  const env = { PATH: ["/usr/local/bin", "/usr/bin"].join(process.platform === "win32" ? ";" : ":") };
  const want = join("/usr/bin", "chromium");
  assert.equal(findAppBrowser({ platform: "linux", env, exists: (p) => p === want }), want);
});

test("openCommand uses an --app window when a Chromium browser exists", () => {
  const [cmd, args] = openCommand("http://127.0.0.1:4477", { platform: "win32", env: winEnv, exists: (p) => p === chrome });
  assert.equal(cmd, chrome);
  assert.ok(args.includes("--app=http://127.0.0.1:4477"));
  assert.ok(args.includes("--new-window"));
});

test("openCommand falls back to the system opener without a Chromium browser", () => {
  assert.deepEqual(openCommand("http://x", { platform: "win32", env: winEnv, exists: () => false }), ["cmd", ["/c", "start", "", "http://x"]]);
  assert.deepEqual(openCommand("http://x", { platform: "darwin", env: {}, exists: () => false }), ["open", ["http://x"]]);
  assert.deepEqual(openCommand("http://x", { platform: "linux", env: {}, exists: () => false }), ["xdg-open", ["http://x"]]);
});

test("openCommand gives the app window its own profile and a size on first launch only", () => {
  const profile = join(PF, "..", "Users", "k", ".louend", "chrome-profile");
  const fresh = openCommand("http://x", { platform: "win32", env: winEnv, exists: (p) => p === chrome, profileDir: profile })[1];
  assert.ok(fresh.includes(`--user-data-dir=${profile}`));
  assert.ok(fresh.some((a) => a.startsWith("--window-size=")));
  const again = openCommand("http://x", { platform: "win32", env: winEnv, exists: (p) => p === chrome || p === profile, profileDir: profile })[1];
  assert.ok(again.includes(`--user-data-dir=${profile}`));
  assert.ok(!again.some((a) => a.startsWith("--window-size=")));
});
