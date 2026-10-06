@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion
title Demo ERP AP-OCR Auto-Start Installer

echo ========================================================================
echo         Demo ERP - AP-OCR Windows Auto-Start Configuration
echo ========================================================================
echo.

set "REPO_ROOT=%~dp0"
if "%REPO_ROOT:~-1%"=="\" set "REPO_ROOT=%REPO_ROOT:~0,-1%"

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\AP_OCR_AutoStart.lnk"
set "TARGET_VBS=%REPO_ROOT%\start_hidden.vbs"
set "ICON_LOCATION=%SystemRoot%\System32\shell32.dll,14"

echo [*] Repository Root       : %REPO_ROOT%
echo [*] Target Startup Folder : %STARTUP_DIR%
echo [*] Target Background VBS : %TARGET_VBS%
echo [*] Shortcut Destination  : %SHORTCUT_PATH%
echo.

if not exist "%TARGET_VBS%" (
    echo [ERROR] Could not find start_hidden.vbs at:
    echo         %TARGET_VBS%
    pause
    exit /b 1
)

:: Clear existing shortcut if present
if exist "%SHORTCUT_PATH%" del /f /q "%SHORTCUT_PATH%" >nul 2>&1

:: Create Windows Shortcut (.lnk) with explicit WorkingDirectory set to REPO_ROOT
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$s = $ws.CreateShortcut('%SHORTCUT_PATH%'); " ^
  "$s.TargetPath = 'wscript.exe'; " ^
  "$s.Arguments = '\"%TARGET_VBS%\"'; " ^
  "$s.WorkingDirectory = '%REPO_ROOT%'; " ^
  "$s.Description = 'Demo ERP AI AP-OCR Automatic Background Service'; " ^
  "$s.IconLocation = '%ICON_LOCATION%'; " ^
  "$s.Save()"

if %errorlevel% neq 0 (
    echo [ERROR] Failed to create shortcut in Startup folder.
    pause
    exit /b 1
)

echo ========================================================================
echo [SUCCESS] AP-OCR Auto-Start configured successfully!
echo.
echo Whenever your Windows PC starts or you log in:
echo   1. start_hidden.vbs executes automatically with WorkingDirectory:
echo      %REPO_ROOT%
echo   2. FastAPI backend launches on http://localhost:8001
echo   3. Vite frontend UI launches on http://localhost:5174
echo   4. Both services run in the background without IDE.
echo.
echo Shortcut created at:
echo   %SHORTCUT_PATH%
echo.
echo (To uninstall auto-start, delete that shortcut or run:)
echo   del "%SHORTCUT_PATH%"
echo ========================================================================
echo.

pause
