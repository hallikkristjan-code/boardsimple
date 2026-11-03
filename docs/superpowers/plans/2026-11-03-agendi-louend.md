# Agendi-lõuend (louend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local, free canvas that shows a project's HTML screens side by side as artboards, live-reloads them, and lets the user circle areas with notes that an agent reads from `.canvas/annotations.json`.

**Architecture:** One zero-dependency Node server (`node:http`, `fs.watch`, SSE) serves the canvas UI and the project's screens from the same origin, so the canvas can look inside iframes. The canvas is plain HTML/CSS/ES modules; pure math (layout, zoom transforms, hit-test sample points) lives in a DOM-free module tested with `node --test`. Annotations are persisted per-note through a small REST API that re-reads the file on every write, so agent edits are never overwritten.

**Tech Stack:** Node 24 (stdlib only), `node:test`, vanilla JS/CSS/SVG in the browser.

**Spec:** `docs/superpowers/specs/2026-11-03-agendi-louend-design.md`

## Global Constraints

- Zero runtime and dev dependencies. Node ≥ 24, `"type": "module"`.
- Server binds `127.0.0.1` only. Default port `4477`; if busy, try next up to `4487`.
- Screens: `<root>/screens/<group>/<name>.html`; files directly in `screens/` → group `"Muu"`. Groups sorted by folder name, files by file name.
- Size meta: `<meta name="artboard" content="width=390,height=844">`; `height=auto` allowed; default `1440×900`. Label = `<title>` else file name without `.html`.
- Annotations file: `<root>/.canvas/annotations.json`, shape `{ "version": 1, "notes": Note[] }`.
- `Note = { id, file, fileHash, box:{x,y,w,h}, text, elements: {selector, tag, text, box}[], status: "open"|"done", createdAt, updatedAt }`. `file` is POSIX path relative to root (`screens/suunad/c-turg.html`); `box` in artboard CSS pixels; `fileHash` = sha256 hex of file bytes at creation; `text` of elements trimmed to 80 chars.
- UI copy in Estonian. Ring color `#ff3b30`. Tools: Vali, Käsi, Ring. Panel footer: `"N avatud märkust · .canvas/annotations.json"` + button `"Kopeeri käsk agendile"` copying `vaata märkused üle: <root>/.canvas/annotations.json`. Stale note badge: `"fail muutunud"`.
- CLI command `louend [kaust]` (default cwd), opens browser.
- No PNG export, no MCP, no drag/edit of elements (non-goals v1).

## Review Focus

1. File/folder names with spaces or `õäöü` — URLs must be encoded and resolve back to the same file.
2. Path traversal (`/screens/..%2f..%2fsecret`) — must return 404, never serve outside `<root>/screens` or the app folder.
3. Missing, empty or corrupt `annotations.json` — server treats as empty doc, does not crash; corrupt file is renamed to `annotations.corrupt-<ts>.json` before writing.
4. Windows `fs.watch` duplicate events and editor atomic saves (rename) — debounce 100 ms, watcher survives file delete/recreate.
5. Port already in use — falls through to next port and prints the actual URL.

---

## File Structure

```
package.json                 bin louend, scripts.test = "node --test"
bin/louend.mjs               CLI: args, start server, open browser
src/scan.mjs                 screens discovery + meta parsing
src/annotations.mjs          annotation store (read-fresh, atomic write)
src/server.mjs               http routes, static, API, SSE, watchers
public/index.html            canvas shell
public/style.css
public/geometry.js           pure math (DOM-free, shared with tests)
public/canvas.js             viewport, artboards, live reload
public/annotate.js           ring tool, note box, side panel, hit-test
test/*.test.mjs
examples/demo/screens/...    3 sample screens in 2 groups for manual checks
AGENTS-LOUEND.md             agent guide to paste into other projects
README.md
```

---

### Task 1: Scaffold + screen discovery

**Files:** Create `package.json`, `src/scan.mjs`, `test/scan.test.mjs`, `examples/demo/screens/suunad/a-ajaleht.html`, `examples/demo/screens/suunad/b-kabel.html`, `examples/demo/screens/viktoriin/01-ooteekraan.html`, `.gitignore` (`node_modules/`, `.canvas/` under examples only: `examples/**/.canvas/`).

