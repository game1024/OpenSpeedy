//! Global keyboard/mouse listening through Raw Input (`RIDEV_INPUTSINK`).
//!
//! Unlike `RegisterHotKey`, raw input is still delivered when an exclusive
//! fullscreen game owns the keyboard, and unlike `WH_KEYBOARD_LL` it does not
//! install a global hook. The listener runs on its own thread with a
//! message-only window; key edges are matched against the shortcut list that
//! the frontend syncs via `set_raw_shortcuts`.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, HWND_MESSAGE, MSG,
    PostMessageW, RegisterClassW, RI_KEY_BREAK, RI_KEY_E0, RI_MOUSE_BUTTON_1_DOWN,
    RI_MOUSE_BUTTON_1_UP, RI_MOUSE_BUTTON_2_DOWN, RI_MOUSE_BUTTON_2_UP, RI_MOUSE_BUTTON_3_DOWN,
    RI_MOUSE_BUTTON_3_UP, RI_MOUSE_BUTTON_4_DOWN, RI_MOUSE_BUTTON_4_UP, RI_MOUSE_BUTTON_5_DOWN,
    RI_MOUSE_BUTTON_5_UP, RI_MOUSE_HWHEEL, RI_MOUSE_WHEEL, TranslateMessage, WM_INPUT, WNDCLASSW,
};

use crate::applog;

/// Notifies the raw-input window thread that the mouse registration state may
/// have changed. `WM_APP` leaves the range used by system messages.
const WM_APP_MOUSE: u32 = 0x8000 + 1;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// Keyboard shortcuts currently in effect, as canonical chord strings.
static ACTIVE: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// True while at least one active chord uses a mouse button. Mouse raw input
/// is only registered then, so mouse movement costs nothing otherwise.
static WANT_MOUSE: AtomicBool = AtomicBool::new(false);
static MOUSE_REGISTERED: AtomicBool = AtomicBool::new(false);
/// Message-only window handle, stored as an integer because `HWND` is not
/// `Send`/`Sync`. Used to wake the listener thread when mouse support changes.
static RAW_WINDOW: OnceLock<isize> = OnceLock::new();

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum MouseButton {
    Left,
    Middle,
    Right,
    X1,
    X2,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum TriggerKey {
    Key(u16),
    Mouse(MouseButton),
}

struct HeldChord {
    chord: String,
    /// The keys/buttons that made up this chord; releasing any ends it.
    triggers: Vec<TriggerKey>,
}

#[derive(Default)]
struct KeyState {
    down: HashSet<u16>,
    mouse_down: HashSet<MouseButton>,
    held: Vec<HeldChord>,
}

static KEY_STATE: OnceLock<Mutex<KeyState>> = OnceLock::new();

#[derive(Clone, serde::Serialize)]
struct ShortcutTrigger {
    shortcut: String,
    state: &'static str,
}

fn key_state() -> &'static Mutex<KeyState> {
    KEY_STATE.get_or_init(|| Mutex::new(KeyState::default()))
}

/// Called from `set_raw_shortcuts` whenever the active profile changes.
pub fn set_shortcuts(shortcuts: Vec<String>) {
    let shortcuts: Vec<String> = shortcuts.into_iter().map(|chord| normalize_chord(&chord)).collect();
    let needs_mouse = shortcuts.iter().any(|chord| chord_has_mouse(chord));
    applog::info(
        "rawinput",
        format!(
            "active shortcuts (mouse={needs_mouse}): [{}]",
            shortcuts.join(", ")
        ),
    );
    match ACTIVE.lock() {
        Ok(mut active) => *active = shortcuts,
        Err(poisoned) => *poisoned.into_inner() = shortcuts,
    }

    // Register raw mouse input only while a mouse shortcut is in effect. The
    // window may not exist yet; `run` applies the current state on startup.
    WANT_MOUSE.store(needs_mouse, Ordering::Relaxed);
    if let Some(raw) = RAW_WINDOW.get() {
        let hwnd = HWND(*raw as *mut core::ffi::c_void);
        unsafe {
            let _ = PostMessageW(hwnd, WM_APP_MOUSE, WPARAM(0), LPARAM(0));
        }
    }
}

