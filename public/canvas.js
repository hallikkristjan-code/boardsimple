import { layoutBoards, zoomAt, fitAll, screenToWorld, labelMode, nearbyBoards } from "./geometry.js";
import { initLang, onLangChange, t } from "./i18n.js";

const AUTO_FALLBACK_H = 900;
const COLOR_KEY = "boardsimple-color";
export const MARK_TOOLS = { ring: "ring", kast: "box", joon: "line", nool: "arrow" }; // tool -> note shape
// Screen px around the viewport. The gap stops pages reloading on small back-and-forth pans.
const LOAD_MARGIN = 600;
const UNLOAD_MARGIN = 1500;
const viewportEl = document.getElementById("viewport");
const worldEl = document.getElementById("world");
const boardsEl = document.getElementById("boards");
const overlayEl = document.getElementById("overlay");
const zoomEl = document.getElementById("zoom");
const emptyEl = document.getElementById("empty");
const connEl = document.getElementById("conn");
const countEl = document.getElementById("count");

let view = { tx: 0, ty: 0, scale: 1 };
let tool = "kasi";
let color = null;
let screens = [];
let root = "";
let layout = { boards: [], groups: [] };
const measured = new Map(); // file -> measured height for height:"auto"
const boardEls = new Map(); // file -> {wrap, label, iframe, hash}
const groupEls = [];
const viewListeners = new Set();
const screensListeners = new Set();
const layoutListeners = new Set();
const reconnectListeners = new Set();
let fittedOnce = false;

export const getView = () => view;
export const getTool = () => tool;
export const getColor = () => color;
export const getScreens = () => screens;
export const getRoot = () => root;
export { viewportEl, worldEl, overlayEl };
export const freeWidth = () => viewportEl.clientWidth - chrome().right; // left of the notes panel
export const onViewChange = (cb) => viewListeners.add(cb);
export const onScreensChange = (cb) => screensListeners.add(cb);
export const onLayoutChange = (cb) => layoutListeners.add(cb);
export const onReconnect = (cb) => reconnectListeners.add(cb);

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
  document.body.classList.remove("tool-vali", "tool-kasi", ...Object.keys(MARK_TOOLS).map((t) => `tool-${t}`));
  document.body.classList.add(`tool-${name}`);
  for (const b of document.querySelectorAll("#tools button[data-tool]")) {
    b.setAttribute("aria-pressed", String(b.dataset.tool === name));
  }
}

function setColor(next) {
  const swatches = [...document.querySelectorAll("#colors button")];
  color = (swatches.find((b) => b.dataset.color === next) ?? swatches[0]).dataset.color;
  localStorage.setItem(COLOR_KEY, color);
  for (const b of swatches) b.setAttribute("aria-pressed", String(b.dataset.color === color));
}

export function setView(v) {
  view = v;
  worldEl.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  worldEl.style.setProperty("--inv", String(1 / view.scale));
  worldEl.dataset.labels = labelMode(view.scale);
  zoomEl.textContent = `${Math.round(view.scale * 100)}%`;
  syncLoaded();
  for (const cb of viewListeners) cb(view);
}

/** Screen px the floating chrome covers on each side of the canvas. A narrow window has the notes along the bottom. */
function chrome() {
  const narrow = matchMedia("(max-width: 700px)").matches;
  return { left: 68, top: 60, right: narrow ? 12 : 304, bottom: narrow ? viewportEl.clientHeight * 0.38 + 24 : 12 };
}

