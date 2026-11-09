//! Boot launch: off, visible, or silent.
//!
//! There is only one OS autostart entry (the Tauri autostart plugin), and it is
//! always registered with `--autostart` so the process can tell a boot launch
//! from a launch by the user. Which mode that entry means is decided here, from
//! a preference file the Rust side owns:
//!
//! | mode      | OS entry | main window on boot |
//! |-----------|----------|---------------------|
//! | `off`     | absent   | n/a                 |
//! | `visible` | present  | shown               |
//! | `silent`  | present  | hidden, tray only   |
//!
//! "Silent" is therefore an independent, persistent choice: turning it on also
//! registers the boot entry, and turning it off removes it (unless the user
//! switches straight to the visible mode).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

/// Argument added to every autostart launch by the plugin. It is a *boot*
/// marker, not a silent marker: the persisted preference decides the mode.
pub const AUTOSTART_FLAG: &str = "--autostart";

const PREFS_FILE: &str = "boot_launch.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct BootPrefs {
    silent: bool,
}

pub struct StartupState {
    prefs: Mutex<BootPrefs>,
    path: PathBuf,
}

impl StartupState {
    pub fn load(dir: &Path) -> Arc<Self> {
        let path = crate::prefs::file(dir, PREFS_FILE);
        Arc::new(Self {
            prefs: Mutex::new(crate::prefs::read(&path)),
            path,
        })
    }

    fn guard(&self) -> MutexGuard<'_, BootPrefs> {
        // A poisoned lock only means a writer panicked; the value is still a
        // valid BootPrefs and panicking here would take the whole app down.
        self.prefs.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn silent(&self) -> bool {
        self.guard().silent
    }

    fn set_silent(&self, silent: bool) -> Result<(), String> {
        let mut prefs = self.guard();
        prefs.silent = silent;
        crate::prefs::write(&self.path, &*prefs)
    }
}

/// True when this process was launched by the OS autostart entry.
pub fn is_autostart_launch() -> bool {
    std::env::args().any(|a| a.eq_ignore_ascii_case(AUTOSTART_FLAG))
}

/// Whether a boot launch must stay completely out of the user's way. The
/// preference is read from disk in `setup`, before any window or WebView work.
pub fn should_start_hidden(state: &Arc<StartupState>) -> bool {
    is_autostart_launch() && state.silent()
}

/// Report the mode that is actually in effect, with the OS registry as the
/// authority for "enabled at all" and our file for the silent/visible choice.
#[tauri::command]
pub fn get_boot_mode(app: AppHandle, state: State<'_, Arc<StartupState>>) -> String {
    let registered = match app.autolaunch().is_enabled() {
        Ok(v) => v,
        Err(e) => {
            crate::applog::warn("startup", format!("could not read autostart state: {e}"));
            false
        }
    };
    if !registered {
        "off".into()
    } else if state.inner().silent() {
        "silent".into()
    } else {
        "visible".into()
    }
}

/// Switch mode. Re-registers even when already enabled so the entry always
/// carries `AUTOSTART_FLAG` — releases before this change registered the app
/// with no arguments, which would otherwise never be recognised as a boot
/// launch.
#[tauri::command]
pub fn set_boot_mode(
    app: AppHandle,
    state: State<'_, Arc<StartupState>>,
    mode: String,
) -> Result<String, String> {
    let mode = mode.as_str();
    if !matches!(mode, "off" | "visible" | "silent") {
        return Err(format!("unknown boot mode: {mode}"));
    }

    let previous = state.inner().silent();
    let next = mode == "silent";
    state.inner().set_silent(next)?;

    // Persist first, then change the OS entry; if the registry write fails,
    // put the preference back so the two never disagree about the next boot.
    let result = apply_registration(&app, mode);
    if let Err(e) = result {
        let _ = state.inner().set_silent(previous);
        return Err(e);
    }

    crate::applog::info("startup", format!("boot mode set to {mode}"));
    Ok(mode.to_string())
}

fn apply_registration(app: &AppHandle, mode: &str) -> Result<(), String> {
    let manager = app.autolaunch();
    // `disable()` is a no-op when the value is missing (the plugin handles the
    // Windows "not found" case), so this is safe on a fresh install too.
    manager
        .disable()
        .map_err(|e| format!("could not clear the previous boot entry: {e}"))?;
    if mode != "off" {
        manager
            .enable()
            .map_err(|e| format!("could not register boot launch: {e}"))?;
    }
    Ok(())
}
