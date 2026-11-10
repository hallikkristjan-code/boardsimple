"""Send-to-agent panel and screen isolation. Run: python -I test/e2e/agents.py"""
import http.client
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

repo = Path(__file__).resolve().parents[2]
work = Path(tempfile.mkdtemp(prefix="boardsimple-agent-ui-"))
shutil.copytree(repo / "examples/demo/screens", work / "screens")
attack_screen = work / "screens/suunad/a-ajaleht.html"
attack_screen.write_text(attack_screen.read_text(encoding="utf-8") + """<script>
(async () => {
  document.documentElement.dataset.ownScript = 'runs';
  try { void parent.document.title; document.documentElement.dataset.parentAccess = 'allowed'; }
  catch { document.documentElement.dataset.parentAccess = 'blocked'; }
  try {
    const r = await fetch(new URL('/api/agent/wait', document.referrer).href);
    document.documentElement.dataset.waitStatus = String(r.status);
  } catch { document.documentElement.dataset.waitStatus = 'blocked'; }
  try {
    const r = await fetch(new URL('/api/agent/send', document.referrer).href, {method:'POST',
      headers:{'content-type':'application/json'}, body:'{}'});
    document.documentElement.dataset.sendStatus = String(r.status);
  } catch { document.documentElement.dataset.sendStatus = 'blocked'; }
})();
</script><script type="module" src="./local-module.js"></script>""", encoding="utf-8")
(attack_screen.parent / "local-module.js").write_text("document.documentElement.dataset.localModule = 'runs';", encoding="utf-8")
srv = subprocess.Popen(["node", str(repo / "bin/boardsimple.mjs"), str(work), "--port", "0", "--no-open"],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
url = None
for _ in range(50):
    match = re.search(r"BoardSimple: (http://127\.0\.0\.1:\d+)", srv.stdout.readline())
    if match:
        url = match.group(1)
        break
assert url, "server did not start"
port = urlparse(url).port
ok = True

ET = {"listening": "Agent kuulab.", "not": "Agent ei kuula. Kopeeri käsk ja kleebi see vestlusesse.",
      "empty": "Agent ei kuula.", "working": "Märkused on agendi käes. Järgmised saad saata, kui agent uuesti kuulab.",
      "sent": "Märkused saadetud. Jätku näed agendi vestluses."}


def check(name, condition):
    global ok
    print(("PASS " if condition else "FAIL ") + name)
    ok &= bool(condition)


class Agent:
    """Plays `boardsimple wait`: one plain HTTP request held open in a thread."""
    def __init__(self):
        self.conn = http.client.HTTPConnection("127.0.0.1", port)
        self.conn.request("GET", "/api/agent/wait")
        self.lines = []
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self):
        try:
            res = self.conn.getresponse()
            for raw in res:
                if raw.strip():
                    self.lines.append(json.loads(raw))
        except Exception:
            pass

    def drop(self):
        try:
            self.conn.sock.shutdown(socket.SHUT_RDWR)  # close() alone keeps the reader's handle open
            self.conn.sock.close()
        except Exception:
            pass


def agent_state():
    c = http.client.HTTPConnection("127.0.0.1", port)
    c.request("GET", "/api/agent")
    return json.loads(c.getresponse().read())


