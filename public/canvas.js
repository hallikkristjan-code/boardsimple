import { layoutBoards, zoomAt, fitAll, screenToWorld, labelMode } from "./geometry.js";

const AUTO_FALLBACK_H = 900;
const viewportEl = document.getElementById("viewport");
const worldEl = document.getElementById("world");
const boardsEl = document.getElementById("boards");
const overlayEl = document.getElementById("overlay");
const zoomEl = document.getElementById("zoom");
const emptyEl = document.getElementById("empty");

let view = { tx: 0, ty: 0, scale: 1 };
let tool = "kasi";
let screens = [];
let root = "";
let layout = { boards: [], groups: [] };
const measured = new Map(); // file -> measured height for height:"auto"
const boardEls = new Map(); // file -> {wrap, label, iframe, hash}
const groupEls = [];
const viewListeners = new Set();
const screensListeners = new Set();
const layoutListeners = new Set();
let fittedOnce = false;

export const getView = () => view;
export const getTool = () => tool;
export const getScreens = () => screens;
export const getRoot = () => root;
export { viewportEl, worldEl, overlayEl };
export const onViewChange = (cb) => viewListeners.add(cb);
export const onScreensChange = (cb) => screensListeners.add(cb);
export const onLayoutChange = (cb) => layoutListeners.add(cb);

export function getBoard(file) {
  const b = layout.boards.find((x) => x.file === file);
  const el = boardEls.get(file);
  return b && el ? { ...b, el: el.iframe } : null;
}

/** Board under a viewport-relative screen point, or null. */
export function boardAt(p) {
  const w = screenToWorld(p, view);
  const b = layout.boards.find((b) => w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h);
  return b ? getBoard(b.file) : null;
}

export function setTool(name) {
  tool = name;
  document.body.classList.remove("tool-vali", "tool-kasi", "tool-ring");
  document.body.classList.add(`tool-${name}`);
  for (const b of document.querySelectorAll("#tools button")) {
    b.setAttribute("aria-pressed", String(b.dataset.tool === name));
  }
}

export function setView(v) {
  view = v;
  worldEl.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  worldEl.style.setProperty("--inv", String(1 / view.scale));
  worldEl.dataset.labels = labelMode(view.scale);
  zoomEl.textContent = `${Math.round(view.scale * 100)}%`;
  for (const cb of viewListeners) cb(view);
}

