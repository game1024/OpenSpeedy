use std::io::Read;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, OnceLock,
};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::SystemInformation::{
    GlobalMemoryStatusEx, GetVersionExW, MEMORYSTATUSEX, OSVERSIONINFOW,
};
use windows::Win32::System::Threading::GetSystemTimes;

#[derive(Debug, Clone, Serialize)]
pub struct GpuStats {
    pub name: String,
    pub used_mb: u64,
    pub total_mb: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemStats {
    pub memory_pct: f64,
    pub cpu_pct: f64,
    pub os_version: String,
    pub gpu: Option<GpuStats>,
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

// `hypomnesis` normally falls back to spawning nvidia-smi. Its subprocess is
// not created with CREATE_NO_WINDOW, so Windows Terminal can briefly appear on
// systems with a stale NVIDIA driver but no usable NVIDIA GPU. Keep the
// fallback under our control so it is hidden and stop retrying after a failure.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const NVIDIA_SMI_TIMEOUT: Duration = Duration::from_secs(2);
static GPU_STATS_UNAVAILABLE: AtomicBool = AtomicBool::new(false);
static GPU_QUERY_LOCK: Mutex<()> = Mutex::new(());

fn gpu_stats() -> Option<GpuStats> {
    if GPU_STATS_UNAVAILABLE.load(Ordering::Acquire) {
        return None;
    }

    // Serialize the complete native/fallback probe. Multiple frontend refreshes
    // can overlap while a broken display driver is taking a long time to fail.
    let _query_guard = GPU_QUERY_LOCK.lock().ok()?;
    if GPU_STATS_UNAVAILABLE.load(Ordering::Acquire) {
        return None;
    }

    let native = hypomnesis::Snapshot::now(0).ok().and_then(|snap| {
        snap.gpu_device.map(|dev| GpuStats {
            name: dev.name.unwrap_or_default(),
            used_mb: dev.total_bytes.saturating_sub(dev.free_bytes) / (1024 * 1024),
            total_mb: dev.total_bytes / (1024 * 1024),
        })
    });

    if native.is_some() {
        return native;
    }

    let fallback = nvidia_smi_gpu_stats();
    if fallback.is_none() {
        // A machine without a usable GPU will not recover during the process
        // lifetime. Avoid repeatedly entering slow or broken driver code.
        GPU_STATS_UNAVAILABLE.store(true, Ordering::Release);
    }
    fallback
}

fn nvidia_smi_gpu_stats() -> Option<GpuStats> {
    let mut command = Command::new("nvidia-smi");
    command
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .args([
            "--query-gpu=name,memory.used,memory.total",
            "--format=csv,noheader,nounits",
            "--id=0",
        ]);

    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + NVIDIA_SMI_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }

                let mut output = Vec::new();
                child.stdout.take()?.read_to_end(&mut output).ok()?;
                return parse_nvidia_smi_output(&output);
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

fn parse_nvidia_smi_output(output: &[u8]) -> Option<GpuStats> {
    let line = std::str::from_utf8(output)
        .ok()?
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let mut fields = line.rsplitn(3, ',').map(str::trim);
    let total_mb = fields.next()?.parse().ok()?;
    let used_mb = fields.next()?.parse().ok()?;
    let name = fields.next()?;

    if name.is_empty() || total_mb == 0 || used_mb > total_mb {
        return None;
    }

    Some(GpuStats {
        name: name.to_owned(),
        used_mb,
        total_mb,
    })
}

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

    // GPU
    let gpu = gpu_stats();

    SystemStats { memory_pct, cpu_pct, os_version: os_version(), gpu }
}

fn ft_to_u64(ft: &FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)
}

#[cfg(test)]
mod tests {
    use super::parse_nvidia_smi_output;

    #[test]
    fn parses_nvidia_smi_gpu_stats() {
        let stats = parse_nvidia_smi_output(b"NVIDIA GeForce RTX 4070, 1536, 12282\r\n")
            .expect("valid nvidia-smi output should parse");

        assert_eq!(stats.name, "NVIDIA GeForce RTX 4070");
        assert_eq!(stats.used_mb, 1536);
        assert_eq!(stats.total_mb, 12282);
    }

    #[test]
    fn parses_gpu_name_containing_a_comma() {
        let stats = parse_nvidia_smi_output(b"NVIDIA Test, Adapter, 256, 8192\n")
            .expect("the final two comma-separated fields are memory values");

        assert_eq!(stats.name, "NVIDIA Test, Adapter");
        assert_eq!(stats.used_mb, 256);
        assert_eq!(stats.total_mb, 8192);
    }

    #[test]
    fn rejects_invalid_nvidia_smi_output() {
        assert!(parse_nvidia_smi_output(b"").is_none());
        assert!(parse_nvidia_smi_output(b"permission denied").is_none());
        assert!(parse_nvidia_smi_output(b"GPU, 9000, 8000").is_none());
    }
}
