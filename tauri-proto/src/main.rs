// Prototype: checks the parts of Stip that are hard to do in Tauri before
// porting the whole app. Run with `cargo run`, or `STIP_PROBE=1 cargo run`
// to run every check on its own and print a JSON report.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, Position, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

const PANEL_W: f64 = 300.0;
const PANEL_H: f64 = 360.0;

#[derive(Default)]
struct State {
    // Clickable area of the water window, in CSS pixels from its top-left.
    water_hit: Mutex<Option<(f64, f64, f64, f64)>>,
    panel_hidden_at: Mutex<Option<Instant>>,
}

// ---- macOS: sit above full-screen apps on every Space ----------------------

#[cfg(target_os = "macos")]
mod mac {
    use objc2::{msg_send, runtime::AnyObject};

    pub const SCREEN_SAVER_LEVEL: isize = 1000;
    pub const FLOATING_LEVEL: isize = 3;
    // CanJoinAllSpaces | Stationary | FullScreenAuxiliary
    const BEHAVIOR: usize = (1 << 0) | (1 << 4) | (1 << 8);

    pub fn raise(win: &tauri::WebviewWindow, level: isize) {
        let Ok(ptr) = win.ns_window() else { return };
        let ns = ptr as *mut AnyObject;
        unsafe {
            let _: () = msg_send![ns, setLevel: level];
            let _: () = msg_send![ns, setCollectionBehavior: BEHAVIOR];
        }
    }

    pub fn describe(win: &tauri::WebviewWindow) -> (isize, usize) {
        let Ok(ptr) = win.ns_window() else { return (-1, 0) };
        let ns = ptr as *mut AnyObject;
        unsafe {
            let level: isize = msg_send![ns, level];
            let behavior: usize = msg_send![ns, collectionBehavior];
            (level, behavior)
        }
    }
}

fn raise(win: &WebviewWindow, screen_saver: bool) {
    #[cfg(target_os = "macos")]
    {
        let w = win.clone();
        let level = if screen_saver { mac::SCREEN_SAVER_LEVEL } else { mac::FLOATING_LEVEL };
        let _ = win.run_on_main_thread(move || mac::raise(&w, level));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (win, screen_saver);
    }
}

// ---- Break overlays: one window per display --------------------------------

#[tauri::command]
fn show_break(app: AppHandle) -> Result<usize, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    for (i, m) in monitors.iter().enumerate() {
        let label = format!("break-{i}");
        if app.get_webview_window(&label).is_some() {
            continue;
        }
        let scale = m.scale_factor();
        let pos = m.position().to_logical::<f64>(scale);
        let size = m.size().to_logical::<f64>(scale);
        let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("break.html".into()))
            .title("Stip break")
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .position(pos.x, pos.y)
            .inner_size(size.width, size.height)
            .background_color(tauri::window::Color(5, 7, 15, 255))
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
        raise(&win, true);
        let _ = win.show();
        if i == 0 {
            let _ = win.set_focus();
        }
    }
    Ok(monitors.len())
}

#[tauri::command]
fn end_break(app: AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with("break-") {
            let _ = win.destroy();
        }
    }
}

// ---- Water: transparent, click-through except over its buttons -------------

#[tauri::command]
fn show_water(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window("water").is_some() {
        return Ok(());
    }
    let m = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("no monitor")?;
    let scale = m.scale_factor();
    let area = m.work_area();
    let pos = area.position.to_logical::<f64>(scale);
    let size = area.size.to_logical::<f64>(scale);
    let win = WebviewWindowBuilder::new(&app, "water", WebviewUrl::App("water.html".into()))
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .position(pos.x, pos.y)
        .inner_size(size.width, size.height)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    raise(&win, false);
    win.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
    let _ = win.show();

    // Tauri has no "forward" mode for ignored mouse events, so the page can't
    // see hovers. Watch the cursor here and stop ignoring it over the buttons.
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut ignoring = true;
        loop {
            std::thread::sleep(Duration::from_millis(60));
            let Some(win) = handle.get_webview_window("water") else { break };
            let over = over_hit(&handle, &win);
            if over == ignoring {
                ignoring = !over;
                let _ = win.set_ignore_cursor_events(ignoring);
            }
        }
    });
    Ok(())
}

fn over_hit(app: &AppHandle, win: &WebviewWindow) -> bool {
    let Some((x, y, w, h)) = *app.state::<State>().water_hit.lock().unwrap() else {
        return false;
    };
    let (Ok(cursor), Ok(origin), Ok(scale)) =
        (app.cursor_position(), win.inner_position(), win.scale_factor())
    else {
        return false;
    };
    let cx = (cursor.x - origin.x as f64) / scale;
    let cy = (cursor.y - origin.y as f64) / scale;
    cx >= x && cx <= x + w && cy >= y && cy <= y + h
}

#[tauri::command]
fn water_hit(state: tauri::State<State>, x: f64, y: f64, w: f64, h: f64) {
    *state.water_hit.lock().unwrap() = Some((x, y, w, h));
}

#[tauri::command]
fn hide_water(app: AppHandle) {
    if let Some(win) = app.get_webview_window("water") {
        let _ = win.destroy();
    }
}

// ---- Idle time ---------------------------------------------------------------

#[tauri::command]
fn idle_seconds() -> Result<u64, String> {
    user_idle::UserIdle::get_time()
        .map(|t| t.as_seconds())
        .map_err(|e| e.to_string())
}

