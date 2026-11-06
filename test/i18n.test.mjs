import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MESSAGES, pickLang } from "../public/i18n.js";

test("both languages define the same keys with the same shape", () => {
  const { et, en } = MESSAGES;
  assert.deepEqual(Object.keys(et).sort(), Object.keys(en).sort());
  for (const k of Object.keys(et)) assert.equal(typeof et[k], typeof en[k], k);
});

test("every string key used in index.html exists", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const keys = [...html.matchAll(/data-i18n(?:-\w+)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 20);
  for (const k of keys) assert.equal(typeof MESSAGES.en[k], "string", k);
});

test("counts use the singular for one", () => {
  assert.equal(MESSAGES.en.screens(1), "1 screen");
  assert.equal(MESSAGES.en.screens(2), "2 screens");
  assert.equal(MESSAGES.et.screens(1), "1 ekraan");
  assert.equal(MESSAGES.et.screens(2), "2 ekraani");
});

test("pickLang prefers the saved choice, then any Estonian browser language, then English", () => {
  assert.equal(pickLang("en", ["et-EE"]), "en");
  assert.equal(pickLang("et", ["en-US"]), "et");
  assert.equal(pickLang(null, ["en-US", "et"]), "et");
  assert.equal(pickLang(null, ["et-EE"]), "et");
  assert.equal(pickLang(null, ["de-DE"]), "en");
  assert.equal(pickLang("xx", ["en-US"]), "en");
});
