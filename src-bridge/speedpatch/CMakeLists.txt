cmake_minimum_required(VERSION 3.16)

project(speedpatch LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

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
