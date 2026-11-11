pub mod applog;
mod bridge_client;
mod bridge_job;
mod dispatch;
mod gamepad;
mod inject_guard;
mod input_poll;
mod inputtrace;
mod process_enumerator;
mod remote;
pub mod startup;
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

    for name in &["bridge64.exe", "bridge32.exe"] {
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
                children.push(child);
            }
            Err(e) => applog::error("bridge", format!("failed to spawn {}: {e}", path.display())),
        }
    }

    // Wait until bridges are ready (pipe server accepting connections)
    let health_checks: [(&str, fn() -> bool); 2] = [
        ("bridge64", bridge_client::bridge64_health as fn() -> bool),
        ("bridge32", bridge_client::bridge32_health as fn() -> bool),
    ];
    for (name, check) in &health_checks {
        let start = std::time::Instant::now();
        let mut ok = check();
        while !ok && start.elapsed() < std::time::Duration::from_secs(2) {
            std::thread::sleep(std::time::Duration::from_millis(100));
            ok = check();
        }
        if ok {
            applog::info("bridge", format!("{name} ready after {} ms", start.elapsed().as_millis()));
        } else {
            applog::error("bridge", format!("{name} did not become ready within 2 s — speed patching will not work"));
        }
    }
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
    if let Ok(mut children) = BRIDGE_CHILDREN.lock() {
        for mut child in children.drain(..) {
            applog::info("bridge", format!("killing bridge pid {}", child.id()));
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command(async)]
async fn foreground_exe_name() -> String {
    process_enumerator::foreground_exe_name()
}

/// Emits `foreground-changed` when the foreground exe changes. A native thread keeps
/// running while the webview is hidden and its timers are throttled.
fn watch_foreground(app: tauri::AppHandle) {
    use tauri::Emitter;
    std::thread::spawn(move || {
        let mut last = String::new();
        loop {
            // Polls the foreground window every 300 ms. Deliberately no OS
            // event hooks: the input layer must not install any hook.
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
    system_stats::get_system_stats()
}

/// Run one shortcut action in Rust. The frontend calls this instead of
/// changing the speed itself when the stage-3 switch is on.
#[tauri::command(async)]
async fn input_dispatch(app: tauri::AppHandle, slot: String, phase: String, source: String) -> Option<f64> {
    dispatch::dispatch(&app, &slot, &phase, &source)
}

/// Stage-3 switch: the action happens in Rust instead of in the webview.
#[tauri::command(async)]
async fn input_dispatch_mode(enabled: bool) {
    dispatch::set_enabled(enabled);
}

/// The speed values the Rust dispatcher needs.
#[tauri::command(async)]
async fn input_config(
    increase_step: f64,
    decrease_step: f64,
    gears: Vec<f64>,
    hold_speed: f64,
) {
    let mut values = [1.0, 2.0, 5.0, 10.0, 100.0];
    for (index, value) in gears.iter().take(5).enumerate() {
        values[index] = *value;
    }
    dispatch::set_config(dispatch::Config {
        increase_step,
        decrease_step,
        gears: values,
        hold_speed,
    });
}

/// Switch the local control page on or off. While it is off nothing listens
/// on the port.
#[tauri::command(async)]
async fn remote_enable(app: tauri::AppHandle, enabled: bool) {
    remote::set_enabled(enabled, app);
}

/// Address and token of the local control page.
#[tauri::command(async)]
async fn remote_info() -> remote::RemoteInfo {
    remote::info()
}

/// The slots that are polled instead of registered as hotkeys. A chord the
/// OS refused (1409) or every chord in compatibility mode ends up here.
#[tauri::command(async)]
async fn input_poll_set(bindings: Vec<(String, String)>) {
    input_poll::set_bindings(bindings);
}

/// Master switch for the polling channel.
#[tauri::command(async)]
async fn input_poll_enable(enabled: bool) {
    input_poll::set_enabled(enabled);
}

/// Exe names that count as "a game is in front of the user" — they get the
/// fast polling period.
#[tauri::command(async)]
async fn input_poll_focus_exes(exes: Vec<String>) {
    input_poll::set_focus_exes(exes);
}

/// Anti-cheat check for one pid. The UI calls this before offering to enable
/// speed, so the refusal is explained instead of silently failing.
#[tauri::command(async)]
async fn injection_guard(pid: u32) -> inject_guard::GuardVerdict {
    inject_guard::check(pid)
}

/// Stage-4 rollback switch: `false` (default) keeps the hard deny, `true`
/// degrades it to a strong warning. No code rollback is needed.
#[tauri::command(async)]
async fn injection_guard_mode(warn_only: bool) {
    inject_guard::set_warn_only(warn_only);
}

#[tauri::command(async)]
async fn bridge_inject(pid: u32, arch: String, force: bool) -> bool {
    // Defence in depth: the UI asked the guard already, but a stale process
    // list or a direct invoke must not be able to skip it.
    if !force {
        let verdict = inject_guard::check(pid);
        if !verdict.allowed {
            applog::warn(
                "guard",
                format!(
                    "refused pid={pid} reason={} matched={}",
                    verdict.reason,
                    verdict.matched.as_deref().unwrap_or("-"),
                ),
            );
            inputtrace::trace_inject(pid, false, "guard_denied");
            return false;
        }
        if let Some(warning) = &verdict.warning {
            applog::warn(
                "guard",
                format!(
                    "warn-only pid={pid} reason={warning} matched={}",
                    verdict.matched.as_deref().unwrap_or("-"),
                ),
            );
        }
    }

    let ok = if arch == "x86" {
        let ok = bridge_client::bridge32_inject(pid);
        bridge_client::bridge32_enable(pid);
        ok
    } else {
        let ok = bridge_client::bridge64_inject(pid);
        bridge_client::bridge64_enable(pid);
        ok
    };

    // Stage 0 observation: one line per attempt (deduped inside `inputtrace`).
    // A false result has two very different causes, so ask the bridge whether
    // it is reachable at all before blaming the injection.
    if ok {
        inputtrace::trace_inject(pid, true, "ok");
    } else {
        let reachable = if arch == "x86" {
            bridge_client::bridge32_health()
        } else {
            bridge_client::bridge64_health()
        };
        inputtrace::trace_inject(pid, false, if reachable { "inject_failed" } else { "bridge_unreachable" });
    }
    ok
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

/// One structured input-layer record. Field values are whitelisted in
/// `inputtrace`, so the log never carries key text or window titles.
#[tauri::command(async)]
async fn input_trace(
    event: String,
    slot: Option<String>,
    channel: Option<String>,
    code: Option<u32>,
    pid: Option<u32>,
    ok: Option<bool>,
    reason: Option<String>,
) {
    inputtrace::trace(
        &event,
        slot.as_deref(),
        channel.as_deref(),
        code,
        pid,
        ok,
        reason.as_deref(),
    );
}

/// Mirrors the `input.observe` switch. Off means the input layer adds nothing
/// to the log — injection results included.
#[tauri::command(async)]
async fn set_input_trace(enabled: bool) {
    inputtrace::set_enabled(enabled);
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
            // Before the bridge health checks, which can block for seconds:
            // the window is created hidden and is only revealed here.
            startup::apply_initial_window_visibility(app.handle());
            ensure_bridges();
            gamepad::start(app.handle().clone());
            input_poll::start(app.handle().clone());
            watch_foreground(app.handle().clone());
            // Register Ctrl+C handler so bridges are killed on console exit
            unsafe { let _ = SetConsoleCtrlHandler(Some(ctrlc_handler), true); }
            applog::info("setup", "startup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            foreground_exe_name,
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
            injection_guard,
            injection_guard_mode,
            input_dispatch,
            remote_enable,
            remote_info,
            input_dispatch_mode,
            input_config,
            input_poll_set,
            input_poll_enable,
            input_poll_focus_exes,
            bridge_enable,
            bridge_disable,
            bridge_get_status,
            set_always_on_top,
            get_log_path,
            report_frontend_error,
            input_trace,
            set_input_trace,
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