**Interfaces — Produces:**
- `scanScreens(root: string): Promise<Screen[]>` where `Screen = { file: string /*posix rel*/, group: string, name: string, title: string, width: number, height: number|"auto", hash: string }`, sorted by group then file.
- `parseMeta(html: string): { title: string|null, width: number|null, height: number|"auto"|null }`

- [ ] **Step 1: Write failing tests** in `test/scan.test.mjs` (create temp dir with `fs.mkdtemp`):
  - `parseMeta` of `<meta name="artboard" content="width=390,height=844"><title>Täna</title>` → `{title:"Täna", width:390, height:844}`; `height=auto` → `"auto"`; no meta → nulls.
  - `scanScreens`: files `screens/suunad/b.html`, `screens/suunad/a.html`, `screens/x.html`, `screens/õhtu menüü/1.html`, `screens/notes.txt` → 4 screens; order `Muu/x`, `suunad/a`, `suunad/b`, `õhtu menüü/1` (group compare with `localeCompare(…, "et")`, `Muu` first); defaults width 1440 height 900; title falls back to `"a"`; `hash` is 64 hex chars; missing `screens/` → `[]`.
- [ ] **Step 2:** `node --test test/scan.test.mjs` → FAIL (module not found).
- [ ] **Step 3: Implement** with `fs.readdir(…, {recursive:true, withFileTypes:true})`, regex meta parse, `crypto.createHash("sha256")`. Write `package.json` (`name: "louend"`, `type: module`, `bin: {louend: "bin/louend.mjs"}`, `engines.node: ">=24"`). Write 3 demo screens with artboard meta (390×844, one `height=auto`), each with a heading, a few rows and a `<button class="cta">`.
- [ ] **Step 4:** `node --test` → PASS.
- [ ] **Step 5:** `git add -A && git commit -m "feat: screen discovery and demo screens"`

### Task 2: Annotation store

**Files:** Create `src/annotations.mjs`, `test/annotations.test.mjs`.

**Interfaces — Produces** (all re-read the file before acting and write atomically via `<file>.tmp` + `rename`):
- `createStore(root: string)` → `{ read(): Promise<Doc>, add(input: Omit<Note,"id"|"status"|"createdAt"|"updatedAt">): Promise<Note>, update(id: string, patch: {text?: string, status?: "open"|"done"}): Promise<Note|null>, remove(id: string): Promise<boolean>, path: string }`
- `id` = `crypto.randomUUID()`; timestamps ISO strings.

