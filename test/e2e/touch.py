"""Browser checks for touch: a narrow window, one finger and two.

Gestures go in through the DevTools protocol, so the browser sees real touch input.

Run:  python -I test/e2e/touch.py
      BOARDSIMPLE_E2E_CHANNEL=msedge python -I test/e2e/touch.py
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

repo = Path(__file__).resolve().parents[2]
work = Path(tempfile.mkdtemp(prefix="boardsimple-touch-"))
folder = work / "screens/a"
folder.mkdir(parents=True)
(folder / "1.html").write_text("""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="artboard" content="width=800,height=800"><title>Page</title></head>
<body><h1>Heading</h1></body></html>""", encoding="utf-8")

srv = subprocess.Popen(
    ["node", str(repo / "bin/boardsimple.mjs"), str(work), "--port", "0", "--no-open"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
)
url = None
for _ in range(50):
    m = re.search(r"BoardSimple: (http://127\.0\.0\.1:\d+)", srv.stdout.readline())
    if m:
        url = m.group(1) + "/"
        break
if not url:
    srv.terminate()
    sys.exit("boardsimple did not print its URL")

ok = True


def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name)
    ok &= bool(cond)


def saved():
    path = work / ".canvas/annotations.json"
    return json.loads(path.read_text(encoding="utf-8"))["notes"] if path.exists() else []


class Fingers:
    def __init__(self, page):
        self.page = page
        self.cdp = page.context.new_cdp_session(page)

    def send(self, kind, points):
        touch = [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]
        self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": touch})

    def tap(self, selector):
        r = self.page.locator(selector).bounding_box()
        point = [(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)]
        self.send("touchStart", point)
        self.send("touchEnd", [])
        self.page.wait_for_timeout(100)

    def stroke(self, start, end, steps=6):
        """One or more fingers moving together from start points to end points."""
        self.send("touchStart", start[:1])
        for i in range(1, len(start)):
            self.send("touchStart", start[:i + 1])
        for s in range(1, steps + 1):
            self.send("touchMove", [(a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps)
                                    for a, b in zip(start, end)])
        self.send("touchEnd", [])
        self.page.wait_for_timeout(100)


def pick(pg, tool):
    # Chromium's emulated touch makes no click once a drag has run, even on a bare page with no
    # script, so tools after the first gesture are clicked. Tapping one is covered before any drag.
    pg.locator(f'#tools [data-tool="{tool}"]').dispatch_event("click")


def world(pg):
    t = pg.evaluate("document.getElementById('world').style.transform")
    tx, ty, scale = re.match(r"translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)", t).groups()
    return float(tx), float(ty), float(scale)


try:
    with sync_playwright() as p:
        channel = os.environ.get("BOARDSIMPLE_E2E_CHANNEL") or None
        b = p.chromium.launch(channel=channel)
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, locale="en-US")
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(url)
        pg.wait_for_selector("iframe")
        pg.wait_for_timeout(400)
        fingers = Fingers(pg)

        # A narrow window keeps the canvas usable.
        board = pg.locator("iframe").bounding_box()
        panel = pg.locator("#panel").bounding_box()
        tools = pg.locator("#tools").bounding_box()
        check("fit gives a screen real room when narrow", board["width"] >= 250)
        check("the notes panel stays inside the window", panel["x"] >= 0 and panel["x"] + panel["width"] <= 390
              and panel["y"] + panel["height"] <= 844)
        check("the notes panel leaves the screen uncovered", board["y"] + board["height"] <= panel["y"])
        check("the screen clears the tools", board["x"] >= tools["x"] + tools["width"])

        # One finger.
        fingers.tap('#tools [data-tool="ring"]')
        check("a tap picks a tool", pg.get_attribute('#tools [data-tool="ring"]', "aria-pressed") == "true")
        pick(pg, "kasi")
        before = world(pg)
        fingers.stroke([(200, 300)], [(240, 340)])
        after = world(pg)
        check("one finger pans", abs(after[0] - before[0] - 40) < 2 and abs(after[1] - before[1] - 40) < 2)
        check("panning ends with the finger", pg.evaluate("!document.body.classList.contains('dragging')"))

        pick(pg, "ring")
        r = pg.locator("iframe").bounding_box()
        x, y = r["x"] + 40, r["y"] + 40
        fingers.stroke([(x, y)], [(x + 100, y + 60)])
        pg.wait_for_selector("#notebox textarea")
        check("one finger draws a mark", pg.locator("#overlay ellipse").count() == 1)
        pg.fill("#notebox textarea", "by touch")
        pg.press("#notebox textarea", "Enter")
        pg.wait_for_selector("#notebox", state="detached")
        pg.wait_for_selector(".ann-pin")
        check("a touch mark is saved", len(saved()) == 1)

        # Two fingers: the point between them stays put.
        pick(pg, "kasi")
        tx, ty, scale = world(pg)
        mid = (200, 300)
        fingers.stroke([(170, 300), (230, 300)], [(140, 300), (260, 300)])
        tx2, ty2, scale2 = world(pg)
        check("spreading two fingers zooms in", abs(scale2 / scale - 2) < 0.1)
        check("the point between the fingers stays put",
              abs((mid[0] - tx) / scale - (mid[0] - tx2) / scale2) < 3 and abs((mid[1] - ty) / scale - (mid[1] - ty2) / scale2) < 3)
        fingers.stroke([(140, 300), (260, 300)], [(170, 300), (230, 300)])
        check("pinching zooms back out", abs(world(pg)[2] - scale) < scale * 0.1)
        tx, ty, scale = world(pg)
        fingers.stroke([(170, 300), (230, 300)], [(190, 340), (250, 340)])
        tx2, ty2, scale2 = world(pg)
        check("two fingers moving together pan", abs(tx2 - tx - 20) < 3 and abs(ty2 - ty - 40) < 3 and abs(scale2 - scale) < 0.02)

        # A second finger during a mark means zoom, not a drawing.
        pick(pg, "ring")
        r = pg.locator("iframe").bounding_box()
        x, y = r["x"] + 120, r["y"] + 120
        fingers.send("touchStart", [(x, y)])
        fingers.send("touchMove", [(x + 30, y + 30)])
        fingers.send("touchStart", [(x + 30, y + 30), (x + 90, y + 30)])
        fingers.send("touchMove", [(x + 10, y + 30), (x + 110, y + 30)])
        fingers.send("touchEnd", [])
        pg.wait_for_timeout(100)
        check("a second finger drops the mark", pg.locator("#notebox").count() == 0 and pg.locator("#overlay ellipse").count() == 1)

        # The system takes the gesture away.
        pick(pg, "kasi")
        fingers.send("touchStart", [(200, 300)])
        fingers.send("touchMove", [(210, 310)])
        fingers.send("touchCancel", [])
        pg.wait_for_timeout(100)
        check("a cancelled pan lets go", pg.evaluate("!document.body.classList.contains('dragging')"))
        before = world(pg)
        fingers.stroke([(170, 300), (230, 300)], [(140, 300), (260, 300)])
        check("pinch works after a cancelled pan", world(pg)[2] > before[2] * 1.5)
        check("no page errors", not errors)
        ctx.close()
        b.close()
finally:
    srv.terminate()

sys.exit(0 if ok else 1)
