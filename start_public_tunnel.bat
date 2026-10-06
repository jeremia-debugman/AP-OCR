@echo off
setlocal enabledelayedexpansion
title AP-OCR - On-Demand Public Tunnel Launcher

:: Navigate to root directory
cd /d "%~dp0"

echo ========================================================================
echo                  AP-OCR On-Demand Public Tunnel Generator
echo ========================================================================
echo.

:: 1. Resolve Python
set "PY_CMD="
if exist "%~dp0backend\.venv\Scripts\python.exe" (
    set "PY_CMD=%~dp0backend\.venv\Scripts\python.exe"
) else (
    where py >nul 2>&1
    if !errorlevel! equ 0 (
        set "PY_CMD=py"
    ) else (
        where python >nul 2>&1
        if !errorlevel! equ 0 set "PY_CMD=python"
    )
)

if "%PY_CMD%"=="" (
    echo [ERROR] Python environment not found. Please install Python or build backend\.venv.
    pause
    exit /b 1
)

:: 2. Ensure cloudflared.exe binary is available
if not exist "%~dp0tools" mkdir "%~dp0tools"
if not exist "%~dp0tools\cloudflared.exe" (
    where cloudflared >nul 2>&1
    if !errorlevel! neq 0 (
        echo [*] cloudflared.exe not found locally.
        echo [*] Downloading official Cloudflare Tunnel binary (one-time setup)...
        curl.exe -L -o "%~dp0tools\cloudflared.exe" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        if !errorlevel! neq 0 (
            echo [*] curl failed, attempting download via Python...
            "%PY_CMD%" -c "import urllib.request; urllib.request.urlretrieve('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', r'%~dp0tools\cloudflared.exe')"
        )
        if not exist "%~dp0tools\cloudflared.exe" (
            echo [ERROR] Failed to download cloudflared.exe. Please verify internet connection.
            pause
            exit /b 1
        )
        echo [*] cloudflared.exe downloaded successfully.
    )
)

:: 3. Pre-flight check: ensure local AP-OCR frontend service is running on port 5174
echo [*] Checking local AP-OCR service status (port 5174)...
netstat -ano -p tcp 2>nul | findstr /C:":5174 " | findstr /I "LISTENING" >nul 2>&1
if !errorlevel! neq 0 (
    echo [WARNING] AP-OCR frontend (port 5174) is not currently running.
    echo [*] Attempting to launch AP-OCR background services automatically...
    call "%~dp0start_services.bat" /no-pause
    echo [*] Waiting 5 seconds for services to initialize...
    powershell -NoProfile -Command "Start-Sleep -Seconds 5"
)

:: 4. Launch public tunnel and display active URL banner
echo.
echo [*] Initializing secure HTTPS tunnel to port 5174...
"%PY_CMD%" "%~dp0tools\tunnel_launcher.py"

pause