- [ ] **Step 1: Failing tests:**
  - `read()` on missing file → `{version:1, notes:[]}`; creates nothing.
  - `add` then `read` → 1 note, `status:"open"`, has `id`, `createdAt === updatedAt`.
  - **merge:** after `add`, write the file externally setting that note's `status:"done"` (simulates agent), then `add` a second note → `read()` has 2 notes and the first is still `"done"`.
  - `update(id,{status:"done"})` changes `updatedAt`; unknown id → `null`; invalid status `"x"` → throws `TypeError`.
  - `remove` existing → `true`, unknown → `false`.
  - corrupt file (`"{oops"`) → `read()` returns empty doc; next `add` succeeds and a file matching `annotations.corrupt-*.json` exists in `.canvas/`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** in `src/annotations.mjs`; `mkdir(…, {recursive:true})` for `.canvas/`; serialize writes with an in-process promise chain.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat: annotation store with per-note merge`.

### Task 3: HTTP server, API, SSE

**Files:** Create `src/server.mjs`, `test/server.test.mjs`, minimal `public/index.html` placeholder (replaced in Task 5).

**Interfaces:**
- Consumes: `scanScreens`, `createStore`.
- Produces: `startServer({root: string, port?: number, appDir?: string}): Promise<{url: string, port: number, close(): Promise<void>}>`.
- Routes:
  - `GET /` → `public/index.html`; `GET /app/<file>` → files from `public/`.
  - `GET /screens/<path>` → files under `<root>/screens` (decodeURIComponent each segment; resolve and require result to start with screens dir + sep; else 404). Content-Type by extension (html, css, js, png, jpg, svg, webp, woff2, json), default `application/octet-stream`. `Cache-Control: no-store`.
  - `GET /api/screens` → `Screen[]` JSON plus `{root}` → shape `{root: string, screens: Screen[]}`.
  - `GET /api/annotations` → Doc; `POST /api/annotations` (JSON body ≤ 1 MB, else 413) → 201 Note; `PATCH /api/annotations/:id` → 200 Note / 404; `DELETE /api/annotations/:id` → 204 / 404. Bad JSON → 400.
  - `GET /api/events` → SSE; emits `event: screens` and `event: annotations` (data `{}`); `: ping` every 25 s.
- Watchers: `fs.watch(<root>/screens, {recursive:true})` and `fs.watch(<root>/.canvas)` (create dir first); debounce 100 ms per event type; if `screens/` doesn't exist, watch root non-recursively until it appears.
- Port: try `port ?? 4477` … `4487` on `EADDRINUSE`.

- [ ] **Step 1: Failing tests** (start on temp root with port 0 allowed for tests → pass `port: 0` means OS-assigned; use `fetch`):
  - `GET /api/screens` lists demo-like files.
  - `GET /screens/%C3%B5htu%20men%C3%BC%C3%BC/1.html` → 200 with file body.
  - `GET /screens/..%2f..%2fpackage.json` and `/screens/../package.json` → 404.
  - POST → 201, GET shows it, PATCH status done → 200, DELETE → 204, DELETE again → 404; POST `"{bad"` → 400.
  - SSE: open `/api/events` via `fetch` reader, then write a file in `screens/` → receive chunk containing `event: screens` within 2 s; write `.canvas/annotations.json` → `event: annotations`.
  - Busy port: occupy a port with `net.createServer`, `startServer({port: thatPort})` → resolves with `port === thatPort + 1`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `src/server.mjs` per Interfaces.
- [ ] **Step 4:** run all tests → PASS.
- [ ] **Step 5:** commit `feat: local server with screens, annotations API and SSE`.

### Task 4: Pure geometry

**Files:** Create `public/geometry.js`, `test/geometry.test.mjs`.

**Interfaces — Produces:**
- `layoutBoards(screens: {file, group, width, height:number}[], opts={gap:48, rowGap:120, labelH:28, x0:0, y0:0}) → {file, x, y, w, h}[]` and `groupRows: {group, x, y}[]` — one row per group, boards left→right; row height = tallest board + labelH + rowGap. Returns `{boards, groups}`.
- `screenToWorld({x,y}, view:{tx,ty,scale}) → {x,y}` and `worldToScreen` inverse.
- `zoomAt(view, pointScreen, factor, min=0.05, max=4) → view` keeping the point under cursor fixed.
- `fitAll(boards, viewport:{w,h}, pad=40) → view`.
- `ellipseSamples(box:{x,y,w,h}, step=8) → {x,y}[]` — grid points inside the ellipse inscribed in box (always includes center).

- [ ] **Step 1: Failing tests:** two groups → second row `y` = first row tallest h + 28 + 120; `worldToScreen(screenToWorld(p))` ≈ p; `zoomAt` keeps point fixed (±1e-9) and clamps scale to `[0.05, 4]`; `fitAll` of one 390×844 board in 800×600 → board fully visible with ≥40 px margin; `ellipseSamples({x:0,y:0,w:16,h:16})` contains `{x:8,y:8}` and no point outside the ellipse; zero-size box → `[{center}]`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat: canvas geometry helpers`.

### Task 5: Canvas UI — boards, pan/zoom, live reload

**Files:** Create `public/index.html`, `public/style.css`, `public/canvas.js`.

**Interfaces:**
- Consumes: `/api/screens`, `/api/events`, `geometry.js`.
- Produces (exported from `canvas.js` for Task 6): `getView(): {tx,ty,scale}`, `boardAt(screenPoint) → {file, el: HTMLIFrameElement, x, y, w, h}|null`, `onViewChange(cb)`, `setTool(name: "vali"|"kasi"|"ring")`, `getTool()`, DOM `#world` (transformed container), `#overlay` (SVG in world coordinates, above iframes).

Layout per spec mockup: top bar (project name = basename of root, zoom %, "Mahuta kõik" button), left tool rail (Vali `V`, Käsi `H`, Ring `O` with keyboard shortcuts), center grid canvas, right 170 px panel placeholder `#panel`.

