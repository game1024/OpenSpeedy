//! Named-pipe client for communicating with bridge64.exe / bridge32.exe.
//! Uses persistent pipe connections — one HANDLE cached per pipe, reused
//! across commands. Reconnects automatically if the pipe breaks.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::Mutex;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};

const PIPE_64: &str = r"\\.\pipe\OpenSpeedyBridge64";
const PIPE_32: &str = r"\\.\pipe\OpenSpeedyBridge32";

// HANDLE is not Send, so store the raw value as isize
static P64: Mutex<Option<isize>> = Mutex::new(None);
static P32: Mutex<Option<isize>> = Mutex::new(None);

fn handle_val(h: HANDLE) -> isize { h.0 as isize }
fn handle_from(v: isize) -> HANDLE { HANDLE(v as *mut std::ffi::c_void) }

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

fn open_pipe(name: &str) -> Option<HANDLE> {
    let name = to_wide(name);
    let h = unsafe {
        CreateFileW(
            PCWSTR::from_raw(name.as_ptr()),
            0xC0000000 | 0x40000000, // GENERIC_READ | GENERIC_WRITE
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            Default::default(),
            None,
        )
    };
    match h {
        Ok(h) if h != INVALID_HANDLE_VALUE => Some(h),
        _ => None,
    }
}

fn cache_for(pipe: &str) -> &Mutex<Option<isize>> {
    if pipe == PIPE_32 { &P32 } else { &P64 }
}

/// Send one command over a persistent pipe connection. Returns the response
/// string on success, or `None` if the pipe is unavailable after a reconnect
/// attempt.
fn pipe_command(pipe: &str, cmd: &str) -> Option<String> {
    let cache = cache_for(pipe);
    // Recover from a poisoned lock — losing the cached handle only costs one
    // reconnect, while panicking here would take down the whole app.
    let mut guard = match cache.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            crate::applog::warn("bridge", format!("{pipe} mutex was poisoned, recovering"));
            poisoned.into_inner()
        }
    };

    // Try the cached handle first
    if let Some(raw) = *guard {
        let h = handle_from(raw);
        match send_recv(h, cmd) {
            Ok(resp) => return Some(resp),
            Err(_) => {
                // Pipe broken — close the stale handle and reconnect on the
                // next command.
                crate::applog::warn(
                    "bridge",
                    format!("{pipe}: connection dropped while running {cmd}, reconnecting"),
                );
                unsafe { let _ = CloseHandle(h); }
                *guard = None;
            }
        }
    }

    // Open a new connection
    let h = match open_pipe(pipe) {
        Some(h) => h,
        None => {
            crate::applog::warn(
                "bridge",
                format!("{pipe}: cannot connect — bridge process is not running or refused the pipe"),
            );
            return None;
        }
    };
    match send_recv(h, cmd) {
        Ok(resp) => {
            *guard = Some(handle_val(h)); // cache for next command
            Some(resp)
        }
        Err(_) => {
            unsafe { let _ = CloseHandle(h); }
            crate::applog::warn("bridge", format!("{pipe}: {cmd} failed on a fresh connection"));
            None
        }
    }
}

/// Write a command and read one response line.  Does NOT close the handle.
fn send_recv(h: HANDLE, cmd: &str) -> Result<String, ()> {
    let msg = format!("{cmd}\n");
    let mut written = 0u32;
    let wr = unsafe { WriteFile(h, Some(msg.as_bytes()), Some(&mut written), None) };
    if wr.is_err() { return Err(()); }

    let mut buf = [0u8; 256];
    let mut nread = 0u32;
    let rd = unsafe { ReadFile(h, Some(&mut buf), Some(&mut nread), None) };
    if rd.is_err() || nread == 0 { return Err(()); }

    let resp = String::from_utf8_lossy(&buf[..nread as usize]).trim().to_string();
    eprintln!("[bridge] {cmd} → {resp}");
    Ok(resp)
}

