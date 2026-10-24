@echo off
REM ============================================================
REM  Sonic the Ledgerhog - build the DESKTOP INSTALLER (Windows)
REM  Double-click this to produce a real installed app with a
REM  Start Menu / desktop icon. Run it when you want a new
REM  standalone build (no terminal needed to run the app after).
REM
REM  When it finishes, the installer is under:
REM    src-tauri\target\release\bundle\msi\   (.msi)
REM    src-tauri\target\release\bundle\nsis\  (.exe setup)
REM  Double-click that to install; then launch from the Start Menu.
REM
REM  Your .sonicledger book file is never touched.
REM ============================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\refresh.ps1" build
echo.
echo ---- build-installer.cmd finished ----
echo Installer is under src-tauri\target\release\bundle\  (msi\ or nsis\)
echo Double-click it to install, then launch from the Start Menu.
pause
