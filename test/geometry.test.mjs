import { test } from "node:test";
import assert from "node:assert/strict";
import {
  layoutBoards, screenToWorld, worldToScreen, zoomAt, fitAll, ellipseSamples, labelMode, nearbyBoards, MIN_SCALE,
  rectSamples, isClosedPath, markSamples, pathBox, pinPoint,
} from "../public/geometry.js";

const S = (file, group, width, height) => ({ file, group, width, height });

test("layoutBoards puts groups on rows and boards left to right", () => {
  const { boards, groups } = layoutBoards([
    S("a", "g1", 390, 844), S("b", "g1", 390, 600), S("c", "g2", 1180, 820),
  ]);
  assert.deepEqual(boards[0], { file: "a", x: 0, y: 28, w: 390, h: 844 });
  assert.equal(boards[1].x, 390 + 48);
  assert.equal(boards[1].y, 28);
  assert.deepEqual(groups[0], { group: "g1", x: 0, y: 0 });
  assert.equal(groups[1].y, 844 + 28 + 120);
  assert.equal(boards[2].y, groups[1].y + 28);
});

test("screen/world transforms are inverses", () => {
  const view = { tx: 37, ty: -12, scale: 0.6 };
  const p = { x: 123, y: 456 };
  const back = worldToScreen(screenToWorld(p, view), view);
  assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
});

test("zoomAt keeps the cursor point fixed", () => {
  const view = { tx: 10, ty: 20, scale: 1 };
  const p = { x: 300, y: 200 };
  const before = screenToWorld(p, view);
  const v2 = zoomAt(view, p, 1.7);
  const after = screenToWorld(p, v2);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
});

test("zoomAt clamps scale to [MIN_SCALE, 4]", () => {
  assert.equal(zoomAt({ tx: 0, ty: 0, scale: 1 }, { x: 0, y: 0 }, 100).scale, 4);
  assert.equal(zoomAt({ tx: 0, ty: 0, scale: 1 }, { x: 0, y: 0 }, 0.0001).scale, MIN_SCALE);
});

test("fitAll shows the whole board with margin", () => {
  const b = { file: "a", x: 0, y: 28, w: 390, h: 844 };
  const v = fitAll([b], { w: 800, h: 600 });
  const tl = worldToScreen({ x: b.x, y: b.y }, v);
  const br = worldToScreen({ x: b.x + b.w, y: b.y + b.h }, v);
  assert.ok(tl.x >= 40 - 1e-9 && tl.y >= 40 - 1e-9, JSON.stringify(tl));
  assert.ok(br.x <= 760 + 1e-9 && br.y <= 560 + 1e-9, JSON.stringify(br));
});

test("fitAll with no boards returns identity", () => {
  assert.deepEqual(fitAll([], { w: 800, h: 600 }), { tx: 0, ty: 0, scale: 1 });
});

test("ellipseSamples stays inside the ellipse and includes center", () => {
  const box = { x: 0, y: 0, w: 16, h: 16 };
  const pts = ellipseSamples(box);
  assert.ok(pts.some((p) => p.x === 8 && p.y === 8));
  for (const p of pts) {
    const dx = (p.x - 8) / 8, dy = (p.y - 8) / 8;
    assert.ok(dx * dx + dy * dy <= 1 + 1e-9, JSON.stringify(p));
  }
});

test("ellipseSamples of zero-size box is just the center", () => {
  assert.deepEqual(ellipseSamples({ x: 5, y: 6, w: 0, h: 0 }), [{ x: 5, y: 6 }]);
});

test("labelMode drops labels that no longer fit the row gap", () => {
  assert.equal(labelMode(1), "all");
  assert.equal(labelMode(0.35), "all");
  assert.equal(labelMode(0.23), "boards");
  assert.equal(labelMode(0.18), "boards");
  assert.equal(labelMode(0.1), "none");
});

