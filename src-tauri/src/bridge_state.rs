//! Readiness of the two bridge processes.
//!
//! The bridges are spawned on a background thread so the event loop and the
//! WebView can paint immediately. Commands that need a bridge wait here until
//! the bridge for their target architecture is ready, instead of failing the
//! first click during cold start.

use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Starting,
    Ready,
    Failed,
    /// The app is shutting down; waiters must return immediately.
    Stopped,
}

/// Index 0 is bridge64 (x64 targets), index 1 is bridge32 (x86 targets).
static STATE: Mutex<[Phase; 2]> = Mutex::new([Phase::Starting; 2]);
static CV: Condvar = Condvar::new();

fn lock_state() -> MutexGuard<'static, [Phase; 2]> {
    match STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn index(arch: &str) -> usize {
    if arch == "x86" { 1 } else { 0 }
}

pub fn set(arch: &str, phase: Phase) {
    let mut state = lock_state();
    let slot = &mut state[index(arch)];
    // A late health-check result must not resurrect a state after shutdown.
    if *slot == Phase::Stopped {
        return;
    }
    *slot = phase;
    drop(state);
    CV.notify_all();
}

pub fn stop_all() {
    let mut state = lock_state();
    state[0] = Phase::Stopped;
    state[1] = Phase::Stopped;
    drop(state);
    CV.notify_all();
}

/// Block until the bridge for `arch` is ready, it failed, or `timeout` passes.
/// Returns `true` only for `Ready`.
pub fn wait_ready(arch: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let i = index(arch);
    let mut state = lock_state();
    loop {
        match state[i] {
            Phase::Ready => return true,
            Phase::Failed | Phase::Stopped => return false,
            Phase::Starting => {}
        }
        let Some(left) = deadline.checked_duration_since(Instant::now()) else {
            return false;
        };
        let (guard, _) = match CV.wait_timeout(state, left) {
            Ok(pair) => pair,
            Err(poisoned) => poisoned.into_inner(),
        };
        state = guard;
    }
}