function viewportSize() {
  const r = viewportEl.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

export function fit() {
  // Reserve room above each board for the board + group labels (~64 screen px at 100%).
  const { w, h } = viewportSize();
  const c = chrome();
  const free = { w: w - c.left - c.right, h: h - c.top - c.bottom };
  const v = fitAll(layout.boards.map((b) => ({ ...b, y: b.y - 64, h: b.h + 64 })), free, 16);
  setView({ ...v, tx: v.tx + c.left, ty: v.ty + c.top });
}

export const usingKeyboard = () => document.body.classList.contains("keyboard");

/** True if a screen rect sits clear of the floating chrome. */
export function inFreeArea(r) {
  const { w, h } = viewportSize();
  const c = chrome();
  return r.left >= c.left && r.top >= c.top && r.right <= w - c.right && r.bottom <= h - c.bottom;
}

/** Pan so a world-space rect is centred. */
export function centerOn(rect) {
  const { w, h } = viewportSize();
  const c = chrome();
  const cx = c.left + (w - c.left - c.right) / 2;
  const cy = c.top + (h - c.top - c.bottom) / 2;
  setView({ ...view, tx: cx - (rect.x + rect.w / 2) * view.scale, ty: cy - (rect.y + rect.h / 2) * view.scale });
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
  syncLoaded();
  for (const cb of layoutListeners) cb(layout);
}

/** Keep a document only in iframes near the viewport; the rest stay blank white boards. */
function syncLoaded() {
  const size = viewportSize();
  const near = nearbyBoards(layout.boards, view, size, LOAD_MARGIN);
  const keep = nearbyBoards(layout.boards, view, size, UNLOAD_MARGIN);
  for (const [file, rec] of boardEls) {
    const url = near.has(file) ? rec.url : keep.has(file) ? rec.iframe.getAttribute("src") : "about:blank";
    if (url !== rec.iframe.getAttribute("src")) rec.iframe.src = url;
  }
}

function measure(s, iframe) {
  if (s.height !== "auto" || iframe.getAttribute("src") === "about:blank") return;
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
  iframe.src = "about:blank";
  iframe.addEventListener("load", () => measure(screens.find((x) => x.file === s.file) ?? s, iframe));
  wrap.append(label, iframe);
  boardsEl.append(wrap);
  const rec = { wrap, label, iframe, url: null };
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
    const url = `/screens/${encodePath(s.file)}?v=${version}`;
    // A loaded page takes the new version now; an unloaded one picks it up in syncLoaded.
    if (rec.url && rec.url !== url && rec.iframe.getAttribute("src") === rec.url) rec.iframe.src = url;
    rec.url = url;
  }
  screens = next;
  relayout();
  for (const cb of screensListeners) cb(screens);
}

const showCount = () => { countEl.textContent = t("screens", screens.length); };

async function loadScreens() {
  const res = await fetch("/api/screens");
  if (!res.ok) throw new Error(`screens: ${res.status}`);
  const data = await res.json();
  root = data.root;
  document.getElementById("project").textContent = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  document.title = `BoardSimple — ${document.getElementById("project").textContent}`;
  syncBoards(data.screens);
  showCount();
  if (!fittedOnce && data.screens.length) {
    fittedOnce = true;
    fit();
  }
}

// --- pan & zoom ---------------------------------------------------------
let spaceHeld = false;
let drag = null;
const touches = new Map(); // pointerId -> viewport point, one entry per finger down
let pinch = null; // {dist, mid} at the last move

export const isPinching = () => touches.size >= 2;

function movePinch() {
  const [a, b] = [...touches.values()];
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (pinch) {
    const v = zoomAt(view, mid, dist / pinch.dist);
    setView({ ...v, tx: v.tx + mid.x - pinch.mid.x, ty: v.ty + mid.y - pinch.mid.y });
  }
  pinch = { dist, mid };
}

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
export const isPin = (e) => Boolean(e.target.closest?.(".ann-pin")); // pointer capture would swallow its click

viewportEl.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") touches.set(e.pointerId, localPoint(e));
  if (isPinching()) {
    drag = null;
    pinch = null;
    movePinch();
    return;
  }
  if (!isPanGesture(e) || isPin(e)) return;
  e.preventDefault();
  drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  viewportEl.setPointerCapture(e.pointerId);
  document.body.classList.add("dragging");
});
viewportEl.addEventListener("pointermove", (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, localPoint(e));
  if (isPinching()) return movePinch();
  if (!drag) return;
  setView({ ...view, tx: drag.tx + e.clientX - drag.x, ty: drag.ty + e.clientY - drag.y });
});
const endDrag = (e) => {
  touches.delete(e.pointerId);
  if (!isPinching()) pinch = null;
  drag = null;
  document.body.classList.remove("dragging");
};
viewportEl.addEventListener("pointerup", endDrag);
viewportEl.addEventListener("pointercancel", endDrag);

