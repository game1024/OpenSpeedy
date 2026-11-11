//! Background poll of every game controller Windows exposes.
//!
//! Reading `RawGameController` does not take the device, so the game still
//! receives the same buttons. Recognized pads (Xbox, and whatever else Windows
//! maps onto `Gamepad`, including most PlayStation and Switch pads) get stable
//! names. Anything else is addressed by vendor, product and button index, so a
//! button with no label can still be bound.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use windows::Gaming::Input::{
    GameControllerButtonLabel, GameControllerSwitchPosition, Gamepad, GamepadButtons,
    RawGameController,
};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::Input::XboxController::{
    XInputGetState, XINPUT_GAMEPAD_A, XINPUT_GAMEPAD_B, XINPUT_GAMEPAD_BACK,
    XINPUT_GAMEPAD_BUTTON_FLAGS, XINPUT_GAMEPAD_DPAD_DOWN, XINPUT_GAMEPAD_DPAD_LEFT,
    XINPUT_GAMEPAD_DPAD_RIGHT, XINPUT_GAMEPAD_DPAD_UP, XINPUT_GAMEPAD_LEFT_SHOULDER,
    XINPUT_GAMEPAD_LEFT_THUMB, XINPUT_GAMEPAD_RIGHT_SHOULDER, XINPUT_GAMEPAD_RIGHT_THUMB,
    XINPUT_GAMEPAD_START, XINPUT_GAMEPAD_TRIGGER_THRESHOLD, XINPUT_GAMEPAD_X, XINPUT_GAMEPAD_Y,
    XINPUT_STATE,
};

use crate::applog;

const POLL: Duration = Duration::from_millis(16);
// Recognized-pad triggers are analog. Half-travel counts as a press.
const TRIGGER_DOWN: f64 = 0.5;
// ponytail: unlabeled axes have no trigger-vs-stick flag. 0.75 stays clear of
// a centered stick (0.5) and still catches pedals and digital triggers.
const AXIS_DOWN: f64 = 0.75;

static RUN: AtomicBool = AtomicBool::new(true);

#[derive(Clone, serde::Serialize)]
struct Chord {
    binding: String,
    state: &'static str,
}

#[derive(Clone, serde::Serialize)]
struct Capture {
    binding: String,
}

#[derive(Clone, serde::Serialize)]
struct Held {
    tokens: Vec<String>,
}

