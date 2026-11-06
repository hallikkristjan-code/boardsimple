"""Browser check for the hand-over from a normal tab to the app window.

The server's window launcher only records calls, so the run opens no extra windows.
The app window is a real --app window from headless Chromium.

Run:  python -I test/e2e/window.py
"""
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

repo = Path(__file__).resolve().parents[2]
work = Path(tempfile.mkdtemp(prefix="boardsimple-window-"))
(work / "screens").mkdir()
(work / "screens/1.html").write_text("<title>Leht</title><p>tere</p>", encoding="utf-8")
calls = work / "open-calls.txt"
calls.touch()

harness = f"""
import {{ appendFileSync }} from "node:fs";
import {{ startServer }} from {json.dumps((repo / "src/server.mjs").as_uri())};
const s = await startServer({{ root: {json.dumps(str(work))}, port: 0,
  openWindow: (url) => appendFileSync({json.dumps(str(calls))}, url + " ") }});
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
    ok &= bool(cond)


def open_calls():
    return calls.read_text(encoding="utf-8").split()


def debug_endpoint(profile):
    port_file = Path(profile) / "DevToolsActivePort"
    for _ in range(100):
        if port_file.exists() and port_file.read_text().strip():
            return f"http://127.0.0.1:{port_file.read_text().split()[0]}"
        time.sleep(0.1)
    raise RuntimeError("Chromium did not report a debug port")


try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        opener = browser.new_context().new_page()
        # A clicked link gives a tab the browser lets a script close; window.open does too.
        with opener.expect_popup() as popup:
            opener.evaluate("(u) => { window.open(u); }", url)
        tab = popup.value
        if not tab.is_closed():
            tab.wait_for_event("close", timeout=5000)
        check("tab asks for the app window", open_calls() == [url])
        check("tab closes after the hand-over", tab.is_closed())

        time.sleep(3.2)  # past the server's cooldown

        # After a navigation the browser refuses window.close(), so the tab stays a canvas.
        kept = opener.context.new_page()
        kept.goto("about:blank")
        kept.evaluate("(u) => { location.href = u; }", url)
        kept.wait_for_selector(".board iframe")
        check("tab the browser keeps open still shows the canvas", not kept.is_closed())
        kept.reload()
        kept.wait_for_selector(".board iframe")
        check("reload does not ask again", len(open_calls()) == 2)
        browser.close()

        time.sleep(3.2)  # past the server's cooldown, so a call from the app window would count

        profile = tempfile.mkdtemp(prefix="boardsimple-window-profile-")
        chromium = subprocess.Popen(
            [p.chromium.executable_path, "--headless=new", f"--app={url}", f"--user-data-dir={profile}",
             "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--no-sandbox"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            app = p.chromium.connect_over_cdp(debug_endpoint(profile))
            for _ in range(100):
                pages = [pg for c in app.contexts for pg in c.pages if pg.url.startswith(url)]
                if pages:
                    break
                time.sleep(0.1)
            check("app window opened", pages)
            pg = pages[0]
            pg.wait_for_selector(".board iframe")
            mode = pg.evaluate("matchMedia('(display-mode: browser)').matches")
            check("app window is not in browser display mode", mode is False)
            time.sleep(1)
            check("app window does not ask for another window", len(open_calls()) == 2)
            app.close()
        finally:
            chromium.kill()
finally:
    srv.terminate()

sys.exit(0 if ok else 1)
