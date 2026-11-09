// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use windows::Win32::System::Threading::CreateMutexW;
use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS, CloseHandle};
use windows::core::PCWSTR;

fn main() {
    // First statement in the process: panics before this point are the only
    // ones that cannot be logged.
    openspeedy_lib::applog::init();

    // Single instance guard
    let name: Vec<u16> = "OpenSpeedy_SingleInstance\0".encode_utf16().collect();
    unsafe {
        if let Ok(h) = CreateMutexW(None, true, PCWSTR::from_raw(name.as_ptr())) {
            if GetLastError() == ERROR_ALREADY_EXISTS {
                let _ = CloseHandle(h);
                openspeedy_lib::applog::warn(
                    "startup",
                    "another instance is already running — second instance exiting (window stays hidden)",
                );
                return;
            }
        }
    }

    openspeedy_lib::applog::info("startup", "single-instance check passed");

    if let Err(e) = openspeedy_lib::run() {
        openspeedy_lib::applog::error("fatal", format!("{e}"));
        // A boot launch must never put a dialog in front of the user — a
        // silent one is not even supposed to show a window. The failure is
        // still written to the log, which the tray menu can reveal later.
        if !openspeedy_lib::startup::is_autostart_launch() {
            openspeedy_lib::applog::fatal_dialog(&format!(
                "OpenSpeedy failed to start.\n\n{e}\n\nA log was written to:\n{}",
                openspeedy_lib::applog::log_path_string()
            ));
        }
        std::process::exit(1);
    }

    openspeedy_lib::applog::info("shutdown", "run() returned, process exiting normally");
}
