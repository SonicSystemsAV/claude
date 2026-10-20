<#
  refresh.ps1 - update Sonic the Ledgerhog to the latest version.

  Usage (from anywhere; it cd's to the repo root automatically):
    powershell -ExecutionPolicy Bypass -File scripts\refresh.ps1          # dev mode (default)
    powershell -ExecutionPolicy Bypass -File scripts\refresh.ps1 build    # build a fresh installer
    powershell -ExecutionPolicy Bypass -File scripts\refresh.ps1 dev -Clean   # force a clean Rust rebuild
                                                                               # (use if the app icon won't update)

  Your company data is NOT touched - the .sonicledger book file lives in
  Documents\sonictheledgerhog and is independent of the code.
#>

param(
  [ValidateSet('dev', 'build')]
  [string]$Mode = 'dev',
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'

# Repo root = the folder this script's parent lives in (scripts\ -> repo root).
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -Path $repo
Write-Host "Repo: $repo" -ForegroundColor DarkGray

Write-Host "`n[1/4] Pulling latest code..." -ForegroundColor Cyan
# Force the checkout to match the remote exactly. A plain 'git pull' refuses when
# the local checkout has diverged or carries stray changes, which silently
# stranded the app on an old build. This discards local CODE changes only - your
# .sonicledger book file lives in Documents and is never touched.
git fetch origin
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if (-not $branch -or $branch -eq 'HEAD') { $branch = 'main' }
git reset --hard "origin/$branch"
Write-Host ("Now at: " + (git log -1 --format='%h %s')) -ForegroundColor DarkGray

Write-Host "`n[2/4] Installing dependencies..." -ForegroundColor Cyan
npm install

Write-Host "`n[3/4] Building web assets..." -ForegroundColor Cyan
npm run build

if ($Clean) {
  Write-Host "`n[clean] Clearing the Rust build cache (forces icon + binary rebuild)..." -ForegroundColor Yellow
  cargo clean --manifest-path src-tauri\Cargo.toml
}

Write-Host "`n[4/4] Launching ($Mode)..." -ForegroundColor Cyan
if ($Mode -eq 'build') {
  npm run tauri build
  Write-Host "`nDone. Installer is under src-tauri\target\release\bundle\ - reinstall to update the desktop app." -ForegroundColor Green
} else {
  Write-Host "Starting dev app (Ctrl+C to stop)...`n" -ForegroundColor Green
  npm run tauri dev
}
