@echo off
setlocal enabledelayedexpansion
title Stop AP-OCR Services
echo ===================================================
echo   Stopping AP-OCR Services (Ports 8001 ^& 5174)
echo ===================================================
echo.

set "PORTS=8001 5174"
set "KILLED_ANY=0"

for %%P in (%PORTS%) do (
    echo [*] Checking port %%P...
    set "PORT_FOUND=0"
    for /f "tokens=5" %%a in ('netstat -ano -p tcp 2^>nul ^| findstr /C:":%%P " ^| findstr /I "LISTENING"') do (
        set "TARGET_PID=%%a"
        if not "!TARGET_PID!"=="" if not "!TARGET_PID!"=="0" (
            echo     - Found PID !TARGET_PID! listening on port %%P. Terminating...
            taskkill /F /PID !TARGET_PID! >nul 2>&1
            set "PORT_FOUND=1"
            set "KILLED_ANY=1"
        )
    )
    if "!PORT_FOUND!"=="0" (
        echo     - Port %%P is already free.
    )
)

echo.
if "!KILLED_ANY!"=="1" (
    echo [SUCCESS] Specified AP-OCR background services have been stopped.
) else (
    echo [INFO] No active AP-OCR services were running on ports 8001 or 5174.
)
echo.

:: Allow automated callers to skip pause via /no-pause parameter
if /I not "%1"=="/no-pause" (
    echo Press any key to exit...
    pause >nul
)
