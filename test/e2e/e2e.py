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

srv = subprocess.Popen(
    ["node", str(repo / "bin/louend.mjs"), str(work), "--port", "0", "--no-open"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
)
url = None
deadline = time.time() + 10
while time.time() < deadline and url is None:
    line = srv.stdout.readline()
    if not line and srv.poll() is not None:
        break
    m = re.search(r"Louend: (http://127\.0\.0\.1:\d+)", line)
    if m:
        url = m.group(1) + "/"
if url is None:
    srv.terminate()
    sys.exit("louend did not print its URL")

ok = True


def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name)
    ok &= bool(cond)


try:
    with sync_playwright() as p:
        channel = os.environ.get("LOUEND_E2E_CHANNEL") or None
        b = p.chromium.launch(channel=channel)
        pg = b.new_page(viewport={"width": 1400, "height": 900})
        alerts = []
        pg.on("dialog", lambda d: (alerts.append(d.message), d.accept()))
        pg.goto(url)
        pg.wait_for_selector("iframe")
        pg.wait_for_timeout(800)

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
        b.close()
finally:
    srv.terminate()
    shutil.rmtree(work, ignore_errors=True)

sys.exit(0 if ok else 1)
