use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::SystemInformation::{
    GlobalMemoryStatusEx, GetVersionExW, MEMORYSTATUSEX, OSVERSIONINFOW,
};
use windows::Win32::System::Threading::GetSystemTimes;

#[derive(Debug, Clone, Serialize)]
pub struct SystemStats {
    pub memory_pct: f64,
    pub cpu_pct: f64,
    pub os_version: String,
}

fn os_version() -> String {
    static CACHED: OnceLock<String> = OnceLock::new();
    CACHED.get_or_init(|| {
        // RtlGetVersion always returns the real OS version (GetVersionExW can lie)
        let ntdll = unsafe { windows::Win32::System::LibraryLoader::GetModuleHandleW(
            windows::core::PCWSTR::from_raw(to_wide("ntdll.dll").as_ptr())
        ) };
        let rtl_get_version: Option<unsafe extern "system" fn(*mut OSVERSIONINFOW) -> i32> = ntdll
            .ok()
            .and_then(|h| unsafe {
                windows::Win32::System::LibraryLoader::GetProcAddress(h, windows::core::s!("RtlGetVersion"))
            })
            .map(|p| unsafe { std::mem::transmute(p) });

        let mut vi = OSVERSIONINFOW {
            dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
            ..Default::default()
        };

        let ok = if let Some(f) = rtl_get_version {
            unsafe { f(&mut vi) == 0 } // STATUS_SUCCESS
        } else {
            unsafe { GetVersionExW(&mut vi) }.is_ok()
        };

        if ok {
            let name = match (vi.dwMajorVersion, vi.dwMinorVersion, vi.dwBuildNumber) {
                (10, 0, b) if b >= 22000 => "Windows 11",
                (10, 0, _) => "Windows 10",
                (6, 3, _) => "Windows 8.1",
                (6, 2, _) => "Windows 8",
                (6, 1, _) => "Windows 7",
                _ => "Windows",
            };
            format!("{name} ({})", vi.dwBuildNumber)
        } else {
            "Windows".into()
        }
    })
    .clone()
}

fn to_wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

struct CpuSnapshot {
    idle: u64,
    kernel: u64,
    user: u64,
}

static CPU_PREV: Mutex<Option<CpuSnapshot>> = Mutex::new(None);

pub fn get_system_stats() -> SystemStats {
    // Memory
    let mut mem = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    let memory_pct = if unsafe { GlobalMemoryStatusEx(&mut mem) }.is_ok() {
        (100.0 - (mem.ullAvailPhys as f64 / mem.ullTotalPhys as f64) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    // CPU — compare with previous call
    let cpu_pct = {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.is_ok() {
            let now = CpuSnapshot {
                idle: ft_to_u64(&idle),
                kernel: ft_to_u64(&kernel),
                user: ft_to_u64(&user),
            };
            let mut prev = CPU_PREV.lock().unwrap();
            let pct = if let Some(ref p) = *prev {
                let idle_delta = now.idle.saturating_sub(p.idle) as f64;
                let total_delta =
                    (now.kernel.saturating_sub(p.kernel) + now.user.saturating_sub(p.user)) as f64;
                if total_delta > 0.0 {
                    (100.0 * (1.0 - idle_delta / total_delta)).clamp(0.0, 100.0)
                } else {
                    0.0
                }
            } else {
                0.0
            };
            *prev = Some(now);
            pct
        } else {
            0.0
        }
    };

    SystemStats { memory_pct, cpu_pct, os_version: os_version() }
}

fn ft_to_u64(ft: &FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)
}
