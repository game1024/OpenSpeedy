//! Read-only key polling (stage 2).
//!
//! A second input channel for the combinations the OS refuses to hand out as
//! a hotkey. It only *reads* the keyboard state through `GetAsyncKeyState` —
//! nothing is injected, blocked or intercepted, so the game still receives
//! every key the user presses.
//!
//! One slot uses one channel. The frontend decides which slots belong here
//! (a chord that failed with 1409, or every chord in compatibility mode) and
//! sends the resulting list; this module never registers a hotkey itself, so
//! the two channels cannot both fire for the same slot.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Emitter;
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

/// Polling period while a game is in the foreground — the window in which a
/// key press has to be noticed to feel instant.
const FAST_INTERVAL_MS: u64 = 16;
/// Polling period for everything else.
const SLOW_INTERVAL_MS: u64 = 100;
/// Period while no slot is polled at all.
const IDLE_INTERVAL_MS: u64 = 500;
/// Minimum gap between two triggers of the same slot. Stops auto-repeat and
/// macro tools from turning one press into a hundred.
const DEBOUNCE_MS: u64 = 80;

struct Binding {
    slot: String,
    keys: Vec<i32>,
    was_down: bool,
    last_fire: Option<Instant>,
}

static ENABLED: AtomicBool = AtomicBool::new(false);
static BINDINGS: Mutex<Vec<Binding>> = Mutex::new(Vec::new());
static FOCUS_EXES: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
    if !on {
        // Drop the edge state so a re-enable does not fire on a key that was
        // already down when polling stopped.
        let mut bindings = lock_bindings();
        for binding in bindings.iter_mut() {
            binding.was_down = false;
            binding.last_fire = None;
        }
    }
}

pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

fn lock_bindings() -> std::sync::MutexGuard<'static, Vec<Binding>> {
    match BINDINGS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Replace the polled slots. A chord that cannot be parsed is skipped rather
/// than guessed at — a wrong virtual key would fire on the wrong key.
pub fn set_bindings(list: Vec<(String, String)>) {
    let mut bindings = lock_bindings();
    let mut next: Vec<Binding> = Vec::new();
    for (slot, chord) in list {
        let Some(keys) = parse_chord(&chord) else { continue };
        if keys.is_empty() {
            continue;
        }
        // Keep the edge state of a slot that is already being polled, so a
        // refresh of an unchanged list cannot re-trigger it.
        let was_down = bindings
            .iter()
            .find(|binding| binding.slot == slot)
            .map(|binding| binding.was_down)
            .unwrap_or(false);
        next.push(Binding { slot, keys, was_down, last_fire: None });
    }
    *bindings = next;
}

/// Exe names that count as "a game is in front of the user" — the frontend
/// sends the ones it knows about (profiles and remembered processes).
pub fn set_focus_exes(exes: Vec<String>) {
    let mut focus = match FOCUS_EXES.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *focus = exes.into_iter().map(|name| name.to_ascii_lowercase()).collect();
}

fn is_focus_exe(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    match FOCUS_EXES.lock() {
        Ok(focus) => focus.iter().any(|exe| *exe == lower),
        Err(poisoned) => poisoned.into_inner().iter().any(|exe| *exe == lower),
    }
}

fn current_interval_ms() -> u64 {
    let count = lock_bindings().len();
    if count == 0 {
        return IDLE_INTERVAL_MS;
    }
    let foreground = crate::process_enumerator::foreground_exe_name();
    if !foreground.is_empty() && is_focus_exe(&foreground) {
        FAST_INTERVAL_MS
    } else {
        SLOW_INTERVAL_MS
    }
}

fn key_down(vk: i32) -> bool {
    // The high bit is the "currently down" flag; the low bit is unreliable and
    // deliberately ignored. The cast keeps the mask in range for i16.
    unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 }
}

/// Background thread. Started once from the Tauri setup hook.
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(current_interval_ms()));
            if !is_enabled() {
                continue;
            }
            poll_once(&app);
        }
    });
}

fn poll_once(app: &tauri::AppHandle) {
    // Detect edges while holding the lock, then drop it before any emit so the
    // IPC write can never block config commands that also lock BINDINGS.
    let mut to_fire: Vec<(String, String)> = Vec::new();
    {
        let mut bindings = lock_bindings();
        for binding in bindings.iter_mut() {
            let down = binding.keys.iter().all(|vk| key_down(*vk));
            if down && !binding.was_down {
                binding.was_down = true;
                let now = Instant::now();
                let too_soon = binding
                    .last_fire
                    .map(|last| now.saturating_duration_since(last) < Duration::from_millis(DEBOUNCE_MS))
                    .unwrap_or(false);
                if !too_soon {
                    binding.last_fire = Some(now);
                    to_fire.push((binding.slot.clone(), "press".to_string()));
                }
            } else if !down {
                if binding.was_down {
                    binding.was_down = false;
                    to_fire.push((binding.slot.clone(), "release".to_string()));
                }
            }
        }
    }
    for (slot, phase) in to_fire {
        fire(app, &slot, &phase);
    }
}

/// With the stage-3 switch on the action runs here; otherwise the edge goes to
/// the webview, which dispatches it as before.
fn fire(app: &tauri::AppHandle, slot: &str, phase: &str) {
    if crate::dispatch::enabled() {
        crate::dispatch::dispatch(app, slot, phase, "poll");
        return;
    }
    let _ = app.emit("input-polled", serde_json::json!({ "slot": slot, "phase": phase }));
}

