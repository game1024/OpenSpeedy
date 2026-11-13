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
#pragma comment(lib, "winmm.lib")
#pragma data_seg("shared")
static std::atomic<double> factor = 1.0;
// 安装失败的 hook 数。放在共享段里 —— 注入到游戏里的那份 DLL 记录到的失败
// 也能被 bridge 进程读到（两者映射同一个 DLL 镜像），从而写进 bridge 的日志。
static std::atomic<unsigned> hookFailures = 0;
#pragma data_seg()
#pragma comment(linker, "/section:shared,RWS")

static std::shared_mutex mutex;
static std::atomic<double> pre_factor = 1.0;
static HANDLE hFileMap;
static bool*  pEnabled;

inline VOID shouldUpdateAll();

SPEEDPATCH_API void SP_SetSpeed(double factor_)
{
    factor.store(factor_);
}

SPEEDPATCH_API double SP_GetSpeed()
{
    return factor.load();
}

SPEEDPATCH_API unsigned SP_GetHookFailures()
{
    return hookFailures.load();
}

void SP_Install()
{
    DWORD processId = GetCurrentProcessId();
    WCHAR filemapName[64];
    GetProcessFileMapName(processId, filemapName, 64);
    hFileMap = CreateFileMapping(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE, 0, sizeof (bool), filemapName);
    if (hFileMap == NULL)
    {
        return;
    }
    pEnabled = (bool*) MapViewOfFile(hFileMap, FILE_MAP_ALL_ACCESS, 0, 0, sizeof (bool));
    if (pEnabled == NULL)
    {
        CloseHandle(hFileMap);
        hFileMap = NULL;
        return;
    }
    // The bridge also loads this DLL; targets are enabled explicitly by SP_Enable.
    *pEnabled = false;
}

void SP_Uninstall()
{
    if (hFileMap != NULL)
    {
        UnmapViewOfFile(pEnabled);
        CloseHandle(hFileMap);
    }
}

BOOL SP_IsEnabled()
{
    return pEnabled ? *pEnabled : FALSE;
}

SPEEDPATCH_API BOOL SP_IsEnabledById(DWORD processId)
{
    WCHAR filemapName[64];
    GetProcessFileMapName(processId, filemapName, 64);
    HANDLE hFileMap_ = OpenFileMapping(FILE_MAP_READ, FALSE, filemapName);
    if (hFileMap_ == NULL)
    {
        return FALSE;
    }
    bool* pStatus = (bool*) MapViewOfFile(hFileMap_, FILE_MAP_READ, 0, 0, sizeof (bool));
    if (pStatus == NULL)
    {
        CloseHandle(hFileMap_);
        return FALSE;
    }
    BOOL enabled = (*pStatus) ? TRUE : FALSE;
    UnmapViewOfFile(pStatus);
    CloseHandle(hFileMap_);
    return enabled;
}

void SP_Enable(DWORD processId)
{
    WCHAR filemapName[64];
    GetProcessFileMapName(processId, filemapName, 64);
    HANDLE hFileMap_ = OpenFileMapping(FILE_MAP_ALL_ACCESS, FALSE, filemapName);
    if (hFileMap_ == NULL)
    {
        return;
    }
    bool* pStatus = (bool*) MapViewOfFile(hFileMap_, FILE_MAP_ALL_ACCESS, 0, 0, sizeof (bool));
    if (pStatus == NULL)
    {
        CloseHandle(hFileMap_);
        return;
    }
    *pStatus = true;
    UnmapViewOfFile(pStatus);
    CloseHandle(hFileMap_);
}

void SP_Disable(DWORD processId)
{
    WCHAR filemapName[64];
    GetProcessFileMapName(processId, filemapName, 64);
    HANDLE hFileMap_ = OpenFileMapping(FILE_MAP_ALL_ACCESS, FALSE, filemapName);
    if (hFileMap_ == NULL)
    {
        return;
    }
    bool* pStatus = (bool*) MapViewOfFile(hFileMap_, FILE_MAP_ALL_ACCESS, 0, 0, sizeof (bool));
    if (pStatus == NULL)
    {
        CloseHandle(hFileMap_);
        return;
    }
    *pStatus = false;
    UnmapViewOfFile(pStatus);
    CloseHandle(hFileMap_);
}

