pub mod applog;
mod bridge_client;
mod bridge_job;
mod bridge_state;
mod gamepad;
mod process_enumerator;
mod raw_input;
pub mod startup;
mod system_stats;

use process_enumerator::ProcessInfo;
use process_enumerator::ModuleInfo;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;

use tauri::Emitter;

use windows::Win32::System::Console::SetConsoleCtrlHandler;
use windows::Win32::Foundation::BOOL;

static BRIDGE_CHILDREN: Mutex<Vec<Child>> = Mutex::new(Vec::new());

/// Ctrl+C handler — ensures bridge processes are killed when the user
/// presses Ctrl+C in the terminal (debug mode / running from console).
unsafe extern "system" fn ctrlc_handler(_ctrl_type: u32) -> BOOL {
    shutdown_bridges();
    std::process::exit(0);
}

fn ensure_bridges(app: tauri::AppHandle) {
    // A poisoned lock here used to panic the whole process; the bridge list is
    // bookkeeping, so recover the data instead.
    let mut children = match BRIDGE_CHILDREN.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            applog::warn("bridge", "BRIDGE_CHILDREN mutex was poisoned, recovering");
            poisoned.into_inner()
        }
    };
    if !children.is_empty() {
        applog::info("bridge", "bridges already started — skipping");
        return;
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_default();
    applog::info("bridge", format!("looking for bridge binaries in {}", exe_dir.display()));

    let targets: [(&str, &str); 2] = [("bridge64.exe", "x64"), ("bridge32.exe", "x86")];
    let mut spawned = [false; 2];

    for (i, (name, _arch)) in targets.iter().enumerate() {
        let path = exe_dir.join(name);
        let log_path = exe_dir.join(format!("{name}.log"));
        if !path.exists() {
            applog::warn("bridge", format!("{name} not found at {} — skipped", path.display()));
            continue;
        }
        let stderr = std::fs::File::create(&log_path)
            .map(std::process::Stdio::from)
            .unwrap_or_else(|e| {
                applog::warn("bridge", format!("cannot create {}: {e}", log_path.display()));
                std::process::Stdio::null()
            });
        match std::process::Command::new(&path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(stderr)
            .spawn()
        {
            Ok(mut child) => {
                applog::info("bridge", format!("spawned {} as pid {}", name, child.id()));
                // Join the cleanup job right away: the gap between spawn() and
                // this call is the only window in which a bridge could outlive a
                // force-killed app. Checked for liveness first — a bridge that
                // died on startup cannot be orphaned, and reporting "not in the
                // job" for it would mislead whoever reads the log.
                match child.try_wait() {
                    Ok(Some(status)) => applog::warn("bridge", format!(
                        "{name} (pid {}) exited immediately ({status}) — not added to the cleanup job",
                        child.id()
                    )),
                    _ => {
                        bridge_job::assign(&child, name);
                    }
                }
                spawned[i] = true;
                children.push(child);
            }
            Err(e) => applog::error("bridge", format!("failed to spawn {}: {e}", path.display())),
        }
    }

    // Injection is gated on bridge_state now, so the process list can be
    // released before the checks: shutdown must not wait for them.
    drop(children);

    let health_checks: [(fn() -> bool, &str, &str); 2] = [
        (bridge_client::bridge64_health as fn() -> bool, "bridge64", "x64"),
        (bridge_client::bridge32_health as fn() -> bool, "bridge32", "x86"),
    ];

    // Check both bridges in parallel: a slow bridge32 must not delay bridge64.
    std::thread::scope(|scope| {
        for (i, (check, name, arch)) in health_checks.into_iter().enumerate() {
            let app = &app;
            let was_spawned = spawned[i];
            scope.spawn(move || {
                let ready = if !was_spawned {
                    applog::warn("bridge", format!("{name} was not spawned — marking it unavailable"));
                    false
                } else {
                    let start = std::time::Instant::now();
                    let mut ok = check();
                    while !ok && start.elapsed() < Duration::from_secs(2) {
                        std::thread::sleep(Duration::from_millis(25));
                        ok = check();
                    }
                    if ok {
                        applog::info("bridge", format!("{name} ready after {} ms", start.elapsed().as_millis()));
                    } else {
                        applog::error("bridge", format!("{name} did not become ready within 2 s — speed patching will not work"));
                    }
                    ok
                };
                bridge_state::set(arch, if ready { bridge_state::Phase::Ready } else { bridge_state::Phase::Failed });
                let _ = app.emit("bridge-ready", BridgeReady { arch, ok: ready });
            });
        }
    });
}

#[derive(Clone, serde::Serialize)]
struct BridgeReady {
    arch: &'static str,
    ok: bool,
}

fn shutdown_bridges() {
    // Kill bridge processes immediately — graceful SHUTDOWN via pipe can
    // block if the bridge is busy processing a long-running command.
    //
    // This covers orderly exits only. A force-kill or a crash runs none of this,
    // and is handled by the `bridge_job` kill-on-close job instead. The job
    // handle is deliberately not closed here: `BRIDGE_JOB` is a `OnceLock`, so
    // closing would be irreversible and leave a dangling handle behind for any
    // later `ensure_bridges` to hand to `AssignProcessToJobObject`. There is
    // nothing to gain either — process exit closes it, which is exactly the
    // signal that tears the bridges down.
    // Release any command waiting for a bridge before killing the processes.
    bridge_state::stop_all();
    if let Ok(mut children) = BRIDGE_CHILDREN.lock() {
        for mut child in children.drain(..) {
            applog::info("bridge", format!("killing bridge pid {}", child.id()));
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Sync the chord strings that the raw-input listener should report.
#[tauri::command]
fn set_raw_shortcuts(shortcuts: Vec<String>) {
    raw_input::set_shortcuts(shortcuts);
}

#[tauri::command(async)]
async fn foreground_exe_name() -> String {
    process_enumerator::foreground_exe_name()
}

/// Emits `foreground-changed` when the foreground exe changes. A native thread keeps
/// running while the webview is hidden and its timers are throttled.
fn watch_foreground(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last = String::new();
        loop {
            // ponytail: polls one window every 300ms. Upgrade path: SetWinEventHook(EVENT_SYSTEM_FOREGROUND).
            let name = process_enumerator::foreground_exe_name();
            if name != last {
                let _ = app.emit("foreground-changed", &name);
                last = name;
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    });
}

/// Injected processes only. `on` / `off` is the DLL enable flag. `absent` means
/// no mapping. Pids we cannot read are omitted so the UI keeps its last state.
#[tauri::command(async)]
async fn probe_acceleration(pids: Vec<u32>) -> Vec<process_enumerator::AccelProbe> {
    process_enumerator::probe_acceleration(&pids)
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
    // On cold start the bridges may still be launching; wait for whichever
    // becomes ready first, then apply the factor to both.
    let ready = tauri::async_runtime::spawn_blocking(|| {
        let x64 = bridge_state::wait_ready("x64", Duration::from_secs(5));
        let x86 = bridge_state::wait_ready("x86", Duration::from_secs(5));
        x64 || x86
    }).await.unwrap_or(false);
    if !ready {
        applog::warn("bridge", "set_speed skipped: no bridge ready");
        return false;
    }
    let a = bridge_client::bridge64_set_speed(factor);
    let b = bridge_client::bridge32_set_speed(factor);
    a || b
}

#[tauri::command(async)]
async fn bridge_get_speed() -> Option<f64> {
    let ready = tauri::async_runtime::spawn_blocking(|| {
        bridge_state::wait_ready("x64", Duration::from_secs(5))
    }).await.unwrap_or(false);
    if !ready {
        applog::warn("bridge", "get_speed skipped: bridge64 not ready");
        return None;
    }
    bridge_client::bridge64_get_speed()
}

#[tauri::command(async)]
async fn get_system_stats() -> system_stats::SystemStats {
    system_stats::get_system_stats()
}

#[tauri::command(async)]
async fn bridge_inject(pid: u32, arch: String) -> bool {
    // A cold start launches the bridges on a background thread. Wait for the
    // one that handles this architecture instead of failing the first click.
    let wait_arch = arch.clone();
    let ready = tauri::async_runtime::spawn_blocking(move || {
        bridge_state::wait_ready(&wait_arch, Duration::from_secs(5))
    }).await.unwrap_or(false);
    if !ready {
        applog::warn("bridge", format!("inject {pid} ({arch}) skipped: bridge not ready"));
        return false;
    }
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

/// Path of the diagnostics log, so the UI can reveal it in Explorer.
#[tauri::command(async)]
async fn get_log_path() -> String {
    applog::log_path_string()
}

/// Sink for frontend errors (`window.onerror`, unhandled rejections, React
/// render errors) so they end up in the same file as the Rust-side diagnostics.
#[tauri::command(async)]
async fn report_frontend_error(source: String, message: String, stack: Option<String>) {
    match stack.filter(|s| !s.trim().is_empty()) {
        Some(stack) => applog::error("frontend", format!("{source}: {message}\n{stack}")),
        None => applog::error("frontend", format!("{source}: {message}")),
    }
}

/// Start the GUI. Returns `Err` instead of panicking so the caller can write
/// the failure to the log and show it to the user — a panic here would make the
/// process disappear with no console and no trace.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), String> {
    // Idempotent — own entry point is `main.rs`, this covers any other caller.
    applog::init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        // The flag travels only on the boot registration; a user launch has
        // no arguments, which is what makes the two cases distinguishable.
        .plugin(
            tauri_plugin_autostart::Builder::default()
                .arg(startup::AUTOSTART_FLAG)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            applog::info("setup", "tauri setup callback entered");
            // The window is created hidden and is only revealed here, before
            // anything that could block the event loop.
            startup::apply_initial_window_visibility(app.handle());
            // Bridge startup includes health checks that can take seconds on a
            // cold start. Run it in the background so the window paints; the
            // commands that need a bridge wait on bridge_state instead.
            let bridge_app = app.handle().clone();
            std::thread::spawn(move || ensure_bridges(bridge_app));
            gamepad::start(app.handle().clone());
            raw_input::start(app.handle().clone());
            watch_foreground(app.handle().clone());
            // Register Ctrl+C handler so bridges are killed on console exit
            unsafe { let _ = SetConsoleCtrlHandler(Some(ctrlc_handler), true); }
            applog::info("setup", "startup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            foreground_exe_name,
            set_raw_shortcuts,
            probe_acceleration,
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
            get_log_path,
            report_frontend_error,
        ])
        .device_event_filter(tauri::DeviceEventFilter::Always)
        .build(tauri::generate_context!())
        .map_err(|e| format!("failed to build the application (window/WebView2): {e}"))?;

    applog::info("startup", "app built, entering event loop");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            applog::info("shutdown", "exit requested, stopping bridges");
            gamepad::stop();
            shutdown_bridges();
        }
    });

    applog::info("shutdown", "event loop finished");
    Ok(())
}
