import { ellipseSamples, screenToWorld, worldToScreen } from "./geometry.js";
import {
  getView, getTool, getScreens, getRoot, getBoard, boardAt, centerOn, isPanGesture,
  onViewChange, onScreensChange, onLayoutChange, viewportEl, worldEl, overlayEl, events,
} from "./canvas.js";

const SVG = "http://www.w3.org/2000/svg";
const MIN_RING_PX = 6;
const MAX_ELEMENTS = 10;
const panel = document.getElementById("panel");
const pinsEl = document.createElement("div");
pinsEl.id = "pins";
worldEl.append(pinsEl);

let notes = [];
let hoverId = null;
let draft = null; // {file, board, start, box, el}
let notebox = null;

// --- data -----------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts });
  if (!res.ok && res.status !== 204) throw new Error(`${opts.method ?? "GET"} ${path}: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function refresh() {
  const doc = await api("/api/annotations");
  notes = [...doc.notes].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  render();
}

const screenOf = (file) => getScreens().find((s) => s.file === file);
const isStale = (n) => {
  const s = screenOf(n.file);
  return Boolean(s && n.fileHash && s.hash !== n.fileHash);
};

// --- element capture --------------------------------------------------------
function selectorFor(el) {
  const parts = [];
  for (let cur = el; cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== "body"; cur = cur.parentElement) {
    const tag = cur.tagName.toLowerCase();
    if (cur.id) {
      parts.unshift(`${tag}#${CSS.escape(cur.id)}`);
      break;
    }
    const classes = [...cur.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
    const parent = cur.parentElement;
    const same = parent ? [...parent.children].filter((c) => c.tagName === cur.tagName) : [];
    const nth = same.length > 1 ? `:nth-of-type(${same.indexOf(cur) + 1})` : "";
    parts.unshift(tag + classes + nth);
  }
  return parts.join(" > ") || "body";
}

const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function captureElements(iframe, box) {
  const doc = iframe.contentDocument;
  if (!doc) return [];
  const found = new Set();
  for (const p of ellipseSamples(box)) {
    for (const el of doc.elementsFromPoint(p.x, p.y)) {
      const tag = el.tagName.toLowerCase();
      if (tag !== "html" && tag !== "body") found.add(el);
    }
  }
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  // Keep the deepest elements: drop anything that contains another hit.
  const hits = [...found].filter((el) => intersects(rectOf(el), box));
  const deepest = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
  deepest.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return deepest.slice(0, MAX_ELEMENTS).map((el) => ({
    selector: selectorFor(el),
    tag: el.tagName.toLowerCase(),
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
    box: rectOf(el),
  }));
}

// --- rendering --------------------------------------------------------------
function ringGeom(n) {
  const b = getBoard(n.file);
  if (!b) return null;
  return { x: b.x + n.box.x, y: b.y + n.box.y, w: n.box.w, h: n.box.h };
}

function ellipse(r, cls) {
  const e = document.createElementNS(SVG, "ellipse");
  e.setAttribute("cx", r.x + r.w / 2);
  e.setAttribute("cy", r.y + r.h / 2);
  e.setAttribute("rx", Math.max(0, r.w / 2));
  e.setAttribute("ry", Math.max(0, r.h / 2));
  e.setAttribute("class", cls);
  return e;
}

function setHover(id) {
  hoverId = id;
  for (const el of document.querySelectorAll("[data-note]")) {
    el.classList.toggle("hover", el.dataset.note === id);
  }
}

