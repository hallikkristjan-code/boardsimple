import { isClosedPath, markSamples, pathBox, pathLength, pinPoint, screenToWorld, worldToScreen } from "./geometry.js";
import {
  freeWidth, getView, getTool, getColor, getScreens, getRoot, getBoard, boardAt, centerOn, isPanGesture, MARK_TOOLS,
  onViewChange, onScreensChange, onLayoutChange, onReconnect, viewportEl, worldEl, overlayEl, events,
} from "./canvas.js";

const SVG = "http://www.w3.org/2000/svg";
const MIN_RING_PX = 6;
const MIN_LINE_PX = 12;
const CLOSE_LOOP_PX = 24;
const MIN_STEP_PX = 2;
const MAX_POINTS = 2000;
const ARROW_HEAD = 18;
const MAX_ELEMENTS = 10;
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
  if (m.color) e.style.setProperty("--mark", m.color);
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
    const m = noteGeom(n);
    if (!m) return;
    const done = n.status === "done";
    const ring = markEl(m, done ? " done" : "");
    ring.dataset.note = n.id;
    overlayEl.append(ring);
    const pin = document.createElement("div");
    pin.className = `ann-pin${done ? " done" : ""}`;
    pin.dataset.note = n.id;
    pin.textContent = done ? "✓" : String(i + 1);
    pin.title = n.text;
    const at = pinPoint(m);
    pin.style.left = `${at.x}px`;
    pin.style.top = `${at.y}px`;
    pin.style.transform = "scale(var(--inv,1))";
    if (n.color) pin.style.setProperty("--mark", n.color);
    pin.addEventListener("mouseenter", () => setHover(n.id));
    pin.addEventListener("mouseleave", () => setHover(null));
    pin.addEventListener("click", () => panel.querySelector(`.note-row[data-note="${n.id}"]`)?.scrollIntoView({ block: "nearest" }));
    pinsEl.append(pin);
  });
  if (draft?.box) overlayEl.append(markEl(toWorld(draft, draft.board), ""));
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

const safely = (fn) => async () => {
  try {
    await fn();
  } catch (e) {
    alert(`Toiming ebaõnnestus: ${e.message}`);
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
        alert(`Märkuse muutmine ebaõnnestus: ${err.message}`);
        return; // keep the textarea and its text
      }
      editing = null;
      await refresh().catch(console.error);
    }
  });
}

function renderPanel() {
  const open = notes.filter((n) => n.status !== "done").length;
  const h = document.createElement("h2");
  h.textContent = "Märkused";
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
    p.textContent = "Vali vasakult tööriist ja märgi koht, mida muuta.";
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
    if (n.color) num.style.setProperty("--mark", n.color);
    const body = document.createElement("div");
    const txt = document.createElement("div");
    txt.className = "txt";
    txt.textContent = n.text || "(tühi märkus)";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = screenOf(n.file)?.title ?? n.file;
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
      button(done ? "ava uuesti" : "märgi tehtuks", safely(async () => {
        await api(`/api/annotations/${n.id}`, { method: "PATCH", body: JSON.stringify({ status: done ? "open" : "done" }) });
        await refresh();
      })),
      button("kustuta", safely(async () => {
        await api(`/api/annotations/${n.id}`, { method: "DELETE" });
        await refresh();
      })),
    );
    body.append(actions);
    row.append(num, body);
    row.addEventListener("mouseenter", () => setHover(n.id));
    row.addEventListener("mouseleave", () => setHover(null));
    row.addEventListener("click", () => { const m = noteGeom(n); if (m) centerOn(m.box); });
    list.append(row);
  });
  const footer = document.createElement("footer");
  const copyLabel = document.createElement("span");
  const say = (text) => { copyLabel.textContent = text; };
  say("Kopeeri käsk agendile");
  const copy = button("", async () => {
    const sepChar = getRoot().includes("\\") ? "\\" : "/";
    const path = `${getRoot()}${sepChar}.canvas${sepChar}annotations.json`;
    try {
      await navigator.clipboard.writeText(`vaata märkused üle: ${path} (louend: ${location.origin})`);
      say("Kopeeritud");
    } catch {
      say("Kopeerimine ei õnnestunud");
    }
    setTimeout(() => say("Kopeeri käsk agendile"), 1500);
  });
  const copyIcon = svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
  copyIcon.append(
    svg("rect", { x: 8, y: 8, width: 12, height: 12, rx: 2 }),
    svg("path", { d: "M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" }),
  );
  copy.append(copyIcon, copyLabel);
  footer.append(copy);
  const active = document.activeElement;
  const caret = active?.tagName === "TEXTAREA" && panel.contains(active) ? active.selectionStart : -1;
  panel.replaceChildren(h, list, ...(open ? [footer] : []));
  if (editing) {
    // Live updates rebuild the panel; reopen the edit with the unsaved text.
    const row = list.querySelector(`.note-row[data-note="${CSS.escape(editing.id)}"]`);
    const n = notes.find((x) => x.id === editing.id);
    if (row && n) editInline(row, n, caret);
    else editing = null; // note was deleted meanwhile
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
  const shape = MARK_TOOLS[getTool()];
  if (!shape || isPanGesture(e) || e.button !== 0) return;
  if (e.target.closest?.("#notebox")) return;
  closeNotebox();
  const board = boardAt(localPoint(e));
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
  const px = clamp(w.x - draft.board.x, draft.board.w);
  const py = clamp(w.y - draft.board.y, draft.board.h);
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
  // Read now: the page may be unloaded if the user pans away before saving.
  draft.elements = captureElements(draft.board.el, draft);
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
    // Keep the ring and the typed text so the user can retry (Enter / Salvesta).
    alert(`Märkuse salvestamine ebaõnnestus: ${e.message}`);
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
onLayoutChange(render);
onScreensChange(render);
events.addEventListener("annotations", () => refresh().catch(console.error));
onReconnect(() => refresh().catch(console.error));
refresh().catch(console.error);
