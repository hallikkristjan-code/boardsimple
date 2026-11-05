#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startServer } from "../src/server.mjs";
import { openCommand } from "../src/browser.mjs";

const USAGE = `Kasutus: boardsimple [kaust] [--port N] [--no-open]

Avab lõuendi eraldi aknas (Chrome/Edge/Chromium --app); kui ühtki pole, tavabrauseris.

  kaust      projekti kaust, kus on screens/ (vaikimisi praegune kaust)
  --port N   port (vaikimisi 4477; kui hõivatud, proovib järgmisi)
  --no-open  ära ava akent`;

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      "no-open": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
} catch (e) {
  console.error(`${e.message}\n\n${USAGE}`);
  process.exit(1);
}

if (args.values.help) {
  console.log(USAGE);
  process.exit(0);
}

const root = resolve(args.positionals[0] ?? process.cwd());
try {
  if (!(await stat(root)).isDirectory()) throw new Error();
} catch {
  console.error(`Kausta ei leitud: ${root}`);
  process.exit(1);
}

const port = args.values.port === undefined ? undefined : Number(args.values.port);
if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port < 65536)) {
  console.error(`Vigane port: ${args.values.port}`);
  process.exit(1);
}

let server;
try {
  server = await startServer({ root, port });
} catch (e) {
  if (e.code !== "EBOARDSIMPLE_PORT") throw e;
  console.error(e.message);
  process.exit(1);
}
console.log(`BoardSimple: ${server.url}  (kaust: ${root})`);
console.log("Peatamiseks vajuta Ctrl+C.");

if (!args.values["no-open"]) {
  const [cmd, cmdArgs] = openCommand(server.url);
  spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {
    console.log("Ava brauseris käsitsi:", server.url);
  }).unref();
}

const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
