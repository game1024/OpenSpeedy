mod bridge_client;
mod process_enumerator;
mod system_stats;

use process_enumerator::ProcessInfo;
use process_enumerator::ModuleInfo;
use std::process::Child;
use std::sync::Mutex;

use windows::Win32::System::Console::SetConsoleCtrlHandler;
use windows::Win32::Foundation::BOOL;

static BRIDGE_CHILDREN: Mutex<Vec<Child>> = Mutex::new(Vec::new());

/// Ctrl+C handler — ensures bridge processes are killed when the user
/// presses Ctrl+C in the terminal (debug mode / running from console).
unsafe extern "system" fn ctrlc_handler(_ctrl_type: u32) -> BOOL {
    shutdown_bridges();
    std::process::exit(0);
}

fn ensure_bridges() {
    let mut children = BRIDGE_CHILDREN.lock().unwrap();
    if !children.is_empty() { return; }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_default();

    for name in &["bridge64.exe", "bridge32.exe"] {
        let path = exe_dir.join(name);
        let log_path = exe_dir.join(format!("{name}.log"));
        if path.exists() {
            let stderr = std::fs::File::create(&log_path)
                .map(std::process::Stdio::from)
                .unwrap_or_else(|_| std::process::Stdio::null());
            match std::process::Command::new(&path)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(stderr)
                .spawn()
            {
                Ok(child) => children.push(child),
                Err(_) => {}
            }
        }
    }

    // Wait until bridges are ready (pipe server accepting connections)
    let health_checks: [(&str, fn() -> bool); 2] = [
        ("bridge64", bridge_client::bridge64_health as fn() -> bool),
        ("bridge32", bridge_client::bridge32_health as fn() -> bool),
    ];
    for (name, check) in &health_checks {
        for _ in 0..20 {
            if check() { break; }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        eprintln!("[startup] {name} health: {}", check());
    }
}

fn shutdown_bridges() {
    // Kill bridge processes immediately — graceful SHUTDOWN via pipe can
    // block if the bridge is busy processing a long-running command.
    if let Ok(mut children) = BRIDGE_CHILDREN.lock() {
        for mut child in children.drain(..) {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command(async)]
async fn get_process_list_fast() -> Vec<ProcessInfo> {
    process_enumerator::enumerate_processes_fast()
}

#[tauri::command(async)]
async fn get_process_list() -> Vec<ProcessInfo> {
    process_enumerator::enumerate_processes_full()
}

#[tauri::command(async)]
async fn get_process_icon(pid: u32) -> Option<String> {
    process_enumerator::get_process_icon(pid)
}

#[tauri::command(async)]
async fn get_process_modules(pid: u32) -> Vec<ModuleInfo> {
    process_enumerator::enumerate_modules(pid)
}

#[tauri::command(async)]
async fn bridge64_health() -> bool {
    bridge_client::bridge64_health()
}

#[tauri::command(async)]
async fn bridge32_health() -> bool {
    bridge_client::bridge32_health()
}

#[tauri::command(async)]
async fn bridge_set_speed(factor: f64) -> bool {
    let a = bridge_client::bridge64_set_speed(factor);
    let b = bridge_client::bridge32_set_speed(factor);
    a || b
}

#[tauri::command(async)]
async fn bridge_get_speed() -> Option<f64> {
    bridge_client::bridge64_get_speed()
}

#[tauri::command(async)]
async fn get_system_stats() -> system_stats::SystemStats {
    // GPU APIs and stale display drivers can block for several seconds. Keep
    // those synchronous probes off Tauri's event loop so the window stays
    // responsive while the first probe is being resolved and cached.
    tauri::async_runtime::spawn_blocking(system_stats::get_system_stats)
        .await
        .expect("system statistics worker panicked")
}

#[tauri::command(async)]
async fn bridge_inject(pid: u32, arch: String) -> bool {
    if arch == "x86" {
        let ok = bridge_client::bridge32_inject(pid);
        bridge_client::bridge32_enable(pid);
        ok
    } else {
        let ok = bridge_client::bridge64_inject(pid);
        bridge_client::bridge64_enable(pid);
        ok
    }
}

#[tauri::command(async)]
async fn bridge_enable(pid: u32, arch: String) -> bool {
    if arch == "x86" {
        bridge_client::bridge32_enable(pid)
    } else {
        bridge_client::bridge64_enable(pid)
    }
}

#[tauri::command(async)]
async fn bridge_disable(pid: u32, arch: String) -> bool {
    if arch == "x86" {
        bridge_client::bridge32_disable(pid)
    } else {
        bridge_client::bridge64_disable(pid)
    }
}

/// Query bridge for per-PID status.
/// Returns Some(true) = enabled, Some(false) = injected but disabled, None = not injected.
#[tauri::command(async)]
async fn bridge_get_status(pid: u32, arch: String) -> Option<bool> {
    if arch == "x86" {
        bridge_client::bridge32_get_status(pid)
    } else {
        bridge_client::bridge64_get_status(pid)
    }
}

#[tauri::command(async)]
async fn set_always_on_top(window: tauri::Window, on_top: bool) {
    let _ = window.set_always_on_top(on_top);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            ensure_bridges();
            // Register Ctrl+C handler so bridges are killed on console exit
            unsafe { let _ = SetConsoleCtrlHandler(Some(ctrlc_handler), true); }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_process_list,
            get_process_list_fast,
            get_process_icon,
            get_process_modules,
            bridge64_health,
            bridge32_health,
            bridge_set_speed,
            bridge_get_speed,
            get_system_stats,
            bridge_inject,
            bridge_enable,
            bridge_disable,
            bridge_get_status,
            set_always_on_top,
        ])
        .device_event_filter(tauri::DeviceEventFilter::Always)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                shutdown_bridges();
            }
        });
}
