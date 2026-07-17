use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, DIB_RGB_COLORS,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW,
    PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::ProcessStatus::{
    GetModuleFileNameExW, GetModuleInformation, GetProcessMemoryInfo, EnumProcessModulesEx,
    MODULEINFO, PROCESS_MEMORY_COUNTERS, LIST_MODULES_32BIT, LIST_MODULES_64BIT,
};
use windows::Win32::Foundation::HMODULE;
use windows::Win32::System::Threading::{
    IsWow64Process, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
};
use windows::Win32::Security::{
    GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
};
use windows::Win32::UI::Shell::ExtractIconExW;
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, EnumWindows, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindowVisible, DI_NORMAL,
};

// ---------------------------------------------------------------------------
// Cache: stores heavy-to-fetch per-process data, keyed by PID
// ---------------------------------------------------------------------------
struct CachedInfo {
    arch: String,
    window_title: Option<String>,
    memory_kb: u64,
    exe_path: Option<String>,
    admin: bool,
}

fn cache() -> &'static Mutex<HashMap<u32, CachedInfo>> {
    static CACHE: OnceLock<Mutex<HashMap<u32, CachedInfo>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_get(pid: u32) -> Option<CachedInfo> {
    cache().lock().ok()?.get(&pid).map(|c| CachedInfo {
        arch: c.arch.clone(),
        window_title: c.window_title.clone(),
        memory_kb: c.memory_kb,
        exe_path: c.exe_path.clone(),
        admin: c.admin,
    })
}

fn cache_set(pid: u32, arch: String, window_title: Option<String>, memory_kb: u64, exe_path: Option<String>, admin: bool) {
    if let Ok(mut cache) = cache().lock() {
        cache.insert(
            pid,
            CachedInfo {
                arch,
                window_title,
                memory_kb,
                exe_path,
                admin,
            },
        );
    }
}

// ---------------------------------------------------------------------------
// Icon cache — stores extracted base64 BMP data URIs, keyed by PID
// ---------------------------------------------------------------------------
fn icon_cache() -> &'static Mutex<HashMap<u32, Option<String>>> {
    static ICON_CACHE: OnceLock<Mutex<HashMap<u32, Option<String>>>> = OnceLock::new();
    ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
#[derive(Debug, Clone, Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub arch: String,
    pub window_title: Option<String>,
    pub memory_kb: u64,
    pub exe_path: Option<String>,
    pub admin: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModuleInfo {
    pub name: String,
    pub path: String,
    pub base_address: u64,
    pub size: u32,
}

fn to_wide(s: &str) -> Vec<u16> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

// ---------------------------------------------------------------------------
// Module enumeration for a single process
// ---------------------------------------------------------------------------
pub fn enumerate_modules(pid: u32) -> Vec<ModuleInfo> {
    let mut modules = Vec::new();

    // Use EnumProcessModulesEx — handles cross-architecture (WOW64) correctly,
    // unlike CreateToolhelp32Snapshot which can only see modules matching the
    // caller's bitness.
    let h_proc = match unsafe {
        OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid)
    } {
        Ok(h) => h,
        Err(_) => return modules,
    };

    // Determine module filter flag: 32-bit or 64-bit modules
    let filter = {
        let mut wow64 = windows::Win32::Foundation::BOOL::default();
        let kernel32_wide = to_wide("kernel32.dll");
        let k32 = unsafe {
            windows::Win32::System::LibraryLoader::GetModuleHandleW(
                windows::core::PCWSTR::from_raw(kernel32_wide.as_ptr()),
            )
            .unwrap_or_default()
        };
        let is_wow64_proc: Option<
            unsafe extern "system" fn(
                windows::Win32::Foundation::HANDLE,
                *mut windows::Win32::Foundation::BOOL,
            ) -> windows::Win32::Foundation::BOOL,
        > = unsafe {
            std::mem::transmute(windows::Win32::System::LibraryLoader::GetProcAddress(
                k32,
                windows::core::s!("IsWow64Process"),
            ))
        };
        let is_wow64 = if let Some(f) = is_wow64_proc {
            unsafe { let _ = f(h_proc, &mut wow64); }
            wow64.as_bool()
        } else {
            false
        };
        if is_wow64 { LIST_MODULES_32BIT } else { LIST_MODULES_64BIT }
    };

    let mut h_mods: Vec<HMODULE> = vec![HMODULE::default(); 1024];
    let mut needed: u32 = 0;
    let h_mods_size = (h_mods.len() * std::mem::size_of::<HMODULE>()) as u32;

    if unsafe {
        EnumProcessModulesEx(
            h_proc,
            h_mods.as_mut_ptr(),
            h_mods_size,
            &mut needed,
            filter,
        )
    }
    .is_err()
    {
        unsafe { let _ = CloseHandle(h_proc); }
        return modules;
    }

    let count = (needed as usize) / std::mem::size_of::<HMODULE>();
    h_mods.truncate(count);

    for &h_mod in &h_mods {
        let mut name_buf = [0u16; 260];
        let len = unsafe {
            GetModuleFileNameExW(h_proc, h_mod, &mut name_buf)
        };
        if len == 0 { continue; }
        let name = String::from_utf16_lossy(&name_buf[..len as usize]);
        let base_name = std::path::Path::new(&name)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let mut info = MODULEINFO::default();
        if unsafe { GetModuleInformation(h_proc, h_mod, &mut info, std::mem::size_of::<MODULEINFO>() as u32) }.is_ok() {
            modules.push(ModuleInfo {
                name: base_name,
                path: name,
                base_address: info.lpBaseOfDll as u64,
                size: info.SizeOfImage,
            });
        }
    }

    unsafe { let _ = CloseHandle(h_proc); }
    modules
}

