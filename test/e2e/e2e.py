"""Browser end-to-end checks for Louend.

Starts the CLI on a copy of examples/demo and drives the canvas with Playwright.
Covers what the node tests cannot: the annotation panel in a real browser,
live (SSE) updates and iframe reloads.

Run:  python -I test/e2e/e2e.py            (uses Playwright's bundled Chromium)
      LOUEND_E2E_CHANNEL=msedge python -I test/e2e/e2e.py
Needs: pip install playwright && playwright install chromium
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

repo = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
work = Path(tempfile.mkdtemp(prefix="louend-e2e-"))
shutil.copytree(repo / "examples/demo/screens", work / "screens")
asset = work / "screens/suunad/pilt.svg"
asset.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')


def start_server(port):
    proc = subprocess.Popen(
        ["node", str(repo / "bin/louend.mjs"), str(work), "--port", str(port), "--no-open"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
    )
    deadline = time.time() + 10
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line and proc.poll() is not None:
            break
        m = re.search(r"Louend: (http://127\.0\.0\.1:\d+)", line)
        if m:
            return proc, m.group(1) + "/"
    proc.terminate()
    sys.exit("louend did not print its URL")


srv, url = start_server(0)

ok = True


def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name)
    ok &= bool(cond)


try:
    with sync_playwright() as p:
        channel = os.environ.get("LOUEND_E2E_CHANNEL") or None
        b = p.chromium.launch(channel=channel, args=["--enable-unsafe-swiftshader"])
        pg = b.new_page(viewport={"width": 1400, "height": 900})
        alerts = []
        pg.on("dialog", lambda d: (alerts.append(d.message), d.accept()))
        pg.goto(url)
        pg.wait_for_selector("iframe")
        pg.wait_for_timeout(800)
        # will-change pins #world to at least 100% raster size, so a book-sized canvas
        # costs GPU memory for all of it at any zoom (146 pages: 1222 MB vs 176 MB).
        check("canvas world not pinned to full-size raster",
              pg.evaluate("getComputedStyle(document.getElementById('world')).willChange") == "auto")
        check("GPU probe present", pg.locator("#gpu-probe").count() == 1)
        lost = pg.evaluate("""() => {
          const ext = document.getElementById('gpu-probe')?.getContext('webgl')?.getExtension('WEBGL_lose_context');
          ext?.loseContext();
          return Boolean(ext);
        }""")
        if lost:
            pg.wait_for_timeout(500)
            log = work / ".canvas/client.log"
            check("lost GPU context is logged", log.exists() and "gpu-context-lost" in log.read_text(encoding="utf-8"))
        else:
            print("SKIP lost GPU context is logged: no WebGL in this browser")

        def draw_ring(text):
            pg.keyboard.press("o")
            fr = pg.locator("iframe").first.bounding_box()
            x, y = fr["x"] + 20, fr["y"] + 20
            pg.mouse.move(x, y)
            pg.mouse.down()
            pg.mouse.move(x + 60, y + 40, steps=5)
            pg.mouse.up()
            pg.wait_for_selector("#notebox textarea")
            pg.fill("#notebox textarea", text)

        # 1. A failed save keeps the draft.
        pg.route("**/api/annotations",
                 lambda r: r.fulfill(status=500, body="x") if r.request.method == "POST" else r.continue_())
        draw_ring("esimene märkus")
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(500)
        check("alert shown on failed save", any("ebaõnnestus" in a for a in alerts))
        check("notebox kept after failure", pg.locator("#notebox textarea").count() == 1)
        check("text kept after failure", pg.input_value("#notebox textarea") == "esimene märkus")
        pg.unroute("**/api/annotations")
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(800)
        check("retry saves and closes notebox",
              pg.locator("#notebox").count() == 0 and pg.locator(".note-row").count() == 1)

        draw_ring("teine märkus")
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(800)
        check("two notes", pg.locator(".note-row").count() == 2)

        # 2. An inline edit survives a live update.
        rows = pg.locator(".note-row")
        first_id = rows.nth(0).get_attribute("data-note")
        second_id = rows.nth(1).get_attribute("data-note")
        rows.nth(0).get_by_text("muuda tekst").click()
        pg.keyboard.press("End")
        pg.keyboard.type(" + pooleli")
        pg.evaluate(
            "id => fetch('/api/annotations/' + id, {method:'PATCH', headers:{'content-type':'application/json'},"
            " body: JSON.stringify({status:'done'})})",
            second_id,
        )
        pg.wait_for_timeout(1500)
        check("second note marked done live",
              "done" in (pg.locator(f'.note-row[data-note="{second_id}"]').get_attribute("class") or ""))
        ta = pg.locator(f'.note-row[data-note="{first_id}"] textarea')
        check("edit textarea survived rebuild", ta.count() == 1)
        check("unsaved text survived", ta.count() == 1 and ta.input_value() == "esimene märkus + pooleli")
        check("focus restored", pg.evaluate("document.activeElement?.tagName") == "TEXTAREA")
        pg.keyboard.type("!")
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(800)
        doc = json.loads(urllib.request.urlopen(url + "api/annotations").read())
        check("edit saved", any(n["text"] == "esimene märkus + pooleli!" for n in doc["notes"]))

        # 3. An asset change reloads the screens in that folder only.
        def srcs():
            return pg.eval_on_selector_all("iframe", "els => els.map(e => e.getAttribute('src'))")

        before = srcs()
        asset.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>')
        pg.wait_for_timeout(1500)
        after = srcs()
        changed = [a for a, c in zip(before, after) if a != c]
        check("asset change reloads suunad screens", bool(changed) and all("suunad" in c for c in changed))
        check("other folder not reloaded", all(a == c for a, c in zip(before, after) if "suunad" not in a))

        # 4. "fail muutunud" warns on open notes only; a done note was changed on purpose.
        changed_note = next(n for n in doc["notes"] if n["id"] == first_id)
        target = work / changed_note["file"]
        target.write_text(target.read_text(encoding="utf8") + "<!-- muudetud -->", encoding="utf8")
        pg.wait_for_timeout(1500)
        badges = lambda note_id: pg.locator(f'.note-row[data-note="{note_id}"] .badge').count()
        check("open note shows file-changed badge", badges(first_id) == 1)
        check("done note has no file-changed badge", badges(second_id) == 0)

        # 5. Labels never collide, at any zoom.
        pg.click("#fit")
        pg.wait_for_timeout(200)
        vp = pg.locator("#viewport").bounding_box()
        pg.mouse.move(vp["x"] + vp["width"] / 2, vp["y"] + vp["height"] / 2)
        collisions = []
        modes = set()
        for _ in range(12):
            found = pg.evaluate("""() => {
              const rect = (e) => e.getBoundingClientRect();
              const shown = (sel) => [...document.querySelectorAll(sel)].filter((e) => rect(e).width > 0);
              const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
              const groups = shown(".group-label"), labels = shown(".board:not(:hover) .board-label"), boards = shown(".board iframe");
              const out = [];
              for (const g of groups) {
                for (const b of boards) if (hit(rect(g), rect(b))) out.push(`group over board: ${g.textContent}`);
                for (const l of labels) if (hit(rect(g), rect(l))) out.push(`group over label: ${g.textContent}`);
              }
              labels.forEach((a, i) => labels.slice(i + 1).forEach((b) => {
                if (hit(rect(a), rect(b))) out.push(`label over label: ${a.textContent} / ${b.textContent}`);
              }));
              for (const l of labels) for (const b of boards) if (hit(rect(l), rect(b))) out.push(`label over board: ${l.textContent}`);
              return { out, mode: document.getElementById("world").dataset.labels ?? "?" };
            }""")
            collisions += found["out"]
            modes.add(found["mode"])
            pg.mouse.wheel(0, 240)
            pg.wait_for_timeout(60)
        check(f"no label collisions while zooming out {sorted(collisions)[:3]}", not collisions)
        check(f"label modes exercised {sorted(modes)}", modes >= {"boards", "none"})

        # 6. With labels hidden, hovering a board shows its full name. Uses a board without
        #    notes: at minimum zoom a pin covers a whole phone-sized board.
        check("zoomed out to no labels", pg.evaluate("document.getElementById('world').dataset.labels") == "none")
        label_state = """() => {
          const l = [...document.querySelectorAll(".board-label")].at(-1);
          return { width: l.getBoundingClientRect().width, cut: l.scrollWidth > l.clientWidth };
        }"""
        pg.mouse.move(5, 5)
        pg.wait_for_timeout(100)
        check("label hidden without hover", pg.evaluate(label_state)["width"] == 0)
        box = pg.locator(".board").last.bounding_box()
        pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        pg.wait_for_timeout(100)
        shown_label = pg.evaluate(label_state)
        check("hover shows the label untruncated", shown_label["width"] > 0 and not shown_label["cut"])

        # 7. The copied command carries the server's real address (the port can vary).
        pg.evaluate("""() => Object.defineProperty(navigator, "clipboard", {
          value: { writeText: (t) => { window.copied = t; return Promise.resolve(); } },
        })""")
        pg.get_by_text("Kopeeri käsk agendile").click()
        pg.wait_for_function("window.copied !== undefined")
        copied = pg.evaluate("window.copied")
        check("copied command has the annotations path", "annotations.json" in copied)
        check(f"copied command has the server URL: {copied}", url.rstrip("/") in copied)

        # 8. A lost connection is visible; reconnecting catches up on what was missed.
        conn = pg.locator("#conn")
        check("no connection warning while connected", not conn.is_visible())
        srv.terminate()
        srv.wait()
        pg.wait_for_selector("#conn:visible", timeout=5000)
        check("connection warning shown when server stops", "katkes" in conn.inner_text())
        (work / "screens/suunad/uus.html").write_text("<title>Uus</title><p>uus</p>", encoding="utf8")
        store = work / ".canvas/annotations.json"
        missed = json.loads(store.read_text(encoding="utf8"))
        next(n for n in missed["notes"] if n["id"] == first_id)["text"] = "muudetud katkestuse ajal"
        store.write_text(json.dumps(missed), encoding="utf8")
        srv, _ = start_server(int(url.rstrip("/").rsplit(":", 1)[1]))
        pg.wait_for_selector("#conn", state="hidden", timeout=15000)
        pg.wait_for_timeout(500)
        check("warning clears after reconnect", not conn.is_visible())
        check("missed screen appears after reconnect", pg.locator('.board-label', has_text="Uus").count() == 1)
        check("missed note edit appears after reconnect",
              "muudetud katkestuse ajal" in pg.locator(f'.note-row[data-note="{first_id}"] .txt').inner_text())

        # 9. EventSource gives up for good on a bad response; do not promise a retry then.
        pg2 = b.new_page()
        pg2.route("**/api/events", lambda r: r.fulfill(status=503, body="x"))
        pg2.goto(url)
        pg2.wait_for_selector("#conn:visible", timeout=5000)
        check("permanent failure asks for a page refresh", "värskenda" in pg2.locator("#conn").inner_text())
        b.close()
finally:
    srv.terminate()
    shutil.rmtree(work, ignore_errors=True)

sys.exit(0 if ok else 1)
