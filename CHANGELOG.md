# Changelog

All notable changes to Stip are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Full-screen stand break on every display, with a breathing timer and a simple task on the main screen, and original memes on the others. Defaults: every 30 minutes, for 2 minutes.
- A snooze limit: after 2 snoozes in a row, the break can't be put off. A finished break resets it.
- Ways out of a break: "I'm in a meeting", "Snooze 5 min", and a 3-second Esc hold to skip. Gentle, balanced and strict modes.
- Meeting mode, and automatic Zoom call detection. Breaks wait until the call ends.
- Water reminder: a drop runs down the screen into an orb showing today's intake, with the rest of the screen dimmed.
- Tray panel with a countdown ring, water progress, Stand now, Water now, meeting mode and pause.
- Settings for timing, strictness, water goal, glass size, working hours, sound, open at login and theme.
- Stats page with stand streak, breaks by hour, water over the last seven days, and weekly totals.
- Flat and aurora themes.
- Away time and sleep count as a break.
- Unit tests, an end-to-end test that drives the real app, and CI on macOS, Windows and Linux.
