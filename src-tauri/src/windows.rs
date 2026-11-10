// Every window Stip opens: break screens, the water reminder, the tray panel,
// settings and the Spine report. Ported from breaks.js, water.js, tray.js,
// settings-window.js and report-window.js.
use crate::app::{self, now_ms, shared};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::window::Color;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

pub const BRIDGE: &str = include_str!("bridge.js");
const BREAK_PAGE: &str = "src/renderer/break/index.html";
const WATER_PAGE: &str = "src/renderer/water/index.html";
const TRAY_PAGE: &str = "src/renderer/tray/index.html";
const SETTINGS_PAGE: &str = "src/renderer/settings/index.html";
const REPORT_PAGE: &str = "src/renderer/report/index.html";

// If the page never reports back, close the break anyway.
const FAILSAFE_MS: i64 = 5000;
// A moment to push the chair back and stand before the timer starts.
const GET_UP_MS: i64 = 10 * 1000;
const PANEL_W: f64 = if cfg!(windows) { 320.0 } else { 300.0 };
const PANEL_H: f64 = 400.0;
const CLICK_THROUGH_MS: u128 = 250;
const WATER_W: f64 = 720.0;
// Linux can't pass clicks through a window, so there the water window only
// covers the bottom corner.
const CLICK_THROUGH: bool = !cfg!(target_os = "linux");

fn page<'a>(app: &'a AppHandle, label: &str, url: &str) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into())).initialization_script(BRIDGE)
}

fn hex(c: &str) -> Color {
    let n = u32::from_str_radix(c.trim_start_matches('#'), 16).unwrap_or(0);
    Color((n >> 16) as u8, (n >> 8) as u8, n as u8, 255)
}

