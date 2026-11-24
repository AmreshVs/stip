# Contributing to Stip

Thanks for wanting to help. Stip is small on purpose, so the best contributions keep it simple, calm and fast.

## Ways to help

- **Report a bug.** Open an issue with your OS, Stip version (Settings shows it at the bottom of the sidebar) and the steps to reproduce it.
- **Suggest an idea.** Open an issue first and describe the problem it solves. It's easier to agree on the idea before anyone writes code.
- **Add a meme.** Memes live in `src/renderer/break/memes.js` and are drawn in markup: a joke with a punchline, a chat, a fake error dialog, a terminal, or a small line drawing. Keep it kind and short: no copied images or comics, no real people, no brands.
- **Fix something.** Issues labelled `good first issue` are a good place to start.

## Set up

You need [Rust](https://www.rust-lang.org/tools/install), [Tauri's prerequisites](https://tauri.app/start/prerequisites/) for your platform, and Node.js 20 or newer (for the fonts the pages use).

```bash
git clone https://github.com/AmreshVs/stip.git
cd stip
npm install
cd src-tauri
cargo run
```

Use a separate data folder while developing, so your real settings and stats stay untouched. A run with its own data folder can also run beside your installed Stip:

```bash
STIP_USER_DATA=/tmp/stip-dev cargo run
```

To make the timers fast while you work on a screen, put this in `/tmp/stip-dev/settings.json` (times in minutes):

```json
{ "stand": { "everyMin": 0.75, "breakSec": 15 }, "water": { "everyMin": 0.5 } }
```

You can also open any screen straight away with `--show`:

```bash
STIP_USER_DATA=/tmp/stip-dev cargo run -- --show=break:aurora
```

Views are `tray`, `tray.meeting` (tray with meeting mode on), `break`, `water`, `settings` and `settings.<page>` (for example `settings.stats`). Themes are `flat` and `aurora`.

## The landing page

The website at [amreshvs.github.io/stip](https://amreshvs.github.io/stip) lives in `docs/` and is plain HTML, CSS and JavaScript. Preview it with:

```bash
npm run site
```

Then open http://localhost:4173. If that port is taken, use another one: `PORT=4174 npm run site`.

## Before you open a pull request

1. Run the unit tests: `cargo test` in `src-tauri/`, and `npm test` in the root.
2. Run the self-check: `STIP_PROBE=1 STIP_USER_DATA=/tmp/stip-probe cargo run` in `src-tauri/`. It opens a break, the water reminder, the tray, settings and the report, checks each, and prints a JSON report. CI runs it on macOS too.
3. If you changed a screen, check it in both themes and attach before and after screenshots. `STIP_SNAPSHOT=/tmp/shot.png` with `--show` saves one without opening a window.
4. If you changed an icon in `assets/`, run `npm run icons` and commit the generated PNGs.

## How the code is laid out

```
src-tauri/src/scheduler.rs  All the timing rules, fully unit tested.
src-tauri/src/store.rs      Settings and stats, saved as JSON in the app's data folder.
src-tauri/src/app.rs        Wires everything together and handles actions from the windows.
src-tauri/src/windows.rs    The windows: breaks, water, tray, settings, report.
src-tauri/src/bridge.js     window.stip, the small API the windows use to talk to the app.
src/renderer/<window>/      The HTML, CSS and JS for each window.
src/cli.js                  The stip command's client.
```

A few rules the code follows:

- Windows only talk to the app through `window.stip`, from `bridge.js`.
- Timing logic lives in `scheduler.rs` and has a test. If you change when something fires, add a test for it.
- Both themes share the same markup. Theme differences live in CSS under `[data-theme='aurora']`.
- Stip never sends data anywhere. Please keep it that way: no analytics, no network calls.

## Commits and pull requests

- Keep commits small and focused, with a short title that says what changed, like "Add snooze count to stats".
- One topic per pull request. Link the issue it closes.
- Be patient and kind in reviews. See the [code of conduct](CODE_OF_CONDUCT.md).

By contributing, you agree that your work is released under the [MIT License](LICENSE).