VOID GetProcessFileMapName(DWORD processId, WCHAR* buf, DWORD bufSize)
{
    wsprintfW(buf, L"OpenSpeedy.%lu", processId);
}

double SpeedFactor()
{
    if (SP_IsEnabled())
    {
        return factor.load();
    }
    else
    {
        return 1.0;
    }
}

typedef VOID (WINAPI* SLEEP) (DWORD);

static SLEEP Real_Sleep = NULL;

VOID WINAPI Hook_Sleep(DWORD dwMilliseconds)
{
    Real_Sleep(dwMilliseconds / SpeedFactor());
}

typedef DWORD (WINAPI* SLEEPEX) (DWORD, BOOL);

static SLEEPEX Real_SleepEx = NULL;

DWORD WINAPI Hook_SleepEx(DWORD dwMilliseconds, BOOL bAlertable)
{

    return Real_SleepEx(dwMilliseconds / SpeedFactor(), bAlertable);
}

typedef DWORD (WINAPI* WAITFORSINGLEOBJECT) (HANDLE, DWORD);

static WAITFORSINGLEOBJECT Real_WaitForSingleObject = NULL;

DWORD WINAPI Hook_WaitForSingleObject(HANDLE hHandle, DWORD dwMilliseconds)
{
    if (dwMilliseconds == 0 || dwMilliseconds == INFINITE) {
        return Real_WaitForSingleObject(hHandle, dwMilliseconds);
    }
    return Real_WaitForSingleObject(hHandle, (DWORD)(dwMilliseconds / SpeedFactor()));
}

typedef DWORD (WINAPI* WAITFORSINGLEOBJECTEX) (HANDLE, DWORD, BOOL);

static WAITFORSINGLEOBJECTEX Real_WaitForSingleObjectEx = NULL;

DWORD WINAPI Hook_WaitForSingleObjectEx(HANDLE hHandle, DWORD dwMilliseconds, BOOL bAlertable)
{
    if (dwMilliseconds == 0 || dwMilliseconds == INFINITE) {
        return Real_WaitForSingleObjectEx(hHandle, dwMilliseconds, bAlertable);
    }
    return Real_WaitForSingleObjectEx(hHandle, (DWORD)(dwMilliseconds / SpeedFactor()), bAlertable);
}

typedef DWORD (WINAPI* WAITFORMULTIPLEOBJECTS) (DWORD, const HANDLE*, BOOL, DWORD);

static WAITFORMULTIPLEOBJECTS Real_WaitForMultipleObjects = NULL;

DWORD WINAPI Hook_WaitForMultipleObjects(DWORD nCount, const HANDLE* lpHandles, BOOL bWaitAll, DWORD dwMilliseconds)
{
    if (dwMilliseconds == 0 || dwMilliseconds == INFINITE) {
        return Real_WaitForMultipleObjects(nCount, lpHandles, bWaitAll, dwMilliseconds);
    }
    return Real_WaitForMultipleObjects(nCount, lpHandles, bWaitAll, (DWORD)(dwMilliseconds / SpeedFactor()));
}

typedef DWORD (WINAPI* WAITFORMULTIPLEOBJECTSEX) (DWORD, const HANDLE*, BOOL, DWORD, BOOL);

static WAITFORMULTIPLEOBJECTSEX Real_WaitForMultipleObjectsEx = NULL;

DWORD WINAPI Hook_WaitForMultipleObjectsEx(DWORD nCount, const HANDLE* lpHandles, BOOL bWaitAll, DWORD dwMilliseconds, BOOL bAlertable)
{
    if (dwMilliseconds == 0 || dwMilliseconds == INFINITE) {
        return Real_WaitForMultipleObjectsEx(nCount, lpHandles, bWaitAll, dwMilliseconds, bAlertable);
    }
    return Real_WaitForMultipleObjectsEx(nCount, lpHandles, bWaitAll, (DWORD)(dwMilliseconds / SpeedFactor()), bAlertable);
}

