"""Browser check for boards added since the user last looked.

A new board is marked until the pointer rests on it or it is shown large in the
focused window. The header button counts the new boards and jumps to the next one.

Run:  python -I test/e2e/fresh.py
"""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

repo = Path(__file__).resolve().parents[2]
work = Path(tempfile.mkdtemp(prefix="boardsimple-fresh-"))
(work / "screens").mkdir()
for i in range(1, 9):
    (work / f"screens/{i}.html").write_text(f"<title>Leht {i}</title><p>tere {i}</p>", encoding="utf-8")

harness = f"""
import {{ startServer }} from {json.dumps((repo / "src/server.mjs").as_uri())};
const s = await startServer({{ root: {json.dumps(str(work))}, port: 0 }});
console.log(s.url);
"""
srv = subprocess.Popen(["node", "--input-type=module", "-e", harness], stdout=subprocess.PIPE, text=True, encoding="utf-8")
url = srv.stdout.readline().strip()
if not url.startswith("http://127.0.0.1:"):
    srv.terminate()
    sys.exit("server did not print its URL")

ok = True


def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name)
    ok = ok and bool(cond)


def add(pg, name, n):
    (work / f"screens/{name}.html").write_text(f"<title>Uus {name}</title><p>uus</p>", encoding="utf-8")
    pg.wait_for_function(f"document.querySelectorAll('.board').length === {n}", timeout=5000)


try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        pg = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        fresh = pg.locator(".board.fresh")
        button = pg.locator("#fresh")

        pg.goto(url)
        pg.wait_for_selector(".board")
        time.sleep(0.5)
        check("first visit: nothing is new", fresh.count() == 0)
        check("first visit: no new-count button", button.is_hidden())

        add(pg, "9", 9)
        time.sleep(1.6)  # longer than the look delay: small at fit-all view, so not seen
        check("new board is marked at the fit-all view", fresh.count() == 1)
        check("button counts one new board", button.is_visible() and button.inner_text() == "1 new")

        pg.reload()
        pg.wait_for_selector(".board")
        time.sleep(0.5)
        check("mark survives a reload", fresh.count() == 1)

        box = fresh.bounding_box()
        pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        time.sleep(0.9)
        check("resting the pointer on it clears the mark", fresh.count() == 0)
        check("button hides when nothing is new", button.is_hidden())
        pg.mouse.move(5, 890)

        add(pg, "10", 10)
        add(pg, "11", 11)
        time.sleep(0.3)
        check("button counts two new boards", button.inner_text() == "2 new")
        button.click()
        time.sleep(0.3)
        scale = pg.evaluate("parseFloat(document.getElementById('zoom').textContent)")
        check("button zooms in to a new board", scale > 30)
        time.sleep(1.6)
        check("a board shown large is seen", fresh.count() == 1 and button.inner_text() == "1 new")
        button.click()
        time.sleep(1.8)
        check("second click shows the last new board", fresh.count() == 0 and button.is_hidden())

        pg.reload()
        pg.wait_for_selector(".board")
        time.sleep(0.5)
        check("seen boards stay seen after a reload", fresh.count() == 0)
        check("no page errors", not errors)
        browser.close()
finally:
    srv.terminate()

sys.exit(0 if ok else 1)