fn chord_has_mouse(chord: &str) -> bool {
    chord.split('+').any(is_mouse_token)
}

fn is_mouse_token(token: &str) -> bool {
    matches!(
        token,
        "MouseLeft"
            | "MouseMiddle"
            | "MouseRight"
            | "Mouse4"
            | "Mouse5"
            | "WheelUp"
            | "WheelDown"
            | "WheelLeft"
            | "WheelRight"
    )
}

fn mouse_token(button: MouseButton) -> &'static str {
    match button {
        MouseButton::Left => "MouseLeft",
        MouseButton::Middle => "MouseMiddle",
        MouseButton::Right => "MouseRight",
        MouseButton::X1 => "Mouse4",
        MouseButton::X2 => "Mouse5",
    }
}

/// Old settings stored the short numpad spellings (`NUMPADSUB`), while the
/// recorder writes the full key names. Match both spellings.
fn normalize_chord(chord: &str) -> String {
    chord
        .split('+')
        .map(|key| match key {
            "NUMPADSUB" => "NUMPADSUBTRACT",
            "NUMPADMUL" | "NUMPADMULT" => "NUMPADMULTIPLY",
            "NUMPADDIV" => "NUMPADDIVIDE",
            "NUMPADDEC" => "NUMPADDECIMAL",
            other => other,
        })
        .collect::<Vec<_>>()
        .join("+")
}

pub fn start(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::spawn(move || {
        if let Err(e) = run() {
            applog::error("rawinput", format!("listener failed: {e}"));
        }
    });
}

fn run() -> windows::core::Result<()> {
    let hinstance = unsafe { GetModuleHandleW(None)? };
    let class_name = to_wide("OpenSpeedyRawInputWindow");
    let wc = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: HINSTANCE(hinstance.0),
        lpszClassName: PCWSTR(class_name.as_ptr()),
        ..Default::default()
    };
    if unsafe { RegisterClassW(&wc) } == 0 {
        return Err(windows::core::Error::from_win32());
    }

    let window = unsafe {
        CreateWindowExW(
            Default::default(),
            PCWSTR(class_name.as_ptr()),
            PCWSTR(class_name.as_ptr()),
            Default::default(),
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            None,
            HINSTANCE(hinstance.0),
            None,
        )?
    };

    // Keyboard is always registered. Mouse registration is toggled on demand
    // in `apply_mouse_registration`, because it adds a WM_INPUT callback for
    // every mouse-move packet (1000+ per second on high-polling-rate mice).
    let devices = [RAWINPUTDEVICE {
        usUsagePage: 0x01,
        usUsage: 0x06, // keyboard
        dwFlags: RIDEV_INPUTSINK,
        hwndTarget: window,
    }];
    unsafe {
        RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32)?;
    }
    let _ = RAW_WINDOW.set(window.0 as isize);
    apply_mouse_registration(window);

    applog::info("rawinput", "listening for raw keyboard input");

    let mut msg = MSG::default();
    while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
        let _ = unsafe { TranslateMessage(&msg) };
        unsafe { DispatchMessageW(&msg) };
    }
    Ok(())
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_APP_MOUSE {
        apply_mouse_registration(hwnd);
        return LRESULT(0);
    }
    if msg == WM_INPUT {
        read_raw_input(HRAWINPUT(lparam.0 as *mut core::ffi::c_void));
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// Bring the mouse raw-input registration in line with `WANT_MOUSE`. Runs on
/// the listener thread, so registration and message pumping share a thread.
fn apply_mouse_registration(window: HWND) {
    let want = WANT_MOUSE.load(Ordering::Relaxed);
    if want == MOUSE_REGISTERED.load(Ordering::Relaxed) {
        return;
    }

    let device = if want {
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x02, // mouse
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: window,
        }
    } else {
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x02,
            dwFlags: RIDEV_REMOVE,
            hwndTarget: HWND::default(),
        }
    };
    match unsafe { RegisterRawInputDevices(&[device], std::mem::size_of::<RAWINPUTDEVICE>() as u32) } {
        Ok(()) => {
            MOUSE_REGISTERED.store(want, Ordering::Relaxed);
            if want {
                applog::info("rawinput", "mouse shortcuts active — raw mouse registered");
            } else {
                applog::info("rawinput", "no mouse shortcuts — raw mouse released");
                // Without the registration we will never see the button-up,
                // so clear held mouse state before dropping the device.
                release_mouse_held();
            }
        }
        Err(e) => applog::warn("rawinput", format!("mouse registration change failed: {e}")),
    }
}

