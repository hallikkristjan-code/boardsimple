import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMeta, scanScreens } from "../src/scan.mjs";

test("parseMeta reads artboard size and title", () => {
  const m = parseMeta('<meta name="artboard" content="width=390,height=844"><title>Täna</title>');
  assert.deepEqual(m, { title: "Täna", width: 390, height: 844 });
});

test("parseMeta supports height=auto", () => {
  assert.equal(parseMeta('<meta name="artboard" content="width=390, height=auto">').height, "auto");
});

test("parseMeta returns nulls without meta", () => {
  assert.deepEqual(parseMeta("<p>x</p>"), { title: null, width: null, height: null });
});

async function makeRoot(files) {
  const root = await mkdtemp(join(tmpdir(), "louend-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, body);
  }
  return root;
}

test("scanScreens groups, sorts and applies defaults", async () => {
  const root = await makeRoot({
    "screens/suunad/b.html": "<title>Bee</title>",
    "screens/suunad/a.html": "<p>a</p>",
    "screens/x.html": "<p>x</p>",
    "screens/õhtu menüü/1.html": '<meta name="artboard" content="width=390,height=auto">',
    "screens/notes.txt": "nope",
  });
  const s = await scanScreens(root);
  assert.deepEqual(s.map((x) => `${x.group}/${x.name}`), ["Muu/x", "suunad/a", "suunad/b", "õhtu menüü/1"]);
  const a = s[1];
  assert.equal(a.file, "screens/suunad/a.html");
  assert.equal(a.title, "a");
  assert.equal(a.width, 1440);
  assert.equal(a.height, 900);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(s[2].title, "Bee");
  assert.equal(s[3].height, "auto");
});

test("scanScreens without screens folder returns []", async () => {
  const root = await makeRoot({});
  assert.deepEqual(await scanScreens(root), []);
});

test("scanScreens assetsHash tracks local assets next to the screen, not the HTML hash", async () => {
  const root = await makeRoot({
    "screens/a/one.html": "<p>1</p>",
    "screens/a/img/logo.png": "v1",
    "screens/b/two.html": "<p>2</p>",
  });
  const before = await scanScreens(root);
  await writeFile(join(root, "screens/a/img/logo.png"), "v2-longer");
  const after = await scanScreens(root);
  const pick = (list, name) => list.find((x) => x.name === name);
  assert.equal(pick(after, "one").hash, pick(before, "one").hash);
  assert.notEqual(pick(after, "one").assetsHash, pick(before, "one").assetsHash);
  assert.equal(pick(after, "two").assetsHash, pick(before, "two").assetsHash);
});
