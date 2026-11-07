// Pure canvas math. No DOM — shared by the browser and node tests.

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 4;

/** One row per group (in input order), boards left to right. */
const ROW_GAP = 120;
const LABEL_H = 28;
const ALL_LABELS_PX = 50; // group label + board label stacked above a board, in screen px
const BOARD_LABEL_PX = 26;

// Labels keep their screen size while the gap between rows shrinks with zoom.
export function labelMode(scale, gap = ROW_GAP + LABEL_H) {
  const room = gap * scale;
  if (room >= ALL_LABELS_PX) return "all";
  return room >= BOARD_LABEL_PX ? "boards" : "none";
}

export function layoutBoards(screens, opts = {}) {
  const { gap = 48, rowGap = ROW_GAP, labelH = LABEL_H, x0 = 0, y0 = 0 } = opts;
  const boards = [];
  const groups = [];
  let y = y0;
  let i = 0;
  while (i < screens.length) {
    const group = screens[i].group;
    groups.push({ group, x: x0, y });
    let x = x0;
    let rowH = 0;
    for (; i < screens.length && screens[i].group === group; i++) {
      const s = screens[i];
      boards.push({ file: s.file, x, y: y + labelH, w: s.width, h: s.height });
      x += s.width + gap;
      rowH = Math.max(rowH, s.height);
    }
    y += rowH + labelH + rowGap;
  }
  return { boards, groups };
}

export function screenToWorld(p, v) {
  return { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale };
}

export function worldToScreen(p, v) {
  return { x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty };
}

export function zoomAt(v, p, factor, min = MIN_SCALE, max = MAX_SCALE) {
  const scale = Math.min(max, Math.max(min, v.scale * factor));
  const w = screenToWorld(p, v);
  return { scale, tx: p.x - w.x * scale, ty: p.y - w.y * scale };
}

export function fitAll(boards, viewport, pad = 40) {
  if (!boards.length) return { tx: 0, ty: 0, scale: 1 };
  const minX = Math.min(...boards.map((b) => b.x));
  const minY = Math.min(...boards.map((b) => b.y));
  const maxX = Math.max(...boards.map((b) => b.x + b.w));
  const maxY = Math.max(...boards.map((b) => b.y + b.h));
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE,
    Math.min((viewport.w - 2 * pad) / w, (viewport.h - 2 * pad) / h)));
  return {
    scale,
    tx: (viewport.w - w * scale) / 2 - minX * scale,
    ty: (viewport.h - h * scale) / 2 - minY * scale,
  };
}

const ABOVE_LINE_PX = 32; // an underline marks the text over it, which it may not touch

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(points) {
  return points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
}

export function pathBox(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** A stroke counts as a loop if it ends near its start and is much longer than that gap. */
export function isClosedPath(points, tolerance) {
  return distance(points[0], points.at(-1)) <= tolerance && pathLength(points) >= tolerance * 3;
}

function insidePolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function rectSamples(box, step = 8) {
  const pts = [{ x: box.x + box.w / 2, y: box.y + box.h / 2 }];
  for (let y = box.y; y <= box.y + box.h; y += step) {
    for (let x = box.x; x <= box.x + box.w; x += step) pts.push({ x, y });
  }
  return pts;
}

function lineSamples(points, step = 8) {
  const pts = [];
  points.forEach((a, i) => {
    const b = points[i + 1] ?? a;
    const flat = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const n = Math.max(1, Math.floor(distance(a, b) / step));
    for (let t = 0; t <= n; t++) {
      const p = { x: a.x + ((b.x - a.x) * t) / n, y: a.y + ((b.y - a.y) * t) / n };
      pts.push(p);
      if (flat) for (let up = step; up <= ABOVE_LINE_PX; up += step) pts.push({ x: p.x, y: p.y - up });
    }
  });
  return pts;
}

/** Points to hit-test for a mark, in the same coordinates as the mark. */
export function markSamples({ shape = "ring", box, points, closed }) {
  if (shape === "box") return rectSamples(box);
  if (shape === "arrow") {
    const { x, y } = points.at(-1);
    return [{ x, y }, { x: x - 6, y }, { x: x + 6, y }, { x, y: y - 6 }, { x, y: y + 6 }];
  }
  if (shape === "line") {
    if (!closed) return lineSamples(points);
    const inside = rectSamples(box).filter((p) => insidePolygon(p, points));
    return inside.length ? inside : points;
  }
  return ellipseSamples(box);
}

/** Where a mark's number pin sits. */
export function pinPoint({ shape = "ring", box, points, closed }) {
  if (shape === "box") return { x: box.x + box.w, y: box.y };
  if (shape === "arrow") return points[0]; // the tip must stay visible
  if (shape === "line") {
    if (!closed) return points.at(-1);
    return points.reduce((best, p) => (p.x - p.y > best.x - best.y ? p : best));
  }
  const a = Math.PI / 4;
  return { x: box.x + box.w / 2 + (box.w / 2) * Math.cos(a), y: box.y + box.h / 2 - (box.h / 2) * Math.sin(a) };
}

/** Files of boards within `margin` screen px of the viewport. */
export function nearbyBoards(boards, view, viewport, margin) {
  const a = screenToWorld({ x: -margin, y: -margin }, view);
  const b = screenToWorld({ x: viewport.w + margin, y: viewport.h + margin }, view);
  return new Set(boards
    .filter((c) => c.x < b.x && c.x + c.w > a.x && c.y < b.y && c.y + c.h > a.y)
    .map((c) => c.file));
}

/** Grid points inside the ellipse inscribed in box; always includes the center. */
export function ellipseSamples(box, step = 8) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = box.w / 2;
  const ry = box.h / 2;
  const pts = [{ x: cx, y: cy }];
  if (rx <= 0 || ry <= 0) return pts;
  for (let y = cy - Math.floor(ry / step) * step; y <= cy + ry; y += step) {
    for (let x = cx - Math.floor(rx / step) * step; x <= cx + rx; x += step) {
      if (x === cx && y === cy) continue;
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) pts.push({ x, y });
    }
  }
  return pts;
}

const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Which ink a mark's number takes: white unless it would miss AA on this colour. */
export const markInk = (color) =>
  /^#[0-9a-f]{6}$/i.test(color ?? "") && contrast(color, "#ffffff") < 4.5 ? "dark" : "light";
