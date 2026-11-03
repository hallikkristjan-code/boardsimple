import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/annotations.mjs";

const input = () => ({
  file: "screens/suunad/a.html",
  fileHash: "a".repeat(64),
  box: { x: 10, y: 20, w: 30, h: 40 },
  text: "CTA liiga väike",
  elements: [],
});

async function fresh() {
  const root = await mkdtemp(join(tmpdir(), "louend-ann-"));
  return { root, store: createStore(root) };
}

test("read on missing file returns empty doc without creating it", async () => {
  const { root, store } = await fresh();
  assert.deepEqual(await store.read(), { version: 1, notes: [] });
  await assert.rejects(readdir(join(root, ".canvas")));
});

test("add stores an open note with id and timestamps", async () => {
  const { store } = await fresh();
  const n = await store.add(input());
  assert.equal(n.status, "open");
  assert.ok(n.id);
  assert.equal(n.createdAt, n.updatedAt);
  const doc = await store.read();
  assert.equal(doc.notes.length, 1);
  assert.equal(doc.notes[0].text, "CTA liiga väike");
});

test("add keeps an external edit made by the agent", async () => {
  const { store } = await fresh();
  const n = await store.add(input());
  const doc = JSON.parse(await readFile(store.path, "utf8"));
  doc.notes[0].status = "done";
  await writeFile(store.path, JSON.stringify(doc));
  await store.add({ ...input(), text: "teine" });
  const after = await store.read();
  assert.equal(after.notes.length, 2);
  assert.equal(after.notes.find((x) => x.id === n.id).status, "done");
});

test("update changes status and updatedAt", async () => {
  const { store } = await fresh();
  const n = await store.add(input());
  await new Promise((r) => setTimeout(r, 5));
  const u = await store.update(n.id, { status: "done" });
  assert.equal(u.status, "done");
  assert.notEqual(u.updatedAt, n.updatedAt);
});

test("update unknown id returns null", async () => {
  const { store } = await fresh();
  assert.equal(await store.update("nope", { text: "x" }), null);
});

test("update with invalid status throws TypeError", async () => {
  const { store } = await fresh();
  const n = await store.add(input());
  await assert.rejects(store.update(n.id, { status: "x" }), TypeError);
});

test("remove returns true for existing and false for unknown", async () => {
  const { store } = await fresh();
  const n = await store.add(input());
  assert.equal(await store.remove(n.id), true);
  assert.equal(await store.remove(n.id), false);
});

test("corrupt file reads as empty and is backed up on next write", async () => {
  const { root, store } = await fresh();
  await mkdir(join(root, ".canvas"), { recursive: true });
  await writeFile(store.path, "{oops");
  assert.deepEqual(await store.read(), { version: 1, notes: [] });
  await store.add(input());
  const files = await readdir(join(root, ".canvas"));
  assert.ok(files.some((f) => /^annotations\.corrupt-.+\.json$/.test(f)), files.join(","));
  assert.equal((await store.read()).notes.length, 1);
});
