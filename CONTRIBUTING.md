# Contributing to Stip

Thanks for wanting to help. Stip is small on purpose, so the best contributions keep it simple, calm and fast.

## Ways to help

- **Report a bug.** Open an issue with your OS, Stip version (Settings shows it at the bottom of the sidebar) and the steps to reproduce it.
- **Suggest an idea.** Open an issue first and describe the problem it solves. It's easier to agree on the idea before anyone writes code.
- **Add a meme.** Stip only ships jokes written for it, drawn in markup. Add one to `src/renderer/break/memes.js`. Keep it kind, short and original: no copied images, no real people, no brands.
- **Fix something.** Issues labelled `good first issue` are a good place to start.

## Set up

You need Node.js 20 or newer.

```bash
git clone https://github.com/AmreshVs/stip.git
cd stip
npm install
npm start
```

Use a separate data folder while developing, so your real settings and stats stay untouched:

```bash
STIP_USER_DATA=/tmp/stip-dev npm start
```

To make the timers fast while you work on a screen, put this in `/tmp/stip-dev/settings.json` (times in minutes):

```json
{ "stand": { "everyMin": 0.75, "breakSec": 15 }, "water": { "everyMin": 0.5 } }
```

You can also open any screen straight away with `--show`:

```bash
STIP_USER_DATA=/tmp/stip-dev npm start -- --show=break:aurora
```

Views are `tray`, `break`, `water`, `settings` and `settings.<page>` (for example `settings.stats`). Themes are `flat` and `aurora`.

## Before you open a pull request

1. Run the unit tests: `npm test`
2. Run the end-to-end test: `npm run e2e`. It starts the real app with hidden windows and clicks through the tray, breaks, water reminder and settings.
3. If you changed a screen, check it in both themes and attach before and after screenshots. `STIP_SNAPSHOT=/tmp/shot.png` with `--show` saves one without opening a window.
4. If you changed an icon in `assets/`, run `npm run icons` and commit the generated PNGs.

## How the code is laid out

```
src/main/scheduler.js   All the timing rules. Plain JavaScript, fully unit tested.
src/main/store.js       Settings and stats, saved as JSON in the user data folder.
src/main/index.js       Wires everything together and handles actions from the windows.
src/main/*.js           One file per window: breaks, water, tray, settings.
src/renderer/<window>/  The HTML, CSS and JS for each window.
src/preload.js          The small, safe API the windows use to talk to the main process.
```

A few rules the code follows:

- Windows never get Node.js access. They talk to the main process only through `window.stip` from the preload script.
- Timing logic lives in `scheduler.js` and has a test. If you change when something fires, add a test for it.
- Both themes share the same markup. Theme differences live in CSS under `[data-theme='aurora']`.
- Stip never sends data anywhere. Please keep it that way: no analytics, no network calls.

## Commits and pull requests

- Keep commits small and focused, with a short title that says what changed, like "Add snooze count to stats".
- One topic per pull request. Link the issue it closes.
- Be patient and kind in reviews. See the [code of conduct](CODE_OF_CONDUCT.md).

By contributing, you agree that your work is released under the [MIT License](LICENSE).
