// The app's state and everything the pages, the tray and the terminal can
// ask it to do. Ported from src/main/index.js.
use crate::characters;
use crate::flow::Flow;
use crate::git_history;
use crate::meeting::Meeting;
use crate::report::{self, build_report, Input};
use crate::scheduler::{local, Event, Scheduler, Tick};
use crate::store::{Kind, Settings, Stats};
use crate::windows;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const PRIVACY_URL: &str = "https://amreshvs.github.io/stip/privacy.html";

pub struct Core {
    pub settings: Settings,
    pub stats: Stats,
    pub scheduler: Scheduler,
    pub meeting: Meeting,
    pub flow: Flow,
    pub cli_install: Option<Value>,
}

#[derive(Default)]
pub struct Ui {
    /// Clickable parts of the water window, in CSS pixels from its corner.
    pub water_hit: Vec<(f64, f64, f64, f64)>,
    pub panel_hidden_at: Option<Instant>,
    pub panel_open: bool,
    /// The first "show" for a window, kept until its page asks for it.
    pub pending_show: HashMap<String, Value>,
    pub break_gen: u64,
    pub break_open: bool,
    pub meme_offset: u64,
    pub title: Option<(String, String)>,
    /// What each page said when the probe asked.
    pub probe: HashMap<String, Value>,
}

pub struct Shared {
    pub core: Mutex<Core>,
    pub ui: Mutex<Ui>,
    pub dir: PathBuf,
    /// The Mac App Store sandbox can't run programs.
    pub sandboxed: bool,
    /// Snapshots and test runs render windows without showing them.
    pub hidden: bool,
    pub actions: Mutex<Option<Sender<(String, Value)>>>,
}

pub fn shared(app: &AppHandle) -> tauri::State<'_, Shared> {
    app.state::<Shared>()
}

impl Shared {
    pub fn core(&self) -> MutexGuard<'_, Core> {
        self.core.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn ui(&self) -> MutexGuard<'_, Ui> {
        self.ui.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn is_sandboxed() -> bool {
    cfg!(feature = "mas") || std::env::var_os("APP_SANDBOX_CONTAINER_ID").is_some() || std::env::var_os("STIP_AS_APP_STORE").is_some()
}

pub fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "linux"
    }
}

// ---- Data folder ---------------------------------------------------------------

/// Electron kept data in <config dir>/Stip; Tauri uses <data dir>/<identifier>.
/// The first run copies the old files over, so nobody loses their streak.
pub fn migrate(legacy: &Path, dir: &Path) -> bool {
    let files = ["settings.json", "stats.json"];
    if files.iter().any(|f| dir.join(f).exists()) || !files.iter().any(|f| legacy.join(f).exists()) {
        return false;
    }
    let _ = std::fs::create_dir_all(dir);
    for f in files {
        if legacy.join(f).exists() {
            let _ = std::fs::copy(legacy.join(f), dir.join(f));
        }
    }
    true
}

pub fn data_dir(app: &AppHandle) -> PathBuf {
    if let Some(dir) = std::env::var_os("STIP_USER_DATA") {
        return PathBuf::from(dir);
    }
    let dir = app.path().app_data_dir().expect("no data folder");
    if let Ok(config) = app.path().config_dir() {
        if migrate(&config.join("Stip"), &dir) {
            eprintln!("stip: copied settings from {}", config.join("Stip").display());
        }
    }
    dir
}

// ---- What the pages see ----------------------------------------------------------

fn minutes_until_midnight(now: i64) -> i64 {
    let date = local(now);
    let midnight = (date.date_naive() + chrono::Duration::days(1)).and_hms_opt(0, 0, 0).unwrap();
    let midnight = midnight.and_local_timezone(chrono::Local).earliest().map(|d| d.timestamp_millis()).unwrap_or(now);
    ((midnight - now) as f64 / 60000.0).ceil() as i64
}

pub fn state_of(c: &Core, app: &AppHandle, sandboxed: bool) -> Value {
    let now = now_ms();
    let date = local(now);
    json!({
        "settings": c.settings.get(),
        "status": c.scheduler.status(now),
        "today": c.stats.today(&date),
        "streak": c.stats.streak(&date),
        "longestStreak": c.stats.longest_streak(),
        "activeDays": c.stats.active_days(),
        "daysSinceBreak": c.stats.days_since_break(&date),
        "week": c.stats.week(&date),
        "meeting": { "manual": c.meeting.manual(now), "active": c.meeting.active(now), "until": c.meeting.manual_until },
        "platform": platform(),
        "version": app.package_info().version.to_string(),
        "fromStore": false,
        "sandboxed": sandboxed,
        "cliInstall": c.cli_install,
        "tip": report::tip(&c.stats.range(14, 0, &date)),
    })
}

