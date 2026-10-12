# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

EVA-UI is a personal UI study: recreations of Neon Genesis Evangelion style screens in plain HTML and CSS. Each study lives in its own folder holding an `index.html` and a `style.css`. Folder names are a letter for the type of screen plus a number: `W-1` is the first Warning screen, and `C-1` would be the first Countdown screen. Pick a new letter to fit the screen type rather than assuming `W`. There is no build step, package manager, linter or test suite, and no JavaScript. Do not add any without asking.

## Running a study

Open `<study>/index.html` (for example `W-1/index.html`) directly in a browser. Fonts load from Google Fonts, so a network connection is needed for the intended look. To screenshot or measure the rendered page, serve the folder (`python3 -m http.server` from the repo root) rather than relying on reading the CSS.

## Conventions that hold across studies

- **Each study is self-contained.** Its own `index.html` and `style.css`, no shared stylesheet. Copying a folder to start the next study is the intended workflow.
- **The stylesheet is a teaching document.** It is ordered top to bottom as variables, layout, type, graphics, motion, with numbered section headers and comments explaining why each technique is used. Keep that order and keep the comments when editing. Add new rules to the matching section.
- **Palette lives in `:root` variables** (`--accent`, `--ink`, `--bg`, plus the three `--font-*` families). Change colors there, not on individual rules.
- **Fixed-size stage.** W-1 is a 1280x720 `.screen` with `overflow: hidden`, and everything inside is positioned relative to it. It is deliberately not responsive. The `sweep` keyframe hardcodes `720px`, so changing the screen height means changing that too.
- **Motion is CSS only** (`@keyframes` with `steps()` for hard blinks) and every animation class is switched off under `prefers-reduced-motion`. A new animation class must be added to that media query.
- **Japanese text** carries `lang="ja"`. Letter-spaced text needs a matching `padding-left` to stay optically centered (see `.title-en`).
- **SVG parts are styled with `stroke` and `fill`**, not `border` and `background` (see `.hex`).
