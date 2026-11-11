#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startServer } from "../src/server.mjs";
import { findAppBrowser, openCommand } from "../src/browser.mjs";

const MESSAGES = {
  et: {
    usage: `Kasutus: boardsimple [kaust] [--port N] [--no-open]
        boardsimple wait [kaust] [--timeout S]   agendile: käivita vajadusel tahvel ja oota, kuni kasutaja vajutab „Saada agendile“

Avab lõuendi eraldi aknas (Chrome/Edge/Chromium --app); kui ühtki pole, tavabrauseris.

  kaust      projekti kaust, kus on screens/ (vaikimisi praegune kaust)
  --port N   port (vaikimisi 4477; kui hõivatud, proovib järgmisi)
  --no-open  ära ava akent`,
    noFolder: (root) => `Kausta ei leitud: ${root}`,
    badPort: (port) => `Vigane port: ${port}`,
    noFreePort: (e) => `Vaba porti ei leitud vahemikus ${e.first}–${e.last}. Proovi: boardsimple --port 5000`,
    started: (root) => `(kaust: ${root})`,
    stop: "Peatamiseks vajuta Ctrl+C.",
    openByHand: "Ava brauseris käsitsi:",
  },
  en: {
    usage: `Usage: boardsimple [folder] [--port N] [--no-open]
       boardsimple wait [folder] [--timeout S]   for agents: start the board if needed and block until the user clicks "Send to agent"

Opens the canvas in its own window (Chrome/Edge/Chromium --app); without those, in the default browser.

  folder     project folder that holds screens/ (default: current folder)
  --port N   port (default 4477; tries the next ones if busy)
  --no-open  do not open a window`,
    noFolder: (root) => `Folder not found: ${root}`,
    badPort: (port) => `Invalid port: ${port}`,
    noFreePort: (e) => `No free port between ${e.first} and ${e.last}. Try: boardsimple --port 5000`,
    started: (root) => `(folder: ${root})`,
    stop: "Press Ctrl+C to stop.",
    openByHand: "Open in a browser:",
  },
};
const locale = process.env.BOARDSIMPLE_LANG || Intl.DateTimeFormat().resolvedOptions().locale;
const T = MESSAGES[locale.toLowerCase().startsWith("et") ? "et" : "en"];

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      "no-open": { type: "boolean", default: false },
      timeout: { type: "string" },
      "idle-exit": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
} catch (e) {
  console.error(`${e.message}\n\n${T.usage}`);
  process.exit(1);
}

if (args.values.help) {
  console.log(T.usage);
  process.exit(0);
}

const waiting = args.positionals[0] === "wait";
const positionals = waiting ? args.positionals.slice(1) : args.positionals;
const positiveInt = (v) => /^[1-9]\d*$/.test(v);
// Each flag belongs to one command; a wrong combination is a usage error.
if ((args.values.timeout !== undefined && (!waiting || !positiveInt(args.values.timeout))) ||
  (args.values["idle-exit"] !== undefined && (waiting || !positiveInt(args.values["idle-exit"])))) {
  console.error(T.usage);
  process.exit(1);
}

const root = resolve(positionals[0] ?? process.cwd());
try {
  if (!(await stat(root)).isDirectory()) throw new Error();
} catch {
  console.error(T.noFolder(root));
  process.exit(1);
}

const port = args.values.port === undefined ? undefined : Number(args.values.port);
if (port !== undefined && !(Number.isInteger(port) && port >= (waiting ? 1 : 0) && port < 65536)) {
  console.error(T.badPort(args.values.port));
  process.exit(1);
}

if (waiting) {
  const { runWait } = await import("../src/wait.mjs");
  process.exit(await runWait({ root, port, timeoutSeconds: Number(args.values.timeout ?? 0), open: !args.values["no-open"] }));
}

const openWindow = (url) => {
  const [cmd, cmdArgs] = openCommand(url);
  spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {
    console.log(T.openByHand, url);
  }).unref();
};

let server;
try {
  // Without an app browser the fallback is a plain tab, so a link clicked in a
  // tab has nothing better to hand over to.
  const canHandOver = !args.values["no-open"] && findAppBrowser();
  server = await startServer({ root, port, openWindow: canHandOver ? openWindow : undefined });
} catch (e) {
  if (e.code !== "EBOARDSIMPLE_PORT") throw e;
  console.error(T.noFreePort(e));
  process.exit(1);
}
console.log(`BoardSimple: ${server.url}  ${T.started(root)}`);
console.log(T.stop);

if (!args.values["no-open"]) openWindow(server.url);

let stopping = false;
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  await server.close();
  process.exit(code);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

// Boards started by `boardsimple wait` stop once nobody uses them: no board
// window and no waiting agent for the whole idle period.
if (args.values["idle-exit"]) {
  const idleMs = Number(args.values["idle-exit"]) * 1000;
  let idleSince = Date.now();
  setInterval(async () => {
    const { listening, windows } = await server.activity();
    if (listening || windows > 0) idleSince = Date.now();
    else if (Date.now() - idleSince >= idleMs) void stop();
  }, Math.min(60_000, idleMs / 2)).unref();
}