const typing = () => ["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName);
// A button the keyboard is on keeps Space; one that was just clicked does not. :focus-visible
// cannot tell them apart, because Chromium turns it on for a clicked button at the first key.
const onKeyboardControl = () => usingKeyboard() && document.activeElement?.tagName === "BUTTON";
window.addEventListener("keydown", (e) => { if (e.key === "Tab") document.body.classList.add("keyboard"); }, true);
window.addEventListener("pointerdown", () => document.body.classList.remove("keyboard"), true);
const releaseSpace = () => {
  spaceHeld = false;
  document.body.classList.remove("panning");
};
window.addEventListener("keydown", (e) => {
  if (typing() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === "Space" && !spaceHeld && !onKeyboardControl()) {
    spaceHeld = true;
    document.body.classList.add("panning");
    e.preventDefault();
  }
  const k = e.key.toLowerCase();
  if (k === "v") setTool("vali");
  if (k === "h") setTool("kasi");
  if (k === "o") setTool("ring");
  if (k === "b") setTool("kast");
  if (k === "p") setTool("joon");
  if (k === "a") setTool("nool");
  if (k === "1" && e.shiftKey) fit();
});
window.addEventListener("keyup", (e) => { if (e.code === "Space") releaseSpace(); });
window.addEventListener("blur", releaseSpace); // the keyup goes to another window

for (const b of document.querySelectorAll("#tools button[data-tool]")) {
  b.addEventListener("click", () => setTool(b.dataset.tool));
}
for (const b of document.querySelectorAll("#colors button")) {
  b.style.setProperty("--c", b.dataset.color);
  b.addEventListener("click", () => setColor(b.dataset.color));
}
document.getElementById("fit").addEventListener("click", fit);
// Theme: no attribute = follow the system; a click picks the opposite of what is showing and remembers it.
document.getElementById("theme").addEventListener("click", () => {
  const dark = getComputedStyle(document.documentElement).colorScheme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("boardsimple-theme", next);
});
window.addEventListener("resize", () => setView(view));

// --- live updates -------------------------------------------------------
const events = new EventSource("/api/events");
events.addEventListener("screens", () => loadScreens().catch(console.error));
events.addEventListener("error", () => {
  // The browser retries network errors by itself, but gives up for good on a bad response.
  connEl.dataset.i18n = events.readyState === EventSource.CLOSED ? "connLost" : "connRetry";
  connEl.textContent = t(connEl.dataset.i18n);
  connEl.hidden = false;
});
events.addEventListener("open", () => {
  if (connEl.hidden) return;
  connEl.hidden = true;
  loadScreens().catch(console.error); // events sent during the outage are gone
  for (const cb of reconnectListeners) cb();
});
export { events };

// A GPU reset can leave gray areas with no error anywhere. A lost WebGL context is the one
// signal a page gets, so a tiny hidden context leaves a trace in .canvas/client.log.
const gpuProbe = document.createElement("canvas");
gpuProbe.id = "gpu-probe";
gpuProbe.hidden = true;
gpuProbe.addEventListener("webglcontextlost", (e) => {
  e.preventDefault(); // lets the browser restore the context, so later resets are seen too
  const loaded = [...boardEls.values()].filter((r) => r.iframe.getAttribute("src") !== "about:blank").length;
  fetch("/api/client-log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "gpu-context-lost", scale: view.scale, loaded, boards: boardEls.size }),
  }).catch(console.error);
});
gpuProbe.getContext("webgl");
document.body.append(gpuProbe);

initLang();
onLangChange(showCount);
setTool("kasi");
setColor(localStorage.getItem(COLOR_KEY));
setView(view);
loadScreens().catch((e) => {
  emptyEl.hidden = false;
  delete emptyEl.dataset.i18nHtml; // keep the error if the language changes
  emptyEl.textContent = t("loadFailed", e.message);
});
