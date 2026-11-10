# Stip on Tauri

A Rust port of the Electron main process (`src/main/*.js`). The pages in
`src/renderer/` are shared with the Electron app and are not changed: at build
time `build.rs` copies them, plus the fonts they import from `node_modules`,
into `ui-dist/`, and Tauri embeds that folder in the binary. The Electron code
stays in place until this app reaches parity everywhere.

## Run it

```sh
npm install                 # once, for the fonts the pages import
cd src-tauri
cargo build                 # no Tauri CLI needed
cargo test                  # the ported unit tests
./target/debug/stip         # the app, in the menu bar / tray
```

Dev runs should keep their data apart from the real app:

```sh
STIP_USER_DATA=/tmp/stip-dev STIP_SOCKET=/tmp/stip-dev.sock ./target/debug/stip
```

| Variable / flag | What it does |
| --- | --- |
| `STIP_USER_DATA=<dir>` | Settings and stats go here. Also leaves the login item alone and, unless `STIP_SOCKET` is set, skips the CLI socket. |
| `STIP_SOCKET=<path>` | The CLI socket (default `~/.stip.sock`, or `\\.\pipe\stip-<user>` on Windows). Unix sockets need a short path. |
| `STIP_PROBE=1` | Self-check: opens a break, the water reminder, the tray panel, settings and the report, checks each, tries the CLI, prints `PROBE {json}` and quits (exit 1 if anything failed). `STIP_PROBE_SHOTS=<dir>` saves screenshots, `STIP_PROBE_OUT=<file>` saves the JSON. |
| `--show=<view>[:theme]` | Opens `break`, `water`, `tray`, `tray.meeting`, `report` or `settings[.page]` at once. With `STIP_SNAPSHOT=<file>` it saves a PNG of that page and quits. |
| `STIP_HIDDEN=1` | Builds windows without showing them. |
| `STIP_AS_APP_STORE=1` | Behaves like the Mac App Store build (also the `mas` cargo feature, or a real sandbox). |
| `--cli <command>` | The `stip` terminal command, built in. |

## How it maps

| Electron | Tauri |
| --- | --- |
| `preload.js` (`window.stip`) | `src/bridge.js`, injected as an initialization script: same `getState`, `getReport`, `act`, `onState`, `onShow`, on `invoke` and events. |
| `index.js` | `app.rs` (state, actions, the 1 s clock, CLI commands) and `main.rs` (tray, setup). |
| `scheduler.js`, `flow.js`, `meeting.js`, `store.js`, `report.js`, `git-history.js` | `scheduler.rs`, `flow.rs`, `meeting.rs`, `store.rs`, `report.rs`, `git_history.rs`, with their tests ported. |
| `breaks.js`, `water.js`, `tray.js`, `settings-window.js`, `report-window.js`, `snapshot.js` | `windows.rs`, `mac.rs`, `probe.rs`. |
| `cli-server.js`, `cli.js` | `cli_server.rs` (tokio Unix socket / named pipe) and `cli.rs`. `src/cli.js` still works against the same socket. |
| `powerMonitor` resume / unlock | A gap of over 30 s between ticks (sleep), and on macOS the session's screen-lock flag. |
| `process.mas` | `app::is_sandboxed()`: the `mas` feature, `APP_SANDBOX_CONTAINER_ID`, or `STIP_AS_APP_STORE`. Process listing, git and the CLI are off there, as before. |

Things Tauri does differently, and how they're handled:

- **Click-through water window.** Tauri has no `setIgnoreMouseEvents(…, { forward: true })`. The bridge reports where the page's `.interactive` parts are; a thread watches the pointer and turns clicks on only over them, and tells the page when the pointer leaves so its `mouseleave` still fires.
- **Windows above full-screen apps.** On macOS, `setLevel:` (1000 for breaks, 3 for water and the panel) and `CanJoinAllSpaces | Stationary | FullScreenAuxiliary` through objc2.
- **`-webkit-app-region: drag`** isn't supported by WebKit or WebView2, so the bridge starts a window drag from `.drag` and `.head`.
- **The pages' CSP** allows only `'self'`; the staged copies also allow `ipc:` so Tauri's IPC isn't refused.
- **Report image.** `WKWebView takeSnapshot` and `NSPasteboard` on macOS.
- **The `stip` command.** Electron's launcher ran `cli.js` with `ELECTRON_RUN_AS_NODE`. There's no Node here, so the launcher runs `<app binary> --cli "$@"` instead.

## Data folder (changed)

Electron kept settings in `<config dir>/Stip`; Tauri uses its app data dir,
named after the identifier:

| | Electron | Tauri |
| --- | --- | --- |
| macOS | `~/Library/Application Support/Stip` | `~/Library/Application Support/dev.amreshvs.stip` |
| Windows | `%APPDATA%\Stip` | `%APPDATA%\dev.amreshvs.stip` |
| Linux | `~/.config/Stip` | `~/.local/share/dev.amreshvs.stip` |

On first run, if the new folder has no `settings.json` or `stats.json` and the
old one does, both are copied over (never moved, never twice). The file
format and defaults are unchanged, and unknown keys are kept.

## CI

- `ci.yml`: the `tauri` job runs `cargo test` and a release build on Ubuntu 24.04, macOS and Windows; `tauri-probe` runs the self-check on macOS and keeps its JSON report.
- `release.yml`: builds only the Tauri app on this branch: a universal DMG (signed with the Developer ID, then the app and the DMG notarized and stapled, when the Apple secrets are set), an AppImage and .deb, and an NSIS installer.

## Left to do

- **Windows and Linux**: the Windows code type-checks (`cargo check --target x86_64-pc-windows-msvc`), but neither has been run. Not done yet on either: picture of the report page (Copy / Save PNG), and screen-unlock detection (sleep is covered).
- **Packaging**: a universal `.app` and DMG build and run on macOS (`npx @tauri-apps/cli@2.12.4 build --target universal-apple-darwin --bundles app,dmg`, after a `cargo check` to stage `ui-dist/`). The AppImage, .deb and NSIS builds are only in the release workflow and haven't been run yet.
- **Windows signing** (the Mac build is signed with the Developer ID and notarized by `release.yml`), the **Mac App Store** build (sandbox entitlements, `mas` feature, a login item through `SMAppService`), and the **MSIX / Store** build.
- The menu bar title doesn't use monospaced digits, as Electron's `fontType: 'monospacedDigit'` did.
- Notifications and launch at login use Tauri's plugins. They need a bundled app with an identifier to show up properly, so they haven't been checked yet.
