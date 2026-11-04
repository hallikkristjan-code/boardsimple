"""Browser checks for the mark tools: box, line and arrow, with colours.

Run:  python -I test/e2e/marks.py
      LOUEND_E2E_CHANNEL=msedge python -I test/e2e/marks.py
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
work = Path(tempfile.mkdtemp(prefix="louend-marks-"))
GREEN = "#2f8f5b"

page = """<!doctype html><html lang="et"><head><meta charset="utf-8">
<meta name="artboard" content="width=800,height=800"><title>Leht</title>
<style>html,body{margin:0}h1,p,button,div{position:absolute;margin:0;left:40px}
#pealkiri{top:40px;font-size:32px}#tekst{top:200px;font-size:20px;width:400px}
#nupp{top:400px;width:200px;height:50px}
#kaart{top:520px;width:300px;height:200px;background:#eee}
#nurk{left:4px;top:4px;width:30px;height:30px;background:#ccc}</style></head>
<body><h1 id="pealkiri">Pealkiri</h1><p id="tekst">Allakriipsutatud lause</p>
<button id="nupp">Salvesta</button><div id="kaart"><div id="nurk"></div></div></body></html>"""
folder = work / "screens/a"
folder.mkdir(parents=True)
(folder / "1.html").write_text(page, encoding="utf-8")

srv = subprocess.Popen(
    ["node", str(repo / "bin/louend.mjs"), str(work), "--port", "0", "--no-open"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
)
url = None
for _ in range(50):
    m = re.search(r"Louend: (http://127\.0\.0\.1:\d+)", srv.stdout.readline())
    if m:
        url = m.group(1) + "/"
        break
if not url:
    srv.terminate()
    sys.exit("louend did not print its URL")

ok = True


def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name)
    ok &= bool(cond)


def to_screen(pg, x, y):
    """Screen point for artboard coordinates."""
    r = pg.locator("iframe").bounding_box()
    k = r["width"] / 800
    return r["x"] + x * k, r["y"] + y * k


def rect(pg, selector):
    return pg.evaluate("""(s) => {
      const r = document.querySelector('iframe').contentDocument.querySelector(s).getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }""", selector)


def stroke(pg, points, text):
    pts = [to_screen(pg, *p) for p in points]
    pg.mouse.move(*pts[0])
    pg.mouse.down()
    for p in pts[1:]:
        pg.mouse.move(*p, steps=6)
    pg.mouse.up()
    pg.wait_for_selector("#notebox textarea")
    pg.fill("#notebox textarea", text)
    pg.press("#notebox textarea", "Enter")
    pg.wait_for_selector("#notebox", state="detached")
    pg.wait_for_timeout(200)
    return json.loads((work / ".canvas/annotations.json").read_text(encoding="utf-8"))["notes"][-1]


def tags(note):
    return {e["tag"] for e in note["elements"]}


def ids(note):
    return " ".join(e["selector"] for e in note["elements"])


try:
    with sync_playwright() as p:
        channel = os.environ.get("LOUEND_E2E_CHANNEL") or None
        b = p.chromium.launch(channel=channel)
        ctx = b.new_context(viewport={"width": 1400, "height": 900})
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(url)
        pg.wait_for_selector("iframe")
        pg.wait_for_timeout(500)

        # Fit keeps every board clear of the floating chrome.
        board = pg.locator("iframe").bounding_box()
        tools = pg.locator("#tools").bounding_box()
        panel = pg.locator("#panel").bounding_box()
        top = pg.locator("#top").bounding_box()
        check("fit clears the tools", board["x"] >= tools["x"] + tools["width"])
        check("fit clears the notes", board["x"] + board["width"] <= panel["x"])
        check("fit clears the title", board["y"] >= top["y"] + top["height"])

        # Box: a corner element is outside an ellipse but inside a box.
        pg.click('#colors button[aria-label="Roheline"]')
        pg.keyboard.press("b")
        k = rect(pg, "#kaart")
        note = stroke(pg, [(k["x"] - 4, k["y"] - 4), (k["x"] + k["w"] + 4, k["y"] + k["h"] + 4)], "kast")
        check("box saved with its shape", note["shape"] == "box")
        check("box saved with the chosen colour", note["color"] == GREEN)
        check("box finds the element in its corner", "#nurk" in ids(note))
        el = pg.locator("#overlay rect")
        check("box drawn as a rectangle", el.count() == 1)
        check("box uses the colour", pg.evaluate("getComputedStyle(document.querySelector('#overlay rect')).stroke") == "rgb(47, 143, 91)")
        check("pin uses the colour", pg.evaluate("getComputedStyle(document.querySelector('.ann-pin')).backgroundColor") == "rgb(47, 143, 91)")
        check("panel number uses the colour", pg.evaluate("getComputedStyle(document.querySelector('.note-row .num')).backgroundColor") == "rgb(47, 143, 91)")

        # Line that returns to its start: marks what is inside, not what is near.
        pg.keyboard.press("p")
        h = rect(pg, "#pealkiri")
        x0, y0, x1, y1 = h["x"] - 12, h["y"] - 12, h["x"] + h["w"] + 12, h["y"] + h["h"] + 12
        note = stroke(pg, [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0 + 2)], "ümber")
        check("loop saved as closed line", note["shape"] == "line" and note["closed"] is True)
        check("loop finds the heading only", tags(note) == {"h1"})
        check("loop drawn closed", pg.locator("#overlay polygon").count() == 1)

        # Underline: passes below the text without touching it.
        t = rect(pg, "#tekst")
        y = t["y"] + t["h"] + 5
        note = stroke(pg, [(t["x"], y), (t["x"] + 200, y + 1)], "alla")
        check("underline saved as open line", note["shape"] == "line" and note["closed"] is False)
        check("underline finds the text above it", "p" in tags(note))
        check("underline drawn open", pg.locator("#overlay polyline").count() == 1)

        # Arrow: only the tip counts, even across other elements.
        pg.keyboard.press("a")
        n = rect(pg, "#nupp")
        note = stroke(pg, [(600, 100), (n["x"] + n["w"] / 2, n["y"] + n["h"] / 2)], "nool")
        check("arrow saved with two points", note["shape"] == "arrow" and len(note["points"]) == 2)
        check("arrow finds what it points at", tags(note) == {"button"})
        check("arrow drawn", pg.locator("#overlay path").count() == 1)

        # A plain click with a drawing tool leaves no note.
        pg.mouse.move(*to_screen(pg, 600, 600))
        pg.mouse.down()
        pg.mouse.up()
        pg.wait_for_timeout(200)
        check("click makes no note", pg.locator("#notebox").count() == 0 and pg.locator(".note-row").count() == 4)

        # A ring from before shapes existed still draws.
        pg.keyboard.press("o")
        doc = json.loads((work / ".canvas/annotations.json").read_text(encoding="utf-8"))
        doc["notes"].append({"id": "vana-ring", "file": note["file"], "box": {"x": 500, "y": 500, "w": 80, "h": 40},
                             "text": "vana", "status": "open", "elements": [], "createdAt": "2026-01-01T00:00:00Z"})
        (work / ".canvas/annotations.json").write_text(json.dumps(doc), encoding="utf-8")
        pg.wait_for_timeout(600)
        pg.reload()
        pg.wait_for_selector(".note-row")
        check("old note still draws as a ring", pg.locator("#overlay ellipse").count() == 1)
        check("colour remembered after reload",
              pg.get_attribute('#colors button[aria-label="Roheline"]', "aria-pressed") == "true")
        check("no page errors", not errors)
        b.close()
finally:
    srv.terminate()

sys.exit(0 if ok else 1)
