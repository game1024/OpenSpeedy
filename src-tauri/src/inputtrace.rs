//! Structured trace records for the input layer (stage 0: observation only).
//!
//! Three events are in the schema — `register_fail`, `hotkey_fired`,
//! `inject_result` — and every free-form value is filtered against a whitelist
//! before it is written. That filter is what makes "the log carries slot names
//! only" a property of this module instead of a promise made by each caller: a
//! window title or a key combination passed by mistake collapses to `unknown`,
//! and an unrecognised reason collapses to `other`.
//!
//! Records go through the normal diagnostics log as `[INFO] [input] …`, so one
//! `grep '\[input\]'` collects the whole chain for a bug report.
//!
//! Nothing here reads input, registers anything, or talks to a game process —
//! it formats and writes text.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The nine configurable slots, plus `diagnostic` for a probe started from the
/// diagnostics page (it is a real hotkey, but not a configured slot).
const SLOTS: [&str; 10] = [
    "increaseSpeedShortcut",
    "decreaseSpeedShortcut",
    "resetSpeedShortcut",
    "gear1Shortcut",
    "gear2Shortcut",
    "gear3Shortcut",
    "gear4Shortcut",
    "gear5Shortcut",
    "holdShortcut",
    "diagnostic",
];

/// How a trigger arrived. Stage 0 only produces `hotkey` and `gamepad`;
/// `poll` is accepted up front so stage 2 does not have to change the schema.
const CHANNELS: [&str; 3] = ["hotkey", "poll", "gamepad"];

const REASONS: [&str; 7] = [
    "ok",
    "inject_failed",
    "bridge_unreachable",
    "no_target",
    "elevated_denied",
    "guard_denied",
    "other",
];

/// A retried injection that keeps failing must not write a line per attempt —
/// the process list re-injects once a second. Identical results within this
/// window are dropped.
const INJECT_DEDUPE: Duration = Duration::from_secs(10);

static ENABLED: AtomicBool = AtomicBool::new(false);
static LAST_INJECT: Mutex<Option<(u32, bool, Instant)>> = Mutex::new(None);

/// Set from the frontend, which owns the `input.observe` switch.
pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// Whitelisted value, or `fallback` when the caller sent something else.
fn allowed(value: Option<&str>, allowed: &[&str], fallback: &str) -> String {
    match value {
        Some(v) if allowed.contains(&v) => v.to_string(),
        _ => fallback.to_string(),
    }
}

fn number(value: Option<u32>) -> String {
    value.map(|v| v.to_string()).unwrap_or_else(|| "none".to_string())
}

/// One record, with the fields its event defines. `None` means the event name
/// is not part of the schema — the caller is wrong, nothing is written.
fn line(
    event: &str,
    slot: Option<&str>,
    channel: Option<&str>,
    code: Option<u32>,
    pid: Option<u32>,
    ok: Option<bool>,
    reason: Option<&str>,
) -> Option<String> {
    match event {
        "register_fail" => Some(format!(
            "register_fail slot={} code={}",
            allowed(slot, &SLOTS, "unknown"),
            number(code),
        )),
        "hotkey_fired" => Some(format!(
            "hotkey_fired slot={} channel={}",
            allowed(slot, &SLOTS, "unknown"),
            allowed(channel, &CHANNELS, "unknown"),
        )),
        "inject_result" => Some(format!(
            "inject_result pid={} ok={} reason={}",
            number(pid),
            match ok {
                Some(true) => "true",
                Some(false) => "false",
                None => "none",
            },
            allowed(reason, &REASONS, "other"),
        )),
        _ => None,
    }
}

/// Write one record. Ignored entirely while the stage-0 switch is off.
pub fn trace(
    event: &str,
    slot: Option<&str>,
    channel: Option<&str>,
    code: Option<u32>,
    pid: Option<u32>,
    ok: Option<bool>,
    reason: Option<&str>,
) {
    if !is_enabled() {
        return;
    }
    match line(event, slot, channel, code, pid, ok, reason) {
        Some(record) => crate::applog::info("input", record),
        // The event name is caller-supplied, so only the failure is recorded —
        // echoing it would reopen the door this module closes.
        None => crate::applog::warn("input", "dropped a trace record with an unknown event"),
    }
}

