# Demo ERP AP OCR - Local Launcher for PowerShell
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Demo ERP - AI AP OCR Invoice Module" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path "C:\Program Files\nodejs") {
    $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
}

# Resolve Python command (check backend\.venv first, then 'py', then 'python')
$pyCmd = ""
if (Test-Path "backend\.venv\Scripts\python.exe") {
    $pyCmd = "backend\.venv\Scripts\python.exe"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $pyCmd = "py"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $pyCmd = "python"
}

if ($pyCmd -eq "") {
    Write-Host "[ERROR] Python is not found in your PATH or backend\.venv." -ForegroundColor Red
    Write-Host "Please install Python 3.10+ from https://www.python.org/" -ForegroundColor Yellow
    exit 1
}

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not found in your PATH." -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

Write-Host "[1/3] Verifying Backend Dependencies..." -ForegroundColor Green
Start-Process $pyCmd -ArgumentList "-m", "pip", "install", "-r", "backend\requirements.txt", "--quiet" -Wait

Write-Host "[2/3] Verifying Frontend Dependencies..." -ForegroundColor Green
if (-not (Test-Path "frontend\node_modules")) {
    Write-Host "Installing npm packages..." -ForegroundColor Yellow
    Set-Location frontend
    Start-Process npm.cmd -ArgumentList "install" -Wait
    Set-Location ..
}

Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "Starting Services:" -ForegroundColor Green
Write-Host " - Backend API:  http://localhost:8001" -ForegroundColor White
Write-Host " - API Docs:     http://localhost:8001/docs" -ForegroundColor White
Write-Host " - Web UI:       http://localhost:5174" -ForegroundColor White
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

Start-Process powershell -ArgumentList "-NoExit", "-Command", "$pyCmd -m uvicorn backend.main:app --reload --port 8001"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:PATH = 'C:\Program Files\nodejs;' + `$env:PATH; cd frontend; npm.cmd run dev -- --port 5174"

Write-Host "Both services launched! Open http://localhost:5174 in your browser." -ForegroundColor Green