unsafe fn read_raw_input(hraw: HRAWINPUT) {
    // Keyboard and mouse packets are small and fixed-size; a stack buffer
    // avoids a heap allocation for every mouse-move WM_INPUT.
    let mut buf = [0u8; 128];
    let mut size = buf.len() as u32;
    let read = GetRawInputData(
        hraw,
        RID_INPUT,
        Some(buf.as_mut_ptr() as *mut core::ffi::c_void),
        &mut size,
        std::mem::size_of::<RAWINPUTHEADER>() as u32,
    );
    if read == u32::MAX || read == 0 {
        return;
    }

    let raw = std::ptr::read_unaligned(buf.as_ptr() as *const RAWINPUT);
    if raw.header.dwType == RIM_TYPEKEYBOARD.0 {
        let keyboard = raw.data.keyboard;
        if keyboard.VKey == 0 || keyboard.VKey == 0xFF {
            return;
        }
        let is_up = (keyboard.Flags as u32 & RI_KEY_BREAK) != 0;
        let is_e0 = (keyboard.Flags as u32 & RI_KEY_E0) != 0;
        handle_key(keyboard.VKey, keyboard.MakeCode, is_e0, is_up);
    } else if raw.header.dwType == RIM_TYPEMOUSE.0 {
        let flags = raw.data.mouse.Anonymous.Anonymous.usButtonFlags as u32;
        let buttons = [
            (RI_MOUSE_BUTTON_1_DOWN, RI_MOUSE_BUTTON_1_UP, MouseButton::Left),
            (RI_MOUSE_BUTTON_2_DOWN, RI_MOUSE_BUTTON_2_UP, MouseButton::Right),
            (RI_MOUSE_BUTTON_3_DOWN, RI_MOUSE_BUTTON_3_UP, MouseButton::Middle),
            (RI_MOUSE_BUTTON_4_DOWN, RI_MOUSE_BUTTON_4_UP, MouseButton::X1),
            (RI_MOUSE_BUTTON_5_DOWN, RI_MOUSE_BUTTON_5_UP, MouseButton::X2),
        ];
        for (down, up, button) in buttons {
            if flags & down != 0 {
                handle_mouse(button, false);
            }
            if flags & up != 0 {
                handle_mouse(button, true);
            }
        }

        let delta = raw.data.mouse.Anonymous.Anonymous.usButtonData as i16 as i32;
        if flags & RI_MOUSE_WHEEL != 0 {
            handle_wheel(delta, false);
        }
        if flags & RI_MOUSE_HWHEEL != 0 {
            handle_wheel(delta, true);
        }
    }
}

fn emit_shortcut(shortcut: &str, state: &'static str) {
    applog::info("rawinput", format!("trigger {shortcut} {state}"));
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "shortcut-trigger",
            ShortcutTrigger { shortcut: shortcut.to_string(), state },
        );
    }
}

