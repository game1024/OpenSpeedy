/*
 * OpenSpeedy - Open Source Game Speed Controller
 * Copyright (C) 2025 Game1024
 *
 * This program is free software: you can redistribute it
 * and/or modify it under the terms of the GNU General
 * Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be
 * useful, but WITHOUT ANY WARRANTY; without even the
 * implied warranty of MERCHANTABILITY or FITNESS FOR A
 * PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public
 * License along with this program.  If not, see
 * <https://www.gnu.org/licenses/>.
 */
#include <windows.h>
#include <winternl.h>
#include "Minhook.h"
#include "speedpatch.h"
#include <atomic>
#include <mmsystem.h>
#include <shared_mutex>
#include <sstream>
#pragma comment(lib, "winmm.lib")
#pragma data_seg("shared")
static std::atomic<double> factor = 1.0;
#pragma data_seg()
#pragma comment(linker, "/section:shared,RWS")

static std::shared_mutex mutex;
static std::atomic<double> pre_factor = 1.0;
static HANDLE hShare;
static bool* pEnable;

typedef VOID (WINAPI* SLEEP) (DWORD);
typedef DWORD (WINAPI* SLEEPEX) (DWORD, BOOL);

typedef UINT_PTR (WINAPI* SETTIMER) (
    HWND,
    UINT_PTR,
    UINT,
    TIMERPROC
    );
typedef DWORD (WINAPI* TIMEGETTIME) (VOID);
typedef MMRESULT (WINAPI* TIMESETEVENT) (
    UINT,
    UINT,
    LPTIMECALLBACK,
    DWORD_PTR,
    UINT
    );

typedef LONG (WINAPI* GETMESSAGETIME) (VOID);
typedef DWORD (WINAPI* GETTICKCOUNT) (VOID);
typedef ULONGLONG (WINAPI* GETTICKCOUNT64) (VOID);

typedef BOOL (WINAPI* QUERYPERFORMANCECOUNTER) (LARGE_INTEGER*);
typedef BOOL (WINAPI* QUERYPERFORMANCEFREQUENCY) (LARGE_INTEGER*);

typedef VOID (WINAPI* GETSYSTEMTIMEASFILETIME) (LPFILETIME);
typedef VOID (WINAPI* GETSYSTEMTIMEPRECISEASFILETIME) (LPFILETIME);

typedef BOOL (WINAPI* SETWAITABLETIMEREX) (
    HANDLE,
    const LARGE_INTEGER*,
    LONG,
    PTIMERAPCROUTINE,
    LPVOID,
    PREASON_CONTEXT,
    ULONG);

inline VOID shouldUpdateAll();

static SLEEP pfnKernelSleep = NULL;
static SLEEP pfnDetourSleep = NULL;

static SLEEPEX pfnKernelSleepEx = NULL;
static SLEEPEX pfnDetourSleepEx = NULL;

static SETTIMER pfnKernelSetTimer = NULL;
static SETTIMER pfnDetourSetTimer = NULL;

static TIMEGETTIME pfnKernelTimeGetTime = NULL;
static TIMEGETTIME pfnDetourTimeGetTime = NULL;

static TIMESETEVENT pfnKernelTimeSetEvent = NULL;
static TIMESETEVENT pfnDetourTimeSetEvent = NULL;

static GETMESSAGETIME pfnKernelGetMessageTime = NULL;
static GETMESSAGETIME pfnDetourGetMessageTime = NULL;

static GETTICKCOUNT pfnKernelGetTickCount = NULL;
static GETTICKCOUNT pfnDetourGetTickCount = NULL;

static GETTICKCOUNT64 pfnKernelGetTickCount64 = NULL;
static GETTICKCOUNT64 pfnDetourGetTickCount64 = NULL;

static QUERYPERFORMANCECOUNTER pfnKernelQueryPerformanceCounter = NULL;
static QUERYPERFORMANCECOUNTER pfnDetourQueryPerformanceCounter = NULL;

static QUERYPERFORMANCEFREQUENCY pfnKernelQueryPerformanceFrequency = NULL;
static QUERYPERFORMANCEFREQUENCY pfnDetourQueryPerformanceFrequency = NULL;

static GETSYSTEMTIMEASFILETIME pfnKernelGetSystemTimeAsFileTime = NULL;
static GETSYSTEMTIMEASFILETIME pfnDetourGetSystemTimeAsFileTime = NULL;

