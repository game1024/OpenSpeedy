//! OpenSpeedy Bridge — named-pipe server (Rust).
//!
//! Receives text commands from the main OpenSpeedy process:
//!   INJECT <pid>  EJECT <pid>  ENABLE <pid>  DISABLE <pid>
//!   SETSPEED <factor>  GETSPEED  SHUTDOWN
//!
//!   STATUS <pid>  — OK ENABLED / OK DISABLED / ERROR <message>
//!
//! Responses:  OK [value]  or  ERROR <message>

#![windows_subsystem = "windows"]

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;
use std::sync::OnceLock;

use windows::core::{PCSTR, PCWSTR, PWSTR, s};
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, HANDLE, HMODULE, BOOL, ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE,
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

// ── Crash protection ─────────────────────────────────────────────────────
// When calling into the speedpatch DLL, a target process that has exited
// can trigger an access violation. Rust's catch_unwind only catches Rust
// panics, not native crashes. We use:
// 1. VEH (AddVectoredExceptionHandler) — logs the crash
// 2. UEF (SetUnhandledExceptionFilter) — returns EXCEPTION_EXECUTE_HANDLER
//    so Windows terminates only the offending THREAD, not the PROCESS.
// Combined with spawn_protected (sacrificial thread), the bridge stays alive.

use windows::Win32::System::Diagnostics::Debug::{
    AddVectoredExceptionHandler, SetUnhandledExceptionFilter,
    EXCEPTION_POINTERS, EXCEPTION_CONTINUE_SEARCH,
};

unsafe extern "system" fn bridge_veh_handler(info: *mut EXCEPTION_POINTERS) -> i32 {
    if let Some(record) = unsafe { info.as_ref() }.and_then(|i| unsafe { i.ExceptionRecord.as_ref() }) {
        eprintln!(
            "[bridge] native crash 0x{:08X} at 0x{:X} — VEH caught",
            record.ExceptionCode.0,
            record.ExceptionAddress as usize,
        );
    }
    EXCEPTION_CONTINUE_SEARCH
}

unsafe extern "system" fn bridge_uef_handler(info: *const EXCEPTION_POINTERS) -> i32 {
    if let Some(record) = unsafe { info.as_ref() }.and_then(|i| unsafe { i.ExceptionRecord.as_ref() }) {
        eprintln!(
            "[bridge] unhandled exception 0x{:08X} — terminating thread, bridge stays alive",
            record.ExceptionCode.0,
        );
    }
    1 // EXCEPTION_EXECUTE_HANDLER
}

fn install_crash_handler() {
    unsafe {
        AddVectoredExceptionHandler(1, Some(bridge_veh_handler));
        SetUnhandledExceptionFilter(Some(bridge_uef_handler));
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

fn exe_dir() -> PathBuf {
    let mut buf = vec![0u16; 260];
    let mut len = buf.len() as u32;
    let h = unsafe { GetCurrentProcess() };
    let ok = unsafe {
        QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR::from_raw(buf.as_mut_ptr()), &mut len)
    };
    // On failure `len` still holds the original capacity; slicing with it
    // would build a path out of 260 NUL characters and silently inject the
    // wrong DLL path.
    if ok.is_err() || len == 0 || len as usize > buf.len() {
        return PathBuf::from(".");
    }
    let s = String::from_utf16_lossy(&buf[..len as usize]);
    PathBuf::from(&s).parent().unwrap_or(&PathBuf::from(".")).to_path_buf()
}

fn is_process_64bit(pid: u32) -> bool {
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid) else {
            eprintln!("[bridge] is_process_64bit({pid}): OpenProcess failed, assuming 64-bit");
            return true;
        };
        let mut wow64 = BOOL::default();
        let wide_k32 = to_wide("kernel32.dll");
        let kernel32 = GetModuleHandleW(PCWSTR::from_raw(wide_k32.as_ptr())).unwrap_or_default();
        let is_wow64: Option<unsafe extern "system" fn(HANDLE, *mut BOOL) -> BOOL> =
            std::mem::transmute(GetProcAddress(kernel32, s!("IsWow64Process")));
        if let Some(f) = is_wow64 { let _ = f(h, &mut wow64); }
        let _ = CloseHandle(h);
        let result = !wow64.as_bool();
        eprintln!("[bridge] is_process_64bit({pid}): wow64={} -> is64={result}", wow64.as_bool());
        result
    }
}

#[cfg(target_arch = "x86_64")]
const OWN_SPEEDPATCH: &str = "speedpatch64.dll";
#[cfg(target_arch = "x86")]
const OWN_SPEEDPATCH: &str = "speedpatch32.dll";

fn speedpatch_dll(is64: bool) -> &'static str {
    if is64 { "speedpatch64.dll" } else { "speedpatch32.dll" }
}

