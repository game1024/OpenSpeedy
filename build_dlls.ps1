# Build speedpatch DLLs (32-bit + 64-bit) for release distribution
# 需要: Visual Studio with C++ tools + CMake in PATH

param(
    [string]$BuildType = "Release"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $scriptDir "target\$BuildType"

# 查找 CMake 生成器
$generator = "Visual Studio 17 2022"
$cmake = Get-Command cmake -ErrorAction SilentlyContinue
if (-not $cmake) {
    Write-Error "找不到 cmake，请安装 CMake 并加入 PATH"
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  building speedpatch DLLs ($BuildType)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 确保输出目录存在
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# ---------- 64-bit ----------
Write-Host "`n[1/2] Building speedpatch64.dll (x64)..." -ForegroundColor Yellow
$build64 = Join-Path $scriptDir "target\speedpatch-build\x64"
New-Item -ItemType Directory -Force -Path $build64 | Out-Null

cmake -S "$scriptDir\speedpatch" -B $build64 `
    -G $generator -A x64 `
    -DCMAKE_BUILD_TYPE=$BuildType
cmake --build $build64 --config $BuildType

$dll64 = Get-ChildItem -Path $build64 -Recurse -Name "speedpatch64.dll" | Select-Object -First 1
Copy-Item (Join-Path $build64 $dll64) (Join-Path $outDir "speedpatch64.dll") -Force
Write-Host "  -> $outDir\speedpatch64.dll" -ForegroundColor Green

# ---------- 32-bit ----------
Write-Host "`n[2/2] Building speedpatch32.dll (x86)..." -ForegroundColor Yellow
$build32 = Join-Path $scriptDir "target\speedpatch-build\x86"
New-Item -ItemType Directory -Force -Path $build32 | Out-Null

cmake -S "$scriptDir\speedpatch" -B $build32 `
    -G $generator -A Win32 `
    -DCMAKE_BUILD_TYPE=$BuildType
cmake --build $build32 --config $BuildType

$dll32 = Get-ChildItem -Path $build32 -Recurse -Name "speedpatch32.dll" | Select-Object -First 1
Copy-Item (Join-Path $build32 $dll32) (Join-Path $outDir "speedpatch32.dll") -Force
Write-Host "  -> $outDir\speedpatch32.dll" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Build complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