static GETSYSTEMTIMEPRECISEASFILETIME pfnKernelGetSystemTimePreciseAsFileTime = NULL;
static GETSYSTEMTIMEPRECISEASFILETIME pfnDetourGetSystemTimePreciseAsFileTime = NULL;

static SETWAITABLETIMEREX pfnKernelSetWaitableTimerEx = NULL;
static SETWAITABLETIMEREX pfnDetourSetWaitableTimerEx = NULL;

SPEEDPATCH_API void ChangeSpeed(double factor_)
{
    factor.store(factor_);
}

void Init()
{
    DWORD processId = GetCurrentProcessId();
    std::wstring filemapName = GetProcessFileMapName(processId);
    hShare = CreateFileMapping(
        INVALID_HANDLE_VALUE,
        NULL,
        PAGE_READWRITE,
        0,
        sizeof (bool),
        filemapName.c_str()
        );
    if (hShare == NULL)
    {
        return;
    }
    pEnable = (bool*) MapViewOfFile(
        hShare,
        FILE_MAP_ALL_ACCESS,
        0,
        0,
        sizeof (bool)
        );
    *pEnable = true;
}

void Clean()
{
    if (hShare != NULL)
    {
        UnmapViewOfFile(pEnable);
        CloseHandle(hShare);
    }
}

BOOL GetStatus()
{
    return *pEnable;
}

void SetProcessStatus(DWORD processId, BOOL status)
{
    std::wstring filemapName = GetProcessFileMapName(processId);
    HANDLE hShare_ = OpenFileMapping(FILE_MAP_ALL_ACCESS,
                                     FALSE,
                                     filemapName.c_str()
                                     );
    if (hShare_ == NULL)
    {
        return;
    }
    bool* pStatus = (bool*) MapViewOfFile(hShare_,
                                          FILE_MAP_ALL_ACCESS,
                                          0,
                                          0,
                                          sizeof (bool));
    *pStatus = status;
    UnmapViewOfFile(pStatus);
    CloseHandle(hShare_);
}

std::wstring GetCurrentProcessName()
{
    wchar_t processPath[MAX_PATH];
    GetModuleFileName(NULL, processPath, MAX_PATH);
    std::wstring fullPath(processPath);
    size_t lastSlash = fullPath.find_last_of(L"\\");
    if (lastSlash != std::wstring::npos)
    {
        fullPath = fullPath.substr(lastSlash + 1);
    }
    return fullPath;
}

std::wstring GetProcessFileMapName(DWORD processId)
{
    std::wstringstream wss;
    wss << L"OpenSpeedy." << processId;
    return wss.str();
}

double SpeedFactor()
{
    if (GetStatus())
    {
        return factor.load();
    }
    else
    {
        return 1.0;
    }
}

VOID WINAPI DetourSleep(DWORD dwMilliseconds)
{
    std::shared_lock<std::shared_mutex> lock(mutex);
    pfnKernelSleep(dwMilliseconds / SpeedFactor());
}

DWORD WINAPI DetourSleepEx(DWORD dwMilliseconds, BOOL bAlertable)
{
    std::shared_lock<std::shared_mutex> lock(mutex);
    return pfnKernelSleepEx(dwMilliseconds / SpeedFactor(), bAlertable);
}

UINT_PTR WINAPI DetourSetTimer(HWND      hWnd,
                               UINT_PTR  nIDEvent,
                               UINT      uElapse,
                               TIMERPROC lpTimerFunc)
{
    std::shared_lock<std::shared_mutex> lock(mutex);
    return pfnKernelSetTimer(
        hWnd,
        nIDEvent,
        uElapse / SpeedFactor(),
        lpTimerFunc
        );
}

static DWORD baselineKernelTimeGetTime = 0;
static DWORD baselineDetourTimeGetTime = 0;
static DWORD prevcallKernelTimeGetTime = 0;
static DWORD prevcallDetourTimeGetTime = 0;
static std::atomic<bool> shouldUpdateTimeGetTime = false;

