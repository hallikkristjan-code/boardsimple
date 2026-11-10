import { onLangChange, t } from "./i18n.js";

/** Keep this subtree alive when annotations rebuild the panel. */
export function createAgentControls({ beforeSend }) {
  const el = document.createElement("div");
  el.id = "agent-controls";
  el.innerHTML = `<details id="agent-settings"><summary id="agent-summary"></summary>
    <form><label for="agent-provider"></label><select id="agent-provider">
      <option value=""></option><option value="t3">T3 Code</option><option value="claude">Claude Code</option><option value="codex">Codex</option>
    </select><label for="agent-target"></label><input id="agent-target" type="text" autocomplete="off" spellcheck="false" maxlength="200">
    <p id="agent-hint"></p><button id="agent-save" type="submit"></button></form></details>
    <button id="agent-send" type="button" disabled></button><p id="agent-status" role="status" aria-live="polite"></p>`;
  const $ = (selector) => el.querySelector(selector);
  const provider = $("#agent-provider");
  const target = $("#agent-target");
  const save = $("#agent-save");
  const send = $("#agent-send");
  const hint = $("#agent-hint");
  const status = $("#agent-status");
  let saved = { provider: "", target: "" };
  let hints = {};
  let connected = false;
  let count = 0;
  let busy = false;
  let saving = false;
  let loaded = false;
  let cooldown = false;
  let statusKey = "";
  let error = "";
  let warning = "";

  async function api(path, options = {}) {
    const res = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  }
  const values = () => ({ provider: provider.value, target: ["t3", "codex"].includes(provider.value) ? target.value.trim() : "" });
  const dirty = () => JSON.stringify(values()) !== JSON.stringify(saved);
  function update() {
    const needsTarget = ["t3", "codex"].includes(provider.value);
    target.hidden = !needsTarget;
    $('label[for="agent-target"]').hidden = !needsTarget;
    hint.textContent = provider.value === "claude" ? t(connected ? "agentClaudeConnected" : "agentClaudeSetup") :
      needsTarget ? t("agentTargetHint") : t("agentOptional");
    send.hidden = !provider.value;
    send.disabled = !loaded || !count || busy || saving || cooldown || dirty() || !saved.provider ||
      (saved.provider === "claude" && !connected);
    save.disabled = !loaded || busy || saving || (needsTarget && !target.value.trim());
    provider.disabled = !loaded || busy || saving;
    target.disabled = busy || saving;
    send.textContent = t(busy ? "agentSending" : "agentSend");
    status.textContent = error ? t("agentFailed", error) : statusKey ? t(statusKey) + (warning ? ` ${warning}` : "") : "";
    status.dataset.error = String(Boolean(error));
  }
  function translate() {
    $("#agent-summary").textContent = t("agentSettings");
    $('label[for="agent-provider"]').textContent = t("agentProvider");
    $('option[value=""]').textContent = t("agentChoose");
    $('label[for="agent-target"]').textContent = t("agentTarget");
    target.placeholder = t("agentTargetPlaceholder");
    save.textContent = t("agentSave");
    update();
  }
  provider.addEventListener("change", () => {
    target.value = provider.value === saved.provider ? saved.target : hints[provider.value] ?? "";
    error = ""; statusKey = ""; update();
  });
  target.addEventListener("input", () => { error = ""; statusKey = ""; update(); });
  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    saving = true; error = ""; statusKey = ""; warning = ""; update();
    try {
      saved = await api("/api/agent", { method: "PUT", body: JSON.stringify(values()) });
      statusKey = "agentSaved";
    } catch (e) { error = e.message; }
    finally { saving = false; update(); }
  });
  send.addEventListener("click", async () => {
    if (send.disabled) return;
    busy = true; error = ""; statusKey = ""; warning = ""; update();
    try {
      await beforeSend();
      const result = await api("/api/agent/send", { method: "POST", body: JSON.stringify({ config: saved }) });
      statusKey = result.delivery === "sent" ? "agentSent" : "agentQueued";
      warning = result.warning ?? "";
      cooldown = true;
      setTimeout(() => { cooldown = false; update(); }, 3100);
    } catch (e) { error = e.message; }
    finally { busy = false; update(); }
  });

  async function refresh(initial = false) {
    try {
      const state = await api("/api/agent");
      connected = state.claudeConnected;
      hints = state.hints;
      if (initial) {
        saved = state.config;
        provider.value = saved.provider;
        target.value = saved.target;
      }
    } catch (e) { if (initial) error = e.message; }
    loaded = true;
    update();
  }
  onLangChange(translate);
  translate();
  void refresh(true);
  // A channel may finish its handshake after the page opens.
  const timer = setInterval(() => { if (provider.value === "claude" && !busy) void refresh(); }, 4000);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  return { el, setOpenCount(n) { count = n; update(); } };
}
