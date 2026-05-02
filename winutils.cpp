/*
 * OpenSpeedy - Open Source Game Speed Controller
 * Copyright (C) 2025 Game1024
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
#include "winutils.h"
#include <QDebug>
#include <QFileInfo>
#include <QDir>
#include <shellapi.h>
#include <psapi.h>
#include <string>
#include <tlhelp32.h>
#include <wchar.h>
#include <winternl.h>
static QSet<std::wstring> systemNames = {
    L"svchost.exe",
    L"wininit.exe",
    L"RuntimeBroker.exe",
};

winutils::winutils()
{
}

bool winutils::injectDll(DWORD processId, const QString &dllPath)
{
    HANDLE hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, processId);
    if (!hProcess)
    {
        qDebug() << "Failed to open process:" << GetLastError();
        return false;
    }

    if (checkDllExist(processId, dllPath))
    {
        qDebug() << "Process already have been injected";
        return true;
    }
    else if (injectDllViaCRTW(processId, dllPath))
    {
        return true;
    }
    else if (injectDllViaCRTA(processId, dllPath))
    {
        return true;
    }

    injectDllViaAPCW(processId, dllPath);
    injectDllViaAPCA(processId, dllPath);
    if (checkDllExist(processId, dllPath))
    {
        return true;
    }
    else if (injectDllViaWHKW(processId, dllPath))
    {
        return true;
    }
    else if (injectDllViaWHKA(processId, dllPath))
    {
        return true;
    }
    else
    {
        return false;
    }
}

bool winutils::injectDllViaCRTA(DWORD processId, const QString &dllPath)
{
    HANDLE hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, processId);
    if (!hProcess)
    {
        qDebug() << "Failed to open process:" << GetLastError();
        return false;
    }

    if (checkDllExist(processId, dllPath))
    {
        qDebug() << "Process already have been injected";
        return true;
    }
    SIZE_T pathSize = (dllPath.size() + 1) * sizeof(char);
    LPVOID pDllPath =
        VirtualAllocEx(hProcess,
                       nullptr,
                       pathSize,
                       MEM_COMMIT | MEM_RESERVE,
                       PAGE_EXECUTE_READWRITE);
    if (!pDllPath)
    {
        qDebug() << "Failed to allocate memory in target process:"
                 << GetLastError();
        CloseHandle(hProcess);
        return false;
    }

    if (!WriteProcessMemory(hProcess,
                            pDllPath,
                            dllPath.toStdString().c_str(),
                            pathSize,
                            nullptr))
    {
        qDebug() << "Failed to write memory in target process:"
                 << GetLastError();
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    HMODULE hKernel32 = GetModuleHandle(L"kernel32.dll");
    if (!hKernel32)
    {
        qDebug() << "Failed to get handle for kernel32.dll:" << GetLastError();
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    FARPROC pLoadLibraryA = GetProcAddress(hKernel32, "LoadLibraryA");
    if (!pLoadLibraryA)
    {
        qDebug() << "Failed to get address of LoadLibraryA:" << GetLastError();
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    HANDLE hThread = CreateRemoteThread(hProcess,
                                        nullptr,
                                        0,
                                        (LPTHREAD_START_ROUTINE)pLoadLibraryA,
                                        pDllPath,
                                        0,
                                        nullptr);
    if (!hThread)
    {
        qDebug() << "Failed to create remote thread:" << GetLastError();
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    WaitForSingleObject(hThread, INFINITE);

    // 检查LoadLibrary是否执行成功
    DWORD exitCode = 0;
    if (GetExitCodeThread(hThread, &exitCode))
    {
        qDebug() << "Remote thread exit code:" << exitCode;
        // LoadLibrary返回的是模块句柄，如果为0则失败
        if (exitCode == 0)
        {
            VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
            CloseHandle(hProcess);
            CloseHandle(hThread);
            qDebug() << "LoadLibrary failed in remote process";
            return false;
        }
    }

    VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
    CloseHandle(hThread);
    CloseHandle(hProcess);

    return true;
}

bool winutils::injectDllViaCRTW(DWORD processId, const QString &dllPath)
{
    HANDLE hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, processId);
    if (!hProcess)
    {
        qDebug() << "Failed to open process:" << GetLastError();
        return false;
    }

    if (checkDllExist(processId, dllPath))
    {
        qDebug() << "Process already have been injected";
        return true;
    }
    SIZE_T pathSize = (dllPath.size() + 1) * sizeof(wchar_t);
    LPVOID pDllPath =
        VirtualAllocEx(hProcess, nullptr, pathSize, MEM_COMMIT | MEM_RESERVE,
                       PAGE_EXECUTE_READWRITE);
    if (!pDllPath)
    {
        qDebug() << "Failed to allocate memory in target process:"
                 << GetLastError();
        CloseHandle(hProcess);
        return false;
    }

    if (!WriteProcessMemory(hProcess,
                            pDllPath,
                            dllPath.toStdWString().c_str(),
                            pathSize,
                            nullptr))
    {
        qDebug() << "Failed to write memory in target process:"
                 << GetLastError();
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    HMODULE hKernel32 = GetModuleHandle(L"kernel32.dll");
    if (!hKernel32)
    {
        qDebug() << "Failed to get handle for kernel32.dll:" << GetLastError();
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    FARPROC pLoadLibraryW = GetProcAddress(hKernel32, "LoadLibraryW");
    if (!pLoadLibraryW)
    {
        qDebug() << "Failed to get address of LoadLibraryW:" << GetLastError();
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    HANDLE hThread = CreateRemoteThread(hProcess,
                                        nullptr,
                                        0,
                                        (LPTHREAD_START_ROUTINE)pLoadLibraryW,
                                        pDllPath,
                                        0,
                                        nullptr);
    if (!hThread)
    {
        qDebug() << "Failed to create remote thread:" << GetLastError();
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    WaitForSingleObject(hThread, INFINITE);

    // 检查LoadLibrary是否执行成功
    DWORD exitCode = 0;
    if (GetExitCodeThread(hThread, &exitCode))
    {
        qDebug() << "Remote thread exit code:" << exitCode;
        // LoadLibrary返回的是模块句柄，如果为0则失败
        if (exitCode == 0)
        {
            VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
            CloseHandle(hProcess);
            CloseHandle(hThread);
            qDebug() << "LoadLibrary failed in remote process";
            return false;
        }
    }

    VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
    CloseHandle(hThread);
    CloseHandle(hProcess);

    return true;
}

bool winutils::injectDllViaAPCA(DWORD processId, const QString &dllPath)
{
    HANDLE hProcess =
        OpenProcess(PROCESS_ALL_ACCESS,
                    FALSE,
                    processId);

    if (!hProcess)
    {
        qDebug() << "Failed to open process: " << GetLastError();
        return false;
    }

    if (checkDllExist(processId, dllPath))
    {
        qDebug() << "Process already have been injected";
        return true;
    }

    // 在目标进程中分配内存并写入DLL路径
    SIZE_T pathSize = (dllPath.toStdString().size() + 1) * sizeof(char);
    LPVOID pDllPath = VirtualAllocEx(hProcess,
                                     NULL,
                                     pathSize,
                                     MEM_COMMIT,
                                     PAGE_READWRITE);

    if (!pDllPath)
    {
        qDebug() << "Failed to allocate memory: " << GetLastError();
        CloseHandle(hProcess);
        return false;
    }

    if (!WriteProcessMemory(hProcess, pDllPath, dllPath.toStdString().c_str(),
                            pathSize, NULL))
    {
        qDebug() << "Failed to write memory: " << GetLastError();
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    // 获取LoadLibraryW的地址
    HMODULE hKernel32 = GetModuleHandle(L"kernel32.dll");
    if (!hKernel32)
    {
        qDebug() << "Failed to get kernel32 handle";
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    FARPROC pLoadLibraryA = GetProcAddress(hKernel32, "LoadLibraryA");
    if (!pLoadLibraryA)
    {
        qDebug() << "Failed to get LoadLibraryA address";
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    // 获取进程中的所有线程
    DWORD threadId = getProcessMainThread(processId);
    if (!threadId)
    {
        qDebug() << "No threads found in the process";
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    // 向目标进程的所有线程队列中添加APC调用
    bool success = false;

    // 打开线程
    HANDLE hThread = OpenThread(THREAD_SET_CONTEXT, FALSE, threadId);
    if (hThread)
    {
        // 将LoadLibraryA作为APC函数加入队列
        PostThreadMessageA(threadId, WM_PAINT, 0, 0);
        DWORD result =
            QueueUserAPC((PAPCFUNC)pLoadLibraryA, hThread, (ULONG_PTR)pDllPath);
        PostThreadMessageA(threadId, WM_PAINT, 0, 0);
        if (result != 0)
        {
            success = true;
            qDebug() << "APC queued to thread " << threadId;
        }

        CloseHandle(hThread);
    }

    if (!success)
    {
        qDebug() << "Failed to queue APC to any thread";
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    // 注意：我们不释放分配的内存，因为APC函数尚未执行
    // 内存将在DLL加载后释放

    CloseHandle(hProcess);
    return true;
}

bool winutils::injectDllViaAPCW(DWORD processId, const QString &dllPath)
{
    HANDLE hProcess =
        OpenProcess(PROCESS_ALL_ACCESS,
                    FALSE,
                    processId);

    if (!hProcess)
    {
        qDebug() << "Failed to open process: " << GetLastError();
        return false;
    }

    if (checkDllExist(processId, dllPath))
    {
        qDebug() << "Process already have been injected";
        return true;
    }

    // 在目标进程中分配内存并写入DLL路径
    SIZE_T pathSize = (dllPath.toStdWString().size() + 1) * sizeof(wchar_t);
    LPVOID pDllPath = VirtualAllocEx(hProcess,
                                     NULL,
                                     pathSize,
                                     MEM_COMMIT,
                                     PAGE_READWRITE);

    if (!pDllPath)
    {
        qDebug() << "Failed to allocate memory: " << GetLastError();
        CloseHandle(hProcess);
        return false;
    }

    if (!WriteProcessMemory(hProcess,
                            pDllPath,
                            dllPath.toStdWString().c_str(),
                            pathSize,
                            NULL))
    {
        qDebug() << "Failed to write memory: " << GetLastError();
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    // 获取LoadLibraryW的地址
    HMODULE hKernel32 = GetModuleHandle(L"kernel32.dll");
    if (!hKernel32)
    {
        qDebug() << "Failed to get kernel32 handle";
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    FARPROC pLoadLibraryW = GetProcAddress(hKernel32, "LoadLibraryW");
    if (!pLoadLibraryW)
    {
        qDebug() << "Failed to get LoadLibraryW address";
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    // 获取进程中的所有线程
    DWORD threadId = getProcessMainThread(processId);
    if (!threadId)
    {
        qDebug() << "No threads found in the process";
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    // 向目标进程的所有线程队列中添加APC调用
    bool success = false;

    // 打开线程
    HANDLE hThread = OpenThread(THREAD_SET_CONTEXT, FALSE, threadId);
    if (hThread)
    {
        // 将LoadLibraryW作为APC函数加入队列
        PostThreadMessageW(threadId, WM_PAINT, 0, 0);
        DWORD result =
            QueueUserAPC((PAPCFUNC)pLoadLibraryW, hThread, (ULONG_PTR)pDllPath);
        PostThreadMessageW(threadId, WM_PAINT, 0, 0);
        if (result != 0)
        {
            success = true;
            qDebug() << "APC queued to thread " << threadId;
        }

        CloseHandle(hThread);
    }

    if (!success)
    {
        qDebug() << "Failed to queue APC to any thread";
        VirtualFreeEx(hProcess, pDllPath, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return false;
    }

    // 注意：我们不释放分配的内存，因为APC函数尚未执行
    // 内存将在DLL加载后释放

    CloseHandle(hProcess);
    return true;
}

bool winutils::injectDllViaWHKA(DWORD processId, const QString &dllPath)
{
    if (checkProcessProtection(processId))
    {
        qDebug() << "进程被保护 进程ID: " << processId;
        return false;
    }

    // 1. 加载DLL到当前进程
    HMODULE hMod = LoadLibraryA(dllPath.toStdString().c_str());
    if (!hMod)
        return false;

    // 2. 获取Hook过程的地址
    HOOKPROC hookProc = (HOOKPROC)GetProcAddress(hMod, "HookProc");
    if (!hookProc)
        return false;

    // 3. 获取目标线程ID
    DWORD threadId = getProcessMainThread(processId);
    if (threadId == 0)
        return false;

    // 4. 安装Hook
    HHOOK hHook = SetWindowsHookExA(WH_CBT,   // Hook类型
                                    hookProc, // Hook过程
                                    hMod,     // DLL模块句柄
                                    threadId  // 目标线程ID
                                    );

    if (!hHook)
        return false;
    // 5. 触发Hook执行
    PostThreadMessageA(threadId, WM_NULL, 0, 0);
    Sleep(5000);
    UnhookWindowsHookEx(hHook);

    return true;
}

bool winutils::injectDllViaWHKW(DWORD processId, const QString &dllPath)
{
    if (checkProcessProtection(processId))
    {
        qDebug() << "进程被保护 进程ID: " << processId;
        return false;
    }

    // 1. 加载DLL到当前进程
    HMODULE hMod = LoadLibraryW(dllPath.toStdWString().c_str());
    if (!hMod)
        return false;

    // 2. 获取Hook过程的地址
    HOOKPROC hookProc = (HOOKPROC)GetProcAddress(hMod, "HookProc");
    if (!hookProc)
        return false;

    // 3. 获取目标线程ID
    DWORD threadId = getProcessMainThread(processId);
    if (threadId == 0)
        return false;

    // 4. 安装Hook
    HHOOK hHook = SetWindowsHookExW(WH_CBT,   // Hook类型
                                    hookProc, // Hook过程
                                    hMod,     // DLL模块句柄
                                    threadId  // 目标线程ID
                                    );

    if (!hHook)
        return false;
    // 5. 触发Hook执行
    PostThreadMessageW(threadId, WM_NULL, 0, 0);
    Sleep(5000);
    UnhookWindowsHookEx(hHook);

    return true;
}

bool winutils::unhookDll(DWORD processId, const QString &dllPath)
{
    HANDLE hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, processId);
    if (!hProcess)
    {
        qDebug() << "Failed to open process:" << GetLastError();
        return false;
    }

    HMODULE hModules[1024];
    DWORD cbNeeded;
    if (EnumProcessModules(hProcess, hModules, sizeof(hModules), &cbNeeded))
    {
        for (unsigned int i = 0; i < (cbNeeded / sizeof(HMODULE)); i++)
        {
            TCHAR moduleName[MAX_PATH];
            if (GetModuleFileNameEx(hProcess, hModules[i], moduleName,
                                    sizeof(moduleName) / sizeof(TCHAR)))
            {
#ifdef UNICODE
                bool isDll = dllPath.toStdWString() == moduleName;
#else
                bool isDll = dllPath.toStdString() == moduleName;
#endif
                if (isDll)
                {
                    FARPROC pFreeLibrary = GetProcAddress(
                        GetModuleHandle(L"kernel32.dll"), "FreeLibrary");
                    if (!pFreeLibrary)
                    {
                        qDebug() << "Failed to get address of FreeLibrary:"
                                 << GetLastError();
                        CloseHandle(hProcess);
                        return false;
                    }

                    HANDLE hThread =
                        CreateRemoteThread(hProcess, nullptr, 0,
                                           (LPTHREAD_START_ROUTINE)pFreeLibrary,
                                           hModules[i], 0, nullptr);
                    if (!hThread)
                    {
                        qDebug() << "Failed to create remote thread for "
                            "FreeLibrary:"
                                 << GetLastError();
                        CloseHandle(hProcess);
                        return false;
                    }

                    WaitForSingleObject(hThread, INFINITE);
                    CloseHandle(hThread);
                    CloseHandle(hProcess);
                    return true;
                }
            }
        }
    }

    CloseHandle(hProcess);
    return false;
}

bool winutils::checkDllExist(DWORD processId, const QString &dllPath)
{
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
                                  FALSE,
                                  processId);
    if (!hProcess)
    {
        qDebug() << "打开进程失败:" << GetLastError();
        return false;
    }

    bool dllFound = false;
    HMODULE hModules[1024];
    DWORD cbNeeded;

    // 获取进程中所有已加载的模块
    if (EnumProcessModules(hProcess, hModules, sizeof(hModules), &cbNeeded))
    {
        DWORD moduleCount = cbNeeded / sizeof(HMODULE);
        for (DWORD i = 0; i < moduleCount; i++)
        {
            TCHAR moduleName[MAX_PATH] = {0};

            // 获取模块的完整路径
            if (GetModuleFileNameExW(hProcess, hModules[i], moduleName,
                                     sizeof(moduleName) / sizeof(TCHAR)))
            {
#ifdef UNICODE
                bool isDll = dllPath.toStdWString() == moduleName;
#else
                bool isDll = dllPath.toStdString() == moduleName;
#endif
                if (isDll)
                {
                    dllFound = true;
                    break;
                }
            }
        }
    }
    else
    {
        qDebug() << "枚举进程模块失败:" << GetLastError();
    }

    CloseHandle(hProcess);
    return dllFound;
}

bool winutils::checkProcessProtection(DWORD processId)
{
    HANDLE hProcess =
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
    if (!hProcess)
    {
        qDebug() << "Cannot open process - likely protected";
        return true; // 可能被保护
    }

    // 检查是否是受保护进程
    PROCESS_PROTECTION_LEVEL_INFORMATION protectionInfo = {};
    DWORD returnLength;

    if (GetProcessInformation(hProcess, ProcessProtectionLevelInfo,
                              &protectionInfo, sizeof(protectionInfo)))
    {
        CloseHandle(hProcess);
        return protectionInfo.ProtectionLevel != PROTECTION_LEVEL_NONE;
    }

    CloseHandle(hProcess);
    return false;
}

void winutils::setAutoStart(bool enable,
                            const QString &appName,
                            const QString &execPath)
{
    TaskScheduler scheduler;

    if (enable)
    {
        scheduler.createStartupShortcut(appName, execPath);
    }
    else
    {
        scheduler.deleteStartupShortcut(appName);
    }
}

bool winutils::isAutoStartEnabled(const QString &appName)
{
    TaskScheduler scheduler;
    return scheduler.isStartupShortcutExists(appName);
}

typedef struct _OSVERSIONINFOEXW RTL_OSVERSIONINFOEXW, *PRTL_OSVERSIONINFOEXW;
typedef LONG NTSTATUS;
typedef NTSTATUS (WINAPI *fnRtlGetVersion)(PRTL_OSVERSIONINFOEXW);

BOOL winutils::getWindowsVersion(DWORD *majorVersion,
                                 DWORD *minorVersion,
                                 DWORD *buildNumber)
{
    HMODULE hNtdll = GetModuleHandleW(L"ntdll.dll");
    if (!hNtdll)
        return FALSE;

    fnRtlGetVersion RtlGetVersion =
        (fnRtlGetVersion)GetProcAddress(hNtdll, "RtlGetVersion");
    if (!RtlGetVersion)
        return FALSE;

    RTL_OSVERSIONINFOEXW osInfo;
    ZeroMemory(&osInfo, sizeof(RTL_OSVERSIONINFOEXW));
    osInfo.dwOSVersionInfoSize = sizeof(RTL_OSVERSIONINFOEXW);

    NTSTATUS status = RtlGetVersion(&osInfo);
    if (status != 0)
        return FALSE;

    if (majorVersion)
        *majorVersion = osInfo.dwMajorVersion;
    if (minorVersion)
        *minorVersion = osInfo.dwMinorVersion;
    if (buildNumber)
        *buildNumber = osInfo.dwBuildNumber;

    return TRUE;
}

QString winutils::getWindowsVersion()
{
    static char version[100] = {0};
    DWORD major, minor, build;

    if (!getWindowsVersion(&major, &minor, &build))
        return "Unknown Windows Version";

    // 确定Windows版本
    if (major == 10)
    {
        if (build >= 22000)
        {
            sprintf(version, "Windows 11 (Build %lu)", build);
        }
        else
        {
            sprintf(version, "Windows 10 (Build %lu)", build);
        }
    }
    else if (major == 6)
    {
        switch (minor)
        {
        case 3:
            sprintf(version, "Windows 8.1 (Build %lu)", build);
            break;
        case 2:
            sprintf(version, "Windows 8 (Build %lu)", build);
            break;
        case 1:
            sprintf(version, "Windows 7 (Build %lu)", build);
            break;
        case 0:
            sprintf(version, "Windows Vista (Build %lu)", build);
            break;
        default:
            sprintf(version, "Windows NT %lu.%lu (Build %lu)", major, minor,
                    build);
        }
    }
    else if (major == 5)
    {
        switch (minor)
        {
        case 2:
            sprintf(version, "Windows Server 2003 (Build %lu)", build);
            break;
        case 1:
            sprintf(version, "Windows XP (Build %lu)", build);
            break;
        case 0:
            sprintf(version, "Windows 2000 (Build %lu)", build);
            break;
        default:
            sprintf(version, "Windows NT %lu.%lu (Build %lu)", major, minor,
                    build);
        }
    }
    else
    {
        sprintf(version, "Windows NT %lu.%lu (Build %lu)", major, minor, build);
    }
    return version;
}

QList<ProcessInfo> winutils::getProcessList()
{
    QList<ProcessInfo> processList;

    HANDLE hProcessSnap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hProcessSnap == INVALID_HANDLE_VALUE)
    {
        qDebug() << "创建进程快照失败: " << GetLastError();
        return processList;
    }

    PROCESSENTRY32 pe32;
    pe32.dwSize = sizeof(PROCESSENTRY32);

    if (!Process32First(hProcessSnap, &pe32))
    {
        qDebug() << "获取首个进程信息失败: " << GetLastError();
        CloseHandle(hProcessSnap);
        return processList;
    }

    do
    {
        if (systemNames.contains(pe32.szExeFile))
        {
            continue;
        }
        ProcessInfo info;
        info.pid = pe32.th32ProcessID;
        info.parentPid = pe32.th32ParentProcessID;
        info.name = QString::fromWCharArray(pe32.szExeFile);
        info.threadCount = pe32.cntThreads;

        // 获取内存使用和优先级信息
        HANDLE hProcess = OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, info.pid);
        if (hProcess)
        {
            PROCESS_MEMORY_COUNTERS pmc;
            if (GetProcessMemoryInfo(hProcess, &pmc, sizeof(pmc)))
            {
                info.memoryUsage = pmc.WorkingSetSize;
            }
            else
            {
                info.memoryUsage = 0;
            }
            BOOL wow64Process = FALSE;
            IsWow64Process(hProcess, &wow64Process);
            info.is64Bit = !wow64Process;
            info.priorityClass = GetPriorityClass(hProcess);
            CloseHandle(hProcess);
        }
        else
        {
            info.memoryUsage = 0;
            info.priorityClass = 0;
        }

        processList.append(info);
    } while (Process32Next(hProcessSnap, &pe32));

    CloseHandle(hProcessSnap);
    return processList;
}

QString winutils::getProcessPath(DWORD processId)
{
    QString processPath;
    // 使用新的QueryFullProcessImageName，这在处理即使是挂起的进程时也更可靠
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
    if (!hProcess)
    {
        // 备选方案，如果上述权限不足
        hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, processId);
    }
    
    if (hProcess != NULL)
    {
        wchar_t buffer[MAX_PATH];
        DWORD dwSize = MAX_PATH;
        if (QueryFullProcessImageNameW(hProcess, 0, buffer, &dwSize))
        {
            processPath = QString::fromWCharArray(buffer);
        }
        else if (GetModuleFileNameExW(hProcess, NULL, buffer, MAX_PATH) > 0)
        {
            processPath = QString::fromWCharArray(buffer);
        }
        CloseHandle(hProcess);
    }

    return processPath;
}

bool winutils::terminateProcess(DWORD processId)
{
    HANDLE hProcess = OpenProcess(PROCESS_TERMINATE, FALSE, processId);
    if (hProcess == NULL)
        return false;

    BOOL result = TerminateProcess(hProcess, 0);
    CloseHandle(hProcess);
    return result != FALSE;
}

void winutils::openProcessFolder(DWORD processId)
{
    QString path = getProcessPath(processId);
    if (!path.isEmpty())
    {
        QString nativePath = QDir::toNativeSeparators(path);
        // 使用 /select 选中文件而不仅仅是打开文件夹
        ShellExecute(NULL, L"open", L"explorer.exe",
                     (L" /select,\"" + nativePath.toStdWString() + L"\"").c_str(),
                     NULL, SW_SHOWNORMAL);
    }
}

DWORD
winutils::getProcessMainThread(DWORD processId)
{
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (hSnapshot == INVALID_HANDLE_VALUE)
    {
        qDebug() << "Failed to create thread snapshot:" << GetLastError();
        return 0;
    }

    THREADENTRY32 te32;
    te32.dwSize = sizeof(THREADENTRY32);

    DWORD mainThreadId = 0;
    FILETIME earliestTime = {0xFFFFFFFF, 0xFFFFFFFF}; // 设为最大值

    if (Thread32First(hSnapshot, &te32))
    {
        do
        {
            if (te32.th32OwnerProcessID == processId)
            {
                // 打开线程获取创建时间
                HANDLE hThread = OpenThread(THREAD_QUERY_INFORMATION, FALSE,
                                            te32.th32ThreadID);
                if (hThread)
                {
                    FILETIME creationTime, exitTime, kernelTime, userTime;
                    if (GetThreadTimes(hThread, &creationTime, &exitTime,
                                       &kernelTime, &userTime))
                    {
                        // 比较创建时间，找最早的线程
                        if (CompareFileTime(&creationTime, &earliestTime) < 0)
                        {
                            earliestTime = creationTime;
                            mainThreadId = te32.th32ThreadID;
                        }
                    }
                    CloseHandle(hThread);
                }
            }
        } while (Thread32Next(hSnapshot, &te32));
    }

    CloseHandle(hSnapshot);
    return mainThreadId;
}

QString winutils::getProcessNameById(DWORD processId)
{
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
                                  FALSE, processId);
    if (hProcess == NULL)
    {
        return QString();
    }

    wchar_t processName[MAX_PATH];
    if (GetModuleBaseName(hProcess, NULL, processName, MAX_PATH))
    {
        CloseHandle(hProcess);
        QString name = QString::fromWCharArray(processName);
        return name;
    }

    CloseHandle(hProcess);
    return QString();
}

bool winutils::enableAllPrivilege()
{
    HANDLE hToken;
    // 获取进程token
    if (!OpenProcessToken(GetCurrentProcess(),
                          TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &hToken))
        return false;

    const wchar_t *essentialPrivileges[] = {
        SE_DEBUG_NAME, // 最重要的调试权限
    };

    TOKEN_PRIVILEGES tkp;
    bool success = true;

    for (const auto &privilege : essentialPrivileges)
    {
        tkp.PrivilegeCount = 1;
        tkp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
        if (LookupPrivilegeValue(NULL, privilege, &tkp.Privileges[0].Luid))
        {
            AdjustTokenPrivileges(hToken, FALSE, &tkp, 0, NULL, NULL);
        }
    }

    CloseHandle(hToken);
    return success;
}