test("nearbyBoards keeps boards inside the viewport plus margin", () => {
  const boards = [
    { file: "in", x: 100, y: 100, w: 100, h: 100 },
    { file: "near", x: 1100, y: 100, w: 100, h: 100 },
    { file: "far", x: 5000, y: 100, w: 100, h: 100 },
  ];
  const got = nearbyBoards(boards, { tx: 0, ty: 0, scale: 1 }, { w: 1000, h: 800 }, 200);
  assert.deepEqual([...got].sort(), ["in", "near"]);
});

test("nearbyBoards margin is in screen px, so it reaches further when zoomed out", () => {
  const boards = [{ file: "a", x: 2200, y: 0, w: 100, h: 100 }];
  const view = { tx: 0, ty: 0, scale: 0.25 }; // 500 px viewport shows world x 0..2000
  assert.equal(nearbyBoards(boards, view, { w: 500, h: 500 }, 0).size, 0);
  assert.equal(nearbyBoards(boards, view, { w: 500, h: 500 }, 100).size, 1); // 100 px = 400 world px
});

test("fitAll fits a book-sized project without cutting off rows", () => {
  const boards = Array.from({ length: 18 }, (_, i) => ({ file: `${i}`, x: 0, y: i * 1012, w: 576, h: 864 }));
  const viewport = { w: 1100, h: 856 };
  const v = fitAll(boards, viewport);
  assert.ok(v.ty >= 0, `first row starts at ${v.ty}`);
  assert.ok(v.ty + (17 * 1012 + 864) * v.scale <= viewport.h, "last row fits");
});

test("rectSamples covers the corners that an ellipse misses", () => {
  const pts = rectSamples({ x: 0, y: 0, w: 80, h: 40 });
  assert.ok(pts.some((p) => p.x <= 4 && p.y <= 4));
  assert.ok(pts.some((p) => p.x >= 76 && p.y >= 36));
});

test("isClosedPath is true only when a long path ends near its start", () => {
  const loop = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 5, y: 5 }];
  assert.equal(isClosedPath(loop, 24), true);
  assert.equal(isClosedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }], 24), false);
  assert.equal(isClosedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 24), false); // short stroke, not a loop
});

test("markSamples on a closed line stays inside it", () => {
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
  const pts = markSamples({ shape: "line", closed: true, points, box: pathBox(points) });
  assert.ok(pts.length > 0);
  assert.ok(pts.every((p) => p.x + p.y <= 100));
});

test("markSamples on an underline reaches the text above it", () => {
  const points = [{ x: 0, y: 100 }, { x: 80, y: 100 }];
  const pts = markSamples({ shape: "line", closed: false, points, box: pathBox(points) });
  assert.ok(pts.some((p) => p.x === 40 && p.y === 100), "on the line");
  assert.ok(pts.some((p) => p.y <= 72), "text above");
  assert.ok(pts.every((p) => p.y <= 100), "nothing below");
});

test("markSamples on a vertical line keeps to the line", () => {
  const points = [{ x: 50, y: 0 }, { x: 50, y: 80 }];
  const pts = markSamples({ shape: "line", closed: false, points, box: pathBox(points) });
  assert.ok(pts.every((p) => p.x === 50 && p.y >= 0));
});

test("markSamples on an arrow looks at the tip, not the tail", () => {
  const points = [{ x: 0, y: 0 }, { x: 200, y: 100 }];
  const pts = markSamples({ shape: "arrow", points, box: pathBox(points) });
  assert.ok(pts.every((p) => Math.abs(p.x - 200) <= 8 && Math.abs(p.y - 100) <= 8));
});

test("markSamples treats notes without a shape as rings", () => {
  const box = { x: 0, y: 0, w: 80, h: 40 };
  assert.deepEqual(markSamples({ box }), ellipseSamples(box));
});

test("pinPoint keeps the arrow pin off the tip and the line pin at its end", () => {
  const box = { x: 0, y: 0, w: 100, h: 50 };
  const points = [{ x: 0, y: 0 }, { x: 100, y: 50 }];
  assert.deepEqual(pinPoint({ shape: "arrow", box, points }), { x: 0, y: 0 });
  assert.deepEqual(pinPoint({ shape: "line", box, points }), { x: 100, y: 50 });
  assert.deepEqual(pinPoint({ shape: "box", box }), { x: 100, y: 0 });
});
