// Short-lived middle process: starts its target detached and exits at once, so
// the target is not a live descendant of `boardsimple wait` and survives a
// harness that kills the command together with its children.
//   node detach.mjs -- <exe> [args...]   start an executable (the browser)
//   node detach.mjs <script> [args...]   start a Node script (the board)
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const [file, args] = argv[0] === "--" ? [argv[1], argv.slice(2)] : [process.execPath, argv];
const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true });
child.on("error", () => process.exit(1));
child.unref();
child.on("spawn", () => process.exit(0));