// ── Chord parsing ──────────────────────────────────────────────────────────

/// Virtual-key codes for the tokens the shortcut field can produce.
fn vk_for_token(token: &str) -> Option<i32> {
    let lower = token.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }
    let code = match lower.as_str() {
        "ctrl" | "control" => 0x11,
        "shift" => 0x10,
        "alt" => 0x12,
        "win" | "meta" | "command" | "cmd" => 0x5B,
        "space" => 0x20,
        "enter" | "return" | "numpadenter" => 0x0D,
        "escape" | "esc" => 0x1B,
        "tab" => 0x09,
        "backspace" => 0x08,
        "delete" | "del" => 0x2E,
        "insert" => 0x2D,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        "up" | "arrowup" => 0x26,
        "down" | "arrowdown" => 0x28,
        "left" | "arrowleft" => 0x25,
        "right" | "arrowright" => 0x27,
        "numpadadd" => 0x6B,
        "numpadsubtract" => 0x6D,
        "numpadmultiply" => 0x6A,
        "numpaddivide" => 0x6F,
        "numpaddecimal" => 0x6E,
        ";" => 0xBA,
        "=" => 0xBB,
        "," => 0xBC,
        "-" => 0xBD,
        "." => 0xBE,
        "/" => 0xBF,
        "`" => 0xC0,
        "[" => 0xDB,
        "\\" => 0xDC,
        "]" => 0xDD,
        "'" => 0xDE,
        _ => {
            let bytes = lower.as_bytes();
            if bytes.len() == 1 {
                let c = bytes[0];
                if c.is_ascii_digit() {
                    0x30 + (c - b'0') as i32
                } else if c.is_ascii_lowercase() {
                    0x41 + (c - b'a') as i32
                } else {
                    return None;
                }
            } else if let Some(rest) = lower.strip_prefix("numpad") {
                if rest.len() == 1 && rest.as_bytes()[0].is_ascii_digit() {
                    0x60 + (rest.as_bytes()[0] - b'0') as i32
                } else {
                    return None;
                }
            } else if let Some(rest) = lower.strip_prefix('f') {
                if rest.len() >= 1 && rest.len() <= 2 && rest.as_bytes().iter().all(|b| b.is_ascii_digit()) {
                    let number: i32 = rest.parse().ok()?;
                    if (1..=24).contains(&number) {
                        0x6F + number
                    } else {
                        return None;
                    }
                } else {
                    return None;
                }
            } else {
                return None;
            }
        }
    };
    Some(code)
}

/// Split a chord such as `Ctrl+Alt+]` into virtual-key codes.
pub fn parse_chord(chord: &str) -> Option<Vec<i32>> {
    if chord.trim().is_empty() {
        return None;
    }
    let mut keys = Vec::new();
    for token in chord.split('+') {
        let token = token.trim();
        if token.is_empty() {
            return None;
        }
        keys.push(vk_for_token(token)?);
    }
    Some(keys)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chords_map_to_virtual_keys() {
        assert_eq!(parse_chord("Ctrl+Alt+]"), Some(vec![0x11, 0x12, 0xDD]));
        assert_eq!(parse_chord("Ctrl+Alt+["), Some(vec![0x11, 0x12, 0xDB]));
        assert_eq!(parse_chord("Ctrl+Shift+1"), Some(vec![0x11, 0x10, 0x31]));
        assert_eq!(parse_chord("NUMPADADD"), Some(vec![0x6B]));
        assert_eq!(parse_chord("NUMPADSUBTRACT"), Some(vec![0x6D]));
        assert_eq!(parse_chord("F12"), Some(vec![0x7B]));
        assert_eq!(parse_chord("A"), Some(vec![0x41]));
        assert_eq!(parse_chord("Space"), Some(vec![0x20]));
        assert_eq!(parse_chord("ArrowUp"), Some(vec![0x26]));
    }

    /// An unknown token must not become a wrong key: the whole chord is
    /// dropped instead.
    #[test]
    fn unknown_tokens_drop_the_whole_chord() {
        assert_eq!(parse_chord("Ctrl+Alt+NoSuchKey"), None);
        assert_eq!(parse_chord(""), None);
        assert_eq!(parse_chord("Ctrl+"), None);
        assert_eq!(parse_chord("F25"), None);
    }

    #[test]
    fn a_binding_survives_a_refresh_with_its_edge_state() {
        set_enabled(true);
        set_bindings(vec![("increaseSpeedShortcut".into(), "Ctrl+Alt+]".into())]);
        let mut bindings = lock_bindings();
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].slot, "increaseSpeedShortcut");
        assert_eq!(bindings[0].keys, vec![0x11, 0x12, 0xDD]);
        bindings[0].was_down = true;
        drop(bindings);

        set_bindings(vec![("increaseSpeedShortcut".into(), "Ctrl+Alt+]".into())]);
        let bindings = lock_bindings();
        assert!(bindings[0].was_down, "a refresh must not re-arm the edge");
    }

    #[test]
    fn unparsable_bindings_are_skipped() {
        set_bindings(vec![
            ("increaseSpeedShortcut".into(), "Ctrl+Alt+]".into()),
            ("bogus".into(), "Ctrl+Nonsense".into()),
        ]);
        let bindings = lock_bindings();
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].slot, "increaseSpeedShortcut");
    }
}