typedef UINT_PTR (WINAPI* SETTIMER) (HWND, UINT_PTR, UINT, TIMERPROC);

static SETTIMER Real_SetTimer = NULL;

UINT_PTR WINAPI Hook_SetTimer(HWND hWnd, UINT_PTR nIDEvent, UINT uElapse, TIMERPROC lpTimerFunc)
{

    return Real_SetTimer(hWnd, nIDEvent, uElapse / SpeedFactor(), lpTimerFunc);
}

static std::atomic<DWORD> baseReal_TimeGetTime = 0;
static std::atomic<DWORD> baseHook_TimeGetTime = 0;
static std::atomic<DWORD> lastReal_TimeGetTime = 0;
static std::atomic<DWORD> lastHook_TimeGetTime = 0;
static std::atomic<bool> shouldUpdateTimeGetTime = false;

typedef DWORD (WINAPI* TIMEGETTIME) (VOID);

static TIMEGETTIME Real_TimeGetTime = NULL;

DWORD WINAPI Hook_TimeGetTime(VOID)
{

    if (pre_factor != SpeedFactor())
    {
        pre_factor = SpeedFactor();
        shouldUpdateAll();
    }
    bool expected = true;
    if (shouldUpdateTimeGetTime.compare_exchange_weak(expected, false))
    {
        baseReal_TimeGetTime.store(lastReal_TimeGetTime.load());
        baseHook_TimeGetTime.store(lastHook_TimeGetTime.load());
    }
    DWORD now = Real_TimeGetTime();
    lastReal_TimeGetTime.store(now);
    DWORD baseReal = baseReal_TimeGetTime.load();
    DWORD delta = SpeedFactor() * (now - baseReal);
    DWORD baseHook = baseHook_TimeGetTime.load();
    lastHook_TimeGetTime.store(baseHook + delta);
    return baseHook + delta;
}

typedef MMRESULT (WINAPI* TIMESETEVENT) (UINT, UINT, LPTIMECALLBACK, DWORD_PTR, UINT);

static TIMESETEVENT Real_TimeSetEvent = NULL;

MMRESULT WINAPI Hook_TimeSetEvent(UINT uDelay, UINT uResolution, LPTIMECALLBACK lpTimeProc, DWORD_PTR dwUser, UINT fuEvent)
{
    return Real_TimeSetEvent(uDelay / SpeedFactor(), uResolution, lpTimeProc, dwUser, fuEvent);
}

static std::atomic<LONG> baseReal_GetMessageTime = 0;
static std::atomic<LONG> baseHook_GetMessageTime = 0;
static std::atomic<LONG> lastReal_GetMessageTime = 0;
static std::atomic<LONG> lastHook_GetMessageTime = 0;
static std::atomic<bool> shouldUpdateGetMessageTime = false;

typedef LONG (WINAPI* GETMESSAGETIME) (VOID);

static GETMESSAGETIME Real_GetMessageTime = NULL;

LONG WINAPI Hook_GetMessageTime(VOID)
{

    if (pre_factor != SpeedFactor())
    {
        pre_factor = SpeedFactor();
        shouldUpdateAll();
    }
    bool expected = true;
    if (shouldUpdateGetMessageTime.compare_exchange_weak(expected, false))
    {
        baseReal_GetMessageTime.store(lastReal_GetMessageTime.load());
        baseHook_GetMessageTime.store(lastHook_GetMessageTime.load());
    }
    LONG now = Real_GetMessageTime();
    lastReal_GetMessageTime.store(now);
    LONG baseReal = baseReal_GetMessageTime.load();
    DWORD delta = SpeedFactor() * (now - baseReal);
    LONG baseHook = baseHook_GetMessageTime.load();
    lastHook_GetMessageTime.store(baseHook + delta);
    return baseHook + delta;
}

static std::atomic<DWORD> baseReal_GetTickCount = 0;
static std::atomic<DWORD> baseHook_GetTickCount = 0;
static std::atomic<DWORD> lastReal_GetTickCount = 0;
static std::atomic<DWORD> lastHook_GetTickCount = 0;
static std::atomic<bool> shouldUpdateGetTickCount = false;

