//! Build script - 使用 cmake crate + MSVC 同时编译 32/64 位 speedpatch DLL
//!
//! - 宿主架构：通过 cmake crate 自动检测编译器
//! - 交叉架构：通过 std::process::Command 调用 cmake -A 切换平台

use std::env;
use std::path::PathBuf;
use std::process::Command;

fn build_with_cmake_crate(
    manifest_dir: &PathBuf,
    profile: &str,
    dll_suffix: &str,
) {
    let build_type = if profile == "release" { "Release" } else { "Debug" };
    let dll_name = format!("speedpatch{}.dll", dll_suffix);

    println!("cargo:info=[cmake crate] building {dll_name} (host arch)...");

    let dst = cmake::Config::new("speedpatch")
        .define("CMAKE_BUILD_TYPE", build_type)
        .build();

    let dll_src = dst.join("bin").join(&dll_name);
    let prof_dir = manifest_dir.join("target").join(profile);
    let dll_dst = prof_dir.join(&dll_name);

    std::fs::copy(&dll_src, &dll_dst).unwrap_or_else(|e| {
        panic!("复制 {} -> {} 失败: {}", dll_src.display(), dll_dst.display(), e);
    });
    println!("cargo:info=  -> {}", dll_dst.display());
}

fn build_with_cmake_command(
    manifest_dir: &PathBuf,
    profile: &str,
    cmake_arch: &str,
    dll_suffix: &str,
) {
    let build_type = if profile == "release" { "Release" } else { "Debug" };
    let dll_name = format!("speedpatch{}.dll", dll_suffix);
    let build_dir = manifest_dir
        .join("target")
        .join("speedpatch-build")
        .join(cmake_arch);

    println!("cargo:info=[cmake cmd] building {dll_name} (-A {cmake_arch})...");

    // cmake configure
    let status = Command::new("cmake")
        .args([
            "-S",
            &manifest_dir.join("speedpatch").to_string_lossy(),
            "-B",
            &build_dir.to_string_lossy(),
            "-G",
            "Visual Studio 17 2022",
            "-A",
            cmake_arch,
        ])
        .status()
        .expect("cmake configure 失败");

    if !status.success() {
        panic!("cmake configure 返回错误");
    }

    // cmake build (跳过 install 目标，直接编译 speedpatch DLL)
    let status = Command::new("cmake")
        .args([
            "--build",
            &build_dir.to_string_lossy(),
            "--config",
            build_type,
        ])
        .status()
        .expect("cmake build 失败");

    if !status.success() {
        panic!("cmake build 返回错误");
    }

    // 复制 DLL
    let dll_src = build_dir.join(build_type).join(&dll_name);
    let prof_dir = manifest_dir.join("target").join(profile);
    let dll_dst = prof_dir.join(&dll_name);

    std::fs::copy(&dll_src, &dll_dst).unwrap_or_else(|e| {
        panic!("复制 {} -> {} 失败: {}", dll_src.display(), dll_dst.display(), e);
    });
    println!("cargo:info=  -> {}", dll_dst.display());
}

fn main() {
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();

    match target_arch.as_str() {
        "x86" | "x86_64" => {}
        _ => {
            println!("cargo:warning=speedpatch 仅支持 x86/x86_64 Windows");
            return;
        }
    }

    let profile = env::var("PROFILE").unwrap();
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());

    // 宿主架构 ⇢ cmake crate
    match target_arch.as_str() {
        "x86_64" => {
            build_with_cmake_crate(&manifest_dir, &profile, "64");
            build_with_cmake_command(&manifest_dir, &profile, "Win32", "32");
        }
        "x86" => {
            build_with_cmake_crate(&manifest_dir, &profile, "32");
            build_with_cmake_command(&manifest_dir, &profile, "x64", "64");
        }
        _ => unreachable!(),
    }

    println!("cargo:rustc-env=SPEEDPATCH_DLL_32=speedpatch32.dll");
    println!("cargo:rustc-env=SPEEDPATCH_DLL_64=speedpatch64.dll");
    println!("cargo:rerun-if-changed=speedpatch/");
    println!("cargo:rerun-if-changed=third_party/minhook/");
}
