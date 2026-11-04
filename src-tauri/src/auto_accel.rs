//! Auto acceleration for bound games.
//!
//! A rule binds a *process name* (for example `game.exe`) to a speed factor or
//! one of the five gears. Rules live in `auto_accel.json` in the app data folder
//! and are watched by a dedicated Rust thread — deliberately not by the React
//! UI. A silent boot hides the window, and a hidden WebView can be throttled,
//! but process detection and injection still have to happen the moment the game
//! starts.
//!
//! The speed factor itself is global to each bridge process (a shared data
//! segment in speedpatch.dll). When several bound games run at once, the factor
//! of the most recently started one wins; every bound process is still injected
//! and enabled. This is a property of the bridge, not of this module.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;
use windows::Win32::Foundation::{CloseHandle, BOOL};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    IsWow64Process, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

const PREFS_FILE: &str = "auto_accel.json";
const SETTINGS_FILE: &str = "settings.json";
const POLL_MS: u64 = 500;
const MAX_INJECT_ATTEMPTS: u8 = 10;
const MIN_SPEED: f64 = 0.001;
const MAX_SPEED: f64 = 1000.0;

// ── Persisted data ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AutoRule {
    /// Executable name as reported by the process snapshot, e.g. `game.exe`.
    pub name: String,
    /// Optional metadata for the UI; matching is by name so a moved install
    /// keeps working.
    pub exe_path: Option<String>,
    pub arch: Option<String>,
    /// Factor used when `gear` is `None`. Also a snapshot of the gear's factor
    /// at bind time, used as a fallback if gear speeds are unavailable.
    pub speed: f64,
    /// 1..=5 when the user bound a gear instead of a literal multiplier.
    pub gear: Option<u8>,
}

impl Default for AutoRule {
    fn default() -> Self {
        Self {
            name: String::new(),
            exe_path: None,
            arch: None,
            speed: 1.0,
            gear: None,
        }
    }
}

fn default_gear_speeds() -> Vec<f64> {
    vec![1.0, 2.0, 5.0, 10.0, 100.0]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AutoAccelConfig {
    /// Master switch, independent of the boot-launch setting.
    pub enabled: bool,
    pub rules: Vec<AutoRule>,
    /// Mirrors the five gear multipliers from the UI settings. Kept here so a
    /// gear binding keeps following the gear definition instead of freezing a
    /// number at bind time.
    pub gear_speeds: Vec<f64>,
}

impl Default for AutoAccelConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            rules: Vec::new(),
            gear_speeds: default_gear_speeds(),
        }
    }
}

struct Inner {
    config: AutoAccelConfig,
    /// Factor the monitor currently applies because a bound game is running.
    /// The frontend reads this so its startup restore does not overwrite it.
    active_speed: Option<f64>,
    /// Bumped on every config change so the monitor re-evaluates immediately.
    generation: u64,
}

pub struct AutoAccelState {
    inner: Mutex<Inner>,
    path: PathBuf,
    settings_path: PathBuf,
}

impl AutoAccelState {
    pub fn load(dir: &Path) -> Arc<Self> {
        let path = crate::prefs::file(dir, PREFS_FILE);
        let mut config: AutoAccelConfig = crate::prefs::read(&path);
        // Fall back to the gear definitions already saved by the UI. This keeps
        // gear bindings correct even when the WebView never gets to call
        // `set_auto_gear_speeds` (silent boot, hidden/throttled window).
        if let Some(speeds) = read_gear_speeds(&crate::prefs::file(dir, SETTINGS_FILE)) {
            config.gear_speeds = speeds;
        }
        if config.gear_speeds.len() != 5 {
            config.gear_speeds = default_gear_speeds();
        }
        Arc::new(Self {
            inner: Mutex::new(Inner {
                config,
                active_speed: None,
                generation: 0,
            }),
            path,
            settings_path: crate::prefs::file(dir, SETTINGS_FILE),
        })
    }

