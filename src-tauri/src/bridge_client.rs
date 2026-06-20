//! Named-pipe client for communicating with bridge64.exe / bridge32.exe.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};

const PIPE_64: &str = r"\\.\pipe\OpenSpeedyBridge64";
const PIPE_32: &str = r"\\.\pipe\OpenSpeedyBridge32";

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

fn pipe_command(pipe: &str, cmd: &str) -> Option<String> {
    let h = open_pipe(pipe)?;
    let msg = format!("{cmd}\n");
    let mut written = 0u32;
    let _ = unsafe { WriteFile(h, Some(msg.as_bytes()), Some(&mut written), None) };

    let mut buf = [0u8; 256];
    let mut nread = 0u32;
    let ok = unsafe { ReadFile(h, Some(&mut buf), Some(&mut nread), None) };
    unsafe { let _ = CloseHandle(h); }

    if ok.is_err() || nread == 0 { return None; }
    Some(String::from_utf8_lossy(&buf[..nread as usize]).trim().to_string())
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

/// Send SHUTDOWN to bridge64 (fire-and-forget — bridge exits after receiving).
pub fn bridge64_shutdown() {
    let _ = pipe_command(PIPE_64, "SHUTDOWN");
}

/// Send SHUTDOWN to bridge32 (fire-and-forget — bridge exits after receiving).
pub fn bridge32_shutdown() {
    let _ = pipe_command(PIPE_32, "SHUTDOWN");
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
