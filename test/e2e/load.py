"""Load check for BoardSimple: a book-sized project (146 pages in 18 rows).

Headless part runs everywhere. It checks that far pages are unloaded when zoomed in,
that they come back, and that a note survives its page being unloaded.

GPU part needs a real GPU and Windows perf counters, so it only runs on request:
      BOARDSIMPLE_E2E_GPU=1 python -I test/e2e/load.py
It opens a visible Chrome window behind your other windows for about 30 s.

Run:  python -I test/e2e/load.py
      BOARDSIMPLE_E2E_CHANNEL=msedge python -I test/e2e/load.py
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

PAGES = 146
ROWS = 18
GPU_PEAK_LIMIT_MB = 400  # 1222 MB with the world layer pinned, 173 MB without

repo = Path(__file__).resolve().parents[2]
work = Path(tempfile.mkdtemp(prefix="boardsimple-load-"))


def write_pages():
    # Text and coloured blocks, so raster tiles cannot collapse into solid colour.
    for n in range(PAGES):
        folder = work / "screens" / f"{n % ROWS:02d}-rida"
        folder.mkdir(parents=True, exist_ok=True)
        lines = "".join(
            f'<p style="margin:4px 24px;color:hsl({(n * 7 + i * 13) % 360} 60% 35%)">'
            f"Lk {n} rida {i}: kiudaine ja küllastunud rasv</p>" for i in range(28))
        (folder / f"lk{n:03d}.html").write_text(
            '<!doctype html><html lang="et"><head><meta charset="utf-8">'
            '<meta name="artboard" content="width=576,height=864">'
            f"<title>lk {n}</title><style>html,body{{margin:0;background:#fff}}</style></head>"
            f'<body><h1 id="pealkiri" style="margin:24px">Lehekülg {n}</h1>{lines}</body></html>',
            encoding="utf-8")


def start_server():
    proc = subprocess.Popen(
        ["node", str(repo / "bin/boardsimple.mjs"), str(work), "--port", "0", "--no-open"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
    )
    for _ in range(50):
        m = re.search(r"BoardSimple: (http://127\.0\.0\.1:\d+)", proc.stdout.readline())
        if m:
            return proc, m.group(1) + "/"
    proc.terminate()
    sys.exit("boardsimple did not print its URL")


ok = True


def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name)
    ok &= bool(cond)


MOUNTED = """[...document.querySelectorAll('.board iframe')]
  .filter((f) => (f.getAttribute('src') ?? '').startsWith('/screens/')).length"""


def open_canvas(pg):
    pg.goto(url)
    pg.wait_for_function(f"document.querySelectorAll('.board').length === {PAGES}")
    pg.wait_for_timeout(1500)


def zoom_to(pg, percent, x, y):
    pg.mouse.move(x, y)
    for _ in range(60):
        if int(pg.inner_text("#zoom")[:-1]) >= percent:
            return
        pg.mouse.wheel(0, -90)
        pg.wait_for_timeout(30)


def pan(pg, dx, dy, button="left"):
    box = pg.locator("#viewport").bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pg.mouse.move(x, y)
    pg.mouse.down(button=button)
    pg.mouse.move(x + dx, y + dy, steps=4)
    pg.mouse.up(button=button)


def board_center(pg, title):
    return pg.evaluate("""(t) => {
      const b = [...document.querySelectorAll('.board')].find((e) => e.querySelector('.board-label').textContent === t);
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }""", title)


def heading_rect(pg, title):
    """Screen rect of the page heading, from the board position and zoom."""
    return pg.evaluate("""(t) => {
      const b = [...document.querySelectorAll('.board')].find((e) => e.querySelector('.board-label').textContent === t);
      const f = b.querySelector('iframe');
      const o = f.getBoundingClientRect();
      const k = o.width / 576;
      const h = f.contentDocument.getElementById('pealkiri').getBoundingClientRect();
      return { x: o.x + h.x * k, y: o.y + h.y * k, w: 300 * k, h: h.height * k };
    }""", title)


def loaded_heading(pg, title):
    return pg.evaluate("""(t) => {
      const b = [...document.querySelectorAll('.board')].find((e) => e.querySelector('.board-label').textContent === t);
      return b.querySelector('iframe').contentDocument?.getElementById('pealkiri')?.textContent ?? null;
    }""", title)


def headless_checks(p):
    channel = os.environ.get("BOARDSIMPLE_E2E_CHANNEL") or None
    b = p.chromium.launch(channel=channel)
    pg = b.new_page(viewport={"width": 1400, "height": 900})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    open_canvas(pg)
    check("all pages mounted when all are in view", pg.evaluate(MOUNTED) == PAGES)

    first = board_center(pg, "lk 0")
    check("fit shows the first row below the header", first["y"] > pg.locator("#viewport").bounding_box()["y"])
    zoom_to(pg, 100, first["x"], first["y"])
    pg.wait_for_timeout(300)
    mounted = pg.evaluate(MOUNTED)
    print(f"     mounted at {pg.inner_text('#zoom')}: {mounted}/{PAGES}")
    check("far pages unloaded when zoomed in", mounted <= 40)
    pg.wait_for_function("(() => { const f = document.querySelector('.board iframe'); return f.contentDocument?.readyState === 'complete'; })()")

    # A note must keep its elements when its page unloads while the note box is open.
    box = pg.locator("#viewport").bounding_box()
    r = heading_rect(pg, "lk 0")
    pan(pg, box["x"] + box["width"] / 2 - r["x"], box["y"] + box["height"] / 2 - r["y"])
    r = heading_rect(pg, "lk 0")
    pg.keyboard.press("o")
    pg.mouse.move(r["x"] - 12, r["y"] - 12)
    pg.mouse.down()
    pg.mouse.move(r["x"] + r["w"] + 12, r["y"] + r["h"] + 12, steps=4)
    pg.mouse.up()
    pg.wait_for_selector("#notebox textarea")
    pg.fill("#notebox textarea", "pealkiri suuremaks")
    for _ in range(4):
        pan(pg, -900, 0, button="middle")
    pg.wait_for_timeout(300)
    check("page unloaded while note open", loaded_heading(pg, "lk 0") is None)
    pg.press("#notebox textarea", "Enter")
    pg.wait_for_selector("#notebox", state="detached")
    notes = json.loads((work / ".canvas/annotations.json").read_text(encoding="utf-8"))["notes"]
    check("note kept its elements", notes and any(e["selector"].endswith("#pealkiri") or e["tag"] == "h1" for e in notes[-1]["elements"]))

    for _ in range(4):
        pan(pg, 900, 0, button="middle")
    pg.wait_for_function("""() => {
      const b = [...document.querySelectorAll('.board')].find((e) => e.querySelector('.board-label').textContent === 'lk 0');
      return b.querySelector('iframe').contentDocument?.getElementById('pealkiri');
    }""", timeout=5000)
    check("page reloads when it comes back", loaded_heading(pg, "lk 0") == "Lehekülg 0")

    # A saved file must not load a page that is out of view, and must show once back.
    far = next((work / "screens").glob(f"{ROWS - 1}-rida/*.html"))
    title = re.search(r"<title>(.*?)</title>", far.read_text(encoding="utf-8")).group(1)
    far.write_text(far.read_text(encoding="utf-8").replace("Lehekülg", "Muudetud"), encoding="utf-8")
    pg.wait_for_timeout(1200)
    check("change to an unloaded page does not load it", loaded_heading(pg, title) is None)
    pg.click("#fit")
    pg.wait_for_function("""(t) => {
      const b = [...document.querySelectorAll('.board')].find((e) => e.querySelector('.board-label').textContent === t);
      return b.querySelector('iframe').contentDocument?.getElementById('pealkiri')?.textContent.startsWith('Muudetud');
    }""", arg=title, timeout=5000)
    check("unloaded page shows the saved change when it returns", True)
    check("no page errors", not errors)
    b.close()


GPU_PS = r"""
$b = Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | ?{$_.CommandLine -match [regex]::Escape('PROFILE') -and $_.CommandLine -notmatch '--type='} | select -first 1
$g = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($b.ProcessId)" | ?{$_.CommandLine -match 'type=gpu-process'} | select -first 1
$c = (Get-Counter "\GPU Process Memory(pid_$($g.ProcessId)_*)\*" -ea 0).CounterSamples
[int](($c | ?{$_.Path -match 'shared'} | Measure-Object CookedValue -Sum).Sum/1MB)
"""


def gpu_check(p):
    profile = tempfile.mkdtemp(prefix="boardsimple-load-profile-")
    ctx = p.chromium.launch_persistent_context(
        profile, channel="chrome", headless=False, no_viewport=True,
        # Windows stops drawing a covered window; the run must not take the user's focus.
        args=["--window-size=1900,1300", "--disable-backgrounding-occluded-windows",
              "--disable-features=CalculateNativeWinOcclusion", "--disable-renderer-backgrounding"])
    pg = ctx.pages[0]
    open_canvas(pg)
    peak = [0]
    done = threading.Event()

    def poll():
        while not done.is_set():
            out = subprocess.run(["powershell", "-NoProfile", "-c", GPU_PS.replace("PROFILE", profile)],
                                 capture_output=True, text=True).stdout.strip()
            if out.isdigit():
                peak[0] = max(peak[0], int(out))

    thread = threading.Thread(target=poll)
    thread.start()
    box = pg.locator("#viewport").bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pg.mouse.move(x, y)
    for _ in range(3):
        for _ in range(34):
            pg.mouse.wheel(0, -90)
            pg.wait_for_timeout(50)
        pan(pg, -500, -500)
        pg.mouse.move(x, y)
        for _ in range(34):
            pg.mouse.wheel(0, 90)
            pg.wait_for_timeout(50)
    done.set()
    thread.join()
    ctx.close()
    print(f"     GPU peak {peak[0]} MB, limit {GPU_PEAK_LIMIT_MB} MB")
    check("GPU counter was read", peak[0] > 0)
    check("GPU peak under limit", peak[0] < GPU_PEAK_LIMIT_MB)


write_pages()
srv, url = start_server()
try:
    with sync_playwright() as p:
        headless_checks(p)
        if os.environ.get("BOARDSIMPLE_E2E_GPU"):
            if sys.platform == "win32":
                gpu_check(p)
            else:
                print("SKIP GPU check: Windows only")
        else:
            print("SKIP GPU check: set BOARDSIMPLE_E2E_GPU=1")
finally:
    srv.terminate()

sys.exit(0 if ok else 1)
