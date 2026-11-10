"""Agent selection and send UX. Run: python -I test/e2e/agents.py"""
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
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
    const r = await fetch(new URL('/api/agent', document.referrer).href, {method:'PUT', headers:{'content-type':'application/json'},
      body:JSON.stringify({provider:'t3',target:'screen-hijack'})});
    document.documentElement.dataset.apiStatus = String(r.status);
  } catch { document.documentElement.dataset.apiStatus = 'blocked'; }
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
ok = True


def check(name, condition):
    global ok
    print(("PASS " if condition else "FAIL ") + name)
    ok &= bool(condition)


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=os.environ.get("BOARDSIMPLE_E2E_CHANNEL") or None)
        pg = browser.new_page(viewport={"width": 1400, "height": 900}, locale="et-EE")
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(url)
        pg.wait_for_selector("iframe")
        frame = pg.locator("iframe").first.element_handle().content_frame()
        frame.wait_for_function("document.documentElement.dataset.apiStatus")
        check("screens keep their own JavaScript", frame.locator("html").get_attribute("data-own-script") == "runs")
        check("screens cannot access the privileged board", frame.locator("html").get_attribute("data-parent-access") == "blocked")
        check("screens cannot configure or trigger agents", frame.locator("html").get_attribute("data-api-status") in ["403", "blocked"])
        frame.locator('html[data-local-module="runs"]').wait_for(timeout=3000)
        check("local ES modules still run in isolated screens", True)
        pg.request.post(url + "/api/annotations", data={"file": "screens/suunad/a-ajaleht.html",
                        "text": "Suurem pealkiri", "box": {"x": 20, "y": 20, "w": 200, "h": 50}})
        pg.wait_for_selector(".note-row")
        pg.wait_for_selector("#agent-settings summary", timeout=3000)
        pg.click("#agent-settings summary")
        check("all three agents are offered", pg.locator("#agent-provider option").all_text_contents() ==
              ["Vali agent…", "T3 Code", "Claude Code", "Codex"])
        check("send disabled until configured", pg.locator("#agent-send").is_disabled())
        pg.select_option("#agent-provider", "t3")
        pg.fill("#agent-target", "thread-test")
        pg.click("#agent-save")
        pg.wait_for_function("!document.querySelector('#agent-send').disabled")

        # SSE panel rebuilds must keep the form's unsaved text and focus.
        pg.fill("#agent-target", "unsaved-thread")
        pg.request.patch(url + "/api/annotations/" + pg.locator(".note-row").get_attribute("data-note"), data={"text": "Muutunud"})
        pg.wait_for_timeout(250)
        check("unsaved conversation survives live update", pg.input_value("#agent-target") == "unsaved-thread")
        check("focus survives live update", pg.locator("#agent-target").evaluate("el => el === document.activeElement"))
        check("unsaved changes disable send", pg.locator("#agent-send").is_disabled())
        pg.reload()
        pg.wait_for_function("!document.querySelector('#agent-send')?.disabled")
        pg.click("#agent-settings summary")
        check("saved agent remembered", pg.input_value("#agent-provider") == "t3" and pg.input_value("#agent-target") == "thread-test")

        requests = []
        def failure(route):
            requests.append(1)
            route.fulfill(status=502, content_type="application/json", body=json.dumps({"error": "Agent unavailable"}))
        pg.route("**/api/agent/send", failure)
        pg.click("#agent-send")
        pg.wait_for_function("document.querySelector('#agent-status').textContent.includes('Agent unavailable')")
        check("failure stays visible and allows retry", pg.locator("#agent-send").is_enabled())
        pg.unroute("**/api/agent/send")
        def success(route):
            requests.append(1)
            route.fulfill(status=200, content_type="application/json", body='{"delivery":"queued"}')
        pg.route("**/api/agent/send", success)
        pg.locator("#agent-send").evaluate("el => { el.click(); el.click(); }")
        pg.wait_for_function("document.querySelector('#agent-status').textContent.includes('järjekorras')")
        check("double click sends once", len(requests) == 2)
        check("copy fallback remains available", pg.get_by_role("button", name="Kopeeri käsk agendile", exact=True).count() == 1)

        pg.select_option("#agent-provider", "claude")
        pg.click("#agent-save")
        pg.wait_for_function("document.querySelector('#agent-status').textContent.includes('ühendus salvestatud')")
        check("disconnected Claude explains setup", "--claude" in pg.locator("#agent-hint").inner_text())
        check("disconnected Claude cannot send", pg.locator("#agent-send").is_disabled())
        pg.keyboard.press("Tab")
        pg.locator("#agent-summary").focus()
        pg.keyboard.press("Space")
        check("Space toggles agent settings from the keyboard", not pg.locator("#agent-settings").evaluate("el => el.open"))
        if not pg.locator("#agent-settings").evaluate("el => el.open"):
            pg.keyboard.press("Space")
        pg.screenshot(path=str(work / "agent-controls-desktop.png"))

        pg.set_viewport_size({"width": 390, "height": 844})
        pg.wait_for_timeout(100)
        check("agent controls fit a narrow panel", pg.locator("#agent-controls").evaluate("el => el.scrollWidth <= el.clientWidth"))
        check("send button remains visible below expanded mobile settings", pg.evaluate("""() => {
            const send = document.querySelector('#agent-send').getBoundingClientRect();
            const controls = document.querySelector('#agent-controls').getBoundingClientRect();
            return send.height > 0 && send.bottom <= controls.bottom;
        }"""))
        pg.screenshot(path=str(work / "agent-controls-mobile.png"))
        print("Screenshots:", work)
        check("no page errors", not errors)
        browser.close()
finally:
    srv.terminate()

raise SystemExit(0 if ok else 1)
