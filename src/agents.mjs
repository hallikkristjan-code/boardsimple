import { realpathSync } from "node:fs";

export class AgentError extends Error {
  constructor(status, message, code) { super(message); this.status = status; if (code) this.code = code; }
}

export function realRoot(root) {
  try { return realpathSync.native(root); } catch { return root; }
}

export function createAgentBridge({ root }) {
  const real = realRoot(root);
  return {
    async state() { return { listening: false, root: real }; },
    async send() { throw new AgentError(409, "No agent is listening", "not-listening"); },
    close() {},
  };
}
