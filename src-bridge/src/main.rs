//! OpenSpeedy Bridge — named-pipe server (Rust).
//!
//! Receives text commands from the main OpenSpeedy process:
//!   INJECT <pid>  EJECT <pid>  ENABLE <pid>  DISABLE <pid>
//!   ISENABLED <pid>  SETSPEED <factor>  GETSPEED  SHUTDOWN
//!
//! Responses:  OK [value]  or  ERROR <message>

#![windows_subsystem = "windows"]

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use windows::core::{PCSTR, PCWSTR, PWSTR, s};
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, HANDLE, BOOL, ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE,
};
use windows::Win32::Storage::FileSystem::{WriteFile, ReadFile, FILE_FLAGS_AND_ATTRIBUTES};
use windows::Win32::System::Threading::{
    CreateRemoteThread, GetCurrentProcess, OpenProcess, QueryFullProcessImageNameW,
    WaitForSingleObject, PROCESS_CREATE_THREAD, PROCESS_QUERY_INFORMATION,
    PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE, PROCESS_NAME_WIN32,
};
use windows::Win32::System::Memory::{
    VirtualAllocEx, VirtualFreeEx,
    MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE,
};
use windows::Win32::System::Diagnostics::Debug::WriteProcessMemory;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W,
    TH32CS_SNAPMODULE,
};
use windows::Win32::System::LibraryLoader::{
    GetModuleHandleW, GetProcAddress, LoadLibraryW,
};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_MESSAGE,
    PIPE_TYPE_MESSAGE, PIPE_WAIT, NAMED_PIPE_MODE,
};

// ── Helpers ──────────────────────────────────────────────────────────────

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

fn exe_dir() -> PathBuf {
    let mut buf = vec![0u16; 260];
    let mut len = buf.len() as u32;
    let h = unsafe { GetCurrentProcess() };
    unsafe {
        let _ = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR::from_raw(buf.as_mut_ptr()), &mut len);
    }
    let s = String::from_utf16_lossy(&buf[..len as usize]);
    PathBuf::from(&s).parent().unwrap_or(&PathBuf::from(".")).to_path_buf()
}

fn is_process_64bit(pid: u32) -> bool {
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid) else { return true };
        let mut wow64 = BOOL::default();
        let kernel32 = GetModuleHandleW(PCWSTR::from_raw(to_wide("kernel32.dll").as_ptr())).unwrap_or_default();
        let is_wow64: Option<unsafe extern "system" fn(HANDLE, *mut BOOL) -> BOOL> =
            std::mem::transmute(GetProcAddress(kernel32, s!("IsWow64Process")));
        if let Some(f) = is_wow64 { f(h, &mut wow64); }
        let _ = CloseHandle(h);
        !wow64.as_bool()
    }
}

#[cfg(target_arch = "x86_64")]
const OWN_SPEEDPATCH: &str = "speedpatch64.dll";
#[cfg(target_arch = "x86")]
const OWN_SPEEDPATCH: &str = "speedpatch32.dll";

fn speedpatch_dll(is64: bool) -> &'static str {
    if is64 { "speedpatch64.dll" } else { "speedpatch32.dll" }
}

// ── Core operations ──────────────────────────────────────────────────────

/// Try injecting via LoadLibraryW, fall back to LoadLibraryA.
fn do_inject(pid: u32) -> Result<(), String> {
    let is64 = is_process_64bit(pid);
    let dll_path = exe_dir().join(speedpatch_dll(is64));
    let dll_str = dll_path.to_string_lossy().to_string();

    let h_proc = unsafe {
        OpenProcess(
            PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION
            | PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ,
            false, pid,
        )
    }.map_err(|e| format!("OpenProcess: {e:?}"))?;

    // Try LoadLibraryW first
    if try_inject_impl(&h_proc, &dll_str, "LoadLibraryW", true) {
        unsafe { let _ = CloseHandle(h_proc); }
        return Ok(());
    }

    // Fallback: LoadLibraryA
    if try_inject_impl(&h_proc, &dll_str, "LoadLibraryA", false) {
        unsafe { let _ = CloseHandle(h_proc); }
        return Ok(());
    }

    unsafe { let _ = CloseHandle(h_proc); }
    Err("both LoadLibraryW and LoadLibraryA injection failed".into())
}

