mod backup;
mod secrets;
#[cfg(target_os = "linux")]
mod linux_tray;

use tauri::Manager;

const HIDDEN_ARG: &str = "--hidden";

fn started_hidden_arg() -> bool {
    std::env::args().any(|a| a == HIDDEN_ARG)
}

#[tauri::command]
fn started_hidden() -> bool {
    started_hidden_arg()
}

#[tauri::command]
fn tray_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("gdbus")
            .args([
                "call",
                "--session",
                "--dest",
                "org.freedesktop.DBus",
                "--object-path",
                "/org/freedesktop/DBus",
                "--method",
                "org.freedesktop.DBus.NameHasOwner",
                "org.kde.StatusNotifierWatcher",
            ])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("true"))
            .unwrap_or(true)
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

// linux: eigenes tray über ksni, weil libayatana keine klicks meldet
#[tauri::command]
fn tray_backend() -> &'static str {
    if cfg!(target_os = "linux") { "ksni" } else { "tauri" }
}

#[cfg(target_os = "linux")]
#[tauri::command]
async fn tray_update(app: tauri::AppHandle, tray: linux_tray::TrayState) -> Result<(), String> {
    linux_tray::linux_tray_update(app, tray).await
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
async fn tray_update() -> Result<(), String> {
    Err("nur linux".into())
}

pub(crate) fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    gtk::glib::set_application_name("hFenceline");

    let builder = tauri::Builder::default();
    #[cfg(target_os = "linux")]
    let builder = builder.manage(linux_tray::LinuxTray::default());
    builder
        // muss das erste plugin sein
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if !started_hidden_arg() {
                show_main(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            started_hidden,
            tray_available,
            quit,
            tray_backend,
            tray_update,
            backup::backup_export,
            backup::backup_import,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_backend,
        ])
        .build(tauri::generate_context!())
        .expect("hFenceline konnte nicht starten")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                #[cfg(target_os = "linux")]
                tauri::async_runtime::block_on(linux_tray::shutdown(_app));
            }
        });
}
