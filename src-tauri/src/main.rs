// Stip: stand up and drink water. A tray app; see app.rs for what it does.
//
//   stip                  run the app
//   stip --cli <command>  the terminal command (what `stip` in a shell runs)
//   stip --show=<view>    open a view at once: break, water, tray, settings[.page], report
//   STIP_PROBE=1 stip     run every part once, print a JSON report and quit
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod characters;
mod cli;
mod cli_server;
mod flow;
mod git_history;
#[cfg(target_os = "macos")]
mod mac;
mod meeting;
mod probe;
mod report;
mod scheduler;
mod store;
mod windows;

use app::{Core, Shared, Ui};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

fn requested_view() -> Option<String> {
    std::env::args().find_map(|a| a.strip_prefix("--show=").map(str::to_string))
}

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id: &str, label: &str| MenuItem::with_id(app, id, label, true, None::<&str>);
    Menu::with_items(
        app,
        &[
            &item("open", "Open Stip")?,
            &item("stand-now", "Stand now")?,
            &item("water-now", "Water reminder now")?,
            &item("sip", "Log a sip")?,
            &item("pause-60", "Pause for 1 hour")?,
            &PredefinedMenuItem::separator(app)?,
            &item("report-open", "This week's report")?,
            &item("settings", "Settings")?,
            &item("quit", "Quit Stip")?,
        ],
    )
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = if cfg!(target_os = "macos") {
        tauri::image::Image::from_bytes(include_bytes!("../icons/trayTemplate@2x.png"))?
    } else {
        tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?
    };
    let menu = tray_menu(app)?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Stip")
        .menu(&menu)
        // Many Linux trays only support a menu, so there the click opens it.
        .show_menu_on_left_click(cfg!(target_os = "linux"))
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => windows::panel_open(app),
            "pause-60" => app::queue(app, "pause", serde_json::json!({ "minutes": 60 })),
            other => app::queue(app, other, serde_json::Value::Null),
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                windows::panel_toggle(tray.app_handle(), Some(rect));
            }
        })
        .build(app)?;
    Ok(())
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let handle = app.handle().clone();
    let dir = app::data_dir(&handle);
    let settings = store::Settings::new(&dir);
    let stats = store::Stats::new(&dir);
    let scheduler = scheduler::Scheduler::new(settings.config().clone(), app::now_ms());
    let sandboxed = app::is_sandboxed();
    let probe = std::env::var_os("STIP_PROBE").is_some();
    let hidden = !probe && (std::env::var_os("STIP_SNAPSHOT").is_some() || std::env::var_os("STIP_HIDDEN").is_some());
    app.manage(Shared {
        core: Mutex::new(Core {
            settings,
            stats,
            scheduler,
            meeting: meeting::Meeting::default(),
            flow: flow::Flow::default(),
            cli_install: None,
        }),
        ui: Mutex::new(Ui::default()),
        dir,
        sandboxed,
        hidden,
        actions: Mutex::new(None),
    });

    app::start_action_worker(&handle);
    windows::panel_build(&handle)?;
    build_tray(&handle)?;

    // Test and snapshot runs keep their hands off the real command's socket,
    // and the Mac App Store sandbox can't install a command at all.
    let own_data = std::env::var_os("STIP_USER_DATA").is_some();
    if !sandboxed && (!own_data || std::env::var_os("STIP_SOCKET").is_some()) {
        cli_server::start(&handle, cli::socket_path());
    }

    app::start_process_watch(&handle);
    app::start_clock(&handle);

    if probe {
        probe::run(handle.clone());
    } else if let Some(view) = requested_view() {
        probe::show_requested_view(handle.clone(), view);
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--cli") {
        #[cfg(windows)]
        unsafe {
            // A GUI program has no console of its own; borrow the terminal's.
            windows_sys::Win32::System::Console::AttachConsole(windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS);
        }
        std::process::exit(cli::main(args[1..].to_vec()));
    }

    tauri::Builder::default()
        // Stip lives in the tray, so only one copy runs. Opening it again
        // shows the panel.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| windows::panel_open(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![
            windows::state,
            windows::report,
            windows::act,
            windows::pending_show,
            windows::water_hit,
            windows::probe_dom,
        ])
        .setup(setup)
        .build(tauri::generate_context!())
        .expect("error while starting Stip")
        .run(|_app, event| {
            // Keep running in the tray when windows close.
            match event {
                tauri::RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
                tauri::RunEvent::Exit => cli_server::cleanup(),
                _ => {}
            }
        });
}
