import { isClosedPath, markInk, markSamples, pathBox, pathLength, pinPoint, screenToWorld, worldToScreen } from "./geometry.js";
import {
  freeWidth, getView, getTool, getColor, getScreens, getRoot, getBoard, boardAt, centerOn, inFreeArea, isPanGesture, isPin, isPinching,
  usingKeyboard, MARK_TOOLS,
  onViewChange, onScreensChange, onLayoutChange, onReconnect, viewportEl, worldEl, overlayEl, events,
} from "./canvas.js";
import { onLangChange, t } from "./i18n.js";

const SVG = "http://www.w3.org/2000/svg";
const MIN_RING_PX = 6;
const MIN_LINE_PX = 12;
const CLOSE_LOOP_PX = 24;
const MIN_STEP_PX = 2;
const MAX_POINTS = 2000;
const ARROW_HEAD = 18;
const MAX_ELEMENTS = 10;
const UNDO_MS = 6000;
const panel = document.getElementById("panel");
const pinsEl = document.createElement("div");
pinsEl.id = "pins";
worldEl.append(pinsEl);

let notes = [];
let hoverId = null;
let draft = null; // {file, board, start, box, el}
let notebox = null;
let editing = null; // {id, value} - unsaved inline edit, survives panel rebuilds from live updates
let saving = false;
let pendingDelete = null; // {id, note, timer} - hidden here, still on disk until undo runs out
const deleting = new Set(); // ids whose DELETE is on its way
let copyStatus = null; // what the copy button says instead of its label, for a moment

// --- data -----------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts });
  if (!res.ok && res.status !== 204) {
    throw Object.assign(new Error(`${opts.method ?? "GET"} ${path}: ${res.status}`), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

const byCreated = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt));

async function refresh() {
  const doc = await api("/api/annotations");
  notes = doc.notes.filter((n) => n.id !== pendingDelete?.id && !deleting.has(n.id)).sort(byCreated);
  render();
}