// ---------------------------------------------------------------------------
// Fast enumeration — snapshot-only, merges cached heavy data
// ---------------------------------------------------------------------------
pub fn enumerate_processes_fast() -> Vec<ProcessInfo> {
    let mut processes = Vec::new();

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot.is_err() {
        return processes;
    }
    let snapshot = snapshot.unwrap();

    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            let pid = entry.th32ProcessID;
            let name = String::from_utf16_lossy(&entry.szExeFile)
                .trim_end_matches('\0')
                .to_string();

            if !name.is_empty() {
                // Merge from cache
                if let Some(cached) = cache_get(pid) {
                    processes.push(ProcessInfo {
                        pid,
                        name,
                        arch: cached.arch,
                        window_title: cached.window_title,
                        memory_kb: cached.memory_kb,
                        exe_path: cached.exe_path,
                        admin: cached.admin,
                    });
                } else {
                    // New process — eagerly fetch arch + exe path + admin (cheapest), defer memory+title
                    let arch = detect_arch(pid);
                    let exe_path = get_exe_path(pid);
                    let admin = is_admin(pid);
                    cache_set(pid, arch.clone(), None, 0, exe_path.clone(), admin);
                    processes.push(ProcessInfo {
                        pid,
                        name,
                        arch,
                        window_title: None,
                        memory_kb: 0,
                        exe_path,
                        admin,
                    });
                }
            }

            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }

    let _ = unsafe { CloseHandle(snapshot) };
    processes
}

// ---------------------------------------------------------------------------
// Full enumeration — opens handles, reads memory, updates cache
// ---------------------------------------------------------------------------
pub fn enumerate_processes_full() -> Vec<ProcessInfo> {
    let mut processes = Vec::new();

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot.is_err() {
        return processes;
    }
    let snapshot = snapshot.unwrap();

    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            let pid = entry.th32ProcessID;
            let name = String::from_utf16_lossy(&entry.szExeFile)
                .trim_end_matches('\0')
                .to_string();

            if !name.is_empty() {
                let arch = detect_arch(pid);
                let window_title = find_window_title(pid);
                let memory_kb = get_memory_kb(pid);
                let exe_path = get_exe_path(pid);
                let admin = is_admin(pid);

                cache_set(pid, arch.clone(), window_title.clone(), memory_kb, exe_path.clone(), admin);

                processes.push(ProcessInfo {
                    pid,
                    name,
                    arch,
                    window_title,
                    memory_kb,
                    exe_path,
                    admin,
                });
            }

            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }

    let _ = unsafe { CloseHandle(snapshot) };
    // Clean up stale pids from cache (processes that no longer exist)
    let live_pids: std::collections::HashSet<u32> = processes.iter().map(|p| p.pid).collect();
    if let Ok(mut cache) = cache().lock() {
        cache.retain(|pid, _| live_pids.contains(pid));
    }
    if let Ok(mut cache) = icon_cache().lock() {
        cache.retain(|pid, _| live_pids.contains(pid));
    }

    processes
}

