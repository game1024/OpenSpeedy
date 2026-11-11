//! Speed dispatch (stage 3).
//!
//! The action behind a shortcut lives here, not in the webview: a hotkey, the
//! read-only poller and the gamepad reader all end up in `dispatch`, which
//! asks the bridge for the current factor, applies the new one and reports
//! the result. The frontend only listens to `speed-changed` to show the value.
//!
//! `bridge_get_speed` is the single source of truth. Nothing is written to the
//! settings file from here — the frontend stores what this module reports, so
//! there is exactly one writer for the persisted value.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::Emitter;

/// The speed values the actions need. The frontend pushes them whenever the
/// settings change.
#[derive(Clone, Copy)]
pub struct Config {
    pub increase_step: f64,
    pub decrease_step: f64,
    pub gears: [f64; 5],
    pub hold_speed: f64,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            increase_step: 0.5,
            decrease_step: 0.5,
            gears: [1.0, 2.0, 5.0, 10.0, 100.0],
            hold_speed: 2.0,
        }
    }
}

static CONFIG: Mutex<Config> = Mutex::new(Config {
    increase_step: 0.5,
    decrease_step: 0.5,
    gears: [1.0, 2.0, 5.0, 10.0, 100.0],
    hold_speed: 2.0,
});

/// Which channel currently owns a slot. A press from a lower-priority channel
/// is ignored while a higher-priority one holds the slot.
static ACTIVE: Mutex<Option<HashMap<String, u8>>> = Mutex::new(None);

/// Stage-3 switch: when on, the action happens here instead of in the webview.
static ENABLED: AtomicBool = AtomicBool::new(false);

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

pub fn set_config(config: Config) {
    let mut current = match CONFIG.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *current = config;
}

/// gamepad beats hotkey beats polling.
pub fn priority(source: &str) -> u8 {
    match source {
        "gamepad" => 3,
        "hotkey" => 2,
        _ => 1,
    }
}

fn lock_active() -> std::sync::MutexGuard<'static, Option<HashMap<String, u8>>> {
    match ACTIVE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Claim the slot for this channel. Returns false when a higher-priority
/// channel already owns it.
fn claim(slot: &str, source: &str, phase: &str) -> bool {
    let prio = priority(source);
    let mut guard = lock_active();
    let owners = guard.get_or_insert_with(HashMap::new);
    if phase == "press" {
        if let Some(current) = owners.get(slot) {
            if *current > prio {
                return false;
            }
        }
        owners.insert(slot.to_string(), prio);
        true
    } else {
        // Only the owner may release; a release from another channel is noise.
        match owners.get(slot) {
            Some(current) if *current == prio => {
                owners.remove(slot);
                true
            }
            _ => false,
        }
    }
}

/// Apply one shortcut action. Returns the factor that was applied.
pub fn dispatch(app: &tauri::AppHandle, slot: &str, phase: &str, source: &str) -> Option<f64> {
    if !claim(slot, source, phase) {
        return None;
    }
    let config = {
        let guard = match CONFIG.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard
    };

    let factor = match (slot, phase) {
        ("increaseSpeedShortcut", "press") => {
            let current = crate::bridge_client::bridge64_get_speed().unwrap_or(1.0);
            current + config.increase_step
        }
        ("decreaseSpeedShortcut", "press") => {
            let current = crate::bridge_client::bridge64_get_speed().unwrap_or(1.0);
            (current - config.decrease_step).max(0.01)
        }
        ("resetSpeedShortcut", "press") => 1.0,
        ("holdShortcut", "press") => config.hold_speed,
        ("holdShortcut", "release") => 1.0,
        (name, "press") if name.starts_with("gear") => {
            let digit: usize = name.get(4..5)?.parse().ok()?;
            *config.gears.get(digit.checked_sub(1)?)?
        }
        _ => return None,
    };

    crate::bridge_client::bridge64_set_speed(factor);
    crate::bridge_client::bridge32_set_speed(factor);
    let _ = app.emit("speed-changed", serde_json::json!({ "factor": factor }));
    Some(factor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channels_are_ordered() {
        assert!(priority("gamepad") > priority("hotkey"));
        assert!(priority("hotkey") > priority("poll"));
        assert_eq!(priority("poll"), priority("unknown"));
    }

    /// The whole point of the priority table: a lower-priority channel cannot
    /// take a slot that a higher-priority one already holds.
    #[test]
    fn a_higher_priority_channel_keeps_the_slot() {
        assert!(claim("increaseSpeedShortcut", "gamepad", "press"));
        assert!(!claim("increaseSpeedShortcut", "hotkey", "press"));
        assert!(!claim("increaseSpeedShortcut", "poll", "press"));
        // The owner still releases it.
        assert!(claim("increaseSpeedShortcut", "gamepad", "release"));
        assert!(claim("increaseSpeedShortcut", "poll", "press"));
    }

    #[test]
    fn a_release_from_another_channel_is_ignored() {
        assert!(claim("holdShortcut", "hotkey", "press"));
        assert!(!claim("holdShortcut", "poll", "release"));
        assert!(claim("holdShortcut", "hotkey", "release"));
    }
}