/// Raises a window over full-screen apps, on the main thread.
fn raise(win: &WebviewWindow, screen_saver: bool) {
    #[cfg(target_os = "macos")]
    {
        let w = win.clone();
        let level = if screen_saver { crate::mac::SCREEN_SAVER_LEVEL } else { crate::mac::FLOATING_LEVEL };
        let _ = win.run_on_main_thread(move || crate::mac::raise(&w, level));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (win, screen_saver);
}

fn theme(app: &AppHandle) -> String {
    shared(app).core().settings.config().theme.clone()
}

// ---- Break screens: one per display ------------------------------------------------

// Screenshot runs can ask for a fixed size (STIP_SNAPSHOT_SIZE=1600x900) so
// pictures don't depend on the monitor they were taken on.
fn snapshot_size() -> Option<(f64, f64)> {
    let size = std::env::var("STIP_SNAPSHOT_SIZE").ok()?;
    let (w, h) = size.split_once('x')?;
    Some((w.parse().ok()?, h.parse().ok()?))
}

/// The primary display gets the timer and buttons; the others get a meme.
pub fn break_show(app: &AppHandle) {
    let s = shared(app);
    if s.ui().break_open {
        return;
    }
    let (stand, theme, snoozes_left) = {
        let c = s.core();
        let config = c.settings.config();
        (config.stand.clone(), config.theme.clone(), c.scheduler.snoozes_left())
    };
    let Ok(all) = app.available_monitors() else { return };
    let primary = app.primary_monitor().ok().flatten();
    let is_primary = |m: &tauri::Monitor| primary.as_ref().is_some_and(|p| p.position() == m.position() && p.size() == m.size());
    let mut displays: Vec<tauri::Monitor> = if stand.cover_all_displays { all } else { primary.clone().into_iter().collect() };
    // The primary display first, so it's the one that gets the timer.
    displays.sort_by_key(|m| !is_primary(m));
    if displays.is_empty() {
        return;
    }
    let starts_at = now_ms() + GET_UP_MS;
    let ends_at = starts_at + (stand.break_sec * 1000.0) as i64;
    let gen = {
        let mut ui = s.ui();
        ui.break_open = true;
        ui.break_gen += 1;
        if ui.meme_offset == 0 {
            ui.meme_offset = (now_ms() % 1000) as u64 + 1;
        }
        ui.meme_offset += displays.len() as u64 + 1;
        let offset = ui.meme_offset;
        for i in 0..displays.len() {
            ui.pending_show.insert(
                format!("break-{i}"),
                json!({
                    "role": if i == 0 { "main" } else { "meme" },
                    "startsAt": starts_at,
                    "endsAt": ends_at,
                    "breakSec": stand.break_sec,
                    "strictness": stand.strictness,
                    "snoozesLeft": snoozes_left,
                    "memeIndex": offset + i as u64,
                    "displayIndex": i + 1,
                    "displayCount": displays.len(),
                }),
            );
        }
        ui.break_gen
    };
    let background = hex(if theme == "aurora" { "#05070f" } else { "#141414" });
    for (i, m) in displays.iter().enumerate() {
        let scale = m.scale_factor();
        let pos = m.position().to_logical::<f64>(scale);
        let mut size = m.size().to_logical::<f64>(scale);
        if let Some((w, h)) = snapshot_size() {
            size = tauri::LogicalSize::new(w, h);
        }
        let Ok(win) = page(app, &format!("break-{i}"), BREAK_PAGE)
            .title("Stand break")
            .decorations(false)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .position(pos.x, pos.y)
            .inner_size(size.width, size.height)
            .background_color(background)
            .visible(false)
            .build()
        else {
            continue;
        };
        // Sit above full-screen apps, the dock and the menu bar.
        raise(&win, true);
        if s.hidden {
            continue;
        }
        let _ = win.show();
        if i == 0 {
            // Tray apps aren't active by default; take focus so Esc reaches us.
            let _ = win.set_focus();
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let wait = ends_at - now_ms() + FAILSAFE_MS;
        std::thread::sleep(Duration::from_millis(wait.max(0) as u64));
        break_finish(&app, "done", Some(gen));
    });
}

/// How the break ended: "done", "skip", "snooze" or "meeting". With a
/// generation, only that break (the failsafe for one that never answered).
pub fn break_finish(app: &AppHandle, how: &str, gen: Option<u64>) {
    {
        let s = shared(app);
        let mut ui = s.ui();
        if !ui.break_open || gen.is_some_and(|g| g != ui.break_gen) {
            return;
        }
        ui.break_open = false;
        ui.pending_show.retain(|k, _| !k.starts_with("break-"));
    }
    for (label, win) in app.webview_windows() {
        if label.starts_with("break-") {
            let _ = win.destroy();
        }
    }
    app::on_break_finished(app, how);
}

// ---- Water: transparent, and clicks pass through but for its buttons -------------

pub fn water_show(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(win) = app.get_webview_window("water") {
        return Some(win);
    }
    let m = app.primary_monitor().ok().flatten()?;
    let scale = m.scale_factor();
    let area = m.work_area();
    let pos = area.position.to_logical::<f64>(scale);
    let size = area.size.to_logical::<f64>(scale);
    // The window covers the whole screen so it can dim it.
    let (w, h) = if CLICK_THROUGH { (size.width, size.height) } else { (WATER_W, size.height.min(460.0)) };
    let s = shared(app);
    s.ui().pending_show.insert("water".into(), json!({}));
    s.ui().water_hit.clear();
    let win = page(app, "water", WATER_PAGE)
        .title("Water")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .position(pos.x + size.width - w, pos.y + size.height - h)
        .inner_size(w, h)
        .visible(false)
        .build()
        .ok()?;
    raise(&win, false);
    if CLICK_THROUGH {
        let _ = win.set_ignore_cursor_events(true);
        watch_pointer(app);
    }
    if !s.hidden {
        let _ = win.show();
    }
    Some(win)
}

// Tauri has no "forward" mode for ignored mouse events, so the page can't
// see hovers. Watch the pointer here and stop ignoring it over the buttons.
fn watch_pointer(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut over = false;
        loop {
            std::thread::sleep(Duration::from_millis(50));
            let Some(win) = app.get_webview_window("water") else { break };
            let now = over_hit(&app, &win);
            if now != over {
                over = now;
                let _ = win.set_ignore_cursor_events(!over);
                let _ = app.emit_to("water", "pointer", json!({ "over": over }));
            }
        }
    });
}