DWORD WINAPI DetourTimeGetTime(VOID)
{
    std::shared_lock<std::shared_mutex> lock(mutex);
    if (pre_factor != SpeedFactor())
    {
        pre_factor = SpeedFactor();
        shouldUpdateAll();
    }
    bool expected = true;
    if (shouldUpdateTimeGetTime.compare_exchange_weak(expected, false))
    {
        baselineKernelTimeGetTime = prevcallKernelTimeGetTime;
        baselineDetourTimeGetTime = prevcallDetourTimeGetTime;
    }
    DWORD now = pfnKernelTimeGetTime();
    prevcallKernelTimeGetTime = now;
    DWORD delta = SpeedFactor() * (now - baselineKernelTimeGetTime);
    prevcallDetourTimeGetTime = baselineDetourTimeGetTime + delta;
    return baselineDetourTimeGetTime + delta;
}

MMRESULT WINAPI DetourTimeSetEvent(UINT           uDelay,
                                   UINT           uResolution,
                                   LPTIMECALLBACK lpTimeProc,
                                   DWORD_PTR      dwUser,
                                   UINT           fuEvent)
{
    return pfnKernelTimeSetEvent(
        uDelay / SpeedFactor(),
        uResolution,
        lpTimeProc,
        dwUser,
        fuEvent);
}

static LONG baselineKernelGetMessageTime = 0;
static LONG baselineDetourGetMessageTime = 0;
static LONG prevcallKernelGetMessageTime = 0;
static LONG prevcallDetourGetMessageTime = 0;
static std::atomic<bool> shouldUpdateGetMessageTime = false;
LONG WINAPI DetourGetMessageTime(VOID)
{
    std::shared_lock<std::shared_mutex> lock(mutex);
    if (pre_factor != SpeedFactor())
    {
        pre_factor = SpeedFactor();
        shouldUpdateAll();
    }
    bool expected = true;
    if (shouldUpdateGetMessageTime.compare_exchange_weak(expected, false))
    {
        baselineKernelGetMessageTime = prevcallKernelGetMessageTime;
        baselineDetourGetMessageTime = prevcallDetourGetMessageTime;
    }
    DWORD now = pfnKernelGetMessageTime();
    prevcallKernelGetMessageTime = now;
    DWORD delta = SpeedFactor() * (now - baselineKernelGetMessageTime);
    prevcallDetourGetMessageTime = baselineDetourGetMessageTime + delta;
    return baselineDetourGetMessageTime + delta;
}

static DWORD baselineKernelGetTickCount = 0;
static DWORD baselineDetourGetTickCount = 0;
static DWORD prevcallKernelGetTickCount = 0;
static DWORD prevcallDetourGetTickCount = 0;
static std::atomic<bool> shouldUpdateGetTickCount = false;
DWORD WINAPI DetourGetTickCount(VOID)
{
    std::shared_lock<std::shared_mutex> lock(mutex);
    if (pre_factor != SpeedFactor())
    {
        pre_factor = SpeedFactor();
        shouldUpdateAll();
    }
    bool expected = true;
    if (shouldUpdateGetTickCount.compare_exchange_weak(expected, false))
    {
        baselineKernelGetTickCount = prevcallKernelGetTickCount;
        baselineDetourGetTickCount = prevcallDetourGetTickCount;
    }
    DWORD now = pfnKernelGetTickCount();
    prevcallKernelGetTickCount = now;
    DWORD delta = SpeedFactor() * (now - baselineKernelGetTickCount);
    prevcallDetourGetTickCount = baselineDetourGetTickCount + delta;
    return baselineDetourGetTickCount + delta;
}

static ULONGLONG baselineKernelGetTickCount64 = 0;
static ULONGLONG baselineDetourGetTickCount64 = 0;
static ULONGLONG prevcallKernelGetTickCount64 = 0;
static ULONGLONG prevcallDetourGetTickCount64 = 0;
std::atomic<bool> shouldUpdateGetTickCount64 = false;
ULONGLONG WINAPI DetourGetTickCount64(VOID)
{
    std::shared_lock<std::shared_mutex> lock(mutex);
    if (pre_factor != SpeedFactor())
    {
        pre_factor = SpeedFactor();
        shouldUpdateAll();
    }
    bool expected = true;
    if (shouldUpdateGetTickCount64.compare_exchange_weak(expected, false))
    {
        baselineKernelGetTickCount64 = prevcallKernelGetTickCount64;
        baselineDetourGetTickCount64 = prevcallDetourGetTickCount64;
    }
    ULONGLONG now = pfnKernelGetTickCount64();
    prevcallKernelGetTickCount64 = now;
    ULONGLONG delta = SpeedFactor() * (now - baselineKernelGetTickCount64);
    prevcallDetourGetTickCount64 = baselineDetourGetTickCount64 + delta;
    return baselineDetourGetTickCount64 + delta;
}