// ---------------------------------------------------------------------------
// Icon extraction
// ---------------------------------------------------------------------------
pub fn get_process_icon(pid: u32) -> Option<String> {
    // Check icon cache first
    if let Ok(cache) = icon_cache().lock() {
        if let Some(entry) = cache.get(&pid) {
            return entry.clone();
        }
    }

    // Try cached exe_path first, fall back to querying it
    let exe_path = cache_get(pid)
        .and_then(|c| c.exe_path)
        .or_else(|| get_exe_path(pid))?;

    let icon = extract_icon_base64(&exe_path);

    // Store in icon cache (even if None, so we don't retry failing PIDs)
    if let Ok(mut cache) = icon_cache().lock() {
        cache.insert(pid, icon.clone());
    }

    icon
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
fn get_exe_path(pid: u32) -> Option<String> {
    let handle = open_process(pid)?;

    let mut buf = vec![0u16; 260];
    let mut len = buf.len() as u32;

    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR::from_raw(buf.as_mut_ptr()),
            &mut len,
        )
    };

    let _ = unsafe { CloseHandle(handle) };

    if result.is_ok() {
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    } else {
        None
    }
}

fn extract_icon_base64(exe_path: &str) -> Option<String> {
    let exe_wide: Vec<u16> = exe_path.encode_utf16().chain(std::iter::once(0)).collect();

    let mut small_icon = Default::default();

    let count = unsafe {
        ExtractIconExW(
            windows::core::PCWSTR(exe_wide.as_ptr()),
            0,
            None,
            Some(&mut small_icon),
            1,
        )
    };

    if count == 0 || small_icon.is_invalid() {
        return None;
    }

    let icon_data = icon_to_png_data(small_icon);
    let _ = unsafe { DestroyIcon(small_icon) };

    icon_data
}

/// Render HICON to a 32bpp RGBA buffer via DrawIconEx (Windows handles mask/transparency),
/// then encode as PNG data URI.
fn icon_to_png_data(
    hicon: windows::Win32::UI::WindowsAndMessaging::HICON,
) -> Option<String> {
    const ICON_SIZE: i32 = 24;

    // Create screen-compatible DC
    let hdc_screen = unsafe { CreateCompatibleDC(None) };
    if hdc_screen.is_invalid() {
        return None;
    }

    // Create a 32bpp DIB section so we get alpha-aware pixels
    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: ICON_SIZE,
            biHeight: -ICON_SIZE, // negative = top-down DIB
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0, // BI_RGB
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [Default::default()],
    };

    let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
    let hbm = unsafe {
        CreateDIBSection(
            hdc_screen,
            &bmi,
            DIB_RGB_COLORS,
            &mut bits,
            None,
            0,
        )
    };

    let hbm = match hbm {
        Ok(h) if !h.is_invalid() => h,
        _ => {
            let _ = unsafe { DeleteDC(hdc_screen) };
            return None;
        }
    };

    // Select the DIB into the DC and draw the icon onto it
    let old_bm = unsafe { SelectObject(hdc_screen, hbm) };
    if old_bm.is_invalid() {
        let _ = unsafe { DeleteObject(hbm) };
        let _ = unsafe { DeleteDC(hdc_screen) };
        return None;
    }

    let _ = unsafe {
        DrawIconEx(
            hdc_screen,
            0,
            0,
            hicon,
            ICON_SIZE,
            ICON_SIZE,
            0,
            None,
            DI_NORMAL,
        )
    };

    // Read back pixels — DrawIconEx fills in proper alpha values
    let pixel_count = (ICON_SIZE * ICON_SIZE) as usize;
    let raw = unsafe { std::slice::from_raw_parts(bits as *const u8, pixel_count * 4) };

    // Raw BGRA → RGBA for PNG encoder
    let mut rgba = vec![0u8; pixel_count * 4];
    for (i, chunk) in raw.chunks_exact(4).enumerate() {
        rgba[i * 4] = chunk[2];     // R
        rgba[i * 4 + 1] = chunk[1]; // G
        rgba[i * 4 + 2] = chunk[0]; // B
        rgba[i * 4 + 3] = chunk[3]; // A (set by DrawIconEx via mask)
    }

    // Cleanup GDI before encoding
    let _ = unsafe { SelectObject(hdc_screen, old_bm) };
    let _ = unsafe { DeleteObject(hbm) };
    let _ = unsafe { DeleteDC(hdc_screen) };

    // Encode PNG
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, ICON_SIZE as u32, ICON_SIZE as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        if let Ok(mut writer) = encoder.write_header() {
            let _ = writer.write_image_data(&rgba);
            writer.finish().ok()?;
        } else {
            return None;
        }
    }

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

