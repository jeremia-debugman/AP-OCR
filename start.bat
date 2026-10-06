@echo off
title Demo ERP AP OCR - Local Launcher
echo ===================================================
echo   Demo ERP - AI AP OCR Invoice Module
echo ===================================================
echo.

:: Add standard Node.js install location to PATH if present
if exist "C:\Program Files\nodejs" set "PATH=C:\Program Files\nodejs;%PATH%"

:: Resolve Python command (check backend\.venv first, then 'py', then 'python')
set "PY_CMD="
if exist "backend\.venv\Scripts\python.exe" (
    set "PY_CMD=backend\.venv\Scripts\python.exe"
) else (
    py --version >nul 2>&1
    if %errorlevel% equ 0 (
        set "PY_CMD=py"
    ) else (
        python --version >nul 2>&1
        if %errorlevel% equ 0 (
            set "PY_CMD=python"
        )
    )
)

if "%PY_CMD%"=="" (
    echo [ERROR] Python is not found in your PATH or backend\.venv.
    echo Please install Python 3.10+ from https://www.python.org/
    pause
    exit /b 1
)

:: Check Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in your PATH.
    echo Please install Node.js (LTS) from https://nodejs.org/
    pause
    exit /b 1
)

echo [1/3] Verifying Backend Dependencies...
%PY_CMD% -m pip install -r backend\requirements.txt --quiet

echo [2/3] Verifying Frontend Dependencies...
cd frontend
if not exist node_modules (
    echo Installing npm dependencies, please wait...
    call npm.cmd install
)
cd ..

echo.
echo ===================================================
echo [3/3] Starting Services:
echo - Backend API:   http://localhost:8001
echo - API Docs:      http://localhost:8001/docs
echo - Web App (UI):  http://localhost:5174
echo ===================================================
echo.

start "Demo ERP AP Backend" cmd /k "%PY_CMD% -m uvicorn backend.main:app --reload --port 8001"
start "Demo ERP AP Frontend" cmd /k "cd frontend && set PATH=C:\Program Files\nodejs;%%PATH%% && npm.cmd run dev -- --port 5174"

echo Services launched! Open http://localhost:5174 in your browser.
pause
