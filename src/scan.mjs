import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, sep, basename, dirname } from "node:path";

const DEFAULT_W = 1440;
const DEFAULT_H = 900;
export const DEFAULT_GROUP = "Muu";

export function parseMeta(html) {
  const out = { title: null, width: null, height: null };
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t && t[1].trim()) out.title = t[1].trim();
  const meta = html.match(/<meta\s+[^>]*name=["']artboard["'][^>]*>/i);
  const content = meta && meta[0].match(/content=["']([^"']*)["']/i);
  if (content) {
    for (const part of content[1].split(",")) {
      const [k, v] = part.split("=").map((s) => s.trim().toLowerCase());
      if (k === "width" && Number(v) > 0) out.width = Number(v);
      if (k === "height") out.height = v === "auto" ? "auto" : Number(v) > 0 ? Number(v) : null;
    }
  }
  return out;
}

function compareGroups(a, b) {
  if (a === b) return 0;
  if (a === DEFAULT_GROUP) return -1;
  if (b === DEFAULT_GROUP) return 1;
  return a.localeCompare(b, "et");
}

export async function scanScreens(root) {
  const dir = join(root, "screens");
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const screens = [];
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith(".html")) continue;
    const abs = join(ent.parentPath, ent.name);
    const relToScreens = relative(dir, abs);
    const groupDir = dirname(relToScreens);
    const buf = await readFile(abs);
    const meta = parseMeta(buf.toString("utf8"));
    const name = basename(ent.name, ".html");
    screens.push({
      file: relative(root, abs).split(sep).join("/"),
      group: groupDir === "." ? DEFAULT_GROUP : groupDir.split(sep).join("/"),
      name,
      title: meta.title ?? name,
      width: meta.width ?? DEFAULT_W,
      height: meta.height ?? DEFAULT_H,
      hash: createHash("sha256").update(buf).digest("hex"),
    });
  }
  return screens.sort((a, b) => compareGroups(a.group, b.group) || a.file.localeCompare(b.file, "et"));
}
