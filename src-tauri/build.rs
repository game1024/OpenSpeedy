//! Build script - compile 32/64-bit speedpatch DLLs and bridge EXEs via cmake
//!
//! - Host arch: cmake crate auto-detects the compiler
//! - Cross arch: cmake -A to target the other platform

use std::collections::HashSet;
use std::env;
use std::path::PathBuf;
use std::process::Command;

/// MSBuild copies the whole environment into a case-insensitive dictionary
/// before it starts `cl.exe`. An environment that carries both `HTTPS_PROXY`
/// and `https_proxy` therefore fails with "an item with the same key has
/// already been added" and the compiler never starts — the native build then
/// dies with the unhelpful "No CMAKE_C_COMPILER could be found".
///
/// On Windows those two names are the *same* variable, so keeping either one
/// is equivalent; the duplicate is simply dropped here. Without this the
/// native build depends on how the shell happened to be set up.
fn dedupe_env_by_case() {
    let mut seen: HashSet<String> = HashSet::new();
    let duplicates: Vec<String> = env::vars()
        .filter_map(|(key, _)| {
            if seen.insert(key.to_ascii_lowercase()) {
                None
            } else {
                Some(key)
            }
        })
        .collect();
    for key in duplicates {
        println!("cargo:warning=dropping duplicate env var (differs only in case): {key}");
        env::remove_var(&key);
    }
}

/// Point the native build at a temp directory it is allowed to write to.
///
/// MSBuild creates a scratch folder under %TEMP% before it starts the
/// compiler. Where the environment denies directory creation there, MSBuild
/// dies with "UnauthorizedAccessException" while creating MSBuildTemp*, and
/// the whole native build fails with a misleading "No CMAKE_C_COMPILER could
/// be found". A scratch directory inside the cargo target dir is always
/// writable, so the native tools are pointed there instead.
fn use_writable_temp_dir(manifest_dir: &PathBuf, profile: &str) {
    let dir = profile_dir(manifest_dir, profile).join("build-tmp");
    if std::fs::create_dir_all(&dir).is_err() {
        println!("cargo:warning=could not create {} — leaving %TEMP% in place", dir.display());
        return;
    }
    let win = dir.to_string_lossy().to_string();
    env::set_var("TEMP", &win);
    env::set_var("TMP", &win);
    println!("cargo:info=native build temp dir = {}", dir.display());
}

