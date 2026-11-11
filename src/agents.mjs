import { realpathSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export class AgentError extends Error {
  constructor(status, message, code) { super(message); this.status = status; if (code) this.code = code; }
}

export function realRoot(root) {
  try { return realpathSync.native(root); } catch { return root; }
}

const COOLDOWN_MS = 3000;

/**
 * One agent at a time holds GET /api/agent/wait open. Send writes an immutable
 * snapshot of the open notes and answers that request with one final line.
 */
export function createAgentBridge({ root, store, pingMs = 15_000, afterSnapshot = async () => {} }) {
  const real = realRoot(root);
  let listener = null; // { res, ping }
  let inFlight = false;
  let lastSent = -Infinity;

  const alive = (l) => !!l && !l.res.writableEnded && !l.res.destroyed;

  function finish(l, line) {
    clearInterval(l.ping);
    if (listener === l) listener = null;
    return new Promise((done) => {
      if (l.res.writableEnded || l.res.destroyed) return done();
      l.res.once("finish", done);
      l.res.once("close", done);
      l.res.end(`${JSON.stringify(line)}\n`);
    });
  }

  return {
    async state() { return { listening: alive(listener), root: real }; },

    wait(req, res) {
      if (req.headers.origin !== undefined || req.headers["sec-fetch-site"] !== undefined) {
        throw new AgentError(403, "Only a local agent command can wait for feedback");
      }
      if (listener) void finish(listener, { status: "replaced" });
      res.on("error", () => {}); // a late write after a drop must never crash the board
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      res.flushHeaders();
      const l = { res, ping: setInterval(() => { if (alive(l)) res.write("\n"); }, pingMs) };
      listener = l;
      res.on("close", () => {
        clearInterval(l.ping);
        if (listener === l) listener = null;
      });
    },

    async send() {
      if (inFlight) throw new AgentError(409, "Feedback is already being sent", "busy");
      if (Date.now() - lastSent < COOLDOWN_MS) {
        throw new AgentError(429, "Feedback was just sent. Check the agent conversation.", "cooldown");
      }
      inFlight = true;
      try {
        if (!alive(listener)) throw new AgentError(409, "No agent is listening", "not-listening");
        const notes = (await store.read()).notes.filter((n) => n.status !== "done");
        if (!notes.length) throw new AgentError(409, "No open feedback to send", "no-notes");
        const snapshot = join(root, ".canvas", `feedback-${randomUUID()}.json`);
        await writeFile(snapshot, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), root, notes }, null, 2) + "\n", { mode: 0o600 });
        await afterSnapshot();
        // Re-read: the listener may have changed or dropped while the file was written.
        const target = listener;
        if (!alive(target)) {
          await unlink(snapshot).catch(() => {});
          throw new AgentError(409, "No agent is listening", "not-listening");
        }
        void finish(target, { status: "feedback", snapshot, root, count: notes.length });
        lastSent = Date.now();
        return { delivery: "sent", count: notes.length };
      } finally { inFlight = false; }
    },

    async close() {
      if (listener) await finish(listener, { status: "closed" });
    },
  };
}
