---
name: BoardSimple
description: A quiet local workbench for marking up agent-made UI screens.
colors:
  canvas-light: "oklch(94% 0.012 245)"
  canvas-dark: "oklch(28% 0.008 260)"
  surface-light: "oklch(100% 0 0)"
  surface-dark: "oklch(32% 0.008 260)"
  surface-raised-light: "oklch(95% 0.01 245)"
  surface-raised-dark: "oklch(37% 0.008 260)"
  ink-light: "oklch(23% 0.012 260)"
  ink-dark: "oklch(93% 0.006 260)"
  ink-secondary-light: "oklch(46% 0.012 260)"
  ink-secondary-dark: "oklch(78% 0.008 260)"
  ink-tertiary-light: "oklch(52% 0.012 260)"
  ink-tertiary-dark: "oklch(71% 0.008 260)"
  accent-light: "oklch(58% 0.22 350)"
  accent-dark: "oklch(73% 0.17 350)"
  warn-light: "oklch(52% 0.14 65)"
  warn-dark: "oklch(72% 0.13 70)"
  danger-light: "oklch(53% 0.2 25)"
  danger-dark: "oklch(73% 0.16 25)"
  mark-red: "#e0383e"
  mark-orange: "#c9741f"
  mark-green: "#2f8f5b"
  mark-blue: "#2f6fc4"
  mark-purple: "#7a55c7"
  on-mark-light: "#ffffff"
  on-mark-dark: "#08090b"
typography:
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  note:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "Cascadia Mono, JetBrains Mono, ui-monospace, SF Mono, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "5px"
  island: "8px"
spacing:
  gap: "12px"
components:
  tool-button:
    textColor: "{colors.ink-secondary-light}"
    rounded: "{rounded.control}"
    size: "36px"
  tool-button-active:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.surface-light}"
    rounded: "{rounded.control}"
    size: "36px"
  island:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.island}"
  pin:
    backgroundColor: "{colors.mark-red}"
    textColor: "{colors.on-mark-dark}"
    typography: "{typography.data}"
    size: "20px"
---

# Design System: BoardSimple

## Overview

**Creative North Star: "The Quiet Workbench"**

BoardSimple is a work surface, not a destination. The screens under review and the marks made on them are the only things that speak. Everything else is a tool lying within reach: small, labelled, and out of the way until a hand goes to it. The chrome floats over the canvas in a few white islands, leaves the middle free, and never competes with whatever an agent has just drawn.

The system is deliberately plain. It uses the operating system's own typeface, no web fonts and no decorative motion. Density comes from the job: this is a desktop tool for someone comparing screens at length, in light or dark, often beside a code editor.

**Key Characteristics:**
- One accent, magenta from the app icon, used only for the active tool and focus.
- Mark colours belong to the user's feedback, never to the interface.
- Floating islands on a dotted canvas; the canvas holds the depth, the islands hold the controls.
- Every string exists in Estonian and English.

## Colors

A cool neutral canvas in both themes, with a single saturated accent and five mark colours kept apart from the interface.

Tokens are declared once in `public/style.css` with `light-dark()`, so a theme is a change of `color-scheme`, not a second stylesheet.

### Primary
- **Workbench Magenta** (`accent-light`, `accent-dark`): the pressed tool and the keyboard focus ring. Nothing else.

### Neutral
- **Cool Canvas** (`canvas-light`, `canvas-dark`): the working surface behind the screens, with a 24px dot grid one step darker.
- **Island White** and **Island Slate** (`surface-light`, `surface-dark`): every floating panel.
- **Raised Surface** (`surface-raised-light`, `surface-raised-dark`): hover on controls and rows.
- **Ink, Secondary Ink, Tertiary Ink**: primary text, labels and idle controls, then hints and board labels.

### Status
- **Warn** marks a note whose file changed. **Danger** is the lost-connection message.

### Mark Colours
- **Red, Orange, Green, Blue, Purple** (`mark-*`): chosen per note and saved with it as hex, in `data-color`. Their value is data, so it is not themed.

### Named Rules
**The One Accent Rule.** Magenta marks the current tool and keyboard focus. It never decorates, and it never stands for a note.

