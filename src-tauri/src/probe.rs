// A self-check: STIP_PROBE=1 runs each part of the app once, the way a person
// would, checks what happened, prints a JSON report and quits. Run it with
// STIP_USER_DATA (and STIP_SOCKET) pointing somewhere disposable.
// Also --show=<view> and STIP_SNAPSHOT=<file>, for screenshots.
use crate::app::{self, shared};
use crate::windows;
use serde_json::{json, Map, Value};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewWindow};

fn sleep(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

fn screenshot(name: &str) -> Value {
    let Ok(dir) = std::env::var("STIP_PROBE_SHOTS") else { return Value::Null };
    let path = format!("{dir}/{name}.png");
    #[cfg(target_os = "macos")]
    let ok = std::process::Command::new("screencapture").args(["-x", &path]).status().is_ok_and(|s| s.success());
    #[cfg(not(target_os = "macos"))]
    let ok = false;
    if ok { json!(path) } else { Value::Null }
}

/// Asks a page what it shows: its title and the start of its text.
fn dom(app: &AppHandle, label: &str, extra: &str) -> Value {
    let Some(win) = app.get_webview_window(label) else { return json!("no window") };
    shared(app).ui().probe.remove(label);
    let js = format!(
        "window.__TAURI__.core.invoke('probe_dom', {{ info: {{ title: document.title, stip: typeof window.stip, \
         text: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 240), extra: (() => {{ try {{ return {extra}; }} catch (e) {{ return String(e); }} }})() }} }})"
    );
    let _ = win.eval(js);
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(3) {
        if let Some(info) = shared(app).ui().probe.remove(label) {
            return info;
        }
        sleep(50);
    }
    json!("no answer")
}

#[cfg(target_os = "macos")]
fn level(win: &WebviewWindow) -> Value {
    let (tx, rx) = std::sync::mpsc::channel();
    let w = win.clone();
    let _ = win.run_on_main_thread(move || {
        let _ = tx.send(crate::mac::describe(&w));
    });
    rx.recv_timeout(Duration::from_secs(2)).unwrap_or(Value::Null)
}

#[cfg(not(target_os = "macos"))]
fn level(_: &WebviewWindow) -> Value {
    Value::Null
}

fn today(app: &AppHandle) -> Value {
    app::state(app)["today"].clone()
}

fn check(out: &mut Map<String, Value>, failures: &mut Vec<String>, name: &str, ok: bool, detail: Value) {
    if !ok {
        failures.push(name.to_string());
    }
    out.insert(name.into(), json!({ "ok": ok, "detail": detail }));
}

pub fn run(app: AppHandle) {
    std::thread::spawn(move || {
        let mut out = Map::new();
        let mut failures = vec![];
        sleep(1500);

        // Break: every display covered, above everything, and finishing counts.
        let before = today(&app)["breaks"].as_u64().unwrap_or(0);
        let started = Instant::now();
        app::handle_action(&app, "stand-now", &Value::Null);
        let shown_ms = started.elapsed().as_millis() as u64;
        sleep(2500);
        let monitors = app.available_monitors().map(|m| m.len()).unwrap_or(0);
        let breaks: Vec<(String, WebviewWindow)> = app.webview_windows().into_iter().filter(|(l, _)| l.starts_with("break-")).collect();
        let windows_info: Vec<Value> = breaks
            .iter()
            .map(|(label, w)| json!({ "label": label, "visible": w.is_visible().unwrap_or(false), "mac": level(w) }))
            .collect();
        let main = dom(&app, "break-0", "document.getElementById('main-view').hidden === false");
        let shot = screenshot("break");
        let on_break = app::state(&app)["status"]["onBreak"].as_bool().unwrap_or(false);
        check(
            &mut out,
            &mut failures,
            "break_shows",
            on_break && breaks.len() == monitors.max(1) && main["extra"] == true,
            json!({ "monitors": monitors, "windows": windows_info, "page": main, "show_ms": shown_ms, "shot": shot }),
        );
        let key = breaks.first().map(|(_, w)| level(w)).unwrap_or(Value::Null);
        check(&mut out, &mut failures, "break_has_keyboard", key["key"] == true || !cfg!(target_os = "macos"), key);
        app::handle_action(&app, "break-finish", &json!({ "how": "done" }));
        sleep(500);
        let after = today(&app)["breaks"].as_u64().unwrap_or(0);
        let left = app.webview_windows().keys().filter(|l| l.starts_with("break-")).count();
        check(&mut out, &mut failures, "break_finishes", after == before + 1 && left == 0, json!({ "breaks": [before, after], "windows_left": left }));

        // Water: transparent, reports its buttons, and logging a sip counts.
        let glasses = today(&app)["glasses"].as_u64().unwrap_or(0);
        app::handle_action(&app, "water-now", &Value::Null);
        sleep(2500);
        let hit = shared(&app).ui().water_hit.clone();
        let page = dom(&app, "water", "document.getElementById('count').textContent");
        let shot = screenshot("water");
        let water = app.get_webview_window("water");
        let mac = water.as_ref().map(level).unwrap_or(Value::Null);
        check(&mut out, &mut failures, "water_shows", water.is_some() && !hit.is_empty() && page["stip"] == "object", json!({ "hit": hit, "page": page, "mac": mac, "shot": shot }));
        // The pointer over the card turns clicks on; leaving turns them off
        // and the page hears it leave. A stand-in pointer, so the real one
        // stays where the user left it.
        let hover = water.as_ref().and_then(|w| {
            let origin = w.inner_position().ok()?;
            let scale = w.scale_factor().ok()?;
            let (x, y, wd, ht) = *hit.first()?;
            let inside = (origin.x as f64 + (x + wd / 2.0) * scale, origin.y as f64 + (y + ht / 2.0) * scale);
            shared(&app).ui().fake_cursor = Some(inside);
            sleep(300);
            let over = level(w);
            let _ = w.eval("document.querySelector('.interactive').dispatchEvent(new MouseEvent('mouseenter'))");
            shared(&app).ui().fake_cursor = Some((origin.x as f64 + 5.0, origin.y as f64 + 5.0));
            sleep(300);
            let away = level(w);
            shared(&app).ui().fake_cursor = None;
            Some(json!({ "over": over["ignoresMouse"], "away": away["ignoresMouse"] }))
        });
        check(&mut out, &mut failures, "water_click_through", hover.as_ref().is_some_and(|h| h["over"] == false && h["away"] == true) || !cfg!(target_os = "macos"), json!(hover));
        // The button's own handler logs the sip and closes the reminder.
        if let Some(w) = &water {
            let _ = w.eval("document.getElementById('sipped').click()");
        }
        sleep(2800);
        sleep(300);
        let now = today(&app)["glasses"].as_u64().unwrap_or(0);
        check(&mut out, &mut failures, "water_sip", now == glasses + 1 && app.get_webview_window("water").is_none(), json!({ "glasses": [glasses, now] }));
        if app.get_webview_window("water").is_some() {
            app::handle_action(&app, "water-close", &Value::Null);
        }

        // Tray panel: opens with the state, fits its content, hides again.
        let tray = app.tray_by_id("main").and_then(|t| t.rect().ok().flatten());
        windows::panel_toggle(&app, tray);
        sleep(1200);
        let placed = app.get_webview_window("panel").and_then(|p| p.outer_position().ok()).map(|p| json!([p.x, p.y]));
        let tray_at = tray.map(|r| { let p = r.position.to_physical::<f64>(1.0); json!([p.x, p.y]) });
        let page = dom(&app, "panel", "document.getElementById('status-text').textContent");
        let size = app.get_webview_window("panel").and_then(|p| p.inner_size().ok()).map(|s| json!([s.width, s.height]));
        let shot = screenshot("panel");
        let visible = app.get_webview_window("panel").is_some_and(|p| p.is_visible().unwrap_or(false));
        check(&mut out, &mut failures, "panel_shows", visible && page["extra"].as_str().is_some_and(|t| !t.is_empty()), json!({ "page": page, "size": size, "placed": placed, "tray": tray_at, "shot": shot }));
        // Clicking anywhere else closes it, as a menu does.
        let other = windows::settings_open(&app, None);
        sleep(800);
        let open_after_blur = shared(&app).ui().panel_open;
        let hidden = app.get_webview_window("panel").is_some_and(|p| !p.is_visible().unwrap_or(true));
        check(&mut out, &mut failures, "panel_hides_on_blur", !open_after_blur && hidden, json!({ "hidden": hidden }));
        // Clicking the icon while it's open blurs it first; that click
        // mustn't reopen it.
        windows::panel_toggle(&app, tray);
        sleep(600);
        if let Some(w) = app.get_webview_window("settings") {
            let _ = w.set_focus();
        }
        let started = Instant::now();
        while shared(&app).ui().panel_open && started.elapsed() < Duration::from_secs(2) {
            sleep(5);
        }
        windows::panel_toggle(&app, tray);
        let reopened = shared(&app).ui().panel_open;
        check(&mut out, &mut failures, "panel_click_guard", !reopened, json!("a click right after closing doesn't reopen it"));
        windows::panel_hide(&app);
        if let Some(w) = other {
            let _ = w.destroy();
        }
        sleep(300);

        // Settings: the page loads its state, and a change is saved.
        windows::settings_open(&app, None);
        sleep(2000);
        let page = dom(&app, "settings", "document.querySelectorAll('.nav').length");
        let shot = screenshot("settings");
        let every = app::state(&app)["settings"]["stand"]["everyMin"].clone();
        app::handle_action(&app, "settings-set", &json!({ "stand": { "everyMin": 31 } }));
        let saved = std::fs::read_to_string(shared(&app).dir.join("settings.json")).unwrap_or_default();
        let saved_ok = serde_json::from_str::<Value>(&saved).is_ok_and(|v| v["stand"]["everyMin"] == 31);
        app::handle_action(&app, "settings-set", &json!({ "stand": { "everyMin": every } }));
        check(&mut out, &mut failures, "settings", page["extra"].as_u64().unwrap_or(0) > 0 && saved_ok, json!({ "page": page, "saved": saved_ok, "shot": shot }));
        if let Some(w) = app.get_webview_window("settings") {
            let _ = w.destroy();
        }

        // Spine report: the page renders a verdict, and a picture can be taken.
        windows::report_open(&app);
        sleep(2500);
        let page = dom(&app, "report", "document.body.className + ' ' + (document.getElementById('verdict')?.textContent || '')");
        let shot = screenshot("report");
        let png = app.get_webview_window("report").and_then(|w| windows::snapshot(&w));
        let png_ok = png.as_ref().is_some_and(|p| p.starts_with(b"\x89PNG"));
        if let (Some(png), Ok(dir)) = (&png, std::env::var("STIP_PROBE_SHOTS")) {
            let _ = std::fs::write(format!("{dir}/report-snapshot.png"), png);
        }
        check(&mut out, &mut failures, "report", page["stip"] == "object" && png_ok, json!({ "page": page, "snapshot_bytes": png.map(|p| p.len()), "shot": shot }));
        if let Some(w) = app.get_webview_window("report") {
            let _ = w.destroy();
        }

        // The terminal command, through the socket.
        if !shared(&app).sandboxed && std::env::var_os("STIP_SOCKET").is_some() {
            sleep(200);
            let socket = crate::cli::socket_path();
            let status = crate::cli::send(&json!({ "command": "status" }), &socket);
            let sip = crate::cli::send(&json!({ "command": "sip" }), &socket);
            let ok = status.as_ref().is_ok_and(|s| s["status"]["msToStand"].is_number())
                && sip.as_ref().is_ok_and(|s| s["message"].as_str().is_some_and(|m| m.starts_with("Logged.")));
            check(&mut out, &mut failures, "cli", ok, json!({ "status": status.map(|s| crate::cli::describe(&s)).map_err(|e| e.to_string()), "sip": sip.map_err(|e| e.to_string()) }));
        }

        out.insert("idle_sec".into(), json!(user_idle::UserIdle::get_time().map(|t| t.as_seconds()).ok()));
        out.insert("failures".into(), json!(failures));
        let report = Value::Object(out);
        println!("PROBE {report}");
        if let Ok(file) = std::env::var("STIP_PROBE_OUT") {
            let _ = std::fs::write(file, serde_json::to_string_pretty(&report).unwrap());
        }
        crate::cli_server::cleanup();
        app.exit(if failures.is_empty() { 0 } else { 1 });
    });
}

/// --show=<view>[:theme] opens one view at once; with STIP_SNAPSHOT=<file> it
/// saves a picture of it and quits.
pub fn show_requested_view(app: AppHandle, view: String) {
    std::thread::spawn(move || {
        sleep(300);
        let (name, theme) = view.split_once(':').map(|(n, t)| (n.to_string(), Some(t.to_string()))).unwrap_or((view.clone(), None));
        if let Some(theme) = theme {
            shared(&app).core().settings.set(&json!({ "theme": theme }));
        }
        let win = match name.as_str() {
            "break" => {
                app::handle_action(&app, "stand-now", &Value::Null);
                app.get_webview_window("break-0")
            }
            "water" => windows::water_show(&app),
            "report" => windows::report_open(&app),
            n if n.starts_with("settings") => windows::settings_open(&app, n.split('.').nth(1)),
            n => {
                // tray.meeting opens the tray with meeting mode on.
                if n == "tray.meeting" {
                    shared(&app).core().meeting.set_manual(true, app::now_ms());
                }
                windows::panel_open(&app);
                app.get_webview_window("panel")
            }
        };
        let Ok(file) = std::env::var("STIP_SNAPSHOT") else { return };
        let delay = std::env::var("STIP_SNAPSHOT_DELAY").ok().and_then(|d| d.parse().ok()).unwrap_or(1500);
        sleep(delay);
        if let Some(png) = win.as_ref().and_then(windows::snapshot) {
            let _ = std::fs::write(&file, png);
        } else {
            eprintln!("stip: couldn't take a picture of {name}");
        }
        crate::cli_server::cleanup();
        app.exit(0);
    });
}