/// Check if bridge64 is running and responsive.
pub fn bridge64_health() -> bool {
    pipe_command(PIPE_64, "GETSPEED").map(|r| r.starts_with("OK")).unwrap_or(false)
}

/// Check if bridge32 is running and responsive.
pub fn bridge32_health() -> bool {
    pipe_command(PIPE_32, "GETSPEED").map(|r| r.starts_with("OK")).unwrap_or(false)
}

/// Set speed factor via bridge64.
pub fn bridge64_set_speed(factor: f64) -> bool {
    pipe_command(PIPE_64, &format!("SETSPEED {factor}")).map(|r| r.starts_with("OK")).unwrap_or(false)
}

/// Set speed factor via bridge32.
pub fn bridge32_set_speed(factor: f64) -> bool {
    pipe_command(PIPE_32, &format!("SETSPEED {factor}")).map(|r| r.starts_with("OK")).unwrap_or(false)
}

/// Get speed factor from bridge64.
pub fn bridge64_get_speed() -> Option<f64> {
    pipe_command(PIPE_64, "GETSPEED").and_then(|r| r.strip_prefix("OK ").and_then(|s| s.parse().ok()))
}

/// Get speed factor from bridge32 — the fallback when the 64-bit bridge is
/// down. Both bridges are written together, so either one is a valid source.
pub fn bridge32_get_speed() -> Option<f64> {
    pipe_command(PIPE_32, "GETSPEED").and_then(|r| r.strip_prefix("OK ").and_then(|s| s.parse().ok()))
}

/// Single source of truth for the current factor. Falling back to the 32-bit
/// bridge avoids silently restarting from 1.0 when only bridge64 died.
pub fn current_speed() -> Option<f64> {
    bridge64_get_speed().or_else(bridge32_get_speed)
}

// ── Per-arch inject / eject / enable / disable ──

pub fn bridge64_inject(pid: u32) -> bool {
    pipe_command(PIPE_64, &format!("INJECT {pid}")).map(|r| r == "OK").unwrap_or(false)
}
pub fn bridge32_inject(pid: u32) -> bool {
    pipe_command(PIPE_32, &format!("INJECT {pid}")).map(|r| r == "OK").unwrap_or(false)
}

#[allow(dead_code)]
pub fn bridge64_eject(pid: u32) -> bool {
    pipe_command(PIPE_64, &format!("EJECT {pid}")).map(|r| r == "OK").unwrap_or(false)
}
#[allow(dead_code)]
pub fn bridge32_eject(pid: u32) -> bool {
    pipe_command(PIPE_32, &format!("EJECT {pid}")).map(|r| r == "OK").unwrap_or(false)
}

pub fn bridge64_enable(pid: u32) -> bool {
    pipe_command(PIPE_64, &format!("ENABLE {pid}")).map(|r| r == "OK").unwrap_or(false)
}
pub fn bridge32_enable(pid: u32) -> bool {
    pipe_command(PIPE_32, &format!("ENABLE {pid}")).map(|r| r == "OK").unwrap_or(false)
}

pub fn bridge64_disable(pid: u32) -> bool {
    pipe_command(PIPE_64, &format!("DISABLE {pid}")).map(|r| r == "OK").unwrap_or(false)
}
pub fn bridge32_disable(pid: u32) -> bool {
    pipe_command(PIPE_32, &format!("DISABLE {pid}")).map(|r| r == "OK").unwrap_or(false)
}

/// Query per-PID status from bridge.
/// Returns Some(true) = injected + enabled, Some(false) = injected + disabled, None = not found / error.
pub fn bridge64_get_status(pid: u32) -> Option<bool> {
    match pipe_command(PIPE_64, &format!("STATUS {pid}"))?.as_str() {
        "OK ENABLED" => Some(true),
        "OK DISABLED" => Some(false),
        _ => None,
    }
}
pub fn bridge32_get_status(pid: u32) -> Option<bool> {
    match pipe_command(PIPE_32, &format!("STATUS {pid}"))?.as_str() {
        "OK ENABLED" => Some(true),
        "OK DISABLED" => Some(false),
        _ => None,
    }
}