    fn guard(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn snapshot(&self) -> (AutoAccelConfig, u64) {
        let inner = self.guard();
        (inner.config.clone(), inner.generation)
    }

    fn config(&self) -> AutoAccelConfig {
        self.guard().config.clone()
    }

    fn active_speed(&self) -> Option<f64> {
        self.guard().active_speed
    }

    fn set_active_speed(&self, speed: Option<f64>) {
        let mut inner = self.guard();
        if inner.active_speed != speed {
            inner.active_speed = speed;
        }
    }

    /// Mutate + persist. Persisting before releasing the lock means two quick
    /// edits cannot write stale snapshots over each other.
    fn update<F>(&self, f: F) -> Result<AutoAccelConfig, String>
    where
        F: FnOnce(&mut AutoAccelConfig),
    {
        let mut inner = self.guard();
        f(&mut inner.config);
        crate::prefs::write(&self.path, &inner.config)?;
        inner.generation = inner.generation.wrapping_add(1);
        Ok(inner.config.clone())
    }

    /// Refresh gear definitions from the UI store when available.
    fn sync_gears(&self) {
        if let Some(speeds) = read_gear_speeds(&self.settings_path) {
            let mut inner = self.guard();
            if inner.config.gear_speeds != speeds {
                inner.config.gear_speeds = speeds;
                let _ = crate::prefs::write(&self.path, &inner.config);
                inner.generation = inner.generation.wrapping_add(1);
            }
        }
    }
}

/// Read `gear1Speed`..`gear5Speed` from the plugin-store file. The store writes
/// a top-level object with a `settings` key; accept both shapes so a changed
/// store layout degrades to defaults instead of breaking gear bindings.
fn read_gear_speeds(path: &Path) -> Option<Vec<f64>> {
    let value: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    let root = value.get("settings").unwrap_or(&value);
    let mut speeds = Vec::with_capacity(5);
    for i in 1..=5 {
        let factor = root
            .get(format!("gear{i}Speed"))
            .and_then(|v| v.as_f64())
            .unwrap_or_else(|| default_gear_speeds()[i - 1]);
        speeds.push(if valid_speed(factor) { factor } else { 1.0 });
    }
    Some(speeds)
}

fn valid_speed(v: f64) -> bool {
    v.is_finite() && (MIN_SPEED..=MAX_SPEED).contains(&v)
}

fn normalise_rule(mut rule: AutoRule) -> Result<AutoRule, String> {
    rule.name = rule.name.trim().to_string();
    if rule.name.is_empty() || rule.name.len() > 260 {
        return Err("a bound process name must be 1..260 characters".into());
    }
    if !valid_speed(rule.speed) {
        return Err(format!("speed must be between {MIN_SPEED} and {MAX_SPEED}"));
    }
    if let Some(gear) = rule.gear {
        if !(1..=5).contains(&gear) {
            return Err("gear must be between 1 and 5".into());
        }
    }
    let trim = |v: Option<String>| {
        v.and_then(|s| {
            let s = s.trim().chars().take(1024).collect::<String>();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        })
    };
    rule.exe_path = trim(rule.exe_path);
    rule.arch = trim(rule.arch);
    Ok(rule)
}

/// Resolve the factor for a rule. A gear binding follows the current gear
/// definition; a custom binding uses its saved multiplier.
fn rule_speed(rule: &AutoRule, cfg: &AutoAccelConfig) -> f64 {
    if let Some(gear) = rule.gear {
        if let Some(v) = cfg.gear_speeds.get((gear - 1) as usize) {
            if valid_speed(*v) {
                return *v;
            }
        }
    }
    rule.speed
}

// ── Tauri commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn get_auto_accel_config(state: State<'_, Arc<AutoAccelState>>) -> AutoAccelConfig {
    state.inner().sync_gears();
    state.inner().config()
}

#[tauri::command]
pub fn set_auto_accel_enabled(
    state: State<'_, Arc<AutoAccelState>>,
    enabled: bool,
) -> Result<AutoAccelConfig, String> {
    state.inner().sync_gears();
    state.inner().update(|cfg| cfg.enabled = enabled)
}