static LARGE_INTEGER baselineKernelQueryPerformanceCounter = { 0 };
static LARGE_INTEGER baselineDetourQueryPerformanceCounter = { 0 };
static LARGE_INTEGER prevcallKernelQueryPerformanceCounter = { 0 };
static LARGE_INTEGER prevcallDetourQueryPerformanceCounter = { 0 };
static std::atomic<bool> shouldUpdateQueryPerformanceCounter = false;
BOOL WINAPI DetourQueryPerformanceCounter(LARGE_INTEGER* lpPerformanceCount)
{
    std::shared_lock<std::shared_mutex> lock(mutex);
    if (lpPerformanceCount == NULL)
    {
        return FALSE;
    }
    if (pre_factor != SpeedFactor())
    {
        pre_factor = SpeedFactor();
        shouldUpdateAll();
    }
    // 更新基准时间点
    bool expected = true;
    if (shouldUpdateQueryPerformanceCounter.compare_exchange_weak(expected,
                                                                  false))
    {
        baselineKernelQueryPerformanceCounter = prevcallKernelQueryPerformanceCounter;
        baselineDetourQueryPerformanceCounter = prevcallDetourQueryPerformanceCounter;
    }
    BOOL rtncode = pfnKernelQueryPerformanceCounter(
        &prevcallKernelQueryPerformanceCounter);
    if (rtncode == TRUE)
    {
        *lpPerformanceCount = prevcallKernelQueryPerformanceCounter;
    }
    LONGLONG delta =
        SpeedFactor() * (lpPerformanceCount->QuadPart -
                         baselineKernelQueryPerformanceCounter.QuadPart)
    ;
    lpPerformanceCount->QuadPart = baselineDetourQueryPerformanceCounter.QuadPart + delta;
    prevcallDetourQueryPerformanceCounter = *lpPerformanceCount;
    return rtncode;
}

static LARGE_INTEGER baselineKernelQueryPerformanceFrequency = { 0 };
BOOL WINAPI DetourQueryPerformanceFrequency(LARGE_INTEGER* lpFrequency)
{
    std::shared_lock<std::shared_mutex> lock(mutex);
    if (lpFrequency == NULL)
    {
        return FALSE;
    }
    else
    {
        BOOL rtncode = pfnKernelQueryPerformanceFrequency(lpFrequency);
        lpFrequency->QuadPart = SpeedFactor() * lpFrequency->QuadPart;
        return rtncode;
    }
}

static std::atomic<FILETIME> baselineKernelGetSystemTimeAsFileTime({ 0 });
static std::atomic<FILETIME> baselineDetourGetSystemTimeAsFileTime({ 0 });
static std::atomic<FILETIME> prevcallKernelGetSystemTimeAsFileTime({ 0 });
static std::atomic<FILETIME> prevcallDetourGetSystemTimeAsFileTime({ 0 });
static std::atomic<bool> shouldUpdateGetSystemTimeAsFileTime = false;
VOID WINAPI DetourGetSystemTimeAsFileTime(LPFILETIME lpSystemTimeAsFileTime)
{
    std::shared_lock<std::shared_mutex> lock(mutex);
    if (lpSystemTimeAsFileTime == NULL)
    {
        return;
    }
    if (pre_factor != SpeedFactor())
    {
        pre_factor = SpeedFactor();
        shouldUpdateAll();
    }
    bool expected = true;
    if (shouldUpdateGetSystemTimeAsFileTime.compare_exchange_weak(expected,
                                                                  false))
    {
        baselineKernelGetSystemTimeAsFileTime.store(
            prevcallKernelGetSystemTimeAsFileTime.load());
        baselineDetourGetSystemTimeAsFileTime.store(
            prevcallDetourGetSystemTimeAsFileTime.load());
    }
    // 从全局变量读取基准点快照到线程栈
    FILETIME baselineKernelSnapshot = baselineKernelGetSystemTimeAsFileTime.load();
    ULARGE_INTEGER baselineKernel = { baselineKernelSnapshot.dwLowDateTime,
                                      baselineKernelSnapshot.dwHighDateTime
    };
    FILETIME baselineDetourSnapshot = baselineDetourGetSystemTimeAsFileTime.load();
    ULARGE_INTEGER baselineDetour = { baselineDetourSnapshot.dwLowDateTime,
                                      baselineDetourSnapshot.dwHighDateTime
    };
    FILETIME ftNow = { 0 };
    pfnKernelGetSystemTimeAsFileTime(&ftNow);
    prevcallKernelGetSystemTimeAsFileTime.store(ftNow);
    ULARGE_INTEGER ulNow = { ftNow.dwLowDateTime, ftNow.dwHighDateTime };
    ULONGLONG delta = SpeedFactor() * (ulNow.QuadPart - baselineKernel.QuadPart);
    ULARGE_INTEGER ulRtn = { 0 };
    ulRtn.QuadPart = baselineDetour.QuadPart + delta;
    prevcallDetourGetSystemTimeAsFileTime.store(
        { ulRtn.LowPart, ulRtn.HighPart });
    (*lpSystemTimeAsFileTime) = { ulRtn.LowPart, ulRtn.HighPart };
}