const screenOf = (file) => getScreens().find((s) => s.file === file);
const isStale = (n) => {
  const s = screenOf(n.file);
  return Boolean(n.status !== "done" && s && n.fileHash && s.hash !== n.fileHash);
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

function captureElements(iframe, mark) {
  const doc = iframe.contentDocument;
  if (!doc) return [];
  const found = new Set();
  const samples = markSamples(mark);
  const area = pathBox(samples);
  const box = { x: area.x - 1, y: area.y - 1, w: area.w + 2, h: area.h + 2 }; // a line's area can be 0 high
  for (const p of samples) {
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
function toWorld(m, b) {
  return {
    ...m,
    box: { x: b.x + m.box.x, y: b.y + m.box.y, w: m.box.w, h: m.box.h },
    points: m.points?.map((p) => ({ x: b.x + p.x, y: b.y + p.y })),
  };
}

function noteGeom(n) {
  const b = getBoard(n.file);
  return b ? toWorld(n, b) : null;
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

function svg(tag, attrs) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

const pointList = (points) => points.map((p) => `${p.x},${p.y}`).join(" ");

function arrowPath([a, b]) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const size = Math.min(ARROW_HEAD, Math.hypot(b.x - a.x, b.y - a.y) / 2);
  const wing = (turn) => `${b.x - size * Math.cos(angle + turn)} ${b.y - size * Math.sin(angle + turn)}`;
  return `M${a.x} ${a.y}L${b.x} ${b.y}M${wing(0.5)}L${b.x} ${b.y}L${wing(-0.5)}`;
}

/** SVG for a mark in world coordinates. */
function markEl(m, cls) {
  const shape = m.shape ?? "ring";
  const open = shape === "arrow" || (shape === "line" && !m.closed);
  const classes = `ann-ring${open ? " open" : ""}${cls}`;
  const { box: r } = m;
  let e;
  if (shape === "box") e = svg("rect", { x: r.x, y: r.y, width: r.w, height: r.h, class: classes });
  else if (shape === "arrow") e = svg("path", { d: arrowPath(m.points), class: classes });
  else if (shape === "line") e = svg(open ? "polyline" : "polygon", { points: pointList(m.points), class: classes });
  else e = ellipse(r, classes);
  paintMark(e, m.color);
  return e;
}

function paintMark(el, color) {
  if (!color) return;
  el.style.setProperty("--mark", color);
  el.style.setProperty("--mark-ink", `var(--on-mark-${markInk(color)})`);
}

function setHover(id) {
  hoverId = id;
  for (const el of document.querySelectorAll("[data-note]")) {
    el.classList.toggle("hover", el.dataset.note === id);
  }
}

function render() {
  const focusedPin = document.activeElement?.closest?.(".ann-pin")?.dataset.note;
  overlayEl.replaceChildren();
  pinsEl.replaceChildren();
  notes.forEach((n, i) => {
    const m = noteGeom(n);
    if (!m) return;
    const done = n.status === "done";
    const ring = markEl(m, done ? " done" : "");
    ring.dataset.note = n.id;
    overlayEl.append(ring);
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `ann-pin${done ? " done" : ""}`;
    pin.dataset.note = n.id;
    pin.textContent = done ? "✓" : String(i + 1);
    pin.title = n.text;
    pin.setAttribute("aria-label", t("pinLabel", i + 1, n.text || t("emptyNote")));
    const at = pinPoint(m);
    pin.style.left = `${at.x}px`;
    pin.style.top = `${at.y}px`;
    pin.style.transform = "scale(var(--inv,1))";
    paintMark(pin, n.color);
    highlightWith(pin, n.id);
    pin.addEventListener("focus", () => {
      if (usingKeyboard() && !inFreeArea(pin.getBoundingClientRect())) centerOn(m.box);
    });
    pin.addEventListener("click", () => {
      const row = panel.querySelector(`.note-row[data-note="${CSS.escape(n.id)}"]`);
      row?.scrollIntoView({ block: "nearest" });
      row?.querySelector(".txt")?.focus({ preventScroll: true });
    });
    pinsEl.append(pin);
  });
  if (focusedPin) (pinsEl.querySelector(`[data-note="${CSS.escape(focusedPin)}"]`) ?? panel).focus({ preventScroll: true });
  if (draft?.box) overlayEl.append(markEl(toWorld(draft, draft.board), ""));
  renderPanel();
  setHover(hoverId);
}

function highlightWith(el, id) {
  for (const on of ["mouseenter", "focusin"]) el.addEventListener(on, () => setHover(id));
  for (const off of ["mouseleave", "focusout"]) el.addEventListener(off, () => setHover(null));
}

function button(label, onClick, action) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (action) b.dataset.action = action;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}

const safely = (fn) => async () => {
  try {
    await fn();
  } catch (e) {
    alert(t("actionFailed", e.message));
  }
};

function editInline(row, n, caret = null) {
  if (editing?.id !== n.id) editing = { id: n.id, value: n.text };
  const txt = row.querySelector(".txt");
  const ta = document.createElement("textarea");
  ta.value = editing.value;
  ta.rows = 3;
  ta.style.width = "100%";
  txt.replaceWith(ta);
  if (caret === null) ta.focus();
  else if (caret >= 0) {
    ta.focus();
    ta.setSelectionRange(caret, caret);
  }
  ta.addEventListener("click", (e) => e.stopPropagation());
  ta.addEventListener("input", () => { editing.value = ta.value; });
  ta.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      editing = null;
      render();
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      try {
        await api(`/api/annotations/${n.id}`, { method: "PATCH", body: JSON.stringify({ text: ta.value.trim() }) });
      } catch (err) {
        alert(t("editFailed", err.message));
        return; // keep the textarea and its text
      }
      editing = null;
      await refresh().catch(console.error);
    }
  });
}

async function finishDelete(keepalive = false) {
  if (!pendingDelete) return;
  const { id, timer } = pendingDelete;
  clearTimeout(timer);
  pendingDelete = null;
  deleting.add(id);
  try {
    await api(`/api/annotations/${id}`, { method: "DELETE", keepalive });
  } catch (e) {
    if (e.status !== 404) throw e; // 404: the agent deleted it first, which is what the user wanted
  } finally {
    deleting.delete(id);
  }
}