fn profile_dir(manifest_dir: &PathBuf, profile: &str) -> PathBuf {
    // Inherited from the caller's environment; Cargo does not set it for build
    // scripts. `--target-dir` on the command line is not seen here.
    let target = env::var("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| manifest_dir.join("target"));
    target.join(profile)
}
fn build_cmake_crate(
    manifest_dir: &PathBuf,
    profile: &str,
    project_dir: &str,    // relative to manifest_dir, e.g. "../speedpatch"
    bin_prefix: &str,     // e.g. "speedpatch" or "bridge"
    bin_suffix: &str,     // "32" or "64"
    file_ext: &str,       // "dll" or "exe"
) {
    let build_type = if profile == "release" { "Release" } else { "Debug" };
    let bin_name = format!("{}{}.{}", bin_prefix, bin_suffix, file_ext);

    println!("cargo:info=[cmake crate] building {bin_name} (host arch)...");

    let dst = cmake::Config::new(project_dir)
        .define("CMAKE_BUILD_TYPE", build_type)
        .build();

    let bin_src = dst.join("bin").join(&bin_name);
    let bin_dst = profile_dir(manifest_dir, profile).join(&bin_name);

    std::fs::copy(&bin_src, &bin_dst).unwrap_or_else(|e| {
        panic!("copy {} -> {} failed: {}", bin_src.display(), bin_dst.display(), e);
    });
    println!("cargo:info=  -> {}", bin_dst.display());
}

/// Build a cmake project (cross arch) via cmake command line, copy the output binary.
fn build_cmake_command(
    manifest_dir: &PathBuf,
    profile: &str,
    project_dir: &str,       // relative to manifest_dir, e.g. "../speedpatch"
    cmake_arch: &str,         // "Win32" or "x64"
    bin_prefix: &str,         // e.g. "speedpatch" or "bridge"
    bin_suffix: &str,         // "32" or "64"
    file_ext: &str,           // "dll" or "exe"
    build_subdir: &str,       // subdirectory under target/ for build artifacts
) {
    let build_type = if profile == "release" { "Release" } else { "Debug" };
    let bin_name = format!("{}{}.{}", bin_prefix, bin_suffix, file_ext);
    let build_dir = manifest_dir.join("target").join(build_subdir).join(cmake_arch);

    println!("cargo:info=[cmake cmd] building {bin_name} (-A {cmake_arch})...");

    let source_dir = manifest_dir.join(project_dir);
    let status = Command::new("cmake")
        .args([
            "-S", &source_dir.to_string_lossy(),
            "-B", &build_dir.to_string_lossy(),
            "-A", cmake_arch,
        ])
        .status()
        .expect("cmake configure failed");

    if !status.success() {
        panic!("cmake configure returned error for {}", bin_name);
    }

    let status = Command::new("cmake")
        .args(["--build", &build_dir.to_string_lossy(), "--config", build_type])
        .status()
        .expect("cmake build failed");

    if !status.success() {
        panic!("cmake build returned error for {}", bin_name);
    }

    let bin_src = build_dir.join(build_type).join(&bin_name);
    let bin_dst = profile_dir(manifest_dir, profile).join(&bin_name);

    std::fs::copy(&bin_src, &bin_dst).unwrap_or_else(|e| {
        panic!("copy {} -> {} failed: {}", bin_src.display(), bin_dst.display(), e);
    });
    println!("cargo:info=  -> {}", bin_dst.display());
}

/// Build both architectures of a project.
fn build_project(
    manifest_dir: &PathBuf,
    profile: &str,
    target_arch: &str,
    project_dir: &str,
    bin_prefix: &str,
    file_ext: &str,
    build_subdir: &str,
) {
    match target_arch {
        "x86_64" => {
            build_cmake_crate(manifest_dir, profile, project_dir, bin_prefix, "64", file_ext);
            build_cmake_command(manifest_dir, profile, project_dir, "Win32", bin_prefix, "32", file_ext, build_subdir);
        }
        "x86" => {
            build_cmake_crate(manifest_dir, profile, project_dir, bin_prefix, "32", file_ext);
            build_cmake_command(manifest_dir, profile, project_dir, "x64", bin_prefix, "64", file_ext, build_subdir);
        }
        _ => unreachable!(),
    }
}

/// Build the Rust bridge crate via cargo for one target triple.
/// Returns `(target_arch_name, built_exe_path)` on success.
fn cargo_build_bridge(bridge_dir: &PathBuf, profile: &str, target: Option<&str>) -> Option<(String, PathBuf)> {
    let profile_flag = if profile == "release" { "--release" } else { "" };
    let build_type = if profile == "release" { "release" } else { "debug" };

    let mut cmd = Command::new("cargo");
    cmd.args(["build", "--manifest-path", &bridge_dir.join("Cargo.toml").to_string_lossy()]);
    // The app build already holds CARGO_TARGET_DIR. A nested cargo using that
    // same directory waits on the lock forever.
    cmd.env_remove("CARGO_TARGET_DIR");
    if !profile_flag.is_empty() { cmd.arg(profile_flag); }
    if let Some(t) = target { cmd.args(["--target", t]); }

    let label = target.unwrap_or("host");
    println!("cargo:info=[cargo] building bridge ({label})...");
    let status = cmd.status().expect("cargo build bridge failed");
    if !status.success() {
        println!("cargo:warning=cargo build bridge ({label}) returned error");
        return None;
    }

    let target_dir = if let Some(t) = target {
        bridge_dir.join("target").join(t).join(build_type)
    } else {
        bridge_dir.join("target").join(build_type)
    };
    let src = target_dir.join("bridge.exe");
    if !src.exists() { return None; }
    Some((label.to_string(), src))
}

/// Whether the 32-bit Windows target can be cross-compiled.
///
/// `rustup` is the usual way to ask, but a plain toolchain install has no
/// rustup at all — and then the check would silently report "not installed"
/// even though the target's standard library sits right there in the
/// toolchain. Ask rustc for the target's lib directory instead and look for
/// the standard library in it.
fn has_i686_target() -> bool {
    let target = "i686-pc-windows-msvc";

    if let Ok(out) = Command::new("rustup").args(["target", "list", "--installed"]).output() {
        if String::from_utf8_lossy(&out.stdout).contains(target) {
            return true;
        }
    }

    let out = match Command::new("rustc")
        .args(["--print", "target-libdir", "--target", target])
        .output()
    {
        Ok(out) if out.status.success() => out,
        _ => return false,
    };
    let libdir = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
    libdir.is_dir()
        && std::fs::read_dir(&libdir)
            .map(|entries| {
                entries.flatten().any(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .starts_with("libstd-")
                })
            })
            .unwrap_or(false)
}