/// Attempt injection with a specific LoadLibrary variant.
/// `wide` = true → use wide-char path (LoadLibraryW), false → ANSI (LoadLibraryA).
fn try_inject_impl(h_proc: &HANDLE, dll_path: &str, fn_name: &str, wide: bool) -> bool {
    let path_bytes: Vec<u8> = if wide {
        dll_path.encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .chain([0u8, 0u8])
            .collect()
    } else {
        dll_path.as_bytes().iter()
            .copied()
            .chain([0u8])
            .collect()
    };
    let path_len = path_bytes.len();

    let remote_mem = unsafe {
        VirtualAllocEx(*h_proc, None, path_len, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE)
    };
    if remote_mem.is_null() { return false; }

    unsafe {
        let _ = WriteProcessMemory(*h_proc, remote_mem, path_bytes.as_ptr() as _, path_len, None);
    }

    let kernel32 = match unsafe {
        GetModuleHandleW(PCWSTR::from_raw(to_wide("kernel32.dll").as_ptr()))
    } {
        Ok(h) => h,
        Err(_) => return false,
    };
    let fn_cstr = std::ffi::CString::new(fn_name).unwrap();
    let load_lib = unsafe {
        match GetProcAddress(kernel32, PCSTR::from_raw(fn_cstr.as_ptr() as *const u8)) {
            Some(ptr) => ptr,
            None => return false,
        }
    };

    let h_thread = match unsafe {
        CreateRemoteThread(*h_proc, None, 0,
            Some(std::mem::transmute(load_lib)), Some(remote_mem), 0, None)
    } {
        Ok(h) => h,
        Err(_) => {
            unsafe { VirtualFreeEx(*h_proc, remote_mem, 0, MEM_RELEASE); }
            return false;
        }
    };

    // Wait for LoadLibrary to complete and check result
    unsafe { WaitForSingleObject(h_thread, 5000); }

    let mut exit_code = 0u32;
    let ok = unsafe {
        use windows::Win32::System::Threading::GetExitCodeThread;
        GetExitCodeThread(h_thread, &mut exit_code)
    };

    unsafe { VirtualFreeEx(*h_proc, remote_mem, 0, MEM_RELEASE); let _ = CloseHandle(h_thread); }

    // LoadLibrary returns NULL (0) on failure, non-zero HMODULE on success
    ok.is_ok() && exit_code != 0
}

fn do_eject(pid: u32) -> Result<(), String> {
    let is64 = is_process_64bit(pid);
    let dll_name = speedpatch_dll(is64);

    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, pid) }
        .map_err(|e| format!("CreateToolhelp32Snapshot: {e:?}"))?;

    let mut me = MODULEENTRY32W { dwSize: std::mem::size_of::<MODULEENTRY32W>() as u32, ..Default::default() };
    let mut h_mod: Option<*mut std::ffi::c_void> = None;

    unsafe {
        if Module32FirstW(snap, &mut me).is_ok() {
            loop {
                let mod_name = String::from_utf16_lossy(&me.szModule)
                    .trim_end_matches('\0').to_lowercase();
                if mod_name == dll_name.to_lowercase() {
                    h_mod = Some(me.hModule.0 as _);
                    break;
                }
                if Module32NextW(snap, &mut me).is_err() { break; }
            }
        }
    }
    unsafe { let _ = CloseHandle(snap); }

    let h_mod_ptr = h_mod.ok_or("module not found in target")?;

    let h_proc = unsafe {
        OpenProcess(
            PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION,
            false, pid,
        )
    }.map_err(|e| format!("OpenProcess: {e:?}"))?;

    let kernel32 = unsafe {
        GetModuleHandleW(PCWSTR::from_raw(to_wide("kernel32.dll").as_ptr()))
    }.map_err(|_| "GetModuleHandleW failed")?;
    let free_lib = unsafe { GetProcAddress(kernel32, s!("FreeLibrary")) }
        .ok_or("GetProcAddress FreeLibrary failed")?;

    let h_thread = unsafe {
        CreateRemoteThread(h_proc, None, 0,
            Some(std::mem::transmute(free_lib)), Some(h_mod_ptr), 0, None)
    }.map_err(|e| format!("CreateRemoteThread: {e:?}"))?;

    unsafe { WaitForSingleObject(h_thread, 5000); }
    unsafe { let _ = CloseHandle(h_thread); let _ = CloseHandle(h_proc); }
    Ok(())
}

fn do_enable(pid: u32) -> Result<(), String> {
    let dll_wide = to_wide(OWN_SPEEDPATCH);
    unsafe {
        let h = LoadLibraryW(PCWSTR::from_raw(dll_wide.as_ptr())).map_err(|e| format!("LoadLibraryW: {e:?}"))?;
        let sp_enable: Option<unsafe extern "system" fn(u32)> =
            std::mem::transmute(GetProcAddress(h, s!("SP_Enable")));
        sp_enable.ok_or("GetProcAddress SP_Enable failed")?(pid);
    }
    Ok(())
}

fn do_disable(pid: u32) -> Result<(), String> {
    let dll_wide = to_wide(OWN_SPEEDPATCH);
    unsafe {
        let h = LoadLibraryW(PCWSTR::from_raw(dll_wide.as_ptr())).map_err(|e| format!("LoadLibraryW: {e:?}"))?;
        let sp_disable: Option<unsafe extern "system" fn(u32)> =
            std::mem::transmute(GetProcAddress(h, s!("SP_Disable")));
        sp_disable.ok_or("GetProcAddress SP_Disable failed")?(pid);
    }
    Ok(())
}

fn do_is_enabled(pid: u32) -> Result<bool, String> {
    let dll_wide = to_wide(OWN_SPEEDPATCH);
    unsafe {
        let h = LoadLibraryW(PCWSTR::from_raw(dll_wide.as_ptr())).map_err(|e| format!("LoadLibraryW: {e:?}"))?;
        let sp_is_enabled: Option<unsafe extern "system" fn(u32) -> i32> =
            std::mem::transmute(GetProcAddress(h, s!("SP_IsEnabledById")));
        Ok(sp_is_enabled.ok_or("GetProcAddress SP_IsEnabledById failed")?(pid) != 0)
    }
}

