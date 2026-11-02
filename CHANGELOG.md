# Changelog

All notable changes to Stip are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Stip is on the [Microsoft Store](https://apps.microsoft.com/detail/9MSN24PF9CD5). The website, README and release notes link to it.
- Breaks wait for a natural pause: if you're busy or a build is running, the break starts when you pause, 10 minutes later at most. It only looks at idle time and program names, and can be turned off in settings.
- Water characters: choose Debug Duck, Coolant, Hump Day, Gulp, Spike or Sprout instead of the orb, in Settings → Water. They fill with today's water, change mood as you drink, and also show in the tray.
- The `stip` terminal command: `status`, `break`, `water`, `sip`, `pause`, `resume` and `meeting`. Install it from settings. Try `npm run build && stip break`.

### Changed

- The tray panel opens instantly, even the first time, and Esc closes it. On macOS it opens over full-screen apps.
- Opening Stip while it's already running shows the tray panel.

### Fixed

- Clicking the tray icon while the panel is open now closes it instead of reopening it.
- The Microsoft Store version now shows up in Windows Settings → Apps → Startup, so it can open at login.

## [1.0.0] - 2026-10-30

The first release.

### Added

- Full-screen stand break on every display, with a breathing timer and a simple task on the main screen, and original memes on the others. Defaults: every 30 minutes, for 2 minutes.
- Ten seconds to get up before the break timer starts counting.
- The menu bar stays quiet: just the icon, with the timer shown only in the last 30 seconds before a break.
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
- macOS DMG (signed and notarized), Linux AppImage and .deb, and a Windows installer, made by CI for every release.

[Unreleased]: https://github.com/AmreshVs/stip/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/AmreshVs/stip/releases/tag/v1.0.0
