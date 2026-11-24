# Stip on Tauri

The app: a Rust core with the pages in `src/renderer/` drawn in the system's
web view. At build time `build.rs` copies those pages, plus the fonts they
import from `node_modules`, into `ui-dist/`, and Tauri embeds that folder in
the binary.

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

## How it's laid out

| File | What it does |
| --- | --- |
| `src/bridge.js` | `window.stip` for the pages (`getState`, `getReport`, `act`, `onState`, `onShow`), injected as an initialization script, on `invoke` and events. |
| `app.rs`, `main.rs` | State, actions, the 1 s clock and CLI commands; the tray and setup. |
| `scheduler.rs`, `flow.rs`, `meeting.rs`, `store.rs`, `report.rs`, `git_history.rs` | The timing rules, flow and call detection, settings and stats, the Spine report and its commit counts, each with unit tests. |
| `windows.rs`, `mac.rs`, `probe.rs` | The windows, the macOS window levels, snapshots and login item, and the self-check. |
| `cli_server.rs`, `cli.rs` | The `stip` command: a tokio Unix socket / named pipe, and the client built into the binary (`stip --cli`). `src/cli.js` speaks the same protocol. |
| Sleep and screen lock | A gap of over 30 s between ticks (sleep), and on macOS the session's screen-lock flag. |
| `app::is_sandboxed()` | The `mas` feature, `APP_SANDBOX_CONTAINER_ID`, or `STIP_AS_APP_STORE`. Process listing, git and the CLI are off there. |

Things Tauri does differently, and how they're handled:

- **Click-through water window.** Tauri has no `setIgnoreMouseEvents(…, { forward: true })`. The bridge reports where the page's `.interactive` parts are; a thread watches the pointer and turns clicks on only over them, and tells the page when the pointer leaves so its `mouseleave` still fires.
- **Windows above full-screen apps.** On macOS, `setLevel:` (1000 for breaks, 3 for water and the panel) and `CanJoinAllSpaces | Stationary | FullScreenAuxiliary` through objc2.
- **`-webkit-app-region: drag`** isn't supported by WebKit or WebView2, so the bridge starts a window drag from `.drag` and `.head`.
- **The pages' CSP** allows only `'self'`; the staged copies also allow `ipc:` so Tauri's IPC isn't refused.
- **Report image.** `WKWebView takeSnapshot` and `NSPasteboard` on macOS.
- **The `stip` command.** There's no Node in the app, so the launcher it installs runs `<app binary> --cli "$@"`.

## Data folder

Settings and stats live in Tauri's app data dir, named after the identifier:
`~/Library/Application Support/dev.amreshvs.stip` on macOS,
`%APPDATA%\dev.amreshvs.stip` on Windows and `~/.local/share/dev.amreshvs.stip`
on Linux.

Versions before 1.1.0 kept them in `<config dir>/Stip`. On first run, if the
new folder has no `settings.json` or `stats.json` and the old one does, both
are copied over (never moved, never twice). The file format and defaults are
unchanged, and unknown keys are kept.

## CI and packaging

- `ci.yml`: the `tauri` job runs `cargo test` and a release build on Ubuntu 24.04, macOS and Windows; `tauri-probe` runs the self-check on macOS and keeps its JSON report.
- `release.yml`: a universal DMG (signed with the Developer ID, then the app and the DMG notarized and stapled, when the Apple secrets are set), an AppImage and .deb, an NSIS installer, and the Microsoft Store MSIX (`scripts/msix.js`).
- Mac App Store: `npm run dist:mas` (`scripts/mas.js`) builds with `--features mas`, signs with the sandbox entitlements in `build/entitlements.mas.plist` and the provisioning profile, uses `Info.mas.plist`, and wraps it in a signed `.pkg`. Open at login goes through `SMAppService` there (macOS 13 and later).

## Left to do

- **Windows and Linux**: picture of the report page (Copy / Save PNG), and screen-unlock detection (sleep is covered).
- **Windows signing.** The installer isn't code-signed yet; Store installs are signed by the Store.
- The menu bar title doesn't use monospaced digits.
- Notifications and launch at login use Tauri's plugins (`SMAppService` in the Mac App Store build) and haven't been checked in every packaged build yet.