function render() {
  overlayEl.replaceChildren();
  pinsEl.replaceChildren();
  notes.forEach((n, i) => {
    const r = ringGeom(n);
    if (!r) return;
    const done = n.status === "done";
    const ring = ellipse(r, `ann-ring${done ? " done" : ""}`);
    ring.dataset.note = n.id;
    overlayEl.append(ring);
    const pin = document.createElement("div");
    pin.className = `ann-pin${done ? " done" : ""}`;
    pin.dataset.note = n.id;
    pin.textContent = done ? "✓" : String(i + 1);
    pin.title = n.text;
    const a = Math.PI / 4;
    pin.style.left = `${r.x + r.w / 2 + (r.w / 2) * Math.cos(a)}px`;
    pin.style.top = `${r.y + r.h / 2 - (r.h / 2) * Math.sin(a)}px`;
    pin.style.transform = "scale(var(--inv,1))";
    pin.addEventListener("mouseenter", () => setHover(n.id));
    pin.addEventListener("mouseleave", () => setHover(null));
    pin.addEventListener("click", () => panel.querySelector(`.note-row[data-note="${n.id}"]`)?.scrollIntoView({ block: "nearest" }));
    pinsEl.append(pin);
  });
  if (draft?.box) overlayEl.append(ellipse(draftWorldRect(), "ann-ring"));
  renderPanel();
  setHover(hoverId);
}

function button(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function editInline(row, n) {
  const txt = row.querySelector(".txt");
  const ta = document.createElement("textarea");
  ta.value = n.text;
  ta.rows = 3;
  ta.style.width = "100%";
  txt.replaceWith(ta);
  ta.focus();
  ta.addEventListener("click", (e) => e.stopPropagation());
  ta.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") render();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await api(`/api/annotations/${n.id}`, { method: "PATCH", body: JSON.stringify({ text: ta.value.trim() }) });
      await refresh();
    }
  });
}

function renderPanel() {
  const open = notes.filter((n) => n.status !== "done").length;
  const h = document.createElement("h2");
  h.textContent = `Märkused (${notes.length})`;
  const list = document.createElement("div");
  list.className = "list";
  if (!notes.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Vali Ring (O) ja tõmba ring ümber koha, mida muuta.";
    list.append(p);
  }
  notes.forEach((n, i) => {
    const done = n.status === "done";
    const row = document.createElement("div");
    row.className = `note-row${done ? " done" : ""}`;
    row.dataset.note = n.id;
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = done ? "✓" : String(i + 1);
    const body = document.createElement("div");
    const txt = document.createElement("div");
    txt.className = "txt";
    txt.textContent = n.text || "(tühi märkus)";
    const meta = document.createElement("div");
    meta.className = "meta";
    const el0 = n.elements?.[0];
    meta.textContent = `${screenOf(n.file)?.title ?? n.file}${el0 ? ` · <${el0.selector.split(" > ").pop()}>` : ""}`;
    body.append(txt, meta);
    if (isStale(n)) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "fail muutunud";
      body.append(badge);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      button("muuda tekst", () => editInline(row, n)),
      button(done ? "ava uuesti" : "märgi tehtuks", async () => {
        await api(`/api/annotations/${n.id}`, { method: "PATCH", body: JSON.stringify({ status: done ? "open" : "done" }) });
        await refresh();
      }),
      button("kustuta", async () => {
        await api(`/api/annotations/${n.id}`, { method: "DELETE" });
        await refresh();
      }),
    );
    body.append(actions);
    row.append(num, body);
    row.addEventListener("mouseenter", () => setHover(n.id));
    row.addEventListener("mouseleave", () => setHover(null));
    row.addEventListener("click", () => { const r = ringGeom(n); if (r) centerOn(r); });
    list.append(row);
  });
  const footer = document.createElement("footer");
  const status = document.createElement("div");
  status.className = "status";
  status.textContent = `${open} avatud märkust · .canvas/annotations.json`;
  const copy = button("Kopeeri käsk agendile", async () => {
    const sepChar = getRoot().includes("\\") ? "\\" : "/";
    const path = `${getRoot()}${sepChar}.canvas${sepChar}annotations.json`;
    try {
      await navigator.clipboard.writeText(`vaata märkused üle: ${path}`);
      copy.textContent = "Kopeeritud";
    } catch {
      copy.textContent = "Kopeerimine ei õnnestunud";
    }
    setTimeout(() => { copy.textContent = "Kopeeri käsk agendile"; }, 1500);
  });
  footer.append(status, copy);
  panel.replaceChildren(h, list, footer);
}