fn over_hit(app: &AppHandle, win: &WebviewWindow) -> bool {
    const PAD: f64 = 4.0;
    let (rects, fake) = {
        let s = shared(app);
        let ui = s.ui();
        (ui.water_hit.clone(), ui.fake_cursor)
    };
    let cursor = match fake {
        Some((x, y)) => Ok(tauri::PhysicalPosition::new(x, y)),
        None => app.cursor_position(),
    };
    let (Ok(cursor), Ok(origin), Ok(scale)) = (cursor, win.inner_position(), win.scale_factor()) else {
        return false;
    };
    let cx = (cursor.x - origin.x as f64) / scale;
    let cy = (cursor.y - origin.y as f64) / scale;
    rects.iter().any(|(x, y, w, h)| cx >= x - PAD && cx <= x + w + PAD && cy >= y - PAD && cy <= y + h + PAD)
}

pub fn water_hide(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("water") {
        let _ = win.destroy();
    }
    let s = shared(app);
    let mut ui = s.ui();
    ui.water_hit.clear();
    ui.pending_show.remove("water");
}

// ---- The tray panel --------------------------------------------------------------------

fn panel_color(win: &WebviewWindow) -> Color {
    let dark = win.theme().map(|t| t == tauri::Theme::Dark).unwrap_or(false);
    match (cfg!(windows), dark) {
        (true, true) => hex("#2c2c2c"),
        (true, false) => hex("#f9f9f9"),
        (false, true) => hex("#2a2a2c"),
        (false, false) => hex("#f6f6f6"),
    }
}

/// Built up front, so the first click opens it at once.
pub fn panel_build(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let win = page(app, "panel", TRAY_PAGE)
        .title("Stip")
        .decorations(false)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .shadow(true)
        .inner_size(PANEL_W, PANEL_H)
        .visible(false)
        .build()?;
    let _ = win.set_background_color(Some(panel_color(&win)));
    raise(&win, false);
    let handle = app.clone();
    win.on_window_event(move |e| match e {
        WindowEvent::Focused(false) => {
            let s = shared(&handle);
            let open = {
                let mut ui = s.ui();
                let open = ui.panel_open;
                ui.panel_open = false;
                if open {
                    ui.panel_hidden_at = Some(Instant::now());
                }
                open
            };
            if open {
                if let Some(p) = handle.get_webview_window("panel") {
                    let _ = p.hide();
                }
                let _ = handle.emit_to("panel", "show", json!({ "visible": false }));
            }
        }
        WindowEvent::ThemeChanged(_) => {
            if let Some(p) = handle.get_webview_window("panel") {
                let _ = p.set_background_color(Some(panel_color(&p)));
            }
        }
        _ => {}
    });
    Ok(win)
}

/// Opens or closes the panel by the tray icon. `tray` is the icon's place.
pub fn panel_toggle(app: &AppHandle, tray: Option<Rect>) {
    let Some(panel) = app.get_webview_window("panel") else { return };
    let s = shared(app);
    {
        let ui = s.ui();
        if ui.panel_open {
            drop(ui);
            panel_hide(app);
            return;
        }
        // Clicking the icon while open blurs the panel first; don't reopen it.
        if ui.panel_hidden_at.is_some_and(|t| t.elapsed().as_millis() < CLICK_THROUGH_MS) {
            return;
        }
    }
    s.ui().panel_open = true;
    let _ = app.emit_to("panel", "show", json!({ "visible": true }));
    let _ = app.emit_to("panel", "state", app::state(app));
    if s.hidden {
        return;
    }
    if let Some(pos) = panel_position(app, &panel, tray) {
        let _ = panel.set_position(pos);
    }
    let _ = panel.show();
    let _ = panel.set_focus();
}

pub fn panel_open(app: &AppHandle) {
    if !shared(app).ui().panel_open {
        shared(app).ui().panel_hidden_at = None;
        let rect = app.tray_by_id("main").and_then(|t| t.rect().ok().flatten());
        panel_toggle(app, rect);
    }
}

