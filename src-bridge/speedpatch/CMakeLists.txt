cmake_minimum_required(VERSION 3.16)

project(speedpatch LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 静态链接 CRT（/MT）。默认的 /MD 会让 speedpatch*.dll 依赖 VCRUNTIME140.dll，
# 那不是 Windows 组件、而是 VC++ 运行库的一部分 —— 目标机器没装时 DLL 根本加载
# 不了，注入会静默失败。CMP0091（CMake 3.15+，这里要求 3.16）让该变量生效。
if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

# 判断 32 位还是 64 位
if(CMAKE_SIZEOF_VOID_P EQUAL 8)
    set(ARCH_SUFFIX "64")
elseif(CMAKE_SIZEOF_VOID_P EQUAL 4)
    set(ARCH_SUFFIX "32")
else()
    message(FATAL_ERROR "Unknown pointer size: ${CMAKE_SIZEOF_VOID_P}")
endif()

set(TARGET_NAME "speedpatch${ARCH_SUFFIX}")

# MinHook 静态库
add_library(minhook STATIC
    ../third_party/minhook/src/buffer.c
    ../third_party/minhook/src/buffer.h
    ../third_party/minhook/src/hook.c
    ../third_party/minhook/src/trampoline.c
    ../third_party/minhook/src/trampoline.h
    ../third_party/minhook/src/hde/hde32.c
    ../third_party/minhook/src/hde/hde32.h
    ../third_party/minhook/src/hde/hde64.c
    ../third_party/minhook/src/hde/hde64.h
    ../third_party/minhook/src/hde/pstdint.h
    ../third_party/minhook/src/hde/table32.h
    ../third_party/minhook/src/hde/table64.h
)
target_include_directories(minhook PUBLIC ../third_party/minhook/include)
target_compile_definitions(minhook PRIVATE _CRT_SECURE_NO_WARNINGS)

add_compile_definitions(UNICODE _UNICODE)

# speedpatch DLL
add_library(${TARGET_NAME} SHARED
    speedpatch.cpp
    speedpatch.h
)

target_link_libraries(${TARGET_NAME} PRIVATE minhook winmm)
target_compile_definitions(${TARGET_NAME} PRIVATE SPEEDPATCH_LIBRARY _CRT_SECURE_NO_WARNINGS)

# shared section for factor
set_target_properties(${TARGET_NAME} PROPERTIES
    LINK_FLAGS "/SECTION:shared,RWS"
)

# install 目标 — cmake crate 需要
include(GNUInstallDirs)
install(TARGETS ${TARGET_NAME}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)

# 时间 hook 回归测试：加载 DLL，多线程读取各时间 API，切换倍率并检查同线程
# 是否倒退。默认不构建，避免拖慢常规 cargo 构建；需要时：
#   cmake -S . -B build -DSPEEDPATCH_BUILD_TESTS=ON
#   cmake --build build --config Release
#   ctest --test-dir build -C Release --output-on-failure
option(SPEEDPATCH_BUILD_TESTS "Build time-hook monotonicity regression tests" OFF)
if(SPEEDPATCH_BUILD_TESTS)
    enable_testing()
    add_executable(time_hook_test tests/time_hook_test.cpp)
    target_link_libraries(time_hook_test PRIVATE winmm)
    add_dependencies(time_hook_test ${TARGET_NAME})
    add_test(NAME time_hook_test COMMAND time_hook_test $<TARGET_FILE:${TARGET_NAME}>)
endif()