/// True when this result is a repeat of the previous one, close enough in time
/// that writing it again would only be noise.
fn duplicate(previous: Option<(u32, bool, Instant)>, pid: u32, ok: bool, now: Instant) -> bool {
    match previous {
        Some((prev_pid, prev_ok, at)) => {
            prev_pid == pid && prev_ok == ok && now.saturating_duration_since(at) < INJECT_DEDUPE
        }
        None => false,
    }
}

/// Injection is the one place where a failure repeats every second, so it gets
/// its own entry point with the dedupe applied.
pub fn trace_inject(pid: u32, ok: bool, reason: &str) {
    if !is_enabled() {
        return;
    }
    let now = Instant::now();
    let emit = {
        // A poisoned lock costs at most one duplicate line.
        let mut last = match LAST_INJECT.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if duplicate(*last, pid, ok, now) {
            false
        } else {
            *last = Some((pid, ok, now));
            true
        }
    };
    if emit {
        trace("inject_result", None, None, None, Some(pid), Some(ok), Some(reason));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Field completeness is structural: each event always emits the same keys
    /// in the same order, so a log reader never has to guess.
    #[test]
    fn every_event_writes_its_full_field_set() {
        assert_eq!(
            line("register_fail", Some("increaseSpeedShortcut"), None, Some(1409), None, None, None).as_deref(),
            Some("register_fail slot=increaseSpeedShortcut code=1409"),
        );
        assert_eq!(
            line("register_fail", Some("resetSpeedShortcut"), None, None, None, None, None).as_deref(),
            Some("register_fail slot=resetSpeedShortcut code=none"),
        );
        assert_eq!(
            line("hotkey_fired", Some("gear3Shortcut"), Some("poll"), None, None, None, None).as_deref(),
            Some("hotkey_fired slot=gear3Shortcut channel=poll"),
        );
        assert_eq!(
            line("inject_result", None, None, None, Some(4321), Some(false), Some("bridge_unreachable")).as_deref(),
            Some("inject_result pid=4321 ok=false reason=bridge_unreachable"),
        );
        assert_eq!(
            line("inject_result", None, None, None, Some(4321), Some(true), Some("ok")).as_deref(),
            Some("inject_result pid=4321 ok=true reason=ok"),
        );
    }

    /// The whole point of the whitelist: text that is not a slot name cannot
    /// reach the file, so a key combination or a window title never leaks.
    #[test]
    fn free_text_cannot_reach_the_log() {
        assert_eq!(
            line("register_fail", Some("Ctrl+Alt+0"), None, Some(1409), None, None, None).as_deref(),
            Some("register_fail slot=unknown code=1409"),
        );
        let leaked = line("inject_result", None, None, None, Some(7), Some(false), Some("Untitled - Notepad"));
        assert_eq!(
            leaked.as_deref(),
            Some("inject_result pid=7 ok=false reason=other"),
            "a window title must collapse to a reason token",
        );
        assert_eq!(
            line("hotkey_fired", Some("increaseSpeedShortcut"), Some("mouse"), None, None, None, None).as_deref(),
            Some("hotkey_fired slot=increaseSpeedShortcut channel=unknown"),
        );
    }

    #[test]
    fn unknown_events_are_rejected() {
        assert_eq!(line("register_ok", Some("gainSpeed"), None, None, None, None, None), None);
        assert_eq!(line("", None, None, None, None, None, None), None);
    }

    /// A missing slot/pid stays visible as `none` instead of silently shifting
    /// the remaining fields.
    #[test]
    fn absent_values_keep_their_key() {
        assert_eq!(
            line("inject_result", None, None, None, None, None, None).as_deref(),
            Some("inject_result pid=none ok=none reason=other"),
        );
    }

    #[test]
    fn repeated_injection_results_are_deduped() {
        let t0 = Instant::now();
        assert!(!duplicate(None, 10, false, t0));
        assert!(duplicate(Some((10, false, t0)), 10, false, t0 + Duration::from_secs(3)));
        // A different outcome, a different process, or a different attempt is news.
        assert!(!duplicate(Some((10, false, t0)), 10, true, t0 + Duration::from_secs(3)));
        assert!(!duplicate(Some((10, false, t0)), 11, false, t0 + Duration::from_secs(3)));
        assert!(!duplicate(
            Some((10, false, t0)),
            10,
            false,
            t0 + INJECT_DEDUPE + Duration::from_millis(1)
        ));
    }
}
