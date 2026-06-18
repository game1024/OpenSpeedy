use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::ProcessStatus::{
    GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
};
use windows::Win32::System::Threading::{
    IsWow64Process, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
};

use crate::process_manager::{Arch, ProcessInfo};

/// 获取所有活动进程列表（真实系统 API）
pub fn enumerate_processes() -> Vec<ProcessInfo> {
    let mut processes = Vec::new();

    // 创建进程快照
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot.is_err() {
        return processes;
    }
    let snapshot = snapshot.unwrap();

    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    // 遍历进程
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            let pid = entry.th32ProcessID;
            let name = unsafe { String::from_utf16_lossy(&entry.szExeFile) }
                .trim_end_matches('\0')
                .to_string();

            if !name.is_empty() {
                let arch = detect_arch(pid);
                let window_title = find_window_title(pid);
                let memory_kb = get_memory_kb(pid);

                processes.push(ProcessInfo {
                    pid,
                    name,
                    arch,
                    window_title,
                    memory_kb,
                    enabled: false,
                });
            }

            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }

    unsafe { CloseHandle(snapshot) };
    processes
}

/// 检测进程架构
fn detect_arch(pid: u32) -> Arch {
    let handle = open_process(pid);
    if handle.is_none() {
        return Arch::X64;
    }
    let handle = handle.unwrap();

    let mut is_wow64 = windows::Win32::Foundation::BOOL::default();
    let result = unsafe { IsWow64Process(handle, &mut is_wow64) };

    unsafe { CloseHandle(handle) };

    if result.is_ok() && is_wow64.as_bool() {
        Arch::X86
    } else {
        Arch::X64
    }
}

struct FindWindowCtx {
    pid: u32,
    title: Option<String>,
}

/// 通过 PID 查找主窗口标题
fn find_window_title(pid: u32) -> Option<String> {
    let mut ctx = FindWindowCtx {
        pid,
        title: None,
    };

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

/// 获取进程内存占用（KB）
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

    let result = unsafe { GetProcessMemoryInfo(handle, &mut pmc, std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32) };

    unsafe { CloseHandle(handle) };

    if result.is_ok() {
        pmc.WorkingSetSize as u64 / 1024
    } else {
        0
    }
}

/// 打开进程句柄
fn open_process(pid: u32) -> Option<HANDLE> {
    if pid == 0 {
        return None;
    }
    unsafe {
        OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
            false,
            pid,
        )
    }
    .ok()
}