// Next to the tray icon, kept inside the screen's work area.
fn panel_position(app: &AppHandle, panel: &WebviewWindow, tray: Option<Rect>) -> Option<PhysicalPosition<i32>> {
    let scale = panel.scale_factor().unwrap_or(1.0);
    let size = panel.outer_size().ok()?;
    let (tx, ty, tw, th) = match tray {
        Some(r) => {
            let p = r.position.to_physical::<f64>(scale);
            let s = r.size.to_physical::<f64>(scale);
            (p.x, p.y, s.width, s.height)
        }
        None => {
            // No icon to go by (tests, a second launch): the top right corner.
            let m = app.primary_monitor().ok()??;
            let a = m.work_area();
            ((a.position.x + a.size.width as i32) as f64 - 120.0 * scale, a.position.y as f64 - 24.0 * scale, 24.0 * scale, 24.0 * scale)
        }
    };
    let monitor = app.monitor_from_point(tx, ty).ok().flatten().or_else(|| app.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    let (ax, ay, aw, ah) = (area.position.x as f64, area.position.y as f64, area.size.width as f64, area.size.height as f64);
    let (w, h) = (size.width as f64, size.height as f64);
    let gap = 6.0 * scale;
    let mut x = (tx + tw / 2.0 - w / 2.0).round();
    // Tray at the top (macOS, some Linux) opens down, otherwise up.
    let mut y = if ty < ay + ah / 2.0 { ay + gap } else { ay + ah - h - gap };
    let _ = th;
    x = x.max(ax + gap).min(ax + aw - w - gap);
    y = y.max(ay).min(ay + ah - h);
    Some(PhysicalPosition::new(x as i32, y as i32))
}

/// The page reports its height so the window fits it exactly.
pub fn panel_resize(app: &AppHandle, height: f64) {
    let Some(panel) = app.get_webview_window("panel") else { return };
    if height <= 0.0 {
        return;
    }
    let scale = panel.scale_factor().unwrap_or(1.0);
    let (Ok(size), Ok(pos)) = (panel.inner_size(), panel.outer_position()) else { return };
    let current = size.height as f64 / scale;
    if (current - height).abs() < 0.5 {
        return;
    }
    // A panel that opens upward keeps its bottom edge in place.
    let opens_up = shared(app).ui().panel_open
        && panel
            .current_monitor()
            .ok()
            .flatten()
            .is_some_and(|m| pos.y > m.work_area().position.y + (20.0 * scale) as i32);
    let _ = panel.set_size(LogicalSize::new(PANEL_W, height));
    if opens_up {
        let dy = ((height - current) * scale) as i32;
        let _ = panel.set_position(PhysicalPosition::new(pos.x, pos.y - dy));
    }
}

pub fn panel_hide(app: &AppHandle) {
    let was_open = {
        let s = shared(app);
        let mut ui = s.ui();
        std::mem::replace(&mut ui.panel_open, false)
    };
    if let Some(p) = app.get_webview_window("panel") {
        let _ = p.hide();
    }
    if was_open {
        let _ = app.emit_to("panel", "show", json!({ "visible": false }));
    }
}

/// macOS shows a word or the countdown right in the menu bar. This runs
/// every second, so it only touches the system when the text changes.
pub fn set_tray_title(app: &AppHandle, (title, tooltip): (String, String)) {
    let s = shared(app);
    {
        let mut ui = s.ui();
        if ui.title.as_ref() == Some(&(title.clone(), tooltip.clone())) {
            return;
        }
        ui.title = Some((title.clone(), tooltip.clone()));
    }
    let Some(tray) = app.tray_by_id("main") else { return };
    if cfg!(target_os = "macos") {
        let _ = tray.set_title(Some(title));
    }
    let _ = tray.set_tooltip(Some(tooltip));
}

// ---- Settings and the report: ordinary windows ----------------------------------------

// A tray app has no dock icon; show one while these windows are open so
// they can be found with Cmd+Tab.
fn dock(app: &AppHandle, show: bool) {
    #[cfg(target_os = "macos")]
    {
        let policy = if show { tauri::ActivationPolicy::Regular } else { tauri::ActivationPolicy::Accessory };
        let _ = app.set_activation_policy(policy);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, show);
}

fn window(app: &AppHandle, label: &str, url: &str, title: &str, size: (f64, f64), min: (f64, f64), background: &str) -> Option<WebviewWindow> {
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.set_focus();
        return Some(win);
    }
    let hidden = shared(app).hidden;
    let builder = page(app, label, url)
        .title(title)
        .inner_size(size.0, size.1)
        .min_inner_size(min.0, min.1)
        .background_color(hex(background))
        .visible(false);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(20.0, 22.0));
    let win = builder.build().ok()?;
    if !hidden {
        dock(app, true);
    }
    let handle = app.clone();
    win.on_window_event(move |e| {
        if let WindowEvent::Destroyed = e {
            let others = ["settings", "report"].iter().any(|l| handle.get_webview_window(l).is_some());
            if !others {
                dock(&handle, false);
            }
        }
    });
    if !hidden {
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
    }
    Some(win)
}