/// Insert or replace a rule, keyed by case-insensitive process name.
#[tauri::command]
pub fn upsert_auto_rule(
    state: State<'_, Arc<AutoAccelState>>,
    rule: AutoRule,
) -> Result<AutoAccelConfig, String> {
    let rule = normalise_rule(rule)?;
    state.inner().sync_gears();
    state.inner().update(|cfg| {
        let key = rule.name.to_lowercase();
        if let Some(existing) = cfg.rules.iter_mut().find(|r| r.name.to_lowercase() == key) {
            *existing = rule.clone();
        } else {
            cfg.rules.push(rule.clone());
        }
    })
}

#[tauri::command]
pub fn remove_auto_rule(
    state: State<'_, Arc<AutoAccelState>>,
    name: String,
) -> Result<AutoAccelConfig, String> {
    let key = name.trim().to_lowercase();
    state.inner().update(|cfg| {
        cfg.rules.retain(|r| r.name.to_lowercase() != key);
    })
}

/// Push the current gear definitions from the UI into the persisted config.
#[tauri::command]
pub fn set_auto_gear_speeds(
    state: State<'_, Arc<AutoAccelState>>,
    speeds: Vec<f64>,
) -> Result<AutoAccelConfig, String> {
    if speeds.len() != 5 || !speeds.iter().all(|v| valid_speed(*v)) {
        return Err("expected five valid gear multipliers".into());
    }
    state.inner().update(|cfg| cfg.gear_speeds = speeds.clone())
}

/// `None` when no bound game is running, otherwise the factor the monitor
/// applied. Used by the UI to avoid restoring an older manual speed.
#[tauri::command]
pub fn get_auto_accel_active_speed(state: State<'_, Arc<AutoAccelState>>) -> Option<f64> {
    state.inner().active_speed()
}

// ── Process monitor ──────────────────────────────────────────────────────

struct Proc {
    pid: u32,
    name: String,
}

#[derive(Clone)]
struct Applied {
    name: String,
    is32: bool,
}

/// Snapshot only PID and executable name. Architecture is queried lazily, and
/// only for processes that actually match a rule.
fn snapshot_processes() -> Vec<Proc> {
    let mut out = Vec::new();
    let snapshot = match unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) } {
        Ok(h) if !h.is_invalid() => h,
        _ => return out,
    };

    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            let name = String::from_utf16_lossy(&entry.szExeFile)
                .trim_end_matches('\0')
                .to_string();
            if !name.is_empty() {
                out.push(Proc {
                    pid: entry.th32ProcessID,
                    name,
                });
            }
            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }
    unsafe {
        let _ = CloseHandle(snapshot);
    }
    out
}

fn is_wow64(pid: u32) -> bool {
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return false;
        };
        let mut wow64 = BOOL::default();
        let ok = IsWow64Process(handle, &mut wow64).is_ok();
        let _ = CloseHandle(handle);
        ok && wow64.as_bool()
    }
}

pub fn spawn_monitor(state: Arc<AutoAccelState>) {
    if let Err(e) = std::thread::Builder::new()
        .name("auto-accel-monitor".into())
        .spawn(move || monitor_loop(state))
    {
        crate::applog::error(
            "auto",
            format!("could not start the auto-accel monitor: {e}"),
        );
    }
}