typedef DWORD (WINAPI* GETTICKCOUNT) (VOID);

static GETTICKCOUNT Real_GetTickCount = NULL;

DWORD WINAPI Hook_GetTickCount(VOID)
{

    if (pre_factor != SpeedFactor())
    {
        pre_factor = SpeedFactor();
        shouldUpdateAll();
    }
    bool expected = true;
    if (shouldUpdateGetTickCount.compare_exchange_weak(expected, false))
    {
        baseReal_GetTickCount.store(lastReal_GetTickCount.load());
        baseHook_GetTickCount.store(lastHook_GetTickCount.load());
    }
    DWORD now = Real_GetTickCount();
    lastReal_GetTickCount.store(now);
    DWORD baseReal = baseReal_GetTickCount.load();
    DWORD delta = SpeedFactor() * (now - baseReal);
    DWORD baseHook = baseHook_GetTickCount.load();
    lastHook_GetTickCount.store(baseHook + delta);
    return baseHook + delta;
}

static std::atomic<ULONGLONG> baseReal_GetTickCount64 = 0;
static std::atomic<ULONGLONG> baseHook_GetTickCount64 = 0;
static std::atomic<ULONGLONG> lastReal_GetTickCount64 = 0;
static std::atomic<ULONGLONG> lastHook_GetTickCount64 = 0;
std::atomic<bool> shouldUpdateGetTickCount64 = false;

typedef ULONGLONG (WINAPI* GETTICKCOUNT64) (VOID);

static GETTICKCOUNT64 Real_GetTickCount64 = NULL;

ULONGLONG WINAPI Hook_GetTickCount64(VOID)
{

    if (pre_factor != SpeedFactor())
    {
        pre_factor = SpeedFactor();
        shouldUpdateAll();
    }
    bool expected = true;
    if (shouldUpdateGetTickCount64.compare_exchange_weak(expected, false))
    {
        baseReal_GetTickCount64.store(lastReal_GetTickCount64.load());
        baseHook_GetTickCount64.store(lastHook_GetTickCount64.load());
    }
    ULONGLONG now = Real_GetTickCount64();
    lastReal_GetTickCount64.store(now);
    ULONGLONG baseReal = baseReal_GetTickCount64.load();
    ULONGLONG delta = SpeedFactor() * (now - baseReal);
    ULONGLONG baseHook = baseHook_GetTickCount64.load();
    lastHook_GetTickCount64.store(baseHook + delta);
    return baseHook + delta;
}

static std::atomic<LARGE_INTEGER> baseReal_QueryPerformanceCounter{};
static std::atomic<LARGE_INTEGER> baseHook_QueryPerformanceCounter{};
static std::atomic<LARGE_INTEGER> lastReal_QueryPerformanceCounter{};
static std::atomic<LARGE_INTEGER> lastHook_QueryPerformanceCounter{};
static std::atomic<bool> shouldUpdateQueryPerformanceCounter = false;

typedef BOOL (WINAPI* QUERYPERFORMANCECOUNTER) (LARGE_INTEGER*);

static QUERYPERFORMANCECOUNTER Real_QueryPerformanceCounter = NULL;

BOOL WINAPI Hook_QueryPerformanceCounter(LARGE_INTEGER* lpPerformanceCount)
{

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
    if (shouldUpdateQueryPerformanceCounter.compare_exchange_weak(expected, false))
    {
        baseReal_QueryPerformanceCounter.store(lastReal_QueryPerformanceCounter.load());
        baseHook_QueryPerformanceCounter.store(lastHook_QueryPerformanceCounter.load());
    }
    LARGE_INTEGER now;
    BOOL rtncode = Real_QueryPerformanceCounter(&now);
    lastReal_QueryPerformanceCounter.store(now);
    LARGE_INTEGER baseReal = baseReal_QueryPerformanceCounter.load();
    LARGE_INTEGER baseHook = baseHook_QueryPerformanceCounter.load();
    LONGLONG delta = SpeedFactor() * (now.QuadPart - baseReal.QuadPart);
    LARGE_INTEGER result;
    result.QuadPart = baseHook.QuadPart + delta;
    *lpPerformanceCount = result;
    lastHook_QueryPerformanceCounter.store(result);
    return rtncode;
}