/** Finish a waiting delete. If the server refuses it, the refresh brings the note back. */
async function settleDelete() {
  if (!pendingDelete) return;
  try {
    await finishDelete();
  } finally {
    await refresh().catch(render); // with the server gone, at least drop the undo line
  }
}

async function removeNote(id) {
  if (pendingDelete?.id === id || deleting.has(id)) return;
  const note = notes.find((n) => n.id === id);
  // Runs up to its first await, so the earlier delete is on its way before this one starts waiting.
  const earlier = settleDelete();
  pendingDelete = { id, note, timer: setTimeout(safely(settleDelete), UNDO_MS) };
  notes = notes.filter((n) => n.id !== id);
  render();
  panel.querySelector("#undo button").focus();
  await earlier;
}

function undoDelete() {
  if (!pendingDelete) return; // its time ran out as the click landed
  const { id, note, timer } = pendingDelete;
  clearTimeout(timer);
  pendingDelete = null;
  notes = [...notes, note].sort(byCreated);
  render();
  if (usingKeyboard()) panel.querySelector(`.note-row[data-note="${CSS.escape(id)}"] .txt`)?.focus();
  return refresh();
}

function showCopyStatus(text) {
  copyStatus = text;
  const label = panel.querySelector("footer span");
  if (label) label.textContent = text ?? t("copy");
}

/** Selector for the panel element holding focus, so it can be found again after a rebuild. */
function panelFocus() {
  const el = document.activeElement;
  if (!panel.contains(el) || el === panel) return null;
  const row = el.closest(".note-row");
  if (!row) return el.closest("#undo") ? "#undo button" : "footer button";
  const inRow = el.dataset.action ? `[data-action="${el.dataset.action}"]` : ".txt";
  return `.note-row[data-note="${CSS.escape(row.dataset.note)}"] ${inRow}`;
}