struct Edges {
    runtime: Vec<(String, &'static str)>,
    capture: Option<String>,
    held: Option<Vec<String>>,
}

struct PadState {
    down: BTreeSet<String>,
    chords: BTreeSet<String>,
}

/// Reusable buffers for one pad's raw reading. The poll runs at 60 Hz and the
/// button/switch/axis counts never change for a given pad, so the vectors are
/// kept alive between frames instead of being reallocated on every poll.
#[derive(Default)]
struct Scratch {
    buttons: Vec<bool>,
    switches: Vec<GameControllerSwitchPosition>,
    axes: Vec<f64>,
    labels: Vec<Option<&'static str>>,
}

impl Scratch {
    /// Fit the buffers to a pad's current shape. `Vec::resize` keeps the
    /// existing allocation whenever the pad's shape has not changed.
    fn fit(&mut self, buttons: usize, switches: usize, axes: usize) {
        self.buttons.resize(buttons, false);
        self.switches.resize(switches, GameControllerSwitchPosition::Center);
        self.axes.resize(axes, 0.0);
        self.labels.clear();
        self.labels.reserve(buttons);
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum PadKey {
    /// Xbox 360 and XInput-compatible pads. Windows.Gaming.Input does not
    /// enumerate these (VID 045E PID 028E and the same protocol).
    XInput(u32),
    Raw(u16, u16, u32),
}

pub fn start(app: AppHandle) {
    RUN.store(true, Ordering::Relaxed);
    if let Err(e) = thread::Builder::new()
        .name("gamepad".into())
        .spawn(move || poll_loop(app))
    {
        applog::error("gamepad", format!("failed to start poll thread: {e}"));
    }
}

pub fn stop() {
    RUN.store(false, Ordering::Relaxed);
}

fn poll_loop(app: AppHandle) {
    if let Err(e) = unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
        applog::error("gamepad", format!("RoInitialize failed: {e}"));
        return;
    }
    applog::info("gamepad", "polling RawGameController");
    let mut states: HashMap<PadKey, PadState> = HashMap::new();
    let mut warned: HashSet<PadKey> = HashSet::new();
    let mut scratch: HashMap<PadKey, Scratch> = HashMap::new();
    let mut logged_poll_error = false;
    while RUN.load(Ordering::Relaxed) {
        match poll_once(&app, &mut states, &mut warned, &mut scratch) {
            Ok(()) => logged_poll_error = false,
            Err(e) if !logged_poll_error => {
                applog::warn("gamepad", format!("poll failed: {e}"));
                logged_poll_error = true;
            }
            Err(_) => {}
        }
        thread::sleep(POLL);
    }
}

fn poll_once(
    app: &AppHandle,
    states: &mut HashMap<PadKey, PadState>,
    warned: &mut HashSet<PadKey>,
    scratch: &mut HashMap<PadKey, Scratch>,
) -> windows::core::Result<()> {
    let mut seen = HashSet::new();
    for slot in 0..4 {
        let key = PadKey::XInput(slot);
        let Some(down) = read_xinput(slot) else {
            continue;
        };
        seen.insert(key);
        warned.remove(&key);
        let state = states.entry(key).or_insert_with(|| {
            applog::info("gamepad", format!("xinput slot {slot} connected"));
            PadState {
                down: BTreeSet::new(),
                chords: BTreeSet::new(),
            }
        });
        apply_edges(app, state, down);
    }

    let controllers = RawGameController::RawGameControllers()?;
    let mut ordinal: HashMap<(u16, u16), u32> = HashMap::new();

    for controller in controllers {
        // The same physical pad is often also an XInput device (`IG_` in the
        // device id). Reading it here as well would fire every button twice.
        if xinput_duplicate(&controller) {
            continue;
        }
        let vid = controller.HardwareVendorId()?;
        let pid = controller.HardwareProductId()?;
        let n = ordinal.entry((vid, pid)).or_insert(0);
        let key = PadKey::Raw(vid, pid, *n);
        *n += 1;
        seen.insert(key);

        let down = match read_down(&controller, vid, pid, scratch.entry(key).or_default()) {
            Ok(down) => {
                warned.remove(&key);
                down
            }
            Err(e) => {
                if warned.insert(key) {
                    applog::warn("gamepad", format!("read {vid:04X}:{pid:04X} failed: {e}"));
                }
                // Drop held chords so a failed read cannot leave hold-speed stuck.
                BTreeSet::new()
            }
        };
        let state = states.entry(key).or_insert_with(|| PadState {
            down: BTreeSet::new(),
            chords: BTreeSet::new(),
        });
        apply_edges(app, state, down);
    }

    let stale: Vec<_> = states.keys().filter(|k| !seen.contains(*k)).copied().collect();
    for key in stale {
        if let Some(state) = states.remove(&key) {
            for binding in state.chords {
                emit(app, binding, "Released");
            }
        }
        // The pad is gone; its buffers are not needed any more.
        scratch.remove(&key);
    }
    Ok(())
}

fn apply_edges(app: &AppHandle, state: &mut PadState, down: BTreeSet<String>) {
    let edges = take_edges(state, down);
    for (binding, phase) in edges.runtime {
        emit(app, binding, phase);
    }
    if let Some(binding) = edges.capture {
        if let Err(e) = app.emit("gamepad-capture", Capture { binding }) {
            applog::warn("gamepad", format!("capture emit failed: {e}"));
        }
    }
    if let Some(tokens) = edges.held {
        if let Err(e) = app.emit("gamepad-held", Held { tokens }) {
            applog::warn("gamepad", format!("held emit failed: {e}"));
        }
    }
}

/// Recording commits on release. One released button is the main key; if
/// several release in the same sample, the last sorted token of the set that
/// was down is the main key so the result stays stable.
fn capture_binding(previous: &BTreeSet<String>, released: &BTreeSet<String>) -> Option<String> {
    if released.is_empty() {
        return None;
    }
    let main = if released.len() == 1 {
        released.iter().next()?.clone()
    } else {
        previous.iter().next_back()?.clone()
    };
    if !previous.contains(&main) {
        return None;
    }
    Some(chord_binding(previous, &main))
}

fn take_edges(state: &mut PadState, down: BTreeSet<String>) -> Edges {
    // `state.down` still holds the previous sample until the end of this
    // function, so it can be read in place instead of cloned every frame.
    let released_buttons: BTreeSet<String> =
        state.down.difference(&down).cloned().collect();

    let mut runtime = Vec::new();
    let pressed: Vec<String> = down
        .iter()
        .filter(|token| !state.down.contains(*token))
        .cloned()
        .collect();
    for main in &pressed {
        let binding = chord_binding(&down, main);
        state.chords.insert(binding.clone());
        runtime.push((binding, "Pressed"));
    }
    let released_chords: Vec<String> = state
        .chords
        .iter()
        .filter(|binding| !chord_held(binding, &down))
        .cloned()
        .collect();
    for binding in released_chords {
        state.chords.remove(&binding);
        runtime.push((binding, "Released"));
    }

    let capture = capture_binding(&state.down, &released_buttons);
    let held = if state.down != down && !down.is_empty() {
        Some(down.iter().cloned().collect())
    } else {
        None
    };
    state.down = down;
    Edges { runtime, capture, held }
}

fn emit(app: &AppHandle, binding: String, state: &'static str) {
    if let Err(e) = app.emit("gamepad-chord", Chord { binding, state }) {
        applog::warn("gamepad", format!("emit failed: {e}"));
    }
}

/// Modifiers are the other buttons already down, sorted. The button that just
/// went down is the main key, so LB-then-A and A-then-LB stay different chords.
fn read_xinput(slot: u32) -> Option<BTreeSet<String>> {
    let mut state = XINPUT_STATE::default();
    let code = unsafe { XInputGetState(slot, &mut state) };
    if code != 0 {
        return None;
    }
    Some(xinput_tokens(state.Gamepad.wButtons.0, state.Gamepad.bLeftTrigger, state.Gamepad.bRightTrigger))
}

fn xinput_tokens(buttons: u16, left_trigger: u8, right_trigger: u8) -> BTreeSet<String> {
    const NAMED: &[(u16, &str)] = &[
        (XINPUT_GAMEPAD_A.0, "A"),
        (XINPUT_GAMEPAD_B.0, "B"),
        (XINPUT_GAMEPAD_X.0, "X"),
        (XINPUT_GAMEPAD_Y.0, "Y"),
        (XINPUT_GAMEPAD_LEFT_SHOULDER.0, "LB"),
        (XINPUT_GAMEPAD_RIGHT_SHOULDER.0, "RB"),
        (XINPUT_GAMEPAD_LEFT_THUMB.0, "LS"),
        (XINPUT_GAMEPAD_RIGHT_THUMB.0, "RS"),
        (XINPUT_GAMEPAD_BACK.0, "View"),
        (XINPUT_GAMEPAD_START.0, "Menu"),
        (XINPUT_GAMEPAD_DPAD_UP.0, "Up"),
        (XINPUT_GAMEPAD_DPAD_DOWN.0, "Down"),
        (XINPUT_GAMEPAD_DPAD_LEFT.0, "Left"),
        (XINPUT_GAMEPAD_DPAD_RIGHT.0, "Right"),
    ];
    let mut down = BTreeSet::new();
    let flags = XINPUT_GAMEPAD_BUTTON_FLAGS(buttons);
    for (bit, name) in NAMED {
        if flags.contains(XINPUT_GAMEPAD_BUTTON_FLAGS(*bit)) {
            down.insert((*name).to_string());
        }
    }
    if left_trigger >= XINPUT_GAMEPAD_TRIGGER_THRESHOLD.0 as u8 {
        down.insert("LT".into());
    }
    if right_trigger >= XINPUT_GAMEPAD_TRIGGER_THRESHOLD.0 as u8 {
        down.insert("RT".into());
    }
    down
}

fn xinput_duplicate(controller: &RawGameController) -> bool {
    let id = controller
        .NonRoamableId()
        .map(|value| value.to_string())
        .unwrap_or_default();
    id.contains("IG_")
}

fn chord_binding(down: &BTreeSet<String>, main: &str) -> String {
    let mut binding = String::from("Pad:");
    for token in down.iter().filter(|token| token.as_str() != main) {
        binding.push_str(token);
        binding.push('+');
    }
    binding.push_str(main);
    binding
}

fn chord_held(binding: &str, down: &BTreeSet<String>) -> bool {
    let body = binding.strip_prefix("Pad:").unwrap_or(binding);
    !body.is_empty() && body.split('+').all(|part| down.contains(part))
}

fn read_down(
    controller: &RawGameController,
    vid: u16,
    pid: u16,
    scratch: &mut Scratch,
) -> windows::core::Result<BTreeSet<String>> {
    let button_count = controller.ButtonCount()? as usize;
    let switch_count = controller.SwitchCount()? as usize;
    let axis_count = controller.AxisCount()? as usize;
    scratch.fit(button_count, switch_count, axis_count);

    let _ = controller.GetCurrentReading(
        &mut scratch.buttons,
        &mut scratch.switches,
        &mut scratch.axes,
    )?;

    for index in 0..button_count {
        scratch.labels.push(label_name(controller.GetButtonLabel(index as i32)?));
    }
    let any_label = scratch.labels.iter().any(|label| label.is_some());

    let mut down = BTreeSet::new();
    // A pad Windows recognizes, but whose raw buttons have no names, is read
    // through Gamepad so A/B/LB don't also show up as B0. Named buttons, and
    // extra unlabeled ones, come from the raw report.
    let gamepad = Gamepad::FromGameController(controller).ok();
    // A single sample of the recognized-pad reading serves both the button set
    // and the analog triggers, so a pad is never read twice per frame.
    let gamepad_reading = match &gamepad {
        Some(gamepad) => Some(gamepad.GetCurrentReading()?),
        None => None,
    };
    if gamepad_reading.is_some() && !any_label {
        if let Some(reading) = gamepad_reading.as_ref() {
            push_gamepad_buttons(&mut down, reading.Buttons);
        }
    } else {
        for (index, pressed) in scratch.buttons.iter().copied().enumerate() {
            if !pressed {
                continue;
            }
            let token = match scratch.labels[index] {
                Some(name) => name.to_string(),
                None => format!("V{vid:04X}P{pid:04X}B{index}"),
            };
            down.insert(token);
        }
    }

    // Hats are buttons. On a recognized pad the triggers are analog, so they
    // are not in the raw button list.
    for position in scratch.switches.iter().copied() {
        if let Some(name) = switch_name(position) {
            down.insert(name.to_string());
        }
    }
    if let Some(reading) = gamepad_reading.as_ref() {
        if reading.LeftTrigger >= TRIGGER_DOWN {
            down.insert("LT".into());
        }
        if reading.RightTrigger >= TRIGGER_DOWN {
            down.insert("RT".into());
        }
    } else {
        for (index, value) in scratch.axes.iter().copied().enumerate() {
            if value >= AXIS_DOWN {
                down.insert(format!("V{vid:04X}P{pid:04X}A{index}"));
            }
        }
    }
    Ok(down)
}

fn push_gamepad_buttons(down: &mut BTreeSet<String>, buttons: GamepadButtons) {
    const NAMED: &[(GamepadButtons, &str)] = &[
        (GamepadButtons::A, "A"),
        (GamepadButtons::B, "B"),
        (GamepadButtons::X, "X"),
        (GamepadButtons::Y, "Y"),
        (GamepadButtons::LeftShoulder, "LB"),
        (GamepadButtons::RightShoulder, "RB"),
        (GamepadButtons::LeftThumbstick, "LS"),
        (GamepadButtons::RightThumbstick, "RS"),
        (GamepadButtons::View, "View"),
        (GamepadButtons::Menu, "Menu"),
        (GamepadButtons::DPadUp, "Up"),
        (GamepadButtons::DPadDown, "Down"),
        (GamepadButtons::DPadLeft, "Left"),
        (GamepadButtons::DPadRight, "Right"),
        (GamepadButtons::Paddle1, "P1"),
        (GamepadButtons::Paddle2, "P2"),
        (GamepadButtons::Paddle3, "P3"),
        (GamepadButtons::Paddle4, "P4"),
    ];
    for (flag, name) in NAMED {
        if buttons.contains(*flag) {
            down.insert((*name).to_string());
        }
    }
}

fn label_name(label: GameControllerButtonLabel) -> Option<&'static str> {
    use GameControllerButtonLabel as L;
    Some(if label == L::None {
        return None;
    } else if label == L::XboxA || label == L::LetterA || label == L::Cross {
        "A"
    } else if label == L::XboxB || label == L::LetterB || label == L::Circle {
        "B"
    } else if label == L::XboxX || label == L::LetterX || label == L::Square {
        "X"
    } else if label == L::XboxY || label == L::LetterY || label == L::Triangle {
        "Y"
    } else if label == L::XboxLeftBumper || label == L::LeftBumper || label == L::Left1 {
        "LB"
    } else if label == L::XboxRightBumper || label == L::RightBumper || label == L::Right1 {
        "RB"
    } else if label == L::XboxLeftTrigger || label == L::LeftTrigger || label == L::Left2 {
        "LT"
    } else if label == L::XboxRightTrigger || label == L::RightTrigger || label == L::Right2 {
        "RT"
    } else if label == L::XboxLeftStickButton || label == L::LeftStickButton || label == L::Left3 {
        "LS"
    } else if label == L::XboxRightStickButton || label == L::RightStickButton || label == L::Right3 {
        "RS"
    } else if label == L::XboxView || label == L::View || label == L::Back || label == L::XboxBack || label == L::Select || label == L::Minus {
        "View"
    } else if label == L::XboxMenu || label == L::Menu || label == L::Start || label == L::XboxStart || label == L::Options || label == L::Plus {
        "Menu"
    } else if label == L::XboxUp || label == L::Up {
        "Up"
    } else if label == L::XboxDown || label == L::Down {
        "Down"
    } else if label == L::XboxLeft || label == L::Left {
        "Left"
    } else if label == L::XboxRight || label == L::Right {
        "Right"
    } else if label == L::XboxPaddle1 || label == L::Paddle1 {
        "P1"
    } else if label == L::XboxPaddle2 || label == L::Paddle2 {
        "P2"
    } else if label == L::XboxPaddle3 || label == L::Paddle3 {
        "P3"
    } else if label == L::XboxPaddle4 || label == L::Paddle4 {
        "P4"
    } else if label == L::Share {
        "Share"
    } else if label == L::Mode {
        "Mode"
    } else if label == L::LetterC {
        "C"
    } else if label == L::LetterL {
        "L"
    } else if label == L::LetterR {
        "R"
    } else if label == L::LetterZ {
        "Z"
    } else if label == L::DownLeftArrow {
        "DownLeft"
    } else if label == L::DialLeft {
        "DialL"
    } else if label == L::DialRight {
        "DialR"
    } else if label == L::Suspension {
        "Suspension"
    } else {
        return None;
    })
}

fn switch_name(position: GameControllerSwitchPosition) -> Option<&'static str> {
    use GameControllerSwitchPosition as S;
    if position == S::Up {
        Some("Up")
    } else if position == S::UpRight {
        Some("UpRight")
    } else if position == S::Right {
        Some("Right")
    } else if position == S::DownRight {
        Some("DownRight")
    } else if position == S::Down {
        Some("Down")
    } else if position == S::DownLeft {
        Some("DownLeft")
    } else if position == S::Left {
        Some("Left")
    } else if position == S::UpLeft {
        Some("UpLeft")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn down(tokens: &[&str]) -> BTreeSet<String> {
        tokens.iter().map(|token| (*token).to_string()).collect()
    }

    #[test]
    fn single_button_and_chord_keep_the_last_press_as_main() {
        let held = down(&["LB", "A"]);
        assert_eq!(chord_binding(&held, "A"), "Pad:LB+A");
        assert_eq!(chord_binding(&held, "LB"), "Pad:A+LB");
        assert_eq!(chord_binding(&down(&["Y"]), "Y"), "Pad:Y");
    }

    #[test]
    fn modifiers_are_sorted_and_release_tracks_every_part() {
        let held = down(&["Y", "LB", "A"]);
        assert_eq!(chord_binding(&held, "A"), "Pad:LB+Y+A");
        assert!(chord_held("Pad:LB+Y+A", &held));
        assert!(!chord_held("Pad:LB+Y+A", &down(&["LB", "Y"])));
        assert!(chord_held("Pad:V045EP028EB3", &down(&["V045EP028EB3"])));
    }

    #[test]
    fn capture_commits_the_released_button_as_main() {
        let previous = down(&["LB", "Up"]);
        assert_eq!(capture_binding(&previous, &down(&["Up"])).as_deref(), Some("Pad:LB+Up"));
        let both = capture_binding(&previous, &previous).unwrap();
        assert!(both.contains("LB") && both.contains("Up"));
        assert!(capture_binding(&down(&["LB"]), &BTreeSet::new()).is_none());
    }

    #[test]
    fn press_previews_without_capture_and_release_commits_the_chord() {
        let mut state = PadState { down: BTreeSet::new(), chords: BTreeSet::new() };
        let held_lb = take_edges(&mut state, down(&["LB"]));
        assert!(held_lb.capture.is_none());
        assert_eq!(held_lb.held.unwrap(), vec!["LB".to_string()]);
        assert!(held_lb.runtime.iter().any(|(binding, phase)| binding == "Pad:LB" && *phase == "Pressed"));

        let both = take_edges(&mut state, down(&["LB", "Up"]));
        assert!(both.capture.is_none());
        assert!(both.runtime.iter().any(|(binding, phase)| binding == "Pad:LB+Up" && *phase == "Pressed"));

        let released = take_edges(&mut state, down(&["LB"]));
        assert_eq!(released.capture.as_deref(), Some("Pad:LB+Up"));
        assert!(released.runtime.iter().any(|(binding, phase)| binding == "Pad:LB+Up" && *phase == "Released"));
        assert!(released.runtime.iter().any(|(binding, phase)| binding == "Pad:LB" && *phase == "Pressed") == false);
    }

    #[test]
    fn xinput_maps_face_buttons_and_the_trigger_threshold() {
        let pressed = xinput_tokens(XINPUT_GAMEPAD_A.0 | XINPUT_GAMEPAD_LEFT_SHOULDER.0, 0, 0);
        assert_eq!(pressed, down(&["A", "LB"]));
        assert!(xinput_tokens(0, XINPUT_GAMEPAD_TRIGGER_THRESHOLD.0 as u8, 0).contains("LT"));
        assert!(!xinput_tokens(0, XINPUT_GAMEPAD_TRIGGER_THRESHOLD.0 as u8 - 1, 0).contains("LT"));
    }
}