static std::atomic<FILETIME> baseReal_GetSystemTimeAsFileTime({ 0 });
static std::atomic<FILETIME> baseHook_GetSystemTimeAsFileTime({ 0 });
static std::atomic<FILETIME> lastReal_GetSystemTimeAsFileTime({ 0 });
static std::atomic<FILETIME> lastHook_GetSystemTimeAsFileTime({ 0 });
static std::atomic<bool> shouldUpdateGetSystemTimeAsFileTime = false;

typedef VOID (WINAPI* GETSYSTEMTIMEASFILETIME) (LPFILETIME);

static GETSYSTEMTIMEASFILETIME Real_GetSystemTimeAsFileTime = NULL;

VOID WINAPI Hook_GetSystemTimeAsFileTime(LPFILETIME lpSystemTimeAsFileTime)
{

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
    if (shouldUpdateGetSystemTimeAsFileTime.compare_exchange_weak(expected, false))
    {
        baseReal_GetSystemTimeAsFileTime.store(lastReal_GetSystemTimeAsFileTime.load());
        baseHook_GetSystemTimeAsFileTime.store(lastHook_GetSystemTimeAsFileTime.load());
    }
    // 从全局变量读取基准点快照到线程栈
    FILETIME baseReal_Snapshot = baseReal_GetSystemTimeAsFileTime.load();
    ULARGE_INTEGER baseReal_ = { baseReal_Snapshot.dwLowDateTime, baseReal_Snapshot.dwHighDateTime };
    FILETIME baseHook_Snapshot = baseHook_GetSystemTimeAsFileTime.load();
    ULARGE_INTEGER baseHook_ = { baseHook_Snapshot.dwLowDateTime, baseHook_Snapshot.dwHighDateTime };
    FILETIME ftNow = { 0 };
    Real_GetSystemTimeAsFileTime(&ftNow);
    lastReal_GetSystemTimeAsFileTime.store(ftNow);
    ULARGE_INTEGER ulNow = { ftNow.dwLowDateTime, ftNow.dwHighDateTime };
    ULONGLONG delta = SpeedFactor() * (ulNow.QuadPart - baseReal_.QuadPart);
    ULARGE_INTEGER ulRtn = { 0 };
    ulRtn.QuadPart = baseHook_.QuadPart + delta;
    lastHook_GetSystemTimeAsFileTime.store({ ulRtn.LowPart, ulRtn.HighPart });
    (*lpSystemTimeAsFileTime) = { ulRtn.LowPart, ulRtn.HighPart };
}

static std::atomic<FILETIME> baseReal_GetSystemTimePreciseAsFileTime({ 0 });
static std::atomic<FILETIME> baseHook_GetSystemTimePreciseAsFileTime({ 0 });
static std::atomic<FILETIME> lastReal_GetSystemTimePreciseAsFileTime({ 0 });
static std::atomic<FILETIME> lastHook_GetSystemTimePreciseAsFileTime({ 0 });
static std::atomic<bool> shouldUpdateGetSystemTimePreciseAsFileTime = false;

typedef VOID (WINAPI* GETSYSTEMTIMEPRECISEASFILETIME) (LPFILETIME);

static GETSYSTEMTIMEPRECISEASFILETIME Real_GetSystemTimePreciseAsFileTime = NULL;

