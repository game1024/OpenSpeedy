// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use windows::Win32::System::Threading::CreateMutexW;
use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS, CloseHandle};
use windows::core::PCWSTR;

fn main() {
    // Single instance guard
    let name: Vec<u16> = "OpenSpeedy_SingleInstance\0".encode_utf16().collect();
    unsafe {
        if let Ok(h) = CreateMutexW(None, true, PCWSTR::from_raw(name.as_ptr())) {
            if GetLastError() == ERROR_ALREADY_EXISTS {
                let _ = CloseHandle(h);
                return;
            }
        }
    }

    openspeedy_lib::run()
}