fn do_set_speed(factor: f64) {
    let dll_wide = to_wide(OWN_SPEEDPATCH);
    unsafe {
        let Ok(h) = LoadLibraryW(PCWSTR::from_raw(dll_wide.as_ptr())) else { return };
        let set_speed: Option<unsafe extern "system" fn(f64)> =
            std::mem::transmute(GetProcAddress(h, s!("SP_SetSpeed")));
        if let Some(f) = set_speed { f(factor); }
    }
}

fn do_get_speed() -> f64 {
    let dll_wide = to_wide(OWN_SPEEDPATCH);
    unsafe {
        let Ok(h) = LoadLibraryW(PCWSTR::from_raw(dll_wide.as_ptr())) else { return 1.0 };
        let get_speed: Option<unsafe extern "system" fn() -> f64> =
            std::mem::transmute(GetProcAddress(h, s!("SP_GetSpeed")));
        if let Some(f) = get_speed { f() } else { 1.0 }
    }
}

// ── Command dispatch ─────────────────────────────────────────────────────

fn handle_command(line: &str) -> String {
    let mut parts = line.trim().split_whitespace();
    let cmd = parts.next().unwrap_or("").to_uppercase();

    match cmd.as_str() {
        "INJECT" => {
            let pid: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            match do_inject(pid) { Ok(()) => "OK".into(), Err(e) => format!("ERROR {e}") }
        }
        "EJECT" => {
            let pid: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            match do_eject(pid) { Ok(()) => "OK".into(), Err(e) => format!("ERROR {e}") }
        }
        "ENABLE" => {
            let pid: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            match do_enable(pid) { Ok(()) => "OK".into(), Err(e) => format!("ERROR {e}") }
        }
        "DISABLE" => {
            let pid: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            match do_disable(pid) { Ok(()) => "OK".into(), Err(e) => format!("ERROR {e}") }
        }
        "ISENABLED" => {
            let pid: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            match do_is_enabled(pid) {
                Ok(true) => "OK 1".into(), Ok(false) => "OK 0".into(),
                Err(e) => format!("ERROR {e}"),
            }
        }
        "SETSPEED" => {
            let f: f64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1.0);
            do_set_speed(f);
            "OK".into()
        }
        "GETSPEED" => {
            let s = do_get_speed();
            format!("OK {s:.6}")
        }
        "SHUTDOWN" => "OK shutting down".into(),
        _ => "ERROR unknown command".into(),
    }
}

fn write_resp(h_pipe: HANDLE, msg: &str) {
    let mut written = 0u32;
    unsafe { let _ = WriteFile(h_pipe, Some(msg.as_bytes()), Some(&mut written), None); }
}

// ── Pipe server ───────────────────────────────────────────────────────────

#[cfg(target_arch = "x86_64")]
const PIPE_NAME: &str = r"\\.\pipe\OpenSpeedyBridge64";
#[cfg(target_arch = "x86")]
const PIPE_NAME: &str = r"\\.\pipe\OpenSpeedyBridge32";

fn pipe_server() {
    loop {
        let name_wide = to_wide(PIPE_NAME);
        let h_pipe = unsafe {
            CreateNamedPipeW(
                PCWSTR::from_raw(name_wide.as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(3), // PIPE_ACCESS_DUPLEX
                NAMED_PIPE_MODE(PIPE_TYPE_MESSAGE.0 | PIPE_READMODE_MESSAGE.0 | PIPE_WAIT.0),
                1, 4096, 4096, 0, None,
            )
        };
        if h_pipe == INVALID_HANDLE_VALUE {
            std::thread::sleep(std::time::Duration::from_secs(1));
            continue;
        }

        let connected = unsafe { ConnectNamedPipe(h_pipe, None) };
        let connected = connected.is_ok() || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;
        if !connected {
            unsafe { let _ = CloseHandle(h_pipe); }
            continue;
        }

        let mut buf = [0u8; 4096];
        loop {
            let mut nread = 0u32;
            let ok = unsafe { ReadFile(h_pipe, Some(&mut buf), Some(&mut nread), None) };
            if ok.is_err() || nread == 0 { break; }

            let text = String::from_utf8_lossy(&buf[..nread as usize]);
            for line in text.lines() {
                let line = line.trim();
                if line.is_empty() { continue; }
                if line.eq_ignore_ascii_case("SHUTDOWN") {
                    write_resp(h_pipe, "OK shutting down\n");
                    unsafe { let _ = CloseHandle(h_pipe); }
                    std::process::exit(0);
                }
                let resp = handle_command(line);
                write_resp(h_pipe, &format!("{resp}\n"));
            }
        }
        unsafe { let _ = CloseHandle(h_pipe); }
    }
}

// ── Entry point ───────────────────────────────────────────────────────────

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let line = args[1..].join(" ");
        println!("{}", handle_command(&line));
        return;
    }
    pipe_server();
}