/// Reject named-pipe clients that arrive over the network (SMB). Local IPC is
/// the only expected transport; a remote client would be an attack.
const PIPE_REJECT_REMOTE_CLIENTS: u32 = 0x0000_0008;

/// Cache the module handle for our own speedpatch DLL. `LoadLibraryW` bumps the
/// ref count on every call; holding one handle for the bridge's lifetime is
/// enough to resolve every exported symbol we need. Stored as a raw address
/// (`usize`) because `HMODULE` is not `Sync` and so cannot live in a `static`.
static SPEEDPATCH_MODULE: OnceLock<Option<usize>> = OnceLock::new();

fn load_speedpatch() -> Option<HMODULE> {
    let cached = SPEEDPATCH_MODULE.get_or_init(|| {
        let dll_wide = to_wide(OWN_SPEEDPATCH);
        unsafe { LoadLibraryW(PCWSTR::from_raw(dll_wide.as_ptr())).ok().map(|h| h.0 as usize) }
    });
    let raw = (*cached)?;
    Some(HMODULE(raw as *mut std::ffi::c_void))
}

// ── Core operations ──────────────────────────────────────────────────────

/// Try injecting via LoadLibraryW, fall back to LoadLibraryA.
fn do_inject(pid: u32) -> Result<(), String> {
    let is64 = is_process_64bit(pid);
    let dll_name = speedpatch_dll(is64);
    eprintln!("[bridge] INJECT pid={pid} arch={} dll={dll_name}", if is64 { "x64" } else { "x86" });
    let dll_path = exe_dir().join(dll_name);
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
    eprintln!("[bridge] try_inject_impl: dll={dll_path} fn={fn_name} wide={wide}");

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
    eprintln!("[bridge] path_bytes len={path_len}");

    let remote_mem = unsafe {
        VirtualAllocEx(*h_proc, None, path_len, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE)
    };
    if remote_mem.is_null() {
        eprintln!("[bridge] VirtualAllocEx failed");
        return false;
    }
    eprintln!("[bridge] VirtualAllocEx ok, remote_mem={remote_mem:?}");

    unsafe {
        let written = WriteProcessMemory(*h_proc, remote_mem, path_bytes.as_ptr() as _, path_len, None);
        if written.is_err() {
            eprintln!("[bridge] WriteProcessMemory failed");
            let _ = VirtualFreeEx(*h_proc, remote_mem, 0, MEM_RELEASE);
            return false;
        }
    }
    eprintln!("[bridge] WriteProcessMemory done");

    let wide_k32 = to_wide("kernel32.dll");
    let kernel32 = match unsafe {
        GetModuleHandleW(PCWSTR::from_raw(wide_k32.as_ptr()))
    } {
        Ok(h) => h,
        Err(_) => {
            unsafe { let _ = VirtualFreeEx(*h_proc, remote_mem, 0, MEM_RELEASE); }
            return false;
        }
    };
    eprintln!("[bridge] GetModuleHandleW(kernel32) ok");

    let fn_cstr = std::ffi::CString::new(fn_name).unwrap();
    let load_lib = unsafe {
        match GetProcAddress(kernel32, PCSTR::from_raw(fn_cstr.as_ptr() as *const u8)) {
            Some(ptr) => ptr,
            None => {
                eprintln!("[bridge] GetProcAddress({fn_name}) failed");
                let _ = VirtualFreeEx(*h_proc, remote_mem, 0, MEM_RELEASE);
                return false;
            }
        }
    };
    eprintln!("[bridge] GetProcAddress({fn_name}) ok = {load_lib:?}");

    let h_thread = match unsafe {
        CreateRemoteThread(*h_proc, None, 0,
            Some(std::mem::transmute(load_lib)), Some(remote_mem), 0, None)
    } {
        Ok(h) => h,
        Err(e) => {
            eprintln!("[bridge] CreateRemoteThread failed: {e:?}");
            unsafe { let _ = VirtualFreeEx(*h_proc, remote_mem, 0, MEM_RELEASE); }
            return false;
        }
    };
    eprintln!("[bridge] CreateRemoteThread ok, h_thread={h_thread:?}");

    // Wait for LoadLibrary to complete and check result
    unsafe { WaitForSingleObject(h_thread, 5000); }
    eprintln!("[bridge] WaitForSingleObject done");

    let mut exit_code = 0u32;
    let ok = unsafe {
        use windows::Win32::System::Threading::GetExitCodeThread;
        GetExitCodeThread(h_thread, &mut exit_code)
    };
    eprintln!("[bridge] GetExitCodeThread ok={ok:?} exit_code={exit_code}");

    unsafe { let _ = VirtualFreeEx(*h_proc, remote_mem, 0, MEM_RELEASE); let _ = CloseHandle(h_thread); }
    eprintln!("[bridge] cleanup done, LoadLibrary result={}", exit_code != 0);

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

    let wide_k32 = to_wide("kernel32.dll");
    let kernel32 = unsafe {
        GetModuleHandleW(PCWSTR::from_raw(wide_k32.as_ptr()))
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
    eprintln!("[bridge] ENABLE pid={pid} dll={OWN_SPEEDPATCH}");
    let h = load_speedpatch().ok_or("LoadLibraryW failed")?;
    unsafe {
        eprintln!("[bridge] ENABLE module h={h:?}");
        let sp_enable: Option<unsafe extern "C" fn(u32)> =
            std::mem::transmute(GetProcAddress(h, s!("SP_Enable")));
        eprintln!("[bridge] ENABLE GetProcAddress(SP_Enable) ok = {sp_enable:?}");
        sp_enable.ok_or("GetProcAddress SP_Enable failed")?(pid);
        eprintln!("[bridge] ENABLE SP_Enable({pid}) done");

        // The DLL's hook-failure counter lives in a section shared between every
        // process mapping it, so this read also surfaces failures recorded by the
        // copy injected into the target — the difference between "speed control
        // does nothing" and a game that crashes the moment it calls Sleep.
        let failures: Option<unsafe extern "C" fn() -> u32> =
            std::mem::transmute(GetProcAddress(h, s!("SP_GetHookFailures")));
        if let Some(f) = failures {
            let n = f();
            if n > 0 {
                eprintln!("[bridge] WARNING: {n} time-API hook(s) not installed — those APIs stay unpatched");
            } else {
                eprintln!("[bridge] all time-API hooks installed");
            }
        }
    }
    Ok(())
}

fn do_disable(pid: u32) -> Result<(), String> {
    eprintln!("[bridge] DISABLE pid={pid} dll={OWN_SPEEDPATCH}");
    let h = load_speedpatch().ok_or("LoadLibraryW failed")?;
    unsafe {
        eprintln!("[bridge] DISABLE module h={h:?}");
        let sp_disable: Option<unsafe extern "C" fn(u32)> =
            std::mem::transmute(GetProcAddress(h, s!("SP_Disable")));
        eprintln!("[bridge] DISABLE GetProcAddress(SP_Disable) ok = {sp_disable:?}");
        sp_disable.ok_or("GetProcAddress SP_Disable failed")?(pid);
        eprintln!("[bridge] DISABLE SP_Disable({pid}) done");
    }
    Ok(())
}

fn do_set_speed(factor: f64) {
    // The timing detours divide by the factor and convert scaled doubles to
    // DWORD. A zero/negative/NaN/infinite value would produce a division by
    // zero, an infinite wait or an undefined integer conversion.
    if !factor.is_finite() || !(0.01..=100.0).contains(&factor) {
        return;
    }
    let Some(h) = load_speedpatch() else { return };
    unsafe {
        let set_speed: Option<unsafe extern "C" fn(f64)> =
            std::mem::transmute(GetProcAddress(h, s!("SP_SetSpeed")));
        if let Some(f) = set_speed { f(factor); }
    }
}

fn do_get_speed() -> f64 {
    let Some(h) = load_speedpatch() else { return 1.0 };
    unsafe {
        let get_speed: Option<unsafe extern "C" fn() -> f64> =
            std::mem::transmute(GetProcAddress(h, s!("SP_GetSpeed")));
        if let Some(f) = get_speed { f() } else { 1.0 }
    }
}

/// True when the target process has the speedpatch DLL installed and enabled.
/// Reads the per-PID shared memory the injected DLL maintains; a target that
/// was never injected reports `false` rather than an error.
fn do_get_status(pid: u32) -> Option<bool> {
    let Some(h) = load_speedpatch() else { return None };
    unsafe {
        let f: Option<unsafe extern "C" fn(u32) -> BOOL> =
            std::mem::transmute(GetProcAddress(h, s!("SP_IsEnabledById")));
        f.map(|f| f(pid).as_bool())
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
        "SETSPEED" => {
            let f: f64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1.0);
            // Reject at the protocol boundary as well, so an invalid request
            // reports an error instead of a misleading "OK".
            if !f.is_finite() || !(0.01..=100.0).contains(&f) {
                return "ERROR invalid factor".into();
            }
            do_set_speed(f);
            "OK".into()
        }
        "GETSPEED" => {
            let s = do_get_speed();
            format!("OK {s:.6}")
        }
        "STATUS" => {
            let pid: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            match do_get_status(pid) {
                Some(true) => "OK ENABLED".into(),
                Some(false) => "OK DISABLED".into(),
                None => "ERROR status unavailable".into(),
            }
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
                FILE_FLAGS_AND_ATTRIBUTES(0x3 | PIPE_REJECT_REMOTE_CLIENTS), // PIPE_ACCESS_DUPLEX | reject remote clients
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
    install_crash_handler();

    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let line = args[1..].join(" ");
        println!("{}", handle_command(&line));
        return;
    }
    pipe_server();
}
