import { onLangChange, t } from "./i18n.js";

const POLL_MS = 3000;
const COOLDOWN_MS = 3100;

/**
 * Shows whether an agent is waiting (`boardsimple wait`) and offers one Send
 * button while it is. Keep this subtree alive when annotations rebuild the panel.
 */
export function createAgentControls({ beforeSend }) {
  const el = document.createElement("div");
  el.id = "agent-controls";
  el.innerHTML = `<p id="agent-state" tabindex="-1"></p>
    <button id="agent-send" type="button" hidden disabled></button>
    <p id="agent-status" role="status" aria-live="polite"></p>`;
  const state = el.querySelector("#agent-state");
  const send = el.querySelector("#agent-send");
  const status = el.querySelector("#agent-status");
  let listening = false;
  let working = false; // decision A: after a send, until the agent listens again
  let count = 0;
  let busy = false;
  let cooldown = false;
  let statusKey = "";
  let error = "";

  function update() {
    const hadFocus = document.activeElement === send;
    const showSend = listening && !working;
    state.textContent = t(working ? "agentWorking" : listening ? "agentListening" :
      count ? "agentNotListening" : "agentNotListeningEmpty");
    send.hidden = !showSend;
    send.disabled = !count || busy || cooldown;
    send.textContent = t(busy ? "agentSending" : "agentSend");
    status.textContent = error ? t("agentFailed", error) : statusKey ? t(statusKey) : "";
    status.dataset.error = String(Boolean(error));
    if (hadFocus && send.hidden) state.focus();
  }

  async function refresh() {
    try {
      const res = await fetch("/api/agent", { cache: "no-store" });
      if (!res.ok) return;
      listening = (await res.json()).listening === true;
      if (listening) working = false;
    } catch { /* the board is restarting; keep the last known state */ }
    update();
  }

  send.addEventListener("click", async () => {
    if (send.disabled || send.hidden) return;
    // Disabling the button while busy can drop its focus; put it back after.
    const hadFocus = document.activeElement === send;
    busy = true; error = ""; statusKey = ""; update();
    try {
      await beforeSend();
      const res = await fetch("/api/agent/send", {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        statusKey = "agentSent";
        working = true;
        listening = false;
        cooldown = true;
        setTimeout(() => { cooldown = false; update(); }, COOLDOWN_MS);
      } else if (body.code === "not-listening") {
        listening = false; // the agent left between poll and click: not an error
      } else {
        error = body.error ?? `HTTP ${res.status}`;
      }
    } catch (e) { error = e.message; }
    finally { busy = false; update(); }
    if (hadFocus) (send.hidden ? state : send).focus();
    if (!working) void refresh();
  });

  onLangChange(update);
  update();
  void refresh();
  const timer = setInterval(() => { if (!busy) void refresh(); }, POLL_MS);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  return { el, setOpenCount(n) { count = n; update(); } };
}