def state_is(pg, text, timeout=4500):
    try:
        pg.wait_for_function("t => document.querySelector('#agent-state')?.textContent === t", arg=text, timeout=timeout)
        return True
    except Exception:
        return False


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=os.environ.get("BOARDSIMPLE_E2E_CHANNEL") or None)
        pg = browser.new_page(viewport={"width": 1400, "height": 900}, locale="et-EE")
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        sends = []
        pg.on("response", lambda r: sends.append(r.status) if r.url.endswith("/api/agent/send") and r.request.method == "POST" else None)
        pg.goto(url)
        pg.wait_for_selector("iframe")
        frame = pg.locator("iframe").first.element_handle().content_frame()
        frame.wait_for_function("document.documentElement.dataset.sendStatus")
        check("screens keep their own JavaScript", frame.locator("html").get_attribute("data-own-script") == "runs")
        check("screens cannot access the privileged board", frame.locator("html").get_attribute("data-parent-access") == "blocked")
        check("screens cannot pose as the waiting agent", frame.locator("html").get_attribute("data-wait-status") in ["403", "blocked"])
        check("screens cannot trigger a send", frame.locator("html").get_attribute("data-send-status") in ["403", "blocked"])
        check("screen attack leaves nobody listening", agent_state()["listening"] is False)
        frame.locator('html[data-local-module="runs"]').wait_for(timeout=3000)
        check("local ES modules still run in isolated screens", True)
        sends.clear()

        check("no agent and no open notes: short not-listening text, send hidden",
              state_is(pg, ET["empty"]) and pg.locator("#agent-send").is_hidden())
        note = pg.request.post(url + "/api/annotations", data={"file": "screens/suunad/a-ajaleht.html",
                               "text": "Suurem pealkiri", "box": {"x": 20, "y": 20, "w": 200, "h": 50}}).json()
        pg.wait_for_selector(".note-row")
        check("copy fallback is offered when nobody listens", state_is(pg, ET["not"]) and
              pg.get_by_role("button", name="Kopeeri käsk agendile", exact=True).count() == 1)

        pg.request.patch(url + "/api/annotations/" + note["id"], data={"status": "done"})
        agent = Agent()
        check("agent attaches: state flips to listening within 4 s", state_is(pg, ET["listening"]))
        check("send disabled without open notes", pg.locator("#agent-send").is_visible() and pg.locator("#agent-send").is_disabled())
        pg.request.patch(url + "/api/annotations/" + note["id"], data={"status": "open"})
        pg.wait_for_function("!document.querySelector('#agent-send').disabled")

        pg.locator("#agent-send").focus()
        pg.request.post(url + "/api/annotations", data={"file": "screens/suunad/a-ajaleht.html",
                        "text": "Teine märkus", "box": {"x": 30, "y": 90, "w": 100, "h": 40}})
        pg.wait_for_function("document.querySelectorAll('.note-row').length === 2")
        pg.wait_for_timeout(250)
        check("status and focus survive a live annotations update",
              pg.locator("#agent-send").evaluate("el => el === document.activeElement") and
              pg.locator("#agent-state").inner_text() == ET["listening"])

        pg.locator("#agent-send").evaluate("el => { el.click(); el.click(); }")
        pg.wait_for_function("t => document.querySelector('#agent-status').textContent === t", arg=ET["sent"])
        agent.thread.join(3)
        check("send delivers the notes to the waiting agent", agent.lines and agent.lines[-1]["status"] == "feedback"
              and agent.lines[-1]["count"] == 2)
        check("double click sends once", sends.count(200) == 1 and len(sends) == 1)
        pg.wait_for_timeout(6500)  # two poll intervals
        check("after delivery the panel says the agent has the notes",
              pg.locator("#agent-state").inner_text() == ET["working"] and pg.locator("#agent-send").is_hidden()
              and pg.locator("#agent-state").evaluate("el => el === document.activeElement")
              and pg.get_by_role("button", name="Kopeeri käsk agendile", exact=True).count() == 1)

        agent = Agent()
        check("the working state ends when the agent listens again", state_is(pg, ET["listening"]))

        # The agent drops; the panel does not notice before the click.
        # A failed poll keeps the last known state, so aborting polls freezes "listening".
        pg.route("**/api/agent", lambda route: route.abort())
        agent.drop()
        for _ in range(100):
            if not agent_state()["listening"]:
                break
            pg.wait_for_timeout(20)
        check("a dropped agent stops counting on the server", agent_state()["listening"] is False)
        pg.wait_for_timeout(3200)  # cooldown from the previous send
        sends.clear()
        pg.click("#agent-send")
        pg.wait_for_function("() => document.querySelector('#agent-send').hidden")
        check("agent drops between poll and click: no error styling, state says not listening",
              sends == [409] and pg.locator("#agent-status").get_attribute("data-error") == "false"
              and pg.locator("#agent-state").inner_text() == ET["not"])
        pg.unroute("**/api/agent")

        agent = Agent()
        state_is(pg, ET["listening"])
        pg.set_viewport_size({"width": 390, "height": 844})
        pg.wait_for_timeout(100)
        check("agent controls fit a narrow panel", pg.locator("#agent-controls").evaluate("el => el.scrollWidth <= el.clientWidth"))
        pg.screenshot(path=str(work / "agent-controls-mobile.png"))
        pg.set_viewport_size({"width": 1400, "height": 900})
        pg.click("#lang")
        check("English strings", state_is(pg, "Your agent is listening.", 2000))
        pg.screenshot(path=str(work / "agent-controls-desktop.png"))
        agent.drop()
        print("Screenshots:", work)
        check("no page errors", not errors)
        browser.close()
finally:
    srv.terminate()

raise SystemExit(0 if ok else 1)