function renderPanel() {
  const open = notes.filter((n) => n.status !== "done").length;
  const h = document.createElement("h2");
  h.textContent = t("notes");
  if (open) {
    const count = document.createElement("span");
    count.className = "n";
    count.textContent = String(open);
    h.append(count);
  }
  const list = document.createElement("div");
  list.className = "list";
  if (!notes.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("notesEmpty");
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
    paintMark(num, n.color);
    const body = document.createElement("div");
    const txt = document.createElement("button"); // its click reaches the row, which centres the mark
    txt.type = "button";
    txt.className = "txt";
    txt.textContent = n.text || t("emptyNote");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = screenOf(n.file)?.title ?? n.file;
    body.append(txt, meta);
    if (isStale(n)) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = t("fileChanged");
      body.append(badge);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      button(t("editText"), () => editInline(row, n), "edit"),
      button(t(done ? "reopen" : "markDone"), safely(async () => {
        await api(`/api/annotations/${n.id}`, { method: "PATCH", body: JSON.stringify({ status: done ? "open" : "done" }) });
        await refresh();
      }), "done"),
      button(t("remove"), safely(() => removeNote(n.id)), "remove"),
    );
    body.append(actions);
    row.append(num, body);
    highlightWith(row, n.id);
    row.addEventListener("click", () => { const m = noteGeom(n); if (m) centerOn(m.box); });
    list.append(row);
  });
  const footer = document.createElement("footer");
  const copyLabel = document.createElement("span");
  copyLabel.textContent = copyStatus ?? t("copy");
  const copy = button("", async () => {
    const sepChar = getRoot().includes("\\") ? "\\" : "/";
    const path = `${getRoot()}${sepChar}.canvas${sepChar}annotations.json`;
    await safely(settleDelete)(); // the agent must not read a note that is already gone here
    try {
      await navigator.clipboard.writeText(t("agentCommand", path, location.origin));
      showCopyStatus(t("copied"));
    } catch {
      showCopyStatus(t("copyFailed"));
    }
    setTimeout(() => showCopyStatus(null), 1500);
  });
  const copyIcon = svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
  copyIcon.append(
    svg("rect", { x: 8, y: 8, width: 12, height: 12, rx: 2 }),
    svg("path", { d: "M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" }),
  );
  copy.append(copyIcon, copyLabel);
  footer.append(copy);
  const undo = [];
  if (pendingDelete) {
    const bar = document.createElement("div");
    bar.id = "undo";
    bar.append(t("noteDeleted"), button(t("undo"), safely(undoDelete)));
    undo.push(bar);
  }
  const active = document.activeElement;
  const caret = active?.tagName === "TEXTAREA" && panel.contains(active) ? active.selectionStart : -1;
  const focused = panelFocus();
  const scrolled = panel.querySelector(".list")?.scrollTop ?? 0;
  panel.replaceChildren(h, list, ...undo, ...(open ? [footer] : []));
  list.scrollTop = scrolled;
  if (editing) {
    // Live updates rebuild the panel; reopen the edit with the unsaved text.
    const row = list.querySelector(`.note-row[data-note="${CSS.escape(editing.id)}"]`);
    const n = notes.find((x) => x.id === editing.id);
    if (row && n) editInline(row, n, caret);
    else editing = null; // note was deleted meanwhile
  }
  if (focused && !(editing && caret >= 0)) {
    const nearby = usingKeyboard() ? panel.querySelector(".txt, footer button") : null;
    (panel.querySelector(focused) ?? nearby ?? panel).focus({ preventScroll: true });
  }
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
  if (isPinching()) { // a second finger means zoom, whatever the first was drawing
    if (draft && !notebox) cancelDraft();
    return;
  }
  const shape = MARK_TOOLS[getTool()];
  if (!shape || isPanGesture(e) || isPin(e) || e.button !== 0) return;
  if (e.target.closest?.("#notebox")) return;
  closeNotebox();
  // A box may start on the canvas. Keep it in world coordinates until its
  // finished area tells us which example it belongs to.
  const board = boardAt(localPoint(e)) ?? (shape === "box" ? { file: null, x: 0, y: 0 } : null);
  if (!board) return;
  e.preventDefault();
  const w = screenToWorld(localPoint(e), getView());
  const start = { x: w.x - board.x, y: w.y - board.y };
  draft = { file: board.file, board, shape, color: getColor(), start, box: null, points: [start] };
  try { viewportEl.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
});

viewportEl.addEventListener("pointermove", (e) => {
  if (!draft || notebox) return;
  const w = screenToWorld(localPoint(e), getView());
  const clamp = (v, max) => Math.min(max, Math.max(0, v));
  const px = draft.file ? clamp(w.x - draft.board.x, draft.board.w) : w.x;
  const py = draft.file ? clamp(w.y - draft.board.y, draft.board.h) : w.y;
  const p = { x: px, y: py };
  const { points, start, shape } = draft;
  if (shape === "line") {
    const last = points.at(-1);
    // ponytail: a stroke past MAX_POINTS stops growing; that is thousands of px of drawing.
    if (Math.hypot(p.x - last.x, p.y - last.y) * getView().scale >= MIN_STEP_PX && points.length < MAX_POINTS) points.push(p);
  } else {
    draft.points = [start, p];
  }
  draft.box = pathBox(draft.points);
  render();
});

viewportEl.addEventListener("pointercancel", () => {
  if (draft && !notebox) cancelDraft();
});

