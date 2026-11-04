//! Small JSON preference files owned by the Rust backend.
//!
//! Boot-launch mode and auto-acceleration rules have to be readable before the
//! WebView finishes loading — a silent boot never shows a window, and the
//! background monitor must start with its rules already in hand. Keeping them
//! out of the frontend store also means they survive a WebView that fails or is
//! throttled while hidden.

use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

pub fn file(dir: &Path, name: &str) -> PathBuf {
    dir.join(name)
}

/// Read a preference file. A missing or damaged file is not fatal: the caller
/// gets its defaults and can rewrite the file on the next change.
pub fn read<T: DeserializeOwned + Default>(path: &Path) -> T {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => return T::default(),
    };
    serde_json::from_str(&text).unwrap_or_else(|e| {
        crate::applog::warn(
            "prefs",
            format!(
                "{} is not valid JSON ({e}) — using defaults",
                path.display()
            ),
        );
        T::default()
    })
}

/// Write a preference file, creating the app data directory on first use.
pub fn write<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| format!("cannot encode preferences: {e}"))?;
    fs::write(path, text).map_err(|e| format!("cannot write {}: {e}", path.display()))
}