/// Build Rust bridge for host arch (→ bridge64.exe) and optionally i686 (→ bridge32.exe).
fn build_rust_bridge(manifest_dir: &PathBuf, profile: &str) {
    let bridge_dir = manifest_dir.join("../src-bridge");
    let prof_dir = profile_dir(manifest_dir, profile);

    // --- 64-bit (host arch) ---
    if let Some((_, src)) = cargo_build_bridge(&bridge_dir, profile, None) {
        let dst = prof_dir.join("bridge64.exe");
        std::fs::copy(&src, &dst).unwrap_or_else(|e| panic!("copy {} -> {} failed: {}", src.display(), dst.display(), e));
        println!("cargo:info=  -> {}", dst.display());
    }

    // --- 32-bit (cross-compile if i686 target installed) ---
    let has_i686 = has_i686_target();

    if has_i686 {
        if let Some((_, src)) = cargo_build_bridge(&bridge_dir, profile, Some("i686-pc-windows-msvc")) {
            let dst = prof_dir.join("bridge32.exe");
            std::fs::copy(&src, &dst).unwrap_or_else(|e| panic!("copy {} -> {} failed: {}", src.display(), dst.display(), e));
            println!("cargo:info=  -> {}", dst.display());
        }
    } else {
        println!("cargo:warning=i686-pc-windows-msvc target not installed — skipping bridge32.exe");
        println!("cargo:warning=Install with: rustup target add i686-pc-windows-msvc");
    }
}

fn main() {
    dedupe_env_by_case();

    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();

    match target_arch.as_str() {
        "x86" | "x86_64" => {}
        _ => {
            println!("cargo:warning=speedpatch/bridge only support x86/x86_64 Windows");
            tauri_build::build();
            return;
        }
    }

    let profile = env::var("PROFILE").unwrap();
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    use_writable_temp_dir(&manifest_dir, &profile);

    // --- speedpatch DLLs (C++ / cmake) ---
    build_project(&manifest_dir, &profile, target_arch.as_str(),
        "../src-bridge/speedpatch", "speedpatch", "dll", "speedpatch-build");

    // --- bridge EXEs (Rust / cargo) ---
    build_rust_bridge(&manifest_dir, &profile);

    println!("cargo:rustc-env=SPEEDPATCH_DLL_32=speedpatch32.dll");
    println!("cargo:rustc-env=SPEEDPATCH_DLL_64=speedpatch64.dll");
    println!("cargo:rustc-env=BRIDGE_EXE_64=bridge64.exe");
    println!("cargo:rerun-if-changed=../src-bridge/speedpatch/");
    println!("cargo:rerun-if-changed=../src-bridge/third_party/minhook/");
    println!("cargo:rerun-if-changed=../src-bridge/src/");

    // Copy binaries to resources folder for Tauri bundling.
    //
    // Only a non-debug profile owns this folder. The bundler reads it when it
    // packages the installer, so whatever sits here is what gets shipped. A
    // debug build (`cargo build`, `cargo test`) writing here would replace the
    // release payload with debug binaries — and since the release build
    // script is cached the next time, the installer would quietly ship the
    // debug ones. The app looks for its bridge next to the executable, so the
    // debug profile has no use for these files.
    if profile != "debug" {
        let bin_dir = manifest_dir.join("binaries");
        let _ = std::fs::create_dir_all(&bin_dir);
        let prof_dir = profile_dir(&manifest_dir, &profile);
        for name in &["speedpatch32.dll", "speedpatch64.dll", "bridge32.exe", "bridge64.exe"] {
            let src = prof_dir.join(name);
            if src.exists() {
                let dst = bin_dir.join(name);
                // A failed copy used to be ignored while the build still reported
                // success, bundling a stale or missing DLL/bridge. Every other
                // copy in this file fails loudly; do the same here.
                std::fs::copy(&src, &dst).unwrap_or_else(|e| {
                    panic!("copy {} -> {} failed: {}", src.display(), dst.display(), e);
                });
                println!("cargo:info=  resource -> {}", dst.display());
            }
        }
    }

    tauri_build::build();
}