fn is_admin(pid: u32) -> bool {
    if pid == 0 { return false; }

    // Try hardest first, fall back to limited (works on protected processes)
    let handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION, false, pid) }
        .or_else(|_| unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) });
    let handle = match handle {
        Ok(h) => h,
        Err(_) => return false,
    };

    let mut token = Default::default();
    if unsafe { OpenProcessToken(handle, TOKEN_QUERY, &mut token) }.is_err() {
        let _ = unsafe { CloseHandle(handle) };
        return false;
    }

    let mut elevation = TOKEN_ELEVATION::default();
    let mut ret_len = 0u32;
    let result = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut TOKEN_ELEVATION as *mut std::ffi::c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut ret_len,
        )
    };

    let _ = unsafe { CloseHandle(token) };
    let _ = unsafe { CloseHandle(handle) };

    result.is_ok() && elevation.TokenIsElevated != 0
}

fn detect_arch(pid: u32) -> String {
    let handle = open_process(pid);
    if handle.is_none() {
        return "x64".to_string();
    }
    let handle = handle.unwrap();

    let mut is_wow64 = windows::Win32::Foundation::BOOL::default();
    let result = unsafe { IsWow64Process(handle, &mut is_wow64) };

    let _ = unsafe { CloseHandle(handle) };

    if result.is_ok() && is_wow64.as_bool() {
        "x86".to_string()
    } else {
        "x64".to_string()
    }
}

struct FindWindowCtx {
    pid: u32,
    title: Option<String>,
}

fn find_window_title(pid: u32) -> Option<String> {
    let mut ctx = FindWindowCtx { pid, title: None };
    let lparam = LPARAM(&mut ctx as *mut FindWindowCtx as isize);
    let _ = unsafe { EnumWindows(Some(enum_window_callback), lparam) };
    ctx.title
}

unsafe extern "system" fn enum_window_callback(
    hwnd: HWND,
    lparam: LPARAM,
) -> windows::Win32::Foundation::BOOL {
    let ctx = unsafe { &mut *(lparam.0 as *mut FindWindowCtx) };

    let mut window_pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut window_pid)) };

    if window_pid != ctx.pid {
        return windows::Win32::Foundation::BOOL::from(true);
    }

    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return windows::Win32::Foundation::BOOL::from(true);
    }

    let text_len = unsafe { GetWindowTextLengthW(hwnd) };
    if text_len == 0 {
        return windows::Win32::Foundation::BOOL::from(true);
    }

    let mut buf = vec![0u16; (text_len + 1) as usize];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if len > 0 {
        ctx.title = Some(String::from_utf16_lossy(&buf[..len as usize]));
    }

    windows::Win32::Foundation::BOOL::from(true)
}

fn get_memory_kb(pid: u32) -> u64 {
    let handle = open_process(pid);
    if handle.is_none() {
        return 0;
    }
    let handle = handle.unwrap();

    let mut pmc = PROCESS_MEMORY_COUNTERS {
        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        ..Default::default()
    };

    let result = unsafe {
        GetProcessMemoryInfo(
            handle,
            &mut pmc,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        )
    };

    let _ = unsafe { CloseHandle(handle) };

    if result.is_ok() {
        pmc.WorkingSetSize as u64 / 1024
    } else {
        0
    }
}

fn open_process(pid: u32) -> Option<HANDLE> {
    if pid == 0 {
        return None;
    }
    unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid) }.ok()
}
