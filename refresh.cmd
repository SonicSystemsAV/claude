@echo off
REM ============================================================
REM  Sonic the Ledgerhog - one-click refresh (Windows)
REM  Double-click this file from Explorer to update + launch.
REM  It pulls the latest code, installs, builds, and starts the
REM  dev app. Your .sonicledger book file is never touched.
REM ============================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\refresh.ps1" dev
echo.
echo ---- refresh.cmd finished (close this window) ----
pause
