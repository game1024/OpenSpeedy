//! Injection guard (stage 4).
//!
//! Before the bridge touches a process, this module answers one question: is
//! there a known anti-cheat inside it? The answer comes from the process image
//! name and from the modules the process has loaded — both read-only
//! enumeration that the process list already performs.
//!
//! Default is deny. A process whose modules cannot be listed is refused as
//! unverified rather than assumed clean, and the UI offers a one-off override
//! for the false positive that inevitably follows.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::process_enumerator;

/// Stage-4 rollback switch. Default `false` = hard deny. Flipping it to
/// `true` degrades the module to a strong warning without touching code.
static WARN_ONLY: AtomicBool = AtomicBool::new(false);

pub fn set_warn_only(on: bool) {
    WARN_ONLY.store(on, Ordering::Relaxed);
}

/// Matchers, most specific first. A needle shorter than five characters is
/// matched against the whole file name (plus its extension) so `vgc` cannot
/// swallow an unrelated `vgcore.dll`.
const MATCHERS: &[(&str, &[&str])] = &[
    ("EasyAntiCheat", &["easyanticheat", "easyanti-cheat", "start_protected_game"]),
    ("BattlEye", &["beservice", "beclient", "battleye"]),
    ("Vanguard", &["vgc", "vgk"]),
    ("nProtect GameGuard", &["gameguard", "gamemon", "npggnt"]),
    ("XignCode3", &["xigncode", "xhunter1"]),
    ("AntiCheatExpert", &["anticheatexpert", "ace-base", "ace-game", "sguard"]),
    ("mhyprot", &["mhyprot"]),
];

#[derive(Serialize, Clone)]
pub struct GuardVerdict {
    /// False means the caller must not inject.
    pub allowed: bool,
    /// `ok` | `anticheat` | `unreadable` | `unverified`.
    pub reason: String,
    /// Which matcher fired, for the message the user sees.
    pub matched: Option<String>,
    pub process: String,
    /// The target runs elevated; the UI uses this to explain a refused handle.
    pub elevated: bool,
    /// Present when the hard deny was degraded to a strong warning by the
    /// stage-4 rollback switch. `allowed` is then true, but the UI must still
    /// show the anti-cheat warning before injecting.
    pub warning: Option<String>,
}

fn hit(name: &str, needle: &str) -> bool {
    if needle.len() >= 5 {
        name.contains(needle)
    } else {
        // Short needles only match a whole file name: `vgc.exe`, `vgk.sys`.
        name == needle || name.starts_with(&format!("{needle}."))
    }
}

fn match_name(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    MATCHERS
        .iter()
        .find(|(_, needles)| needles.iter().any(|needle| hit(&lower, needle)))
        .map(|(label, _)| *label)
}

fn refused(info: &process_enumerator::ProcessInfo, reason: &str, matched: Option<&'static str>) -> GuardVerdict {
    GuardVerdict {
        allowed: false,
        reason: reason.to_string(),
        matched: matched.map(str::to_string),
        process: info.name.clone(),
        elevated: info.admin,
        warning: None,
    }
}

/// Decide whether `pid` may be injected. Pure read-only inspection.
pub fn check(pid: u32) -> GuardVerdict {
    let mut verdict = check_raw(pid);
    if !verdict.allowed && WARN_ONLY.load(Ordering::Relaxed) {
        verdict.warning = Some(verdict.reason.clone());
        verdict.allowed = true;
    }
    verdict
}

fn check_raw(pid: u32) -> GuardVerdict {
    let info = match process_enumerator::enumerate_processes_fast()
        .into_iter()
        .find(|proc| proc.pid == pid)
    {
        Some(info) => info,
        // Gone, or protected beyond a process snapshot.
        None => {
            return GuardVerdict {
                allowed: false,
                reason: "unreadable".to_string(),
                matched: None,
                process: String::new(),
                elevated: false,
                warning: None,
            }
        }
    };

    if let Some(label) = match_name(&info.name) {
        return refused(&info, "anticheat", Some(label));
    }

    let modules = process_enumerator::enumerate_modules(pid);
    for module in &modules {
        if let Some(label) = match_name(&module.name) {
            return refused(&info, "anticheat", Some(label));
        }
    }

    // No module list means no evidence either way; refuse instead of guessing.
    if modules.is_empty() {
        return refused(&info, "unverified", None);
    }

    GuardVerdict {
        allowed: true,
        reason: "ok".to_string(),
        matched: None,
        process: info.name,
        elevated: info.admin,
        warning: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_anti_cheat_names_are_caught() {
        assert_eq!(match_name("EasyAntiCheat.exe"), Some("EasyAntiCheat"));
        assert_eq!(match_name("EasyAntiCheat.dll"), Some("EasyAntiCheat"));
        assert_eq!(match_name("BEService.exe"), Some("BattlEye"));
        assert_eq!(match_name("BEClient_x64.dll"), Some("BattlEye"));
        assert_eq!(match_name("vgc.exe"), Some("Vanguard"));
        assert_eq!(match_name("vgk.sys"), Some("Vanguard"));
        assert_eq!(match_name("GameGuard.des"), Some("nProtect GameGuard"));
        assert_eq!(match_name("npggNT64.des"), Some("nProtect GameGuard"));
        assert_eq!(match_name("XignCode.dll"), Some("XignCode3"));
        assert_eq!(match_name("xhunter1.sys"), Some("XignCode3"));
        assert_eq!(match_name("ACE-BASE64.dll"), Some("AntiCheatExpert"));
        assert_eq!(match_name("SGuard64.exe"), Some("AntiCheatExpert"));
        assert_eq!(match_name("mhyprot3.sys"), Some("mhyprot"));
    }

    /// A false positive blocks a single-player game outright, so the matchers
    /// must not fire on ordinary names.
    #[test]
    fn ordinary_names_stay_clean() {
        for name in ["game.exe", "notepad.exe", "kernel32.dll", "OpenSpeedy.exe", "explorer.exe"] {
            assert_eq!(match_name(name), None, "{name} must not match an anti-cheat");
        }
    }

    /// `vgc` is three characters; without the whole-name rule it would swallow
    /// any DLL whose name merely starts with those letters.
    /// A real-machine check: the guard must be able to resolve a live pid
    /// through the process snapshot and module enumeration, and must not flag
    /// an ordinary test process as protected.
    #[test]
    fn a_live_process_is_enumerated_without_a_false_positive() {
        set_warn_only(false);
        let verdict = check(std::process::id());
        assert!(!verdict.process.is_empty(), "live pid must be in the snapshot");
        assert_ne!(verdict.reason, "anticheat");
        assert_eq!(verdict.matched, None);
    }

    /// The rollback switch degrades a hard deny to a strong warning without
    /// changing any code. A pid that cannot be enumerated is always refused.
    #[test]
    fn warn_only_degrades_a_denial_to_a_warning() {
        set_warn_only(false);
        let hard = check(u32::MAX);
        assert!(!hard.allowed);
        assert!(hard.warning.is_none());

        set_warn_only(true);
        let soft = check(u32::MAX);
        assert!(soft.allowed);
        assert_eq!(soft.warning.as_deref(), Some("unreadable"));
        set_warn_only(false);
    }

    #[test]
    fn short_needles_only_match_whole_file_names() {
        assert_eq!(match_name("vgcore.dll"), None);
        assert_eq!(match_name("vgc.exe"), Some("Vanguard"));
    }
}
