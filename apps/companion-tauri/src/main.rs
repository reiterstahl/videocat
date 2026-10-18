// VideoCAT Companion for Windows, Tauri shell (phase 0 proof of concept, see
// COMPANION_TAURI_PLAN.es.md). It shows the tray icon and menu and runs the same Node agent,
// packed as one executable (videocat-agent.exe) beside this one. The agent closes on its own
// if this process goes away (VIDEOCAT_PARENT_WATCH), so it never outlives the tray.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent};

struct Agent(Mutex<Option<Child>>);

fn agent_path() -> PathBuf {
    let name = if cfg!(windows) { "videocat-agent.exe" } else { "videocat-agent" };
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(name)))
        .unwrap_or_else(|| PathBuf::from(name))
}

// Where the agent's output goes while there is no Actividad window yet (phase 2 brings it).
fn log_path() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("VideoCAT").join("companion-tauri.log")
}

fn append_log(log: &Arc<Mutex<Option<std::fs::File>>>, source: &str, line: &str) {
    if let Ok(mut guard) = log.lock() {
        if let Some(file) = guard.as_mut() {
            let _ = writeln!(file, "[{source}] {line}");
        }
    }
}

fn start_agent() -> Option<Child> {
    let log_file = log_path();
    if let Some(dir) = log_file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let log = Arc::new(Mutex::new(OpenOptions::new().create(true).append(true).open(&log_file).ok()));

    let mut command = Command::new(agent_path());
    command
        .arg("companion")
        .env("VIDEOCAT_PARENT_WATCH", "1")
        .env("UV_THREADPOOL_SIZE", std::env::var("UV_THREADPOOL_SIZE").unwrap_or_else(|_| "16".into()))
        // Kept open: the agent leaves when this pipe closes, that is, when the tray is gone.
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console flashes up for the agent.
        command.creation_flags(0x0800_0000);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            append_log(&log, "tray", &format!("No se pudo iniciar el agente: {error}"));
            return None;
        }
    };
    append_log(&log, "tray", &format!("Agente iniciado (pid {}).", child.id()));
    if let Some(stdout) = child.stdout.take() {
        let log = Arc::clone(&log);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                append_log(&log, "agente", &line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let log = Arc::clone(&log);
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                append_log(&log, "agente:error", &line);
            }
        });
    }
    Some(child)
}

fn stop_agent(app: &tauri::AppHandle) {
    if let Some(agent) = app.try_state::<Agent>() {
        if let Ok(mut guard) = agent.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn main() {
    // Velopack install, update and uninstall hooks: they may run and exit before anything else.
    velopack::VelopackApp::build().run();

    let app = tauri::Builder::default()
        .setup(|app| {
            let version = app.package_info().version.to_string();
            let about = MenuItem::with_id(app, "about", format!("VideoCAT Companion v{version} (Tauri)"), false, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&about, &separator, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip(format!("VideoCAT Companion v{version}"))
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        stop_agent(app);
                        app.exit(0);
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            app.manage(Agent(Mutex::new(start_agent())));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar VideoCAT Companion");

    app.run(|app, event| match event {
        // Tray-only: no window closing ever quits the app, only "Salir".
        RunEvent::ExitRequested { api, code, .. } if code.is_none() => api.prevent_exit(),
        RunEvent::Exit => stop_agent(app),
        _ => {}
    });
}
