"""Browser checks for keyboard use, undo and colour contrast on the canvas.

Run:  python -I test/e2e/a11y.py
      BOARDSIMPLE_E2E_CHANNEL=msedge python -I test/e2e/a11y.py
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
work = Path(tempfile.mkdtemp(prefix="boardsimple-a11y-"))
folder = work / "screens/a"
folder.mkdir(parents=True)
(folder / "1.html").write_text("""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="artboard" content="width=800,height=800"><title>Page</title></head>
<body><h1>Heading</h1><button>Inside</button></body></html>""", encoding="utf-8")

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


def mark(pg, x, y, text):
    r = pg.locator("iframe").bounding_box()
    k = r["width"] / 800
    pg.keyboard.press("o")
    pg.mouse.move(r["x"] + x * k, r["y"] + y * k)
    pg.mouse.down()
    pg.mouse.move(r["x"] + (x + 80) * k, r["y"] + (y + 60) * k, steps=4)
    pg.mouse.up()
    pg.wait_for_selector("#notebox textarea")
    pg.fill("#notebox textarea", text)
    pg.press("#notebox textarea", "Enter")
    pg.wait_for_selector("#notebox", state="detached")


def active(pg):
    return pg.evaluate("""() => {
      const a = document.activeElement;
      return { tag: a.tagName, cls: a.className, note: a.closest('[data-note]')?.dataset.note ?? null };
    }""")


def view(pg):
    return pg.evaluate("document.getElementById('world').style.transform")


try:
    with sync_playwright() as p:
        channel = os.environ.get("BOARDSIMPLE_E2E_CHANNEL") or None
        b = p.chromium.launch(channel=channel)
        ctx = b.new_context(viewport={"width": 1400, "height": 900}, locale="en-US", color_scheme="dark")
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(url)
        pg.wait_for_selector("iframe")
        pg.wait_for_timeout(400)

        # Structure.
        check("project name is the page heading", pg.locator("h1#project").count() == 1)
        check("the marks layer is hidden from assistive tech", pg.get_attribute("#overlay", "aria-hidden") == "true")
        check("swatches get their colour from data-color",
              pg.evaluate("getComputedStyle(document.querySelector('#colors button')).getPropertyValue('--c')").strip() == "#e0383e")

        mark(pg, 40, 40, "first note")
        mark(pg, 300, 300, "second note")
        pg.wait_for_selector(".note-row >> nth=1")
        first, second = [n["id"] for n in sorted(saved(), key=lambda n: n["createdAt"])]

        # Pins are real buttons with a name; Enter lands on the note in the panel.
        pin = pg.locator(f'.ann-pin[data-note="{second}"]')
        check("pin is a button", pin.evaluate("e => e.tagName") == "BUTTON")
        check("pin names its note", "second note" in (pin.get_attribute("aria-label") or ""))
        pin.focus()
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(100)
        check("Enter on a pin moves focus to its note", active(pg)["note"] == second and "txt" in active(pg)["cls"])

        # A note can be reached and centred from the keyboard.
        txt = pg.locator(f'.note-row[data-note="{first}"] .txt')
        check("note text is a button", txt.evaluate("e => e.tagName") == "BUTTON")
        before = view(pg)
        txt.focus()
        check("focus highlights the note", "hover" in (pg.locator(f'.ann-pin[data-note="{first}"]').get_attribute("class") or ""))
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(100)
        check("Enter on a note centres its mark", view(pg) != before)

        # Rebuilding the panel keeps the keyboard user's place.
        done = pg.locator(f'.note-row[data-note="{first}"] [data-action="done"]')
        done.focus()
        pg.keyboard.press("Enter")
        pg.wait_for_selector(f'.note-row.done[data-note="{first}"]')
        pg.wait_for_timeout(100)
        check("focus stays on the action after the panel rebuilds",
              active(pg)["note"] == first and pg.evaluate("document.activeElement.dataset.action") == "done")

        # Delete waits, so it can be undone.
        pg.locator(f'.note-row[data-note="{second}"] [data-action="remove"]').click()
        pg.wait_for_selector("#undo button")
        check("deleted note leaves the panel at once", pg.locator(f'.note-row[data-note="{second}"]').count() == 0)
        check("deleted note leaves the canvas at once", pg.locator(f'.ann-pin[data-note="{second}"]').count() == 0)
        check("deleted note is still on disk while it can be undone", second in [n["id"] for n in saved()])
        pg.click("#undo button")
        pg.wait_for_selector(f'.note-row[data-note="{second}"]')
        check("undo brings the note back", pg.locator("#undo").count() == 0)
        pg.wait_for_timeout(6500)
        check("undone note survives the delay", second in [n["id"] for n in saved()])

        remove = pg.locator(f'.note-row[data-note="{second}"] [data-action="remove"]')
        remove.focus()
        pg.keyboard.press("Enter")
        pg.wait_for_selector("#undo button")
        check("keyboard delete puts focus on undo", pg.evaluate("document.activeElement.closest('#undo') !== null"))
        pg.wait_for_selector("#undo", state="detached", timeout=8000)
        pg.wait_for_timeout(300)
        check("delete reaches the disk after the delay", second not in [n["id"] for n in saved()])
        check("focus stays in the panel after undo expires",
              pg.evaluate("document.getElementById('panel').contains(document.activeElement)"))

        pg.locator(f'.note-row[data-note="{first}"] [data-action="remove"]').click()
        pg.wait_for_selector("#undo button")
        pg.reload()
        pg.wait_for_selector("iframe")
        pg.wait_for_timeout(400)
        check("leaving the page finishes a pending delete", not saved())

        mark(pg, 40, 40, "third note")
        pg.wait_for_selector(".ann-pin")
        third = saved()[0]["id"]

        # A delete the server refuses puts the note back.
        pg.route("**/api/annotations/*", lambda r: r.fulfill(status=500) if r.request.method == "DELETE" else r.continue_())
        pg.locator(f'.note-row[data-note="{third}"] [data-action="remove"]').click()
        pg.wait_for_selector("#undo button")
        pg.wait_for_selector(f'.note-row[data-note="{third}"]', timeout=8000)
        check("a refused delete brings the note back", pg.locator("#undo").count() == 0)
        pg.unroute("**/api/annotations/*")

        # The agent may delete a note first; that is not an error for the user.
        dialogs = []
        pg.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        pg.route("**/api/annotations/*", lambda r: r.fulfill(status=404) if r.request.method == "DELETE" else r.continue_())
        pg.locator(f'.note-row[data-note="{third}"] [data-action="remove"]').click()
        pg.wait_for_selector("#undo button")
        pg.wait_for_selector(f'.note-row[data-note="{third}"]', timeout=8000)
        check("a note already deleted raises no error", not dialogs)
        pg.unroute("**/api/annotations/*")

        # Live updates rebuild the pins; the keyboard user's place survives.
        pg.locator(f'.ann-pin[data-note="{third}"]').focus()
        pg.evaluate("""(id) => fetch(`/api/annotations/${id}`, { method: 'PATCH', body: JSON.stringify({ text: 'edited by the agent' }) })""", third)
        pg.wait_for_selector(f'.ann-pin[data-note="{third}"][title="edited by the agent"]')
        pg.wait_for_timeout(100)
        check("a pin keeps focus through a live update",
              pg.evaluate("document.activeElement.classList.contains('ann-pin')"))

        # Hand tool, the default: a mouse click on a pin still reaches it.
        pg.keyboard.press("h")
        pg.locator(f'.ann-pin[data-note="{third}"]').click()
        pg.wait_for_timeout(100)
        check("a click on a pin works with the hand tool", active(pg)["note"] == third)
        pg.keyboard.press("o")
        pg.mouse.click(700, 880)
        pg.locator(f'.ann-pin[data-note="{third}"]').click()
        pg.wait_for_timeout(100)
        check("a click on a pin works with a mark tool", active(pg)["note"] == third)

        # Space presses a control the keyboard is on, and pans everywhere else.
        pg.locator('#tools [data-tool="ring"]').focus()
        pg.keyboard.press("Tab")
        pg.keyboard.press("Space")
        pg.wait_for_timeout(100)
        check("Space presses a focused control", pg.get_attribute('#tools [data-tool="kast"]', "aria-pressed") == "true")
        pg.click('#tools [data-tool="ring"]')
        pg.keyboard.down("Space")
        check("Space pans after a mouse click on a tool", pg.evaluate("document.body.classList.contains('panning')"))
        pg.keyboard.up("Space")
        check("Space does not press the clicked tool again", pg.get_attribute('#tools [data-tool="ring"]', "aria-pressed") == "true")

        # Leaving the window with Space down must not leave the canvas stuck on panning.
        pg.keyboard.down("Space")
        pg.evaluate("window.dispatchEvent(new Event('blur'))")
        check("losing the window ends panning", pg.evaluate("!document.body.classList.contains('panning')"))
        pg.keyboard.up("Space")

        # An interrupted stroke leaves nothing behind.
        pg.keyboard.press("o")
        r = pg.locator("iframe").bounding_box()
        pg.mouse.move(r["x"] + 100, r["y"] + 100)
        pg.mouse.down()
        pg.mouse.move(r["x"] + 180, r["y"] + 180, steps=4)
        drawn = pg.locator("#overlay ellipse").count()
        pg.evaluate("document.getElementById('viewport').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))")
        pg.wait_for_timeout(50)
        pg.mouse.up()
        pg.wait_for_timeout(100)
        check("a cancelled stroke disappears", drawn == 2 and pg.locator("#overlay ellipse").count() == 1)
        check("a cancelled stroke opens no note box", pg.locator("#notebox").count() == 0)

        # Marks and swatches.
        pg.click('#colors button[aria-label="Orange"]')
        mark(pg, 300, 300, "orange")
        pg.wait_for_selector(".ann-pin >> nth=1")
        check("number on orange is dark", pg.evaluate("""() => {
          const [r, g, b] = getComputedStyle(document.querySelectorAll('.ann-pin')[1]).color.match(/[\\d.]+/g).map(Number);
          return Math.max(r, g, b) < 40;
        }"""))
        check("number in the panel matches its pin", pg.evaluate("""() =>
          getComputedStyle(document.querySelectorAll('.note-row .num')[1]).color ===
          getComputedStyle(document.querySelectorAll('.ann-pin')[1]).color"""))
        check("unselected swatches carry an edge in the dark theme", pg.evaluate("""() =>
          getComputedStyle(document.querySelector('#colors button[aria-pressed="false"]'), '::before').boxShadow !== 'none'"""))

        # A screen's own controls are reachable; they show their own focus.
        pg.locator('#colors button[aria-label="Purple"]').focus()
        pg.keyboard.press("Tab")
        check("Tab goes from the tools into a screen", pg.evaluate("document.activeElement.tagName") == "IFRAME")
        check("no page errors", not errors)
        ctx.close()

        # Deletes under pressure, with a project that starts empty.
        ctx = b.new_context(viewport={"width": 1400, "height": 500}, locale="en-US")
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=url.rstrip("/"))
        pg = ctx.new_page()
        pg.goto(url)
        pg.wait_for_selector("iframe")
        pg.wait_for_timeout(300)
        file = saved()[0]["file"]
        pg.evaluate("""async (ids) => { for (const id of ids) await fetch(`/api/annotations/${id}`, { method: 'DELETE' }); }""",
                    [n["id"] for n in saved()])

        def seed(count):
            pg.evaluate("""async ([file, count]) => {
              for (let i = 0; i < count; i++) await fetch('/api/annotations', { method: 'POST', body: JSON.stringify({
                file, text: `note ${i}`, shape: 'box', color: '#2f6fc4', elements: [],
                box: { x: 20 + i * 12, y: 20 + i * 12, w: 60, h: 40 } }) });
            }""", [file, count])
            pg.wait_for_function(f"document.querySelectorAll('.note-row').length === {count}")

        def ids():
            return pg.evaluate("[...document.querySelectorAll('.note-row')].map((r) => r.dataset.note)")

        # Three deletes in a row while the server is slow: none is lost.
        seed(3)
        pg.evaluate("""() => {
          const real = window.fetch;
          window.fetch = (u, o) => o?.method === 'DELETE'
            ? new Promise((done) => setTimeout(done, 400)).then(() => real(u, o)) : real(u, o);
        }""")
        for _ in range(3):
            pg.locator('.note-row [data-action="remove"]').first.click()
        pg.wait_for_function("document.querySelectorAll('.note-row').length === 0")
        pg.wait_for_timeout(1000)
        check("a slow delete does not bring its note back", pg.locator(".note-row").count() == 0)
        pg.wait_for_timeout(6500)
        check("quick deletes all reach the disk", not saved())
        check("nothing is left waiting after quick deletes", pg.locator("#undo").count() == 0)
        pg.reload()
        pg.wait_for_selector("iframe")
        pg.wait_for_timeout(300)

        # A live update leaves the list where it was scrolled.
        seed(8)
        pg.evaluate("document.querySelector('#panel .list').scrollTop = 150")
        pg.evaluate("""(id) => fetch(`/api/annotations/${id}`, { method: 'PATCH', body: JSON.stringify({ text: 'moved on' }) })""", ids()[0])
        pg.wait_for_function("document.querySelector('.note-row .txt').textContent === 'moved on'")
        check("a live update keeps the list scroll", pg.evaluate("document.querySelector('#panel .list').scrollTop") == 150)

        # Undo from the keyboard lands on the note it restored.
        target = ids()[-1]
        pg.locator(".note-row .txt").first.focus()
        pg.keyboard.press("Tab")
        pg.locator(f'.note-row[data-note="{target}"] [data-action="remove"]').focus()
        pg.keyboard.press("Enter")
        pg.wait_for_selector("#undo button")
        pg.keyboard.press("Enter")
        pg.wait_for_selector(f'.note-row[data-note="{target}"]')
        pg.wait_for_timeout(100)
        check("undo returns focus to the restored note", active(pg)["note"] == target)

        # The copy button speaks up even while a delete settles.
        pg.locator(f'.note-row[data-note="{target}"] [data-action="remove"]').click()
        pg.wait_for_selector("#undo button")
        pg.click("#panel footer button")
        pg.wait_for_timeout(300)
        check("copy confirms with a delete pending", pg.locator("#panel footer button").inner_text() == "Copied")
        check("copy finishes the delete", target not in [n["id"] for n in saved()])

        # A note deleted with the mouse does not light up another one.
        pg.mouse.click(700, 490)
        pg.locator(f'.note-row[data-note="{ids()[0]}"] [data-action="remove"]').click(force=True)
        pg.wait_for_selector("#undo button")
        pg.wait_for_selector("#undo", state="detached", timeout=8000)
        pg.mouse.move(700, 490)
        pg.wait_for_timeout(200)
        check("mouse delete highlights nothing afterwards", pg.locator(".note-row.hover").count() == 0)

        # With the server gone the undo line still ends.
        pg.route("**/api/annotations**", lambda r: r.abort())
        pg.locator('.note-row [data-action="remove"]').first.click()
        pg.wait_for_selector("#undo button")
        pg.wait_for_selector("#undo", state="detached", timeout=8000)
        check("the undo line ends when the server is gone", True)
        pg.unroute("**/api/annotations**")
        pg.reload()
        pg.wait_for_selector("iframe")
        pg.wait_for_timeout(300)

        # A pin off-screen comes into view; the canvas itself never scrolls.
        pg.keyboard.press("h")
        pg.mouse.move(700, 300)
        pg.mouse.down()
        pg.mouse.move(-1200, 300, steps=4)
        pg.mouse.up()
        pg.keyboard.press("Tab")
        pg.locator(".note-row .txt").first.focus()
        pg.keyboard.press("Shift+Tab")
        check("Shift+Tab reaches a pin", pg.evaluate("document.activeElement.classList.contains('ann-pin')"))
        pg.wait_for_timeout(100)
        check("the canvas does not scroll to a pin", pg.evaluate(
            "(() => { const v = document.getElementById('viewport'); return v.scrollLeft === 0 && v.scrollTop === 0; })()"))
        pin_box = pg.evaluate("(() => { const r = document.activeElement.getBoundingClientRect(); return { x: r.x, y: r.y }; })()")
        check("an off-screen pin comes into view", 68 <= pin_box["x"] <= 1096 and 60 <= pin_box["y"] <= 488)

        # The note under a focused pin goes away: focus stays somewhere useful.
        note = pg.evaluate("document.activeElement.dataset.note")
        pg.evaluate("""(id) => fetch(`/api/annotations/${id}`, { method: 'DELETE' })""", note)
        pg.wait_for_selector(f'.ann-pin[data-note="{note}"]', state="detached")
        pg.wait_for_timeout(100)
        check("focus survives the pin's note going away", pg.evaluate("document.activeElement !== document.body"))
        ctx.close()

        ctx = b.new_context(viewport={"width": 320, "height": 640}, locale="en-US")
        pg = ctx.new_page()
        pg.goto(url)
        pg.wait_for_selector("iframe")
        fit = pg.locator("#fit").bounding_box()
        check("Fit all stays on one line at 320px", fit["height"] < 30)
        ctx.close()
        b.close()
finally:
    srv.terminate()

sys.exit(0 if ok else 1)
