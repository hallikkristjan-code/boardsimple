import { test } from "node:test";
import assert from "node:assert/strict";
import {
  layoutBoards, screenToWorld, worldToScreen, zoomAt, fitAll, ellipseSamples, labelMode, nearbyBoards,
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

test("zoomAt clamps scale to [0.05, 4]", () => {
  assert.equal(zoomAt({ tx: 0, ty: 0, scale: 1 }, { x: 0, y: 0 }, 100).scale, 4);
  assert.equal(zoomAt({ tx: 0, ty: 0, scale: 1 }, { x: 0, y: 0 }, 0.0001).scale, 0.05);
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