// ---- Tray panel ----------------------------------------------------------------

fn build_panel(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let win = WebviewWindowBuilder::new(app, "panel", WebviewUrl::App("panel.html".into()))
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .inner_size(PANEL_W, PANEL_H)
        .visible(false)
        .build()?;
    raise(&win, false);
    let handle = app.clone();
    win.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            if let Some(p) = handle.get_webview_window("panel") {
                let _ = p.hide();
                *handle.state::<State>().panel_hidden_at.lock().unwrap() = Some(Instant::now());
            }
        }
    });
    Ok(win)
}

fn toggle_panel(app: &AppHandle, tray: Rect) {
    let Some(panel) = app.get_webview_window("panel") else { return };
    if panel.is_visible().unwrap_or(false) {
        let _ = panel.hide();
        return;
    }
    // Clicking the icon while the panel is open blurs it first; don't reopen.
    if let Some(t) = *app.state::<State>().panel_hidden_at.lock().unwrap() {
        if t.elapsed() < Duration::from_millis(250) {
            return;
        }
    }
    let scale = panel.scale_factor().unwrap_or(1.0);
    let (tp, ts) = match (tray.position, tray.size) {
        (Position::Physical(p), tauri::Size::Physical(s)) => (p, s),
        (p, s) => (p.to_physical(scale), s.to_physical(scale)),
    };
    let w = (PANEL_W * scale) as i32;
    let h = (PANEL_H * scale) as i32;
    let x = tp.x + ts.width as i32 / 2 - w / 2;
    // Below the menu bar on macOS; above the taskbar elsewhere.
    let y = if cfg!(target_os = "macos") { tp.y + ts.height as i32 + 4 } else { tp.y - h - 4 };
    let _ = panel.set_position(PhysicalPosition::new(x.max(0), y.max(0)));
    let _ = panel.show();
    let _ = panel.set_focus();
}

// ---- Probe: run every check and print a report ---------------------------------

fn probe(app: AppHandle) {
    std::thread::spawn(move || {
        let mut out = serde_json::Map::new();
        let t = Instant::now();
        let shown = show_break(app.clone());
        out.insert("break_show_ms".into(), (t.elapsed().as_millis() as u64).into());
        out.insert("monitors".into(), format!("{shown:?}").into());
        std::thread::sleep(Duration::from_millis(1500));
        let _ = std::process::Command::new("screencapture")
            .args(["-x", "/tmp/stip-proto-break.png"])
            .status();
        let mut wins = vec![];
        for (label, win) in app.webview_windows() {
            if !label.starts_with("break-") {
                continue;
            }
            let mut w = serde_json::Map::new();
            w.insert("label".into(), label.clone().into());
            w.insert("visible".into(), win.is_visible().unwrap_or(false).into());
            w.insert("pos".into(), format!("{:?}", win.outer_position().ok()).into());
            w.insert("size".into(), format!("{:?}", win.outer_size().ok()).into());
            #[cfg(target_os = "macos")]
            {
                let (tx, rx) = std::sync::mpsc::channel();
                let c = win.clone();
                let _ = win.run_on_main_thread(move || {
                    let _ = tx.send(mac::describe(&c));
                });
                if let Ok((level, behavior)) = rx.recv_timeout(Duration::from_secs(2)) {
                    w.insert("level".into(), level.into());
                    w.insert("behavior".into(), behavior.into());
                }
            }
            wins.push(serde_json::Value::Object(w));
        }
        out.insert("break_windows".into(), wins.into());
        end_break(app.clone());

        let t = Instant::now();
        out.insert("water".into(), format!("{:?}", show_water(app.clone())).into());
        out.insert("water_show_ms".into(), (t.elapsed().as_millis() as u64).into());
        std::thread::sleep(Duration::from_millis(1500));
        let _ = std::process::Command::new("screencapture")
            .args(["-x", "/tmp/stip-proto-water.png"])
            .status();
        out.insert(
            "water_hit".into(),
            format!("{:?}", *app.state::<State>().water_hit.lock().unwrap()).into(),
        );
        hide_water(app.clone());

        out.insert("idle".into(), format!("{:?}", idle_seconds()).into());

        let t = Instant::now();
        if let Some(p) = app.get_webview_window("panel") {
            let _ = p.set_position(PhysicalPosition::new(800, 60));
            let _ = p.show();
            out.insert("panel_show_ms".into(), (t.elapsed().as_millis() as u64).into());
            std::thread::sleep(Duration::from_millis(800));
            let _ = std::process::Command::new("screencapture")
                .args(["-x", "/tmp/stip-proto-panel.png"])
                .status();
            out.insert("panel_visible".into(), p.is_visible().unwrap_or(false).into());
        }
        println!("PROBE {}", serde_json::Value::Object(out));
        app.exit(0);
    });
}

fn main() {
    tauri::Builder::default()
        .manage(State::default())
        .invoke_handler(tauri::generate_handler![
            show_break,
            end_break,
            show_water,
            hide_water,
            water_hit,
            idle_seconds
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Built up front, so the first click shows it at once.
            build_panel(app.handle())?;

            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("Stip prototype")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = e
                    {
                        toggle_panel(tray.app_handle(), rect);
                    }
                })
                .build(app)?;

            if std::env::var("STIP_PROBE").is_ok() {
                probe(app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running prototype");
}