function viewportSize() {
  const r = viewportEl.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

export function fit() {
  // Reserve room above each board for the board + group labels (~64 screen px at 100%).
  setView(fitAll(layout.boards.map((b) => ({ ...b, y: b.y - 64, h: b.h + 64 })), viewportSize()));
}

/** Pan so a world-space rect is centred. */
export function centerOn(rect) {
  const { w, h } = viewportSize();
  setView({ ...view, tx: w / 2 - (rect.x + rect.w / 2) * view.scale, ty: h / 2 - (rect.y + rect.h / 2) * view.scale });
}

const encodePath = (file) => file.split("/").slice(1).map(encodeURIComponent).join("/");

function heightOf(s) {
  return s.height === "auto" ? measured.get(s.file) ?? AUTO_FALLBACK_H : s.height;
}

function relayout() {
  layout = layoutBoards(screens.map((s) => ({ ...s, height: heightOf(s) })));
  for (const b of layout.boards) {
    const el = boardEls.get(b.file);
    Object.assign(el.wrap.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
  }
  for (const g of groupEls) g.remove();
  groupEls.length = 0;
  for (const g of layout.groups) {
    const el = document.createElement("div");
    el.className = "group-label";
    el.textContent = g.group;
    // Anchored at the row's board top; counter-scaled, then lifted 30 screen px above the board labels.
    el.style.cssText = `left:${g.x}px;top:${g.y + 28}px;transform-origin:0 0;transform:scale(var(--inv,1)) translateY(calc(-100% - 30px))`;
    boardsEl.append(el);
    groupEls.push(el);
  }
  emptyEl.hidden = screens.length > 0;
  for (const cb of layoutListeners) cb(layout);
}

function measure(s, iframe) {
  if (s.height !== "auto") return;
  try {
    const h = Math.ceil(iframe.contentDocument.documentElement.scrollHeight);
    if (h > 0 && measured.get(s.file) !== h) {
      measured.set(s.file, h);
      relayout();
    }
  } catch { /* cross-origin should not happen; keep fallback height */ }
}

function createBoard(s) {
  const wrap = document.createElement("div");
  wrap.className = "board";
  const label = document.createElement("div");
  label.className = "board-label";
  label.style.transform = "scale(var(--inv,1))";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("scrolling", "no");
  iframe.addEventListener("load", () => measure(screens.find((x) => x.file === s.file) ?? s, iframe));
  wrap.append(label, iframe);
  boardsEl.append(wrap);
  const rec = { wrap, label, iframe, hash: null };
  boardEls.set(s.file, rec);
  return rec;
}

function syncBoards(next) {
  const nextFiles = new Set(next.map((s) => s.file));
  for (const [file, rec] of boardEls) {
    if (!nextFiles.has(file)) {
      rec.wrap.remove();
      boardEls.delete(file);
      measured.delete(file);
    }
  }
  for (const s of next) {
    const rec = boardEls.get(s.file) ?? createBoard(s);
    rec.label.textContent = s.title;
    rec.label.title = s.title;
    rec.iframe.title = s.title;
    const version = `${s.hash.slice(0, 12)}${(s.assetsHash ?? "").slice(0, 12)}`;
    if (rec.hash !== version) {
      rec.hash = version;
      rec.iframe.src = `/screens/${encodePath(s.file)}?v=${version}`;
    }
  }
  screens = next;
  relayout();
  for (const cb of screensListeners) cb(screens);
}

async function loadScreens() {
  const res = await fetch("/api/screens");
  if (!res.ok) throw new Error(`screens: ${res.status}`);
  const data = await res.json();
  root = data.root;
  document.getElementById("project").textContent = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  document.title = `Louend — ${document.getElementById("project").textContent}`;
  document.getElementById("count").textContent = `${data.screens.length} ekraani`;
  syncBoards(data.screens);
  if (!fittedOnce && data.screens.length) {
    fittedOnce = true;
    fit();
  }
}

// --- pan & zoom ---------------------------------------------------------
let spaceHeld = false;
let drag = null;

const localPoint = (e) => {
  const r = viewportEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

viewportEl.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  setView(zoomAt(view, localPoint(e), factor));
}, { passive: false });

export const isPanGesture = (e) => tool === "kasi" || spaceHeld || e.button === 1;

viewportEl.addEventListener("pointerdown", (e) => {
  if (!isPanGesture(e)) return;
  e.preventDefault();
  drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  viewportEl.setPointerCapture(e.pointerId);
  document.body.classList.add("dragging");
});
viewportEl.addEventListener("pointermove", (e) => {
  if (!drag) return;
  setView({ ...view, tx: drag.tx + e.clientX - drag.x, ty: drag.ty + e.clientY - drag.y });
});
const endDrag = () => { drag = null; document.body.classList.remove("dragging"); };
viewportEl.addEventListener("pointerup", endDrag);
viewportEl.addEventListener("pointercancel", endDrag);

const typing = () => ["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName);
window.addEventListener("keydown", (e) => {
  if (typing() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === "Space" && !spaceHeld) {
    spaceHeld = true;
    document.body.classList.add("panning");
    e.preventDefault();
  }
  const k = e.key.toLowerCase();
  if (k === "v") setTool("vali");
  if (k === "h") setTool("kasi");
  if (k === "o") setTool("ring");
  if (k === "1" && e.shiftKey) fit();
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spaceHeld = false;
    document.body.classList.remove("panning");
  }
});

for (const b of document.querySelectorAll("#tools button")) {
  b.addEventListener("click", () => setTool(b.dataset.tool));
}
document.getElementById("fit").addEventListener("click", fit);
window.addEventListener("resize", () => setView(view));

// --- live updates -------------------------------------------------------
const events = new EventSource("/api/events");
events.addEventListener("screens", () => loadScreens().catch(console.error));
export { events };

setTool("kasi");
setView(view);
loadScreens().catch((e) => {
  emptyEl.hidden = false;
  emptyEl.textContent = `Ekraanide laadimine ebaõnnestus: ${e.message}`;
});