static std::atomic<FILETIME> baselineKernelGetSystemTimePreciseAsFileTime({ 0 });
static std::atomic<FILETIME> baselineDetourGetSystemTimePreciseAsFileTime({ 0 });
static std::atomic<FILETIME> prevcallKernelGetSystemTimePreciseAsFileTime({ 0 });
static std::atomic<FILETIME> prevcallDetourGetSystemTimePreciseAsFileTime({ 0 });
static std::atomic<bool> shouldUpdateGetSystemTimePreciseAsFileTime = false;
VOID WINAPI
DetourGetSystemTimePreciseAsFileTime(LPFILETIME lpSystemTimeAsFileTime)
{
    std::shared_lock<std::shared_mutex> lock(mutex);
    if (lpSystemTimeAsFileTime == NULL)
    {
        return;
    }
    if (pre_factor != SpeedFactor())
    {
        pre_factor = SpeedFactor();
        shouldUpdateAll();
    }
    bool expected = true;
    if (shouldUpdateGetSystemTimePreciseAsFileTime.compare_exchange_weak(
            expected, false))
    {
        baselineKernelGetSystemTimePreciseAsFileTime.store(
            prevcallKernelGetSystemTimePreciseAsFileTime.load());
        baselineDetourGetSystemTimePreciseAsFileTime.store(
            prevcallDetourGetSystemTimePreciseAsFileTime.load());
    }
    // 从全局变量读取基准点快照到线程栈
    FILETIME baselineKernelSnapshot = baselineKernelGetSystemTimePreciseAsFileTime.load();
    ULARGE_INTEGER baselineKernel = { baselineKernelSnapshot.dwLowDateTime,
                                      baselineKernelSnapshot.dwHighDateTime
    };
    FILETIME baselineDetourSnapshot = baselineDetourGetSystemTimePreciseAsFileTime.load();
    ULARGE_INTEGER baselineDetour = { baselineDetourSnapshot.dwLowDateTime,
                                      baselineDetourSnapshot.dwHighDateTime
    };
    FILETIME ftNow = { 0 };
    pfnKernelGetSystemTimePreciseAsFileTime(&ftNow);
    prevcallKernelGetSystemTimePreciseAsFileTime.store(ftNow);
    ULARGE_INTEGER ulNow = { ftNow.dwLowDateTime,
                             ftNow.dwHighDateTime
    };
    ULONGLONG delta = SpeedFactor() * (ulNow.QuadPart - baselineKernel.QuadPart);
    ULARGE_INTEGER ulRtn = { 0 };
    ulRtn.QuadPart = baselineDetour.QuadPart + delta;
    prevcallDetourGetSystemTimePreciseAsFileTime.store({ ulRtn.LowPart, ulRtn.HighPart });
    (*lpSystemTimeAsFileTime) = { ulRtn.LowPart, ulRtn.HighPart };
}

BOOL WINAPI DetourSetWaitableTimerEx(
    HANDLE               hTimer,
    const LARGE_INTEGER* lpDueTime,
    LONG                 lPeriod,
    PTIMERAPCROUTINE     pfnCompletionRoutine,
    LPVOID               lpArgToCompletionRoutine,
    PREASON_CONTEXT      WakeContext,
    ULONG                TolerableDelay
    )
{
    LARGE_INTEGER dueTime = {0};
    dueTime.QuadPart = lpDueTime->QuadPart / SpeedFactor();
    return pfnKernelSetWaitableTimerEx(hTimer,
                                       &dueTime,
                                       lPeriod,
                                       pfnCompletionRoutine,
                                       lpArgToCompletionRoutine,
                                       WakeContext,
                                       TolerableDelay);
}

