<img src="assets/icon.svg" width="64" height="64" alt="">

# BoardSimple

[Eesti keeles](README.et.md)

A simple, free board for giving feedback on UIs created by coding agents.

If you don't need all the tools Paper offers and just want a board to review your agent's
UI proposals, BoardSimple is a lightweight option. Put HTML screens side by side, mark what
should change, and let your agent read the feedback from a local file. No account or
subscription is required.

![Three UI directions on BoardSimple, with an annotation for the agent](assets/demo.png)

BoardSimple is an early-stage local tool. It works with HTML files your agent creates;
it does not embed a running application's URL. It is an independent project, unaffiliated
with Paper.

## Install

Needs Node.js 24+. No npm dependencies.

```sh
npm install -g boardsimple
```

Or run it once without installing, inside your project folder:

```sh
npx boardsimple
```

Keep the terminal running while you use the board; press Ctrl+C to stop the server.
On Windows, if PowerShell blocks npm scripts, use `npm.cmd`, `npx.cmd` and `boardsimple.cmd`.

The demo ships in this repository. To try it, you also need Git:

```sh
git clone https://github.com/hallikkristjan-code/boardsimple.git
cd boardsimple
boardsimple examples/demo-en
```

## Give feedback to your agent

1. Ask your coding agent to create self-contained HTML screens in your project's `screens/` folder.
   Copy the [agent guide](AGENTS-BOARDSIMPLE.en.md) into the project's `AGENTS.md` or `CLAUDE.md`.
2. Run `boardsimple ./my-project` from its parent folder, or `boardsimple` inside the project.
3. Compare the screens, draw a ring, box, line or arrow, and write what should change.
4. Use **Agent connection** to select T3 Code, Claude Code or Codex, then **Send to agent**.
   You can also click **Copy command for agent** and paste it into your agent's chat.
5. Let the agent read `.canvas/annotations.json` and update the HTML. The board refreshes automatically.

Annotations stay in the project's `.canvas/` folder. Include that folder in your backups;
add it to your project's `.gitignore` if the feedback is private. BoardSimple stores feedback
locally; the HTML screens you load may still request external assets.

### Send directly to an agent

Open **Agent connection** in the notes panel. For **T3 Code** or **Codex**, enter the ID of the
conversation working on this project and save the connection. Ask your agent for the ID if you
cannot find it; when the agent started BoardSimple, its conversation ID may already be filled in.
The choice is remembered for this project in `.canvas/agent.json`.

T3 Code must be running locally with its `t3 thread send` CLI available. Codex must be installed
and signed in, with support for `codex queue --thread ... --message ... --resume`. If an older
installation lacks those commands, update the agent or use the copy button.

For **Claude Code**, start the board and its connected interactive session together:

```sh
boardsimple ./my-project --claude
# To continue a specific conversation, first exit it in the other terminal:
boardsimple ./my-project --claude --claude-session <session-id>
```

Approve the BoardSimple MCP server and development channel in Claude, then select **Claude Code**
in the board and save the connection. The channel goes to that open session; no additional API key
is needed. Custom channels currently require Claude's development-channel opt-in and an account or
organization that permits channels. Agent permission prompts still appear in Claude. Closing the
connected Claude session also stops this BoardSimple server.

**Send to agent** asks the selected conversation to implement the open notes immediately. A busy
agent may queue them. Each send saves a snapshot in `.canvas/feedback-<id>.json`, so later edits
do not change what was sent. Delivery confirmation means the feedback reached the agent's queue
or channel; follow the work and any permission prompts in the agent conversation. Sending does
not mark notes done, commit changes or publish anything. The copy button remains available.

## Usage

```sh
boardsimple                 # current folder
boardsimple ./my-project
boardsimple --port 5000 --no-open
```

The canvas opens in its own window (Chrome, Edge, Chromium or Brave in `--app` mode): it has its
own taskbar entry, shows up in Alt+Tab and does not get lost among tabs. The window keeps its own
profile (`~/.boardsimple/chrome-profile`), so its size and position are remembered. A canvas link
clicked elsewhere lands in a normal tab, which hands over to this window and closes itself. Without
any of those browsers it opens in your default browser.

Try the demo from a clone of this repository: `boardsimple examples/demo-en`.

- **Screens:** `screens/<group>/<name>.html`, sized with `<meta name="artboard" content="width=390,height=844">`.
- **Tools:** Select (V) — click and scroll inside a screen · Hand (H or Space) — pan · Ring (O), Box (B), Line (P), Arrow (A) — mark. A line closes if you finish near its start; otherwise it stays an underline. The color applies to the next marks.
- **Zoom:** mouse wheel or pinch; "Fit all" (Shift+1).
- **For the agent:** notes are saved to `.canvas/annotations.json` right away; a deleted note can be undone for a few seconds. Connect an agent and send the open notes, or copy the command into the chat.
- **Language:** the app follows your browser (Estonian if it is listed, otherwise English). The ET/EN button next to the theme toggle switches it and remembers the choice. The command line follows the system language; `BOARDSIMPLE_LANG=en` or `et` overrides it.
- **Troubleshooting:** when the GPU process crashes or resets, a line is added to `.canvas/client.log`. Missing graphics tiles do not show up there.

Agent guide for a project's `CLAUDE.md`: [AGENTS-BOARDSIMPLE.en.md](AGENTS-BOARDSIMPLE.en.md).

The server listens on `127.0.0.1` only and refuses requests with a foreign `Origin` or `Host` header.
Screens use a separate read-only loopback origin in sandbox frames: their own scripts, local
modules and fonts can run, but cannot access the board's DOM or agent controls. Screen browser
storage belongs to that separate origin. Geometry and annotation hit-tests use a limited message bridge.

## Development

```sh
npm test                      # node tests
python -I test/e2e/e2e.py     # browser e2e (pip install playwright && playwright install chromium)
python -I test/e2e/marks.py   # marking tools and colors
python -I test/e2e/agents.py  # agent selection, delivery states and reconnect setup
python -I test/e2e/a11y.py    # keyboard use, undo and contrast
python -I test/e2e/touch.py   # one and two fingers, narrow window
python -I test/e2e/window.py  # hand-over from a tab to the app window
python -I test/e2e/load.py    # 146-page load test; BOARDSIMPLE_E2E_GPU=1 adds a GPU memory limit on Windows
```

CI runs all of them (node tests on Ubuntu and Windows, e2e and load test on Ubuntu). It does not check the GPU limit, because it has no real GPU.

## License

[MIT](LICENSE). Free to use, modify and share.