- [ ] **Step 1:** Implement: each screen → label div + `<iframe src="/screens/<encoded path>" scrolling="no">` sized `w×h`; for `height:"auto"` set height from `iframe.contentDocument.documentElement.scrollHeight` on load and re-layout. Wheel = zoom at cursor (`ctrlKey` pinch too), Space-drag or Käsi tool = pan, initial `fitAll`. Transparent `.shield` div over iframes unless tool is `vali`. On SSE `screens`: refetch list, reload only iframes whose `hash` changed, add/remove boards, keep view.
- [ ] **Step 2: Verify manually:** `node -e "import('./src/server.mjs').then(m=>m.startServer({root:'examples/demo'})).then(s=>console.log(s.url))"`, open URL: 2 group rows with labels, 3 boards at correct sizes, wheel zoom centers on cursor, pan works, editing `examples/demo/screens/suunad/a-ajaleht.html` updates that board within ~1 s without page reload; adding a new file adds a board.
- [ ] **Step 3:** commit `feat: canvas with artboards, pan/zoom, live reload`.

### Task 6: Ring annotations UI

**Files:** Create `public/annotate.js`; modify `public/index.html` (script tag), `public/style.css`.

**Interfaces:** Consumes Task 5 exports, `/api/annotations` API, `ellipseSamples`.

- [ ] **Step 1: Implement:**
  - Ring tool: pointerdown on a board starts ellipse, drag sizes it (draw in `#overlay`, stroke `#ff3b30` 2.5 px / scale-independent via `vector-effect: non-scaling-stroke`); ring clipped to its board; release <6 px → cancel.
  - On release open note box beside ring (textarea, Enter = salvesta, Shift+Enter = new line, Esc = tühista). On save: compute box in artboard px; hit-test `iframe.contentDocument.elementsFromPoint` for each `ellipseSamples(box)` point; keep elements whose bounding box intersects ring box, drop `html`/`body`, dedupe, keep the deepest 10 (descendants over ancestors); selector = `tag#id` if id else path of `tag.class1:nth-of-type(n)` up to body. POST note with `fileHash` from current screen list.
  - Numbered red pins (order by `createdAt`); `done` notes shown grey with check; hover pin ↔ highlight panel row.
  - Panel: list rows `N · text` + `<board label> · <first element tag.class>`; click row → pan to ring; row actions: muuda tekst, märgi tehtuks / ava uuesti, kustuta. Badge `"fail muutunud"` when note `fileHash` ≠ current screen hash. Footer text + "Kopeeri käsk agendile" (`navigator.clipboard.writeText`, label flashes "Kopeeritud").
  - On SSE `annotations`: refetch and re-render (agent's `done` appears without reload).
- [ ] **Step 2: Verify manually** on demo: draw ring around CTA on `b-kabel`, type note, save → `examples/demo/.canvas/annotations.json` has note with `elements[0].tag === "button"`; edit JSON status to `done` in editor → pin turns grey within ~1 s; edit the screen file → badge "fail muutunud"; zoomed to 50% and 200% the ring still lands on the same element.
- [ ] **Step 3:** commit `feat: ring annotations with element hit-test`.

### Task 7: CLI, agent guide, README

**Files:** Create `bin/louend.mjs`, `AGENTS-LOUEND.md`, `README.md`; test `test/cli.test.mjs`.

**Interfaces:** `bin/louend.mjs [kaust] [--port N] [--no-open]` → resolves root (default `process.cwd()`), errors with exit 1 and Estonian message if folder missing, starts server, prints `Louend: <url>  (kaust: <root>)`, opens browser via `start "" <url>` on win32 / `open` / `xdg-open` unless `--no-open`.

- [ ] **Step 1: Failing test:** spawn `node bin/louend.mjs examples/demo --no-open --port 0`, read stdout until it matches `/Louend: http:\/\/127\.0\.0\.1:\d+/`, fetch `/api/screens` → 3 screens, kill. Nonexistent folder → exit code 1.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5:** Write `AGENTS-LOUEND.md` (≤ 40 lines, Estonian): where to write screens, the artboard meta, one-state-per-file, "vaata märkused üle" workflow (read `.canvas/annotations.json`, act on `status:"open"`, use `selector`/`text`/`box`, edit the HTML file, then set note `status` to `"done"` and `updatedAt` — never delete notes), keep screens self-contained. `README.md`: install (`npm link` in repo), `louend`, demo command.
- [ ] **Step 6:** `npm link` then `louend examples/demo` opens canvas (manual).
- [ ] **Step 7:** commit `feat: louend CLI and agent guide`.