inline VOID shouldUpdateAll()
{
    shouldUpdateTimeGetTime = true;
    shouldUpdateGetMessageTime = true;
    shouldUpdateGetTickCount = true;
    shouldUpdateGetTickCount64 = true;
    shouldUpdateQueryPerformanceCounter = true;
    shouldUpdateGetSystemTimeAsFileTime = true;
    shouldUpdateGetSystemTimePreciseAsFileTime = true;
}

template <typename S, typename T>
inline VOID MH_HOOK(S* pTarget, S* pDetour, T** ppOriginal)
{

    if (MH_CreateHook(reinterpret_cast<LPVOID> (pTarget),
                      reinterpret_cast<LPVOID> (pDetour),
                      reinterpret_cast<LPVOID*> (ppOriginal)) != MH_OK)
    {
        MessageBoxW(NULL, L"MH装载失败", L"DLL", MB_OK);
    }

    if (MH_EnableHook(reinterpret_cast<LPVOID> (pTarget)) != MH_OK)
    {
        MessageBoxW(NULL, L"MH装载失败", L"DLL", MB_OK);
    }
}

template <typename T>
VOID MH_UNHOOK(T* pTarget)
{
    MH_RemoveHook(reinterpret_cast<LPVOID> (pTarget));
}

LRESULT CALLBACK HookProc(int    nCode,
                          WPARAM wParam,
                          LPARAM lParam)
{
    if (nCode >= 0)
    {
        // Hook被触发，DLL已经注入到目标进程
        // 在这里执行需要的操作
        // 只执行一次，然后移除Hook
        static bool executed = false;
        if (!executed)
        {
            executed = true;
        }
    }
    return CallNextHookEx(NULL, nCode, wParam, lParam);
}

