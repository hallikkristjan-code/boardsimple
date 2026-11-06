<img src="assets/icon.svg" width="64" height="64" alt="">

# BoardSimple

[Eesti keeles](README.et.md)

A free, local canvas for reviewing UIs built by agents. HTML screens sit side by side as
artboards, the canvas updates by itself, and you ring what should change. The notes go to a
file your agent reads.

## Install

Needs Node 24+. No dependencies.

```sh
cd C:\Arendus\boardsimple
npm link
```

## Usage

```sh
boardsimple                 # current folder
boardsimple C:\Arendus\some-project
boardsimple --port 5000 --no-open
```

The canvas opens in its own window (Chrome, Edge, Chromium or Brave in `--app` mode): it has its
own taskbar entry, shows up in Alt+Tab and does not get lost among tabs. The window keeps its own
profile (`~/.boardsimple/chrome-profile`), so its size and position are remembered. Without any of
those browsers it opens in your default browser.

Try the demo: `boardsimple examples/demo-en`.

- **Screens:** `screens/<group>/<name>.html`, sized with `<meta name="artboard" content="width=390,height=844">`.
- **Tools:** Select (V) — click and scroll inside a screen · Hand (H or Space) — pan · Ring (O), Box (B), Line (P), Arrow (A) — mark. A line closes if you finish near its start; otherwise it stays an underline. The color applies to the next marks.
- **Zoom:** mouse wheel or pinch; "Fit all" (Shift+1).
- **For the agent:** notes are saved to `.canvas/annotations.json` right away. Press "Copy command for agent" and paste it into the chat.
- **Language:** the app follows your browser (Estonian if it is listed, otherwise English). The ET/EN button next to the theme toggle switches it and remembers the choice. The command line follows the system language; `BOARDSIMPLE_LANG=en` or `et` overrides it.
- **Troubleshooting:** when the GPU process crashes or resets, a line is added to `.canvas/client.log`. Missing graphics tiles do not show up there.

Agent guide for a project's `CLAUDE.md`: [AGENTS-BOARDSIMPLE.en.md](AGENTS-BOARDSIMPLE.en.md).

The server listens on `127.0.0.1` only and refuses requests with a foreign `Origin` or `Host` header.

## Development

```sh
npm test                      # node tests
python -I test/e2e/e2e.py     # browser e2e (pip install playwright && playwright install chromium)
python -I test/e2e/marks.py   # marking tools and colors
python -I test/e2e/load.py    # 146-page load test; BOARDSIMPLE_E2E_GPU=1 adds a GPU memory limit on Windows
```

CI runs all of them (node tests on Ubuntu and Windows, e2e and load test on Ubuntu). It does not check the GPU limit, because it has no real GPU.
