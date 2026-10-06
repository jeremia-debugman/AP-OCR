@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion
title Demo ERP AP OCR - Services Launcher

:: Ensure Node.js standard install path is available
if exist "C:\Program Files\nodejs" set "PATH=C:\Program Files\nodejs;%PATH%"

echo ========================================================================
echo                 Demo ERP - AI AP OCR Services Launcher
echo ========================================================================
echo.
echo [*] Working Directory: %CD%

:: 1. Resolve Python in virtual environment
set "PY_CMD=%~dp0backend\.venv\Scripts\python.exe"
if not exist "%PY_CMD%" (
    where py >nul 2>&1
    if !errorlevel! equ 0 (
        set "PY_CMD=py"
    ) else (
        where python >nul 2>&1
        if !errorlevel! equ 0 set "PY_CMD=python"
    )
)

echo [*] Python Command   : %PY_CMD%

if "%PY_CMD%"=="" (
    echo [ERROR] Python not found in backend\.venv or system PATH.
    echo Please install Python 3.10+ from https://www.python.org/
    if /I not "%1"=="/no-pause" pause
    exit /b 1
)

:: 2. Resolve Node.js
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo [ERROR] Node.js is not found in your PATH.
    echo Please install Node.js LTS from https://nodejs.org/
    if /I not "%1"=="/no-pause" pause
    exit /b 1
)

:: 3. Create logs directory
if not exist "%~dp0logs" mkdir "%~dp0logs"

:: 4. Pre-flight check & clear port conflicts: ports 8001 and 5174
echo [*] Checking and freeing existing ports 8001 and 5174...
call "%~dp0stop_services.bat" /no-pause >nul 2>&1

:: 5. Launch FastAPI Backend on port 8001
echo [*] Launching FastAPI Backend on http://localhost:8001...
start "Demo ERP AP Backend" /min cmd /k ""%PY_CMD%" -m uvicorn backend.main:app --host 0.0.0.0 --port 8001"

:: 6. Launch Vite Frontend on port 5174
echo [*] Launching Vite Frontend on http://localhost:5174...
start "Demo ERP AP Frontend" /min cmd /k "cd /d "%~dp0frontend" && set PATH=C:\Program Files\nodejs;%%PATH%% && npm run dev -- --port 5174 --host"

echo.
echo ========================================================================
echo [SUCCESS] AP-OCR Services are running!
echo   - Backend API : http://localhost:8001
echo   - API Docs    : http://localhost:8001/docs
echo   - Frontend UI : http://localhost:5174
echo ========================================================================
echo.

if /I not "%1"=="/no-pause" (
    echo Services are running in background. You may close this window.
    timeout /t 5 >nul 2>&1
)