VOID WINAPI Hook_GetSystemTimePreciseAsFileTime(LPFILETIME lpSystemTimeAsFileTime)
{

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
    if (shouldUpdateGetSystemTimePreciseAsFileTime.compare_exchange_weak(expected, false))
    {
        baseReal_GetSystemTimePreciseAsFileTime.store(lastReal_GetSystemTimePreciseAsFileTime.load());
        baseHook_GetSystemTimePreciseAsFileTime.store(lastHook_GetSystemTimePreciseAsFileTime.load());
    }
    // 从全局变量读取基准点快照到线程栈
    FILETIME baseReal_Snapshot = baseReal_GetSystemTimePreciseAsFileTime.load();
    ULARGE_INTEGER baseReal_ = { baseReal_Snapshot.dwLowDateTime, baseReal_Snapshot.dwHighDateTime };
    FILETIME baseHook_Snapshot = baseHook_GetSystemTimePreciseAsFileTime.load();
    ULARGE_INTEGER baseHook_ = { baseHook_Snapshot.dwLowDateTime, baseHook_Snapshot.dwHighDateTime };
    FILETIME ftNow = { 0 };
    Real_GetSystemTimePreciseAsFileTime(&ftNow);
    lastReal_GetSystemTimePreciseAsFileTime.store(ftNow);
    ULARGE_INTEGER ulNow = { ftNow.dwLowDateTime, ftNow.dwHighDateTime };
    ULONGLONG delta = SpeedFactor() * (ulNow.QuadPart - baseReal_.QuadPart);
    ULARGE_INTEGER ulRtn = { 0 };
    ulRtn.QuadPart = baseHook_.QuadPart + delta;
    lastHook_GetSystemTimePreciseAsFileTime.store({ ulRtn.LowPart, ulRtn.HighPart });
    (*lpSystemTimeAsFileTime) = { ulRtn.LowPart, ulRtn.HighPart };
}

typedef BOOL (WINAPI* SETWAITABLETIMER) (HANDLE, const LARGE_INTEGER*, LONG, PTIMERAPCROUTINE, LPVOID, BOOL);

static SETWAITABLETIMER Real_SetWaitableTimer = NULL;

BOOL WINAPI Hook_SetWaitableTimer(HANDLE hTimer, const LARGE_INTEGER* lpDueTime, LONG lPeriod, PTIMERAPCROUTINE pfnCompletionRoutine, LPVOID lpArgToCompletionRoutine, BOOL fResume)
{
    if (lpDueTime == NULL)
    {
        return FALSE;
    }
    LARGE_INTEGER dueTime = {0};
    dueTime.QuadPart = lpDueTime->QuadPart / SpeedFactor();
    return Real_SetWaitableTimer(hTimer, &dueTime, lPeriod, pfnCompletionRoutine, lpArgToCompletionRoutine, fResume);
}

typedef BOOL (WINAPI* SETWAITABLETIMEREX) (HANDLE, const LARGE_INTEGER*, LONG, PTIMERAPCROUTINE, LPVOID, PREASON_CONTEXT, ULONG);

static SETWAITABLETIMEREX Real_SetWaitableTimerEx = NULL;