pub fn settings_open(app: &AppHandle, page: Option<&str>) -> Option<WebviewWindow> {
    let background = if theme(app) == "aurora" { "#0c111e" } else { "#f3f0e8" };
    let win = window(app, "settings", SETTINGS_PAGE, "Stip settings", (1120.0, 760.0), (760.0, 560.0), background)?;
    // settings.water opens straight on the Water page.
    if let Some(page) = page {
        let w = win.clone();
        let page = page.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(800));
            let _ = w.eval(format!("document.querySelector('.nav[data-page=\"{page}\"]')?.click()"));
        });
    }
    Some(win)
}

pub fn report_open(app: &AppHandle) -> Option<WebviewWindow> {
    let background = if theme(app) == "aurora" { "#0c111e" } else { "#141414" };
    window(app, "report", REPORT_PAGE, "Spine report", (1080.0, 780.0), (860.0, 620.0), background)
}

/// A PNG of a window's page.
pub fn snapshot(win: &WebviewWindow) -> Option<Vec<u8>> {
    #[cfg(target_os = "macos")]
    return crate::mac::snapshot(win);
    #[cfg(not(target_os = "macos"))]
    {
        // TODO: WebView2's CapturePreview on Windows, WebKitGTK's snapshot on Linux.
        let _ = win;
        None
    }
}

pub fn report_copy(app: &AppHandle) {
    let Some(win) = app.get_webview_window("report") else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(png) = snapshot(&win) else { return };
        #[cfg(target_os = "macos")]
        let _ = app.run_on_main_thread(move || {
            crate::mac::copy_png(&png);
        });
        #[cfg(not(target_os = "macos"))]
        let _ = (app, png);
    });
}

pub fn report_save(app: &AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    let Some(win) = app.get_webview_window("report") else { return };
    let Some(png) = snapshot(&win) else { return };
    let desktop = app.path().desktop_dir().unwrap_or_else(|_| crate::cli::home());
    let picked = app
        .dialog()
        .file()
        .set_parent(&win)
        .set_directory(desktop)
        .set_file_name("spine-report.png")
        .add_filter("PNG image", &["png"])
        .blocking_save_file();
    if let Some(path) = picked.and_then(|p| p.into_path().ok()) {
        let _ = std::fs::write(path, png);
    }
}

pub fn pick_folder(app: &AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_title("Choose a project folder");
    if let Some(win) = app.get_webview_window("report") {
        dialog = dialog.set_parent(&win);
    }
    let folder = dialog.blocking_pick_folder()?;
    folder.into_path().ok().map(|p| p.display().to_string())
}

// ---- Commands the pages call ------------------------------------------------------------

#[tauri::command]
pub fn state(app: AppHandle) -> Value {
    app::state(&app)
}

#[tauri::command]
pub async fn report(app: AppHandle) -> Value {
    tauri::async_runtime::spawn_blocking(move || app::report_data(&app)).await.unwrap_or(Value::Null)
}

#[tauri::command]
pub fn act(app: AppHandle, name: String, payload: Option<Value>) {
    app::queue(&app, &name, payload.unwrap_or(Value::Null));
}

#[tauri::command]
pub fn pending_show(app: AppHandle, webview: WebviewWindow) -> Value {
    shared(&app).ui().pending_show.remove(webview.label()).unwrap_or(Value::Null)
}

#[derive(serde::Deserialize)]
pub struct HitRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[tauri::command]
pub fn water_hit(app: AppHandle, rects: Vec<HitRect>) {
    shared(&app).ui().water_hit = rects.into_iter().map(|r| (r.x, r.y, r.w, r.h)).collect();
}

#[tauri::command]
pub fn probe_dom(app: AppHandle, webview: WebviewWindow, info: Value) {
    shared(&app).ui().probe.insert(webview.label().to_string(), info);
}
