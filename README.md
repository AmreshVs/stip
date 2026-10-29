# Stip

Stand. Sip. Ship.

Stip is a small desktop app for people who forget to move. Every 40 minutes it covers your screens with a calm one-minute stand break, and every so often a little water drop runs down the edge of your screen into an orb in the corner and asks you to take a sip.

It runs on macOS, Windows and Linux, and lives in the menu bar or system tray.

## What it does

- **Stand breaks.** A full-screen break on every display: a breathing timer on your main screen, and memes on the others. A soft chime plays when it's over.
- **Ways out.** "I'm in a meeting" waits until your call ends. "Snooze 5 min" does what it says. Skipping needs a 3-second hold of Esc, so you can't skip by reflex. Pick gentle, balanced or strict in settings.
- **Calls.** Turn on meeting mode from the tray, and Stip holds the break until you turn it off. A running Zoom call is detected on its own. The break starts 30 seconds after the call ends.
- **Water.** A drop runs down your screen edge and lands in an orb whose water level is how much you've drunk today. Tap "I sipped" to fill it up. It never takes focus from your editor.
- **Away time counts.** Five minutes away from the keyboard resets the timer.
- **Two themes.** Flat (the default) and Aurora, switchable in settings.
- **Working hours, pauses and stats.** Optional working days and hours, pauses of 30 minutes, an hour or the rest of the day, and a daily count with a streak.

## Develop

```bash
npm install
npm start
```

Settings and stats live in the app's user data folder. To keep dev runs separate from your real data, set `STIP_USER_DATA`:

```bash
STIP_USER_DATA=/tmp/stip-dev npm start
```

### Preview a screen

`--show=<view>[:<theme>]` opens a screen straight away: `tray`, `break`, `water` or `settings`. Add `STIP_SNAPSHOT` to save a PNG of it without showing anything, then quit:

```bash
STIP_USER_DATA=/tmp/stip-dev STIP_SNAPSHOT=/tmp/break.png npm start -- --show=break:aurora
```

### Test

```bash
npm test
```

The timing logic in `src/main/scheduler.js` is plain JavaScript and fully covered by tests that don't need Electron.

The end-to-end test starts the real app with its windows hidden, clicks the real buttons, holds Esc, and checks the tray, breaks, water reminder and settings:

```bash
npm run e2e
```

### Icons

The icons are drawn as SVG in `assets/`. After changing one, render the PNGs again:

```bash
npm run icons
```

## Build

```bash
npm run dist
```

Installers land in `dist/`: a DMG on macOS, an NSIS installer on Windows, and an AppImage and .deb on Linux. Build each platform on that platform.

## Project layout

```
src/main/          Electron main process: scheduler, tray, windows, settings store
src/renderer/      One folder per window: break, water, tray, settings
src/preload.js     The small API the windows use to talk to the main process
assets/            Icon sources and generated PNGs
test/              Unit tests
```