BOOL WINAPI Hook_SetWaitableTimerEx(HANDLE hTimer, const LARGE_INTEGER* lpDueTime, LONG lPeriod, PTIMERAPCROUTINE pfnCompletionRoutine, LPVOID lpArgToCompletionRoutine, PREASON_CONTEXT WakeContext, ULONG TolerableDelay)
{
    if (lpDueTime == NULL)
    {
        return FALSE;
    }
    LARGE_INTEGER dueTime = {0};
    dueTime.QuadPart = lpDueTime->QuadPart / SpeedFactor();
    return Real_SetWaitableTimerEx(hTimer, &dueTime, lPeriod, pfnCompletionRoutine, lpArgToCompletionRoutine, WakeContext, TolerableDelay);
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

// 记录 hook 安装失败。DllMain 运行在加载器锁里：既不能弹 MessageBox（模态框会把
// 目标进程和 bridge 一起卡死），也不能写文件（同样在加载器锁里）。输出到调试器，
// 并累加到共享计数器，由 bridge 读出来写进自己的日志。
static void ReportHookFailure(const char* stage, MH_STATUS status)
{
    char buf[160];
    wsprintfA(buf, "[speedpatch] %s failed (status %d) — hook skipped\n", stage, (int)status);
    OutputDebugStringA(buf);
    hookFailures.fetch_add(1);
}

template <typename S, typename T>
inline BOOL MH_HOOK(S* pTarget, S* pDetour, T** ppOriginal)
{
    MH_STATUS status = MH_CreateHook(reinterpret_cast<LPVOID> (pTarget), reinterpret_cast<LPVOID> (pDetour), reinterpret_cast<LPVOID*> (ppOriginal));
    if (status != MH_OK)
    {
        // 这一步失败时目标函数一个字节都没动，detour 不可能被调用，
        // ppOriginal 也保持 MinHook 写下的值 —— 不要去改它。
        ReportHookFailure("MH_CreateHook", status);
        return FALSE;
    }

    status = MH_EnableHook(reinterpret_cast<LPVOID> (pTarget));
    if (status != MH_OK)
    {
        // MinHook 在写入前会先 VirtualProtect 校验，失败时目标函数保持原样。
        // 所以这里故意不删 hook：留着已建好的 trampoline 比删掉更安全 ——
        // 即使目标真被改了一半，trampoline 仍指向正确的原始代码。
        ReportHookFailure("MH_EnableHook", status);
        return FALSE;
    }

    return TRUE;
}

template <typename T>
VOID MH_UNHOOK(T* pTarget)
{
    MH_RemoveHook(reinterpret_cast<LPVOID> (pTarget));
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD ul_reason_for_call, LPVOID lpReserved)
{
    FILETIME now = { 0 };
    switch (ul_reason_for_call)
    {
    case DLL_PROCESS_ATTACH:

        if (MH_Initialize() != MH_OK)
        {
            // 不能弹 MessageBox —— DllMain 持有加载器锁。返回 FALSE 让这次加载干净失败。
            OutputDebugStringA("[speedpatch] MH_Initialize failed — DLL not loaded\n");
            return FALSE;
        }
        SP_Install();
        {
            /* Initial timeGetTime */
            DWORD tgt = timeGetTime();
            baseReal_TimeGetTime.store(tgt);
            lastReal_TimeGetTime.store(tgt);
            baseHook_TimeGetTime.store(tgt);
            lastHook_TimeGetTime.store(tgt);

            /* Initial GetMessageTime */
            LONG gmt = GetMessageTime();
            baseReal_GetMessageTime.store(gmt);
            lastReal_GetMessageTime.store(gmt);
            baseHook_GetMessageTime.store(gmt);
            lastHook_GetMessageTime.store(gmt);

            /* Initial GetTickCount */
            DWORD tck = GetTickCount();
            baseReal_GetTickCount.store(tck);
            lastReal_GetTickCount.store(tck);
            baseHook_GetTickCount.store(tck);
            lastHook_GetTickCount.store(tck);

            /* Initial GetTickCount64 */
            ULONGLONG tck64 = GetTickCount64();
            baseReal_GetTickCount64.store(tck64);
            lastReal_GetTickCount64.store(tck64);
            baseHook_GetTickCount64.store(tck64);
            lastHook_GetTickCount64.store(tck64);

            /* Initial QueryPerformanceCounter */
            LARGE_INTEGER qpc;
            QueryPerformanceCounter(&qpc);
            baseReal_QueryPerformanceCounter.store(qpc);
            lastReal_QueryPerformanceCounter.store(qpc);
            baseHook_QueryPerformanceCounter.store(qpc);
            lastHook_QueryPerformanceCounter.store(qpc);

            /* Initial GetSystemTimeAsFileTime */
            GetSystemTimeAsFileTime(&now);
            baseReal_GetSystemTimeAsFileTime.store(now);
            lastReal_GetSystemTimeAsFileTime.store(now);
            baseHook_GetSystemTimeAsFileTime.store(now);
            lastHook_GetSystemTimeAsFileTime.store(now);

            /* Initial GetSystemTimePreciseAsFileTime */
            GetSystemTimePreciseAsFileTime(&now);
            baseReal_GetSystemTimePreciseAsFileTime.store(now);
            lastReal_GetSystemTimePreciseAsFileTime.store(now);
        baseHook_GetSystemTimePreciseAsFileTime.store(now);
        lastHook_GetSystemTimePreciseAsFileTime.store(now);
        }

        MH_HOOK(&Sleep, &Hook_Sleep, reinterpret_cast<LPVOID*> (&Real_Sleep));
        MH_HOOK(&SleepEx, &Hook_SleepEx, reinterpret_cast<LPVOID*>(&Real_SleepEx));
        MH_HOOK(&WaitForSingleObject, &Hook_WaitForSingleObject, reinterpret_cast<LPVOID*>(&Real_WaitForSingleObject));
        MH_HOOK(&WaitForSingleObjectEx, &Hook_WaitForSingleObjectEx, reinterpret_cast<LPVOID*>(&Real_WaitForSingleObjectEx));
        MH_HOOK(&WaitForMultipleObjects, &Hook_WaitForMultipleObjects, reinterpret_cast<LPVOID*>(&Real_WaitForMultipleObjects));
        MH_HOOK(&WaitForMultipleObjectsEx, &Hook_WaitForMultipleObjectsEx, reinterpret_cast<LPVOID*>(&Real_WaitForMultipleObjectsEx));
        MH_HOOK(&SetWaitableTimer, &Hook_SetWaitableTimer, reinterpret_cast<LPVOID*>(&Real_SetWaitableTimer));
        MH_HOOK(&SetWaitableTimerEx, &Hook_SetWaitableTimerEx, reinterpret_cast<LPVOID*>(&Real_SetWaitableTimerEx));
        MH_HOOK(&SetTimer, &Hook_SetTimer, reinterpret_cast<LPVOID*> (&Real_SetTimer));
        MH_HOOK(&timeGetTime, &Hook_TimeGetTime, reinterpret_cast<LPVOID*> (&Real_TimeGetTime));
        MH_HOOK(&timeSetEvent, &Hook_TimeSetEvent, reinterpret_cast<LPVOID*>(&Real_TimeSetEvent));
        MH_HOOK(&GetMessageTime, &Hook_GetMessageTime, reinterpret_cast<LPVOID*>(&Real_GetMessageTime));
        MH_HOOK(&GetTickCount, &Hook_GetTickCount, reinterpret_cast<LPVOID*> (&Real_GetTickCount));
        MH_HOOK(&GetTickCount64, &Hook_GetTickCount64, reinterpret_cast<LPVOID*> (&Real_GetTickCount64));
        MH_HOOK(&QueryPerformanceCounter, &Hook_QueryPerformanceCounter, reinterpret_cast<LPVOID*> (&Real_QueryPerformanceCounter));
        MH_HOOK(&GetSystemTimeAsFileTime, &Hook_GetSystemTimeAsFileTime, reinterpret_cast<LPVOID*> (&Real_GetSystemTimeAsFileTime));
        MH_HOOK(&GetSystemTimePreciseAsFileTime, &Hook_GetSystemTimePreciseAsFileTime, reinterpret_cast<LPVOID*> (&Real_GetSystemTimePreciseAsFileTime));


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
            MH_UNHOOK(Real_Sleep);
            MH_UNHOOK(Real_SleepEx);
            MH_UNHOOK(Real_WaitForSingleObject);
            MH_UNHOOK(Real_WaitForSingleObjectEx);
            MH_UNHOOK(Real_WaitForMultipleObjects);
            MH_UNHOOK(Real_WaitForMultipleObjectsEx);
            MH_UNHOOK(Real_SetWaitableTimer);
            MH_UNHOOK(Real_SetWaitableTimerEx);
            MH_UNHOOK(Real_SetTimer);
            MH_UNHOOK(Real_TimeGetTime);
            MH_UNHOOK(Real_TimeSetEvent);
            MH_UNHOOK(Real_GetTickCount);
            MH_UNHOOK(Real_GetTickCount64);
            MH_UNHOOK(Real_QueryPerformanceCounter);
            MH_UNHOOK(Real_GetSystemTimeAsFileTime);
            MH_UNHOOK(Real_GetSystemTimePreciseAsFileTime);
        }
        // Wait for All threads to finish detour api
        Sleep(1000);
        {
            std::unique_lock<std::shared_mutex> lock(mutex);
            if (MH_Uninitialize() != MH_OK)
            {
                // 进程正在退出，同样不能弹模态框；DllMain 在 DETACH 下的返回值无意义，
                // 所以这里也不能 return —— 下面的 SP_Uninstall() 必须照常执行。
                OutputDebugStringA("[speedpatch] MH_Uninitialize failed\n");
            }
        }
        SP_Uninstall();
        break;
    }
    }
    return TRUE;
}