pub fn state(app: &AppHandle) -> Value {
    let s = shared(app);
    let c = s.core();
    state_of(&c, app, s.sandboxed)
}

/// The tray gets every tick; the settings and report windows only real
/// changes, so they don't redraw under the pointer every second.
pub fn broadcast(app: &AppHandle, include_settings: bool) {
    let current = state(app);
    let panel_open = shared(app).ui().panel_open;
    if panel_open {
        let _ = app.emit_to("panel", "state", &current);
    }
    if include_settings {
        for label in ["settings", "report"] {
            if app.get_webview_window(label).is_some() {
                let _ = app.emit_to(label, "state", &current);
            }
        }
    }
}

pub fn report_data(app: &AppHandle) -> Value {
    let s = shared(app);
    let (config, folders) = {
        let c = s.core();
        let config = c.settings.config().clone();
        // The Mac App Store sandbox can't run git, so that version leaves commits out.
        let folders = if s.sandboxed { vec![] } else { config.report.folders.clone() };
        (config, folders)
    };
    let commits = (!folders.is_empty()).then(|| git_history::recent_commits(&folders, 14));
    let c = s.core();
    let date = local(now_ms());
    let week = c.stats.range(7, 0, &date);
    let last_week = c.stats.range(7, 7, &date);
    let report = build_report(Input {
        week: &week,
        last_week: &last_week,
        streak: c.stats.streak(&date),
        settings: &config,
        now: date,
        commits: commits.as_deref(),
    });
    json!({ "report": report, "folders": folders, "theme": config.theme, "sandboxed": s.sandboxed })
}

// ---- Things that happen -----------------------------------------------------------

/// Runs what the scheduler asked for since the last look.
pub fn drain(app: &AppHandle) {
    let events = shared(app).core().scheduler.take_events();
    for event in events {
        match event {
            Event::Stand => {
                windows::water_hide(app);
                windows::break_show(app);
            }
            Event::StandWaiting => notify(app, "Stand break is waiting for you", "You're on a call, so it starts 30 seconds after the call ends."),
            Event::Water => {
                if !shared(app).ui().break_open {
                    windows::water_show(app);
                }
            }
        }
    }
}

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    if shared(app).hidden {
        return;
    }
    use tauri_plugin_notification::NotificationExt;
    let app = app.clone();
    let (title, body) = (title.to_string(), body.to_string());
    std::thread::spawn(move || {
        let _ = app.notification().builder().title(title).body(body).show();
    });
}

fn record_sip(app: &AppHandle) {
    let s = shared(app);
    let mut c = s.core();
    let now = now_ms();
    c.stats.record(Kind::Glasses, &local(now));
    c.scheduler.sipped(now);
}

pub fn on_break_finished(app: &AppHandle, how: &str) {
    let s = shared(app);
    let now = now_ms();
    let date = local(now);
    let mut unlock = None;
    {
        let mut c = s.core();
        match how {
            "done" => {
                let before = c.stats.active_days();
                c.stats.record(Kind::Breaks, &date);
                let after = c.stats.active_days();
                let character = c.settings.config().water.character.clone();
                if let Some(prize) = characters::unlocked_between(&character, before, after) {
                    unlock = Some((format!("{} earned {prize}", characters::name(&character)), format!("That's {after} days with a break. Nice work.")));
                }
                c.scheduler.break_done(now);
            }
            "snooze" => {
                c.stats.record(Kind::Snoozed, &date);
                c.scheduler.snooze(now, 5);
            }
            "meeting" => {
                c.meeting.set_manual(true, now);
                c.scheduler.defer_for_meeting();
            }
            _ => {
                c.stats.record(Kind::Skipped, &date);
                c.scheduler.skip(now);
            }
        }
    }
    if let Some((title, body)) = unlock {
        notify(app, &title, &body);
    }
    drain(app);
    broadcast(app, true);
}

fn settings_changed(app: &AppHandle) {
    let s = shared(app);
    let launch = {
        let mut c = s.core();
        let config = c.settings.config().clone();
        let launch = config.launch_at_login;
        c.scheduler.reschedule(config, now_ms());
        launch
    };
    apply_login_item(app, launch);
}