**The Readable Number Rule.** A number on a mark is white unless white misses 4.5:1 on that colour; then it is `on-mark-dark`. `markInk()` in `public/geometry.js` decides, and a test holds every swatch to it.

**The Visible Swatch Rule.** In the dark theme blue and purple fall under 3:1 against an island, so swatches carry a 1px edge and the selected one takes an ink ring.

## Typography

**Body Font:** Segoe UI Variable Text (with the platform sans as fallback)
**Label/Mono Font:** Cascadia Mono (with platform monospace as fallback)

**Character:** The system's own voice, so the tool feels native on each platform and costs nothing to load.

### Hierarchy
- **Title** (600, 13px, 1.5): the project name and the Notes heading. Weight carries the hierarchy, not size.
- **Note** (400, 14px, 20px): note text in the panel, one step larger than the chrome because it is the thing being read.
- **Body** (400, 13px, 1.5): controls and panel copy.
- **Label** (400, 11px, 1.5): board labels and hints.
- **Data** (400, 11 to 12px): numbers only, such as the zoom level, counts, pins and the screen name under a note. Numerals are tabular.

### Named Rules
**The Mono Means Data Rule.** Monospace is for figures and file names. A label in sentence case stays in the body face.

## Layout

The canvas fills the window and the chrome floats above it, all 12px (`gap`) from the edges: the title top left, view controls top right, tools down the left, notes down the right. `fit()` reserves that chrome so a board never starts underneath it.

The notes panel is 280px wide and caps at the window height, scrolling its list inside. The canvas never scrolls; it pans and zooms. Labels counter-scale against the zoom to keep their screen size, and hide in steps as boards shrink.

The app is built for a desktop window. At 700px and below the notes panel moves to the bottom edge, capped at 38% of the height, and `chrome()` in `public/canvas.js` reserves that space so a screen still fits above it.

## Elevation & Depth

Depth is a single idea: islands float over the canvas, and screens float a little higher so they read as pages.

### Shadow Vocabulary
- **Lift** (`--lift`): every island. A hairline edge plus two soft shadows.
- **Page lift** (`--lift-page`): a screen on the canvas, wider and softer, so it reads as paper.

### Named Rules
**The Two Heights Rule.** There are islands and there are pages. A third level means a component has no business existing.

## Shapes

Gently rounded and consistent: controls at 5px, islands at 8px. Pins and swatches are the only circles, which is what makes them findable on a busy screen.

## Components

### Tool Buttons
- **Shape:** 36px square, 5px radius, in one vertical island.
- **Idle:** Secondary Ink, 18px icon at a 1.6 stroke.
- **Hover / Pressed:** Raised Surface on hover; Workbench Magenta when `aria-pressed` is true.

### Islands
- **Corner Style:** 8px.
- **Background:** Island White or Island Slate, with Lift.
- **Internal Padding:** tight, 4px around tool groups and 8 to 16px around text.

### Pins
- **Shape:** a 20px circle, counter-scaled so it keeps its size at any zoom.
- **Colour:** the mark's colour, or Done Grey with a check when the note is done.
- **Behaviour:** a real button; it highlights its mark and note, and moves focus to the note.

### Note Rows
- **Layout:** number, then note text, screen name and quiet text actions.
- **Interaction:** the text is a button that centres the mark. Hover and focus highlight the mark on the canvas.
- **Delete:** the note disappears at once and an Undo line stays for six seconds. The file changes only when that time ends, when the page closes, or when the command for the agent is copied.

### Note Box
- **Style:** a 260px island beside the fresh mark, with a borderless textarea.
- **Keys:** Enter saves, Shift+Enter adds a line, Esc cancels.

## Do's and Don'ts

### Do:
- **Do** send every colour and font through a token in `public/style.css`.
- **Do** add new text to both languages in `public/i18n.js`.
- **Do** keep every control reachable by keyboard, with `:focus-visible` showing the accent ring.
- **Do** give every transition a `prefers-reduced-motion` fallback.
- **Do** keep a destructive action undoable.

### Don't:
- **Don't** use the accent for anything but the current tool and focus.
- **Don't** add a web font, a third surface height or a decorative animation.
- **Don't** let a mark colour into the interface, or theme a mark colour.
- **Don't** make a pointer-only control; a click on a `div` is a bug here.
- **Don't** add npm dependencies. The app ships as plain files.