// --- ring drawing -----------------------------------------------------------
const localPoint = (e) => {
  const r = viewportEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

function draftWorldRect() {
  return { x: draft.board.x + draft.box.x, y: draft.board.y + draft.box.y, w: draft.box.w, h: draft.box.h };
}

viewportEl.addEventListener("pointerdown", (e) => {
  if (getTool() !== "ring" || isPanGesture(e) || e.button !== 0) return;
  if (e.target.closest?.("#notebox")) return;
  closeNotebox();
  const board = boardAt(localPoint(e));
  if (!board) return;
  e.preventDefault();
  const w = screenToWorld(localPoint(e), getView());
  draft = { file: board.file, board, start: { x: w.x - board.x, y: w.y - board.y }, box: null };
  try { viewportEl.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
});

viewportEl.addEventListener("pointermove", (e) => {
  if (!draft || notebox) return;
  const w = screenToWorld(localPoint(e), getView());
  const clamp = (v, max) => Math.min(max, Math.max(0, v));
  const px = clamp(w.x - draft.board.x, draft.board.w);
  const py = clamp(w.y - draft.board.y, draft.board.h);
  draft.box = {
    x: Math.min(draft.start.x, px), y: Math.min(draft.start.y, py),
    w: Math.abs(px - draft.start.x), h: Math.abs(py - draft.start.y),
  };
  render();
});

viewportEl.addEventListener("pointerup", () => {
  if (!draft || notebox) return;
  const scale = getView().scale;
  if (!draft.box || draft.box.w * scale < MIN_RING_PX || draft.box.h * scale < MIN_RING_PX) {
    draft = null;
    render();
    return;
  }
  openNotebox();
});

function positionNotebox() {
  if (!notebox || !draft) return;
  const r = draftWorldRect();
  const p = worldToScreen({ x: r.x + r.w, y: r.y }, getView());
  const vw = viewportEl.clientWidth;
  const left = p.x + 12 + 240 > vw ? worldToScreen({ x: r.x, y: r.y }, getView()).x - 252 : p.x + 12;
  notebox.style.left = `${Math.max(8, left)}px`;
  notebox.style.top = `${Math.max(8, p.y)}px`;
}

function openNotebox() {
  notebox = document.createElement("div");
  notebox.id = "notebox";
  const label = document.createElement("label");
  label.textContent = `Märkus · ${screenOf(draft.file)?.title ?? draft.file}`;
  label.style.cssText = "display:block;font-weight:600;margin-bottom:6px";
  const ta = document.createElement("textarea");
  ta.placeholder = "Mida siin muuta?";
  label.htmlFor = ta.id = "notebox-text";
  const row = document.createElement("div");
  row.className = "row";
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = "Enter salvestab · Esc tühistab";
  const save = button("Salvesta", () => saveDraft(ta.value));
  row.append(hint, save);
  notebox.append(label, ta, row);
  notebox.addEventListener("pointerdown", (e) => e.stopPropagation());
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); cancelDraft(); }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveDraft(ta.value); }
  });
  viewportEl.append(notebox);
  positionNotebox();
  ta.focus();
}

function closeNotebox() {
  notebox?.remove();
  notebox = null;
}

function cancelDraft() {
  closeNotebox();
  draft = null;
  render();
}

async function saveDraft(text) {
  const d = draft;
  const box = { x: Math.round(d.box.x), y: Math.round(d.box.y), w: Math.round(d.box.w), h: Math.round(d.box.h) };
  const note = {
    file: d.file,
    fileHash: screenOf(d.file)?.hash ?? null,
    box,
    text: text.trim(),
    elements: captureElements(d.board.el, box),
  };
  closeNotebox();
  draft = null;
  try {
    await api("/api/annotations", { method: "POST", body: JSON.stringify(note) });
  } catch (e) {
    alert(`Märkuse salvestamine ebaõnnestus: ${e.message}`);
  }
  await refresh();
}

// --- wiring -------------------------------------------------------------------
onViewChange(positionNotebox);
onLayoutChange(render);
onScreensChange(render);
events.addEventListener("annotations", () => refresh().catch(console.error));
refresh().catch(console.error);