fn monitor_loop(state: Arc<AutoAccelState>) {
    crate::applog::info("auto", "auto-acceleration monitor started");
    let mut applied: HashMap<u32, Applied> = HashMap::new();
    let mut attempts: HashMap<u32, u8> = HashMap::new();
    let mut seen_generation = u64::MAX;
    let mut last_factor: Option<f64> = None;

    loop {
        let (cfg, generation) = state.snapshot();
        if generation != seen_generation {
            seen_generation = generation;
            // A rule or gear change can alter the desired factor even when the
            // very same processes are still running.
            last_factor = None;
        }

        if cfg.enabled && !cfg.rules.is_empty() {
            let rules: HashMap<String, f64> = cfg
                .rules
                .iter()
                .map(|r| (r.name.to_lowercase(), rule_speed(r, &cfg)))
                .collect();

            let procs = snapshot_processes();
            let live: HashSet<u32> = procs.iter().map(|p| p.pid).collect();
            let mut matched: HashSet<u32> = HashSet::new();
            let mut pending: Vec<Proc> = Vec::new();
            // Highest PID is a good approximation of "most recently started"
            // and makes the global-factor choice deterministic.
            let mut newest: Option<(u32, f64, String)> = None;

            for p in procs {
                let Some(&speed) = rules.get(&p.name.to_lowercase()) else {
                    continue;
                };
                matched.insert(p.pid);
                if newest.as_ref().map_or(true, |(pid, _, _)| p.pid > *pid) {
                    newest = Some((p.pid, speed, p.name.clone()));
                }
                if !applied.contains_key(&p.pid)
                    && attempts.get(&p.pid).copied().unwrap_or(0) < MAX_INJECT_ATTEMPTS
                {
                    pending.push(p);
                }
            }

            // Stop acceleration for processes that exited, whose rule was
            // removed, or when the master switch went off.
            let stale: Vec<(u32, Applied)> = applied
                .iter()
                .filter(|(pid, _)| !matched.contains(pid))
                .map(|(pid, info)| (*pid, info.clone()))
                .collect();
            for (pid, info) in stale {
                if info.is32 {
                    crate::bridge_client::bridge32_disable(pid);
                } else {
                    crate::bridge_client::bridge64_disable(pid);
                }
                applied.remove(&pid);
                attempts.remove(&pid);
                crate::applog::info(
                    "auto",
                    format!("stopped auto acceleration for {} (pid {pid})", info.name),
                );
            }

            let mut injected_new_process = false;
            for p in pending {
                let is32 = is_wow64(p.pid);
                let injected = if is32 {
                    crate::bridge_client::bridge32_inject(p.pid)
                } else {
                    crate::bridge_client::bridge64_inject(p.pid)
                };
                if is32 {
                    crate::bridge_client::bridge32_enable(p.pid);
                } else {
                    crate::bridge_client::bridge64_enable(p.pid);
                }
                if injected {
                    injected_new_process = true;
                    applied.insert(
                        p.pid,
                        Applied {
                            name: p.name.clone(),
                            is32,
                        },
                    );
                    attempts.remove(&p.pid);
                    crate::applog::info(
                        "auto",
                        format!("auto acceleration applied to {} (pid {})", p.name, p.pid),
                    );
                } else {
                    let n = attempts.entry(p.pid).or_insert(0);
                    *n = n.saturating_add(1);
                    if *n == MAX_INJECT_ATTEMPTS {
                        crate::applog::warn(
                            "auto",
                            format!(
                                "giving up on {} (pid {}) after {MAX_INJECT_ATTEMPTS} failed injections — run as administrator or check the game's protection",
                                p.name, p.pid
                            ),
                        );
                    }
                }
            }

            attempts.retain(|pid, _| matched.contains(pid) && live.contains(pid));

            // A fresh bound process must get the saved factor even when the
            // global factor happens to have the same value already (for example
            // the user dragged the slider in between two launches).
            if injected_new_process {
                last_factor = None;
            }

            let desired = newest.as_ref().map(|(_, factor, _)| *factor);
            state.set_active_speed(desired);
            if desired != last_factor {
                if let Some(factor) = desired {
                    // Both bridges must be set. `||` would short-circuit and
                    // leave the 32-bit bridge on the previous factor.
                    let a = crate::bridge_client::bridge64_set_speed(factor);
                    let b = crate::bridge_client::bridge32_set_speed(factor);
                    crate::applog::info(
                        "auto",
                        format!(
                            "applied {factor}× for {} (64-bit bridge: {a}, 32-bit bridge: {b})",
                            newest.as_ref().map(|(_, _, n)| n.as_str()).unwrap_or("?")
                        ),
                    );
                }
                last_factor = desired;
            }
        } else {
            if !applied.is_empty() {
                for (pid, info) in applied.drain() {
                    if info.is32 {
                        crate::bridge_client::bridge32_disable(pid);
                    } else {
                        crate::bridge_client::bridge64_disable(pid);
                    }
                }
            }
            attempts.clear();
            state.set_active_speed(None);
            last_factor = None;
        }

        std::thread::sleep(Duration::from_millis(POLL_MS));
    }
}