fn handle_key(vk: u16, make_code: u16, is_e0: bool, is_up: bool) {
    let mut state = match key_state().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if is_up {
        state.down.remove(&vk);
        let released = release_held(&mut state);
        drop(state);
        for chord in released {
            emit_shortcut(&chord, "Released");
        }
        return;
    }

    // Auto-repeat sends repeated make codes; only the first one is an edge.
    if !state.down.insert(vk) {
        return;
    }
    let Some(main) = vk_token(vk, make_code, is_e0) else {
        return;
    };

    let (chord, mut triggers) = build_chord(&state, &main);
    if !is_active(&chord) {
        return;
    }
    triggers.push(TriggerKey::Key(vk));
    state.held.push(HeldChord { chord: chord.clone(), triggers });
    drop(state);
    emit_shortcut(&chord, "Pressed");
}

fn handle_mouse(button: MouseButton, is_up: bool) {
    let mut state = match key_state().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if is_up {
        state.mouse_down.remove(&button);
        let released = release_held(&mut state);
        drop(state);
        for chord in released {
            emit_shortcut(&chord, "Released");
        }
        return;
    }

    if !state.mouse_down.insert(button) {
        return;
    }
    let (chord, mut triggers) = build_chord(&state, mouse_token(button));
    if !is_active(&chord) {
        return;
    }
    triggers.push(TriggerKey::Mouse(button));
    state.held.push(HeldChord { chord: chord.clone(), triggers });
    drop(state);
    emit_shortcut(&chord, "Pressed");
}

/// A wheel tick has no key-up edge, so it reports Pressed and Released back to
/// back. This keeps ordinary chord actions working and returns hold shortcuts
/// to their resting speed.
fn handle_wheel(delta: i32, horizontal: bool) {
    if delta == 0 {
        return;
    }
    let main = match (horizontal, delta > 0) {
        (false, true) => "WheelUp",
        (false, false) => "WheelDown",
        (true, true) => "WheelRight",
        (true, false) => "WheelLeft",
    };

    let state = match key_state().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let (chord, _) = build_chord(&state, main);
    drop(state);

    if !is_active(&chord) {
        return;
    }
    emit_shortcut(&chord, "Pressed");
    emit_shortcut(&chord, "Released");
}

/// Build a chord in the same order the recorder writes it.
fn build_chord(state: &KeyState, main: &str) -> (String, Vec<TriggerKey>) {
    let (ctrl, shift, alt, modifier_vks) = modifier_keys(&state.down);
    let mut chord = String::new();
    if ctrl {
        chord.push_str("Ctrl+");
    }
    if shift {
        chord.push_str("Shift+");
    }
    if alt {
        chord.push_str("Alt+");
    }
    chord.push_str(main);
    (chord, modifier_vks.into_iter().map(TriggerKey::Key).collect())
}

fn is_active(chord: &str) -> bool {
    match ACTIVE.lock() {
        Ok(active) => active.iter().any(|item| item == chord),
        Err(poisoned) => poisoned.into_inner().iter().any(|item| item == chord),
    }
}

/// Drop held chords whose any trigger is no longer down and return them.
fn release_held(state: &mut KeyState) -> Vec<String> {
    let KeyState { down, mouse_down, held } = state;
    let mut released = Vec::new();
    held.retain(|entry| {
        let still_down = entry.triggers.iter().all(|trigger| match trigger {
            TriggerKey::Key(vk) => down.contains(vk),
            TriggerKey::Mouse(button) => mouse_down.contains(button),
        });
        if !still_down {
            released.push(entry.chord.clone());
        }
        still_down
    });
    released
}

fn release_mouse_held() {
    let mut state = match key_state().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    state.mouse_down.clear();
    let released = release_held(&mut state);
    drop(state);
    for chord in released {
        emit_shortcut(&chord, "Released");
    }
}

