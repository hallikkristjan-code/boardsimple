// Pure canvas math. No DOM — shared by the browser and node tests.

export const MIN_SCALE = 0.05;
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
