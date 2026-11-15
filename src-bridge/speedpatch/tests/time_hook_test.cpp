/*
 * Regression test for the speedpatch time hooks.
 *
 * Loads speedpatch*.dll into this process (its DllMain hooks the time APIs),
 * then several threads read one clock while another thread changes the speed.
 * Each thread only compares its own consecutive readings; a negative delta
 * means the hooked clock went backwards.
 *
 * Build and run:
 *   cmake -S . -B build -DSPEEDPATCH_BUILD_TESTS=ON
 *   cmake --build build --config Release
 *   ctest --test-dir build -C Release --output-on-failure
 *
 * Manual run:
 *   time_hook_test <speedpatch64.dll> [threads] [fixed|up|down|alt] [api] [iterations]
 * with api in qpc|tgt|tick|tick64|ft|ftprecise. Without extra arguments it
 * runs the full matrix (every API, a 25x->10x switch and rapid toggling).
 */
#define NOMINMAX
#include <windows.h>
#include <mmsystem.h>
#include <atomic>
#include <thread>
#include <vector>
#include <string>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <algorithm>
#pragma comment(lib, "winmm.lib")

typedef void (__cdecl* SetSpeedFn)(double);

static std::atomic<bool> running{true};

struct Result
{
    long long backwards = 0;
    unsigned long long worst = 0;
};

template <typename Fn>
static void reader32(Fn fn, Result* out)
{
    DWORD prev = fn();
    while (running.load(std::memory_order_relaxed))
    {
        DWORD now = fn();
        int32_t delta = (int32_t)(now - prev);
        if (delta < 0)
        {
            out->backwards++;
            unsigned long long mag = (unsigned long long)(-(int64_t)delta);
            if (mag > out->worst) out->worst = mag;
        }
        prev = now;
    }
}

template <typename Fn>
static void reader64(Fn fn, Result* out)
{
    ULONGLONG prev = fn();
    while (running.load(std::memory_order_relaxed))
    {
        ULONGLONG now = fn();
        int64_t delta = (int64_t)(now - prev);
        if (delta < 0)
        {
            out->backwards++;
            unsigned long long mag = (unsigned long long)(-delta);
            if (mag > out->worst) out->worst = mag;
        }
        prev = now;
    }
}

static void readerQpc(Result* out)
{
    LARGE_INTEGER prev;
    QueryPerformanceCounter(&prev);
    while (running.load(std::memory_order_relaxed))
    {
        LARGE_INTEGER now;
        QueryPerformanceCounter(&now);
        int64_t delta = now.QuadPart - prev.QuadPart;
        if (delta < 0)
        {
            out->backwards++;
            unsigned long long mag = (unsigned long long)(-delta);
            if (mag > out->worst) out->worst = mag;
        }
        prev = now;
    }
}

template <typename Fn>
static void readerFileTime(Fn fn, Result* out)
{
    FILETIME ft;
    fn(&ft);
    ULARGE_INTEGER prev = { ft.dwLowDateTime, ft.dwHighDateTime };
    while (running.load(std::memory_order_relaxed))
    {
        fn(&ft);
        ULARGE_INTEGER now = { ft.dwLowDateTime, ft.dwHighDateTime };
        int64_t delta = (int64_t)(now.QuadPart - prev.QuadPart);
        if (delta < 0)
        {
            out->backwards++;
            unsigned long long mag = (unsigned long long)(-delta);
            if (mag > out->worst) out->worst = mag;
        }
        prev = now;
    }
}

