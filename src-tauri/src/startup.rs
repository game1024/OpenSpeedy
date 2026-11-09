//! Boot-launch detection and the initial main-window visibility.
//!
//! The autostart registration appends [`AUTOSTART_FLAG`] to the command line,
//! so a launch by Windows can be told apart from a launch by the user. The
//! window is created hidden (`visible: false` in `tauri.conf.json`) and only
//! stays hidden when the user opted into a silent boot; every other launch
//! shows it from the setup callback.

use tauri::Manager;
use tauri_plugin_store::StoreExt;

use crate::applog;

/// Command-line marker appended to the autostart registration.
pub const AUTOSTART_FLAG: &str = "--autostart";

/// Whether this process was started from the autostart registration.
pub fn is_autostart_launch() -> bool {
    std::env::args_os().any(|arg| arg.to_string_lossy() == AUTOSTART_FLAG)
}

/// The user's `silentAutostart` preference, read from the same `settings.json`
/// the frontend store uses (key `settings`). Anything unreadable means "not
/// silent": a visible window is the failure mode the user can react to.
fn silent_start_enabled(app: &tauri::AppHandle) -> bool {
    match app.store("settings.json") {
        Ok(store) => store
            .get("settings")
            .and_then(|settings| settings.get("silentAutostart").and_then(|v| v.as_bool()))
            .unwrap_or(false),
        Err(e) => {
            applog::warn(
                "startup",
                format!("settings.json could not be opened ({e}) — treating silent start as off"),
            );
            false
        }
    }
}

/// Decide whether the main window appears at startup.
///
/// Called first thing in the setup callback: the bridge health checks block for
/// a few seconds, and a normal launch should not wait for them to see its
/// window.
pub fn apply_initial_window_visibility(app: &tauri::AppHandle) {
    let boot_launch = is_autostart_launch();

    if boot_launch && silent_start_enabled(app) {
        applog::info(
            "startup",
            "autostart launch with silent start enabled — main window stays hidden",
        );
        return;
    }

    let Some(window) = app.get_webview_window("main") else {
        applog::warn("startup", "main window not found — initial visibility left unchanged");
        return;
    };

    match window.show() {
        Ok(()) => {
            // An OS-launched process has no foreground rights, so the window
            // must ask for focus explicitly.
            let _ = window.set_focus();
            applog::info(
                "startup",
                if boot_launch {
                    "autostart launch without silent start — main window shown"
                } else {
                    "normal launch — main window shown"
                },
            );
        }
        Err(e) => applog::error("startup", format!("could not show the main window: {e}")),
    }
}