viewportEl.addEventListener("pointerup", () => {
  if (!draft || notebox) return;
  const scale = getView().scale;
  const drawn = draft.shape === "line" || draft.shape === "arrow";
  const tooSmall = !draft.box || (drawn
    ? pathLength(draft.points) * scale < MIN_LINE_PX
    : draft.box.w * scale < MIN_RING_PX || draft.box.h * scale < MIN_RING_PX);
  if (tooSmall) {
    draft = null;
    render();
    return;
  }
  if (!draft.file) {
    const box = draft.box;
    let board = null;
    let largestArea = 0;
    for (const screen of getScreens()) {
      const b = getBoard(screen.file);
      if (!b) continue;
      const area = Math.max(0, Math.min(box.x + box.w, b.x + b.w) - Math.max(box.x, b.x)) *
        Math.max(0, Math.min(box.y + box.h, b.y + b.h) - Math.max(box.y, b.y));
      if (area > largestArea) { board = b; largestArea = area; }
    }
    if (!board) return cancelDraft();
    draft.file = board.file;
    draft.board = board;
    draft.box = { ...box, x: box.x - board.x, y: box.y - board.y };
    draft.points = draft.points.map((p) => ({ x: p.x - board.x, y: p.y - board.y }));
    draft.start = draft.points[0];
  }
  draft.closed = draft.shape === "line" && isClosedPath(draft.points, CLOSE_LOOP_PX / scale);
  render();
  openNotebox();
});

function positionNotebox() {
  if (!notebox || !draft) return;
  const r = draftWorldRect();
  const p = worldToScreen({ x: r.x + r.w, y: r.y }, getView());
  const vw = freeWidth();
  const left = p.x + 12 + 240 > vw ? worldToScreen({ x: r.x, y: r.y }, getView()).x - 252 : p.x + 12;
  notebox.style.left = `${Math.max(68, left)}px`;
  notebox.style.top = `${Math.max(60, p.y)}px`;
}

function openNotebox() {
  notebox = document.createElement("div");
  notebox.id = "notebox";
  const label = document.createElement("label");
  label.style.cssText = "display:block;font-weight:600;margin-bottom:6px";
  const ta = document.createElement("textarea");
  label.htmlFor = ta.id = "notebox-text";
  const row = document.createElement("div");
  row.className = "row";
  const hint = document.createElement("span");
  hint.className = "hint";
  const save = button("", () => saveDraft(ta.value));
  row.append(hint, save);
  notebox.append(label, ta, row);
  labelNotebox();
  notebox.addEventListener("pointerdown", (e) => e.stopPropagation());
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); cancelDraft(); }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveDraft(ta.value); }
  });
  viewportEl.append(notebox);
  positionNotebox();
  ta.focus();
  // Read now: the page may be unloaded if the user pans away before saving.
  draft.elements = captureElements(draft.board.el, draft);
}

function labelNotebox() {
  if (!notebox) return;
  notebox.querySelector("label").textContent = t("noteFor", screenOf(draft.file)?.title ?? draft.file);
  notebox.querySelector("textarea").placeholder = t("notePrompt");
  notebox.querySelector(".hint").textContent = t("noteHint");
  notebox.querySelector(".row button").textContent = t("save");
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

const roundBox = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
const roundPoints = (points) => points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));

async function saveDraft(text) {
  const d = draft;
  if (saving || !d?.box) return;
  const note = {
    file: d.file,
    fileHash: screenOf(d.file)?.hash ?? null,
    box: roundBox(d.box),
    text: text.trim(),
    elements: d.elements,
    shape: d.shape,
    color: d.color,
    ...(d.shape === "line" && { closed: d.closed }),
    ...((d.shape === "line" || d.shape === "arrow") && { points: roundPoints(d.points) }),
  };
  saving = true;
  try {
    await api("/api/annotations", { method: "POST", body: JSON.stringify(note) });
  } catch (e) {
    // Keep the ring and the typed text so the user can retry (Enter / Save).
    alert(t("saveFailed", e.message));
    notebox?.querySelector("textarea")?.focus();
    return;
  } finally {
    saving = false;
  }
  if (draft === d) {
    closeNotebox();
    draft = null;
  }
  await refresh().catch(console.error);
}

// --- wiring -------------------------------------------------------------------
onViewChange(positionNotebox);
onLangChange(() => { labelNotebox(); render(); });
onLayoutChange(render);
onScreensChange(render);
events.addEventListener("annotations", () => refresh().catch(console.error));
onReconnect(() => refresh().catch(console.error));
window.addEventListener("pagehide", () => finishDelete(true).catch(console.error));
refresh().catch(console.error);
