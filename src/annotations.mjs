import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";

const STATUSES = new Set(["open", "done"]);
const empty = () => ({ version: 1, notes: [] });

export function createStore(root) {
  const path = join(root, ".canvas", "annotations.json");
  let chain = Promise.resolve();
  let corrupt = false;

  async function load() {
    let raw;
    try {
      raw = await readFile(path, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return empty();
      throw e;
    }
    if (!raw.trim()) return empty();
    try {
      const doc = JSON.parse(raw);
      if (!doc || !Array.isArray(doc.notes)) throw new Error("bad shape");
      corrupt = false;
      return { version: 1, ...doc };
    } catch {
      corrupt = true;
      return empty();
    }
  }

  async function save(doc) {
    await mkdir(dirname(path), { recursive: true });
    if (corrupt) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await rename(path, join(dirname(path), `annotations.corrupt-${ts}.json`)).catch(() => {});
      corrupt = false;
    }
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(doc, null, 2) + "\n");
    await rename(tmp, path);
  }

  // Serialize mutations; each re-reads the file so external (agent) edits survive.
  function mutate(fn) {
    const run = chain.then(async () => {
      const doc = await load();
      const { result, changed } = fn(doc);
      if (changed) await save(doc);
      return result;
    });
    chain = run.catch(() => {});
    return run;
  }

  return {
    path,
    read: load,
    add(input) {
      return mutate((doc) => {
        const now = new Date().toISOString();
        const note = { ...input, id: randomUUID(), status: "open", createdAt: now, updatedAt: now };
        doc.notes.push(note);
        return { result: note, changed: true };
      });
    },
    update(id, patch) {
      if (patch.status !== undefined && !STATUSES.has(patch.status)) {
        return Promise.reject(new TypeError(`invalid status: ${patch.status}`));
      }
      if (patch.text !== undefined && typeof patch.text !== "string") {
        return Promise.reject(new TypeError("text must be a string"));
      }
      return mutate((doc) => {
        const note = doc.notes.find((n) => n.id === id);
        if (!note) return { result: null, changed: false };
        if (patch.text !== undefined) note.text = patch.text;
        if (patch.status !== undefined) note.status = patch.status;
        note.updatedAt = new Date().toISOString();
        return { result: note, changed: true };
      });
    },
    remove(id) {
      return mutate((doc) => {
        const i = doc.notes.findIndex((n) => n.id === id);
        if (i < 0) return { result: false, changed: false };
        doc.notes.splice(i, 1);
        return { result: true, changed: true };
      });
    },
  };
}