BOOL APIENTRY DllMain(HMODULE hModule,
                      DWORD   ul_reason_for_call,
                      LPVOID  lpReserved)
{
    FILETIME now = { 0 };
    HMODULE hKernel32;
    SETWAITABLETIMEREX pSetWaitableTimerEx;
    switch (ul_reason_for_call)
    {
    case DLL_PROCESS_ATTACH:
        hKernel32 = GetModuleHandleW(L"kernel32.dll");

        if (MH_Initialize() != MH_OK)
        {
            MessageBoxW(NULL, L"MH装载失败", L"DLL", MB_OK);
            return FALSE;
        }
        Init();
        /* Initial timeGetTime */
        baselineKernelTimeGetTime = timeGetTime();
        prevcallKernelTimeGetTime = baselineKernelTimeGetTime;
        baselineDetourTimeGetTime = baselineKernelTimeGetTime;
        prevcallDetourTimeGetTime = baselineKernelTimeGetTime;

        baselineKernelGetMessageTime = GetMessageTime();
        prevcallKernelGetMessageTime = baselineKernelGetMessageTime;
        baselineDetourGetMessageTime = baselineKernelGetMessageTime;
        prevcallDetourGetMessageTime = baselineKernelGetMessageTime;

        /* Initial GetTickCount */
        baselineKernelGetTickCount = GetTickCount();
        prevcallKernelGetTickCount = baselineKernelGetTickCount;
        baselineDetourGetTickCount = baselineKernelGetTickCount;
        prevcallDetourGetTickCount = baselineKernelGetTickCount;

        baselineKernelGetTickCount64 = GetTickCount64();
        prevcallKernelGetTickCount64 = baselineKernelGetTickCount64;
        baselineDetourGetTickCount64 = baselineKernelGetTickCount64;
        prevcallDetourGetTickCount64 = baselineKernelGetTickCount64;

        /* Initial QueryPerformanceCounter */
        QueryPerformanceCounter(&baselineKernelQueryPerformanceCounter);
        prevcallKernelQueryPerformanceCounter = baselineKernelQueryPerformanceCounter;
        baselineDetourQueryPerformanceCounter = baselineKernelQueryPerformanceCounter;
        prevcallDetourQueryPerformanceCounter = baselineKernelQueryPerformanceCounter;

        /* Initial QueryPerformanceFrequency */
        QueryPerformanceFrequency(&baselineKernelQueryPerformanceFrequency);

        /* Initial GetSystemTimeAsFileTime */
        GetSystemTimeAsFileTime(&now);
        baselineKernelGetSystemTimeAsFileTime.store(now);
        prevcallKernelGetSystemTimeAsFileTime.store(now);
        baselineDetourGetSystemTimeAsFileTime.store(now);
        prevcallDetourGetSystemTimeAsFileTime.store(now);

        /* Initial GetSystemTimePreciseAsFileTime */
        GetSystemTimePreciseAsFileTime(&now);
        baselineKernelGetSystemTimePreciseAsFileTime.store(now);
        prevcallKernelGetSystemTimePreciseAsFileTime.store(now);
        baselineDetourGetSystemTimePreciseAsFileTime.store(now);
        prevcallDetourGetSystemTimePreciseAsFileTime.store(now);

        MH_HOOK(&Sleep,
                &DetourSleep,
                reinterpret_cast<LPVOID*> (&pfnKernelSleep));
        MH_HOOK(&SleepEx,
                &DetourSleepEx,
                reinterpret_cast<LPVOID*>(&pfnKernelSleepEx));

        pSetWaitableTimerEx = (SETWAITABLETIMEREX)GetProcAddress(hKernel32, "SetWaitableTimerEx");
        MH_HOOK(pSetWaitableTimerEx,
                &DetourSetWaitableTimerEx,
                reinterpret_cast<LPVOID*>(&pfnKernelSetWaitableTimerEx));
        MH_HOOK(&SetTimer,
                &DetourSetTimer,
                reinterpret_cast<LPVOID*> (&pfnKernelSetTimer));
        MH_HOOK(&timeGetTime,
                &DetourTimeGetTime,
                reinterpret_cast<LPVOID*> (&pfnKernelTimeGetTime));
        MH_HOOK(&timeSetEvent,
                &DetourTimeSetEvent,
                reinterpret_cast<LPVOID*>(&pfnKernelTimeSetEvent));
        MH_HOOK(&GetMessageTime,
                &DetourGetMessageTime,
                reinterpret_cast<LPVOID*>(&pfnKernelGetMessageTime));
        MH_HOOK(&GetTickCount,
                &DetourGetTickCount,
                reinterpret_cast<LPVOID*> (&pfnKernelGetTickCount));
        MH_HOOK(&GetTickCount64,
                &DetourGetTickCount64,
                reinterpret_cast<LPVOID*> (&pfnKernelGetTickCount64));
        MH_HOOK(&QueryPerformanceCounter,
                &DetourQueryPerformanceCounter,
                reinterpret_cast<LPVOID*> (&pfnKernelQueryPerformanceCounter));
        MH_HOOK(&GetSystemTimeAsFileTime,
                &DetourGetSystemTimeAsFileTime,
                reinterpret_cast<LPVOID*> (&pfnKernelGetSystemTimeAsFileTime));
        MH_HOOK(&GetSystemTimePreciseAsFileTime,
                &DetourGetSystemTimePreciseAsFileTime,
                reinterpret_cast<LPVOID*> (
                    &pfnKernelGetSystemTimePreciseAsFileTime));


        break;
    case DLL_THREAD_ATTACH:
        break;
    case DLL_THREAD_DETACH:
        break;
    case DLL_PROCESS_DETACH:
    {
        {
            std::unique_lock<std::shared_mutex> lock(mutex);
            MH_DisableHook(MH_ALL_HOOKS);
        }
        {
            std::unique_lock<std::shared_mutex> lock(mutex);
            MH_UNHOOK(pfnKernelSleep);
            MH_UNHOOK(pfnKernelSetTimer);
            MH_UNHOOK(pfnKernelTimeGetTime);
            MH_UNHOOK(pfnKernelTimeSetEvent);
            MH_UNHOOK(pfnKernelGetTickCount);
            MH_UNHOOK(pfnKernelGetTickCount64);
            MH_UNHOOK(pfnKernelQueryPerformanceCounter);
            MH_UNHOOK(pfnKernelGetSystemTimeAsFileTime);
            MH_UNHOOK(pfnKernelGetSystemTimePreciseAsFileTime);
        }
        // Wait for All threads to finish detour api
        Sleep(1000);
        {
            std::unique_lock<std::shared_mutex> lock(mutex);
            if (MH_Uninitialize() != MH_OK)
            {
                MessageBoxW(NULL, L"DLL卸载失败", L"DLL", MB_OK);
                return FALSE;
            }
        }
        Clean();
        break;
    }
    }
    return TRUE;
}