static bool startReaders(const std::string& api, int threads, std::vector<Result>& results, std::vector<std::thread>& pool)
{
    results.assign(threads, Result{});
    for (int i = 0; i < threads; i++)
    {
        Result* r = &results[i];
        if (api == "qpc") pool.emplace_back(readerQpc, r);
        else if (api == "tgt") pool.emplace_back(reader32<DWORD (WINAPI*)()>, &timeGetTime, r);
        else if (api == "tick") pool.emplace_back(reader32<DWORD (WINAPI*)()>, &GetTickCount, r);
        else if (api == "tick64") pool.emplace_back(reader64<ULONGLONG (WINAPI*)()>, &GetTickCount64, r);
        else if (api == "ft") pool.emplace_back(readerFileTime<VOID (WINAPI*)(LPFILETIME)>, &GetSystemTimeAsFileTime, r);
        else if (api == "ftprecise") pool.emplace_back(readerFileTime<VOID (WINAPI*)(LPFILETIME)>, &GetSystemTimePreciseAsFileTime, r);
        else return false;
    }
    return true;
}

// Returns the number of backwards readings observed across all threads.
static long long runScenario(SetSpeedFn setSpeed, int threads, const std::string& mode, const std::string& api, int iterations)
{
    const bool startHigh = (mode == "down" || mode == "alt");
    setSpeed(startHigh ? 25.0 : 10.0);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    running = true;
    std::vector<Result> results;
    std::vector<std::thread> pool;
    if (!startReaders(api, threads, results, pool))
    {
        running = false;
        return -1;
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(350));
    if (mode == "fixed")
    {
        std::this_thread::sleep_for(std::chrono::seconds(8));
    }
    else if (mode == "up")
    {
        setSpeed(25.0);
        std::this_thread::sleep_for(std::chrono::milliseconds(350));
    }
    else if (mode == "down")
    {
        setSpeed(10.0);
        std::this_thread::sleep_for(std::chrono::milliseconds(350));
    }
    else if (mode == "alt")
    {
        for (int i = 0; i < iterations; i++)
        {
            setSpeed(i % 2 ? 25.0 : 10.0);
            std::this_thread::sleep_for(std::chrono::milliseconds(3));
        }
    }

    running = false;
    for (auto& t : pool) t.join();

    long long back = 0;
    unsigned long long worst = 0;
    for (const auto& r : results)
    {
        back += r.backwards;
        worst = std::max(worst, r.worst);
    }

    LARGE_INTEGER freq;
    QueryPerformanceFrequency(&freq);
    printf("api=%-9s mode=%-6s threads=%d backwards=%lld worst_ms=%.3f\n",
        api.c_str(), mode.c_str(), threads, back,
        freq.QuadPart ? (double)worst * 1000.0 / freq.QuadPart : 0.0);
    return back;
}

int main(int argc, char** argv)
{
    if (argc < 2)
    {
        printf("usage: %s <speedpatch64.dll> [threads] [fixed|up|down|alt] [qpc|tgt|tick|tick64|ft|ftprecise] [iterations]\n", argv[0]);
        return 2;
    }

    HMODULE dll = LoadLibraryA(argv[1]);
    if (!dll)
    {
        printf("LoadLibrary failed: %lu\n", GetLastError());
        return 1;
    }
    auto setSpeed = (SetSpeedFn)GetProcAddress(dll, "SP_SetSpeed");
    if (!setSpeed)
    {
        printf("SP_SetSpeed not found\n");
        return 1;
    }

    if (argc == 2)
    {
        // Full regression matrix. Rapid toggling is the case that used to
        // produce thousands of backwards readings in one process.
        const char* apis[] = { "qpc", "tgt", "tick", "tick64", "ft", "ftprecise" };
        bool ok = true;
        for (const char* api : apis)
        {
            if (runScenario(setSpeed, 4, "down", api, 12) != 0) ok = false;
            if (runScenario(setSpeed, 4, "alt", api, 1000) != 0) ok = false;
        }
        printf(ok ? "PASS\n" : "FAIL\n");
        return ok ? 0 : 1;
    }

    const int threads = argc > 2 ? atoi(argv[2]) : 4;
    const std::string mode = argc > 3 ? argv[3] : "down";
    const std::string api = argc > 4 ? argv[4] : "qpc";
    const int iterations = argc > 5 ? atoi(argv[5]) : 12;
    long long back = runScenario(setSpeed, threads, mode, api, iterations);
    return back == 0 ? 0 : 1;
}