fn modifier_keys(down: &HashSet<u16>) -> (bool, bool, bool, Vec<u16>) {
    let mut ctrl = false;
    let mut shift = false;
    let mut alt = false;
    let mut keys = Vec::new();
    for &vk in down {
        match vk {
            0x11 | 0xA2 | 0xA3 => {
                ctrl = true;
                keys.push(vk);
            }
            0x10 | 0xA0 | 0xA1 => {
                shift = true;
                keys.push(vk);
            }
            0x12 | 0xA4 | 0xA5 => {
                alt = true;
                keys.push(vk);
            }
            _ => {}
        }
    }
    (ctrl, shift, alt, keys)
}

/// Map a virtual-key code to the token format used by the shortcut fields.
/// Returns `None` for modifiers and keys we do not record.
fn vk_token(vk: u16, _make_code: u16, is_e0: bool) -> Option<String> {
    // Numpad Enter shares VK_RETURN with the main Enter key but is extended.
    if vk == 0x0D && is_e0 {
        return Some("NUMPADENTER".to_string());
    }
    // With NumLock off, the numpad reports navigation virtual keys. Those are
    // not the dedicated arrow/navigation keys the user may have bound.
    if !is_e0 && matches!(vk, 0x21..=0x28 | 0x2D | 0x2E) {
        return None;
    }

    let token = match vk {
        0x41..=0x5A => ((b'A' + (vk as u8 - 0x41)) as char).to_string(),
        0x30..=0x39 => ((b'0' + (vk as u8 - 0x30)) as char).to_string(),
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        0x60..=0x69 => format!("NUMPAD{}", vk - 0x60),
        0x6A => "NUMPADMULTIPLY".to_string(),
        0x6B => "NUMPADADD".to_string(),
        0x6D => "NUMPADSUBTRACT".to_string(),
        0x6E => "NUMPADDECIMAL".to_string(),
        0x6F => "NUMPADDIVIDE".to_string(),
        0x25 => "ArrowLeft".to_string(),
        0x26 => "ArrowUp".to_string(),
        0x27 => "ArrowRight".to_string(),
        0x28 => "ArrowDown".to_string(),
        0x20 => "Space".to_string(),
        0x0D => "Enter".to_string(),
        0x1B => "Escape".to_string(),
        0x09 => "Tab".to_string(),
        0x08 => "Backspace".to_string(),
        0x2E => "Delete".to_string(),
        0x2D => "Insert".to_string(),
        0x24 => "Home".to_string(),
        0x23 => "End".to_string(),
        0x21 => "PageUp".to_string(),
        0x22 => "PageDown".to_string(),
        0x14 => "CapsLock".to_string(),
        0x90 => "NumLock".to_string(),
        0x2C => "PrintScreen".to_string(),
        0x91 => "ScrollLock".to_string(),
        0x13 => "Pause".to_string(),
        0x5D => "ContextMenu".to_string(),
        0xAD => "AudioVolumeMute".to_string(),
        0xAE => "AudioVolumeDown".to_string(),
        0xAF => "AudioVolumeUp".to_string(),
        0xB0 => "MediaTrackNext".to_string(),
        0xB1 => "MediaTrackPrevious".to_string(),
        0xB2 => "MediaStop".to_string(),
        0xB3 => "MediaPlayPause".to_string(),
        0xB4 => "LaunchMail".to_string(),
        0xB5 => "MediaSelect".to_string(),
        0xB6 => "LaunchApp1".to_string(),
        0xB7 => "LaunchApp2".to_string(),
        0xBD => "-".to_string(),
        0xBB => "=".to_string(),
        0xC0 => "`".to_string(),
        0xDB => "[".to_string(),
        0xDD => "]".to_string(),
        0xDC => "\\".to_string(),
        0xBA => ";".to_string(),
        0xDE => "'".to_string(),
        0xBC => ",".to_string(),
        0xBE => ".".to_string(),
        0xBF => "/".to_string(),
        _ => return None,
    };
    Some(token)
}