fn apply_login_item(app: &AppHandle, on: bool) {
    // Dev and test runs keep their hands off the real login items.
    if std::env::var_os("STIP_USER_DATA").is_some() {
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if launcher.is_enabled().unwrap_or(false) != on {
        let _ = if on { launcher.enable() } else { launcher.disable() };
    }
}

fn set_settings(app: &AppHandle, patch: &Value) {
    shared(app).core().settings.set(patch);
    settings_changed(app);
}

/// Applying or dismissing a suggestion settles it for the week.
fn settle_suggestion(app: &AppHandle, outcome: &str) {
    let data = report_data(app);
    let current = &data["report"];
    if current["suggestion"].is_null() {
        return;
    }
    let mut patch = if outcome == "applied" { current["suggestion"]["patch"].clone() } else { json!({}) };
    patch["report"] = json!({ "reviewed": { "key": current["key"], "outcome": outcome } });
    set_settings(app, &patch);
}

/// Writes a small launcher so `stip` in a terminal runs this app's CLI mode.
pub fn install_command(exe: &Path, home: &Path) -> std::io::Result<PathBuf> {
    let windows = cfg!(windows);
    let dir = if windows {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or(home.to_path_buf()).join("Stip").join("bin")
    } else {
        home.join(".local").join("bin")
    };
    std::fs::create_dir_all(&dir)?;
    let file = dir.join(if windows { "stip.cmd" } else { "stip" });
    let exe = exe.display();
    let script = if windows { format!("@echo off\r\n\"{exe}\" --cli %*\r\n") } else { format!("#!/bin/sh\nexec \"{exe}\" --cli \"$@\"\n") };
    std::fs::write(&file, script)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(dir)
}

fn minutes_of(payload: &Value) -> i64 {
    match &payload["minutes"] {
        Value::String(s) if s == "day" => minutes_until_midnight(now_ms()),
        Value::String(s) => s.parse().unwrap_or(60),
        v => v.as_f64().map(|m| m as i64).unwrap_or(60),
    }
}

/// Queues an action from a page or the tray menu; they run in order on one
/// thread, away from the main thread, so window work never deadlocks.
pub fn queue(app: &AppHandle, name: &str, payload: Value) {
    if let Some(tx) = shared(app).actions.lock().unwrap().as_ref() {
        let _ = tx.send((name.to_string(), payload));
    }
}

pub fn start_action_worker(app: &AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel::<(String, Value)>();
    *shared(app).actions.lock().unwrap() = Some(tx);
    let app = app.clone();
    std::thread::Builder::new()
        .name("stip-actions".into())
        .spawn(move || {
            for (name, payload) in rx {
                handle_action(&app, &name, &payload);
            }
        })
        .unwrap();
}

pub fn handle_action(app: &AppHandle, name: &str, payload: &Value) {
    let s = shared(app);
    let now = now_ms();
    match name {
        "stand-now" => {
            windows::panel_hide(app);
            s.core().scheduler.start_break();
            drain(app);
        }
        "break-finish" => windows::break_finish(app, payload["how"].as_str().unwrap_or("done"), None),
        "sip" | "water-sipped" => record_sip(app),
        "tray-size" => windows::panel_resize(app, payload["height"].as_f64().unwrap_or(0.0)),
        "tray-close" => windows::panel_hide(app),
        "water-now" => {
            windows::panel_hide(app);
            if !s.ui().break_open {
                windows::water_show(app);
            }
        }
        // The pointer watcher already handles this; see windows::water_show.
        "water-hover" => {}
        "water-later" => {
            s.core().scheduler.water_later(now, 10);
            windows::water_hide(app);
        }
        "water-close" => windows::water_hide(app),
        "meeting-toggle" => {
            let mut c = s.core();
            let on = !c.meeting.manual(now);
            c.meeting.set_manual(on, now);
        }
        "pause" => {
            let minutes = minutes_of(payload);
            s.core().scheduler.pause(now, minutes);
        }
        "resume" => s.core().scheduler.resume(now),
        "settings" => {
            windows::panel_hide(app);
            windows::settings_open(app, None);
        }
        "settings-set" => set_settings(app, payload),
        "open-privacy" => {
            use tauri_plugin_opener::OpenerExt;
            let _ = app.opener().open_url(PRIVACY_URL, None::<&str>);
        }
        "report-open" => {
            windows::panel_hide(app);
            windows::report_open(app);
        }
        "report-apply" => settle_suggestion(app, "applied"),
        "report-dismiss" => settle_suggestion(app, "dismissed"),
        "report-copy" => windows::report_copy(app),
        "report-save" => {
            let app = app.clone();
            std::thread::spawn(move || windows::report_save(&app));
        }
        "report-add-folder" => {
            let app = app.clone();
            std::thread::spawn(move || {
                if let Some(folder) = windows::pick_folder(&app) {
                    let folders = shared(&app).core().settings.config().report.folders.clone();
                    if !folders.contains(&folder) {
                        let mut next = folders;
                        next.push(folder);
                        set_settings(&app, &json!({ "report": { "folders": next } }));
                    }
                }
                broadcast(&app, true);
            });
        }
        "report-remove-folder" => {
            let folder = payload["folder"].as_str().unwrap_or("");
            let folders: Vec<String> = s.core().settings.config().report.folders.iter().filter(|f| *f != folder).cloned().collect();
            set_settings(app, &json!({ "report": { "folders": folders } }));
        }
        "install-cli" => {
            let result = std::env::current_exe()
                .and_then(|exe| install_command(&exe, &crate::cli::home()))
                .map(|dir| json!({ "ok": true, "dir": dir }))
                .unwrap_or_else(|e| json!({ "ok": false, "error": e.to_string() }));
            s.core().cli_install = Some(result);
        }
        "quit" => {
            crate::cli_server::cleanup();
            app.exit(0);
            return;
        }
        _ => return,
    }
    broadcast(app, true);
}

/// The `stip` command in the terminal.
pub fn cli_command(app: &AppHandle, request: &Value) -> Value {
    let s = shared(app);
    let now = now_ms();
    match request["command"].as_str().unwrap_or("") {
        "status" => {
            let c = s.core();
            let date = local(now);
            json!({
                "status": c.scheduler.status(now),
                "today": c.stats.today(&date),
                "streak": c.stats.streak(&date),
                "meeting": c.meeting.manual(now),
            })
        }
        "break" => {
            if s.core().scheduler.on_break {
                return json!({ "message": "Already on a break." });
            }
            handle_action(app, "stand-now", &Value::Null);
            json!({ "message": "Stand up!" })
        }
        "water" => {
            handle_action(app, "water-now", &Value::Null);
            json!({ "message": "Water reminder is up." })
        }
        "sip" => {
            handle_action(app, "sip", &Value::Null);
            let c = s.core();
            let glasses = c.stats.today(&local(now)).glasses;
            json!({ "message": format!("Logged. {glasses} of {} glasses today.", c.settings.config().water.goal_glasses) })
        }
        "pause" => {
            handle_action(app, "pause", request);
            let message = if request["minutes"] == "day" { "Paused for today.".to_string() } else { format!("Paused for {} min.", request["minutes"]) };
            json!({ "message": message })
        }
        "resume" => {
            handle_action(app, "resume", &Value::Null);
            json!({ "message": "Reminders are back on." })
        }
        "meeting" => {
            let on = request["on"].as_bool().unwrap_or(false);
            s.core().meeting.set_manual(on, now);
            broadcast(app, true);
            json!({ "message": if on { "Meeting mode on." } else { "Meeting mode off." } })
        }
        _ => json!({ "error": "Unknown command." }),
    }
}

// ---- The clock ----------------------------------------------------------------------

// The menu bar stays quiet: the icon alone, plus a word for a state that
// matters, and the timer only in the last 30 seconds before a break.
const FINAL_COUNTDOWN_MS: i64 = 30 * 1000;

pub fn tray_title(c: &Core, now: i64) -> (String, String) {
    let status = c.scheduler.status(now);
    let clock = crate::cli::clock(status.ms_to_stand);
    let minutes = (status.ms_to_stand as f64 / 60000.0).ceil() as i64;
    let final_ = c.settings.config().show_countdown && status.ms_to_stand <= FINAL_COUNTDOWN_MS;
    let (title, tip) = if status.paused_until > 0 {
        ("Paused".to_string(), "Stip · paused".to_string())
    } else if status.off_hours {
        (String::new(), "Stip · outside working hours".into())
    } else if status.waiting_for_meeting {
        ("In call · break waiting".into(), "Stip · your break starts after the call".into())
    } else if status.waiting_for_flow {
        ("Break at next pause".into(), "Stip · your break starts when you pause".into())
    } else if c.meeting.active(now) {
        (if final_ { format!("In call · {clock}") } else { "In call".into() }, format!("Stip · in a call, next stand in {minutes} min"))
    } else {
        (if final_ { clock } else { String::new() }, format!("Stip · next stand in {minutes} min"))
    };
    (title, tip)
}

pub fn start_clock(app: &AppHandle) {
    let app = app.clone();
    std::thread::Builder::new()
        .name("stip-clock".into())
        .spawn(move || {
            let mut last = now_ms();
            let mut was_locked = false;
            loop {
                std::thread::sleep(Duration::from_millis(1000 - (now_ms() % 1000) as u64));
                let now = now_ms();
                let s = shared(&app);
                // A long gap means the computer slept; start fresh, as
                // Electron did on powerMonitor's resume.
                let mut restart = now - last > 30_000;
                last = now;
                #[cfg(target_os = "macos")]
                {
                    let locked = crate::mac::screen_locked();
                    restart |= was_locked && !locked;
                    was_locked = locked;
                }
                #[cfg(not(target_os = "macos"))]
                let _ = &mut was_locked;
                let idle_sec = user_idle::UserIdle::get_time().map(|t| t.as_seconds() as f64).unwrap_or(0.0);
                let title = {
                    let mut c = s.core();
                    if restart {
                        c.scheduler.restart(now);
                    }
                    c.flow.note(idle_sec);
                    let tick = Tick { idle_sec, in_meeting: c.meeting.active(now), in_flow: c.flow.active() };
                    c.scheduler.tick(now, tick);
                    let sitting = c.scheduler.status(now);
                    if sitting.paused_until == 0 && !sitting.off_hours && !sitting.on_break {
                        c.stats.note_sit((sitting.sitting_ms / 60000).max(0) as u64, &local(now));
                    }
                    tray_title(&c, now)
                };
                drain(&app);
                windows::set_tray_title(&app, title);
                broadcast(&app, false);
            }
        })
        .unwrap();
}

/// Looks at running programs every 15 seconds for calls and builds.
pub fn start_process_watch(app: &AppHandle) {
    // The Mac App Store sandbox can't list programs, so there meeting mode is
    // the only way to say you're in a call.
    if shared(app).sandboxed {
        return;
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("stip-processes".into())
        .spawn(move || loop {
            let names = crate::meeting::list_processes();
            {
                let s = shared(&app);
                let mut c = s.core();
                c.meeting.update_processes(&names);
                c.flow.update_processes(&names);
            }
            std::thread::sleep(Duration::from_secs(15));
        })
        .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_copies_electron_data_once() {
        let legacy = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let new = dir.path().join("dev.amreshvs.stip");
        std::fs::write(legacy.path().join("stats.json"), "{}").unwrap();
        std::fs::write(legacy.path().join("settings.json"), r#"{"theme":"aurora"}"#).unwrap();
        assert!(migrate(legacy.path(), &new));
        assert_eq!(std::fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"theme":"aurora"}"#);
        std::fs::write(legacy.path().join("settings.json"), r#"{"theme":"flat"}"#).unwrap();
        assert!(!migrate(legacy.path(), &new), "never twice");
        assert!(!migrate(&dir.path().join("none"), &dir.path().join("x")), "nothing to copy");
    }

    #[test]
    fn install_writes_a_launcher() {
        if cfg!(windows) {
            return;
        }
        let home = tempfile::tempdir().unwrap();
        let dir = install_command(Path::new("/Applications/Stip.app/Contents/MacOS/stip"), home.path()).unwrap();
        let script = std::fs::read_to_string(dir.join("stip")).unwrap();
        assert_eq!(script, "#!/bin/sh\nexec \"/Applications/Stip.app/Contents/MacOS/stip\" --cli \"$@\"\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert!(std::fs::metadata(dir.join("stip")).unwrap().permissions().mode() & 0o100 != 0);
        }
    }

    #[test]
    fn pausing_for_the_day_runs_to_midnight() {
        use chrono::TimeZone;
        let at = chrono::Local.with_ymd_and_hms(2026, 11, 2, 23, 30, 0).unwrap().timestamp_millis();
        assert_eq!(minutes_until_midnight(at), 30);
    }
}
