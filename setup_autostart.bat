@echo off
title ClaimDesk Auto-Host Setup
echo Installing ClaimDesk as an automatic background service on Windows...
echo.

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET_VBS=%~dp0host_background.vbs"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\ClaimDeskHost.lnk"

powershell -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath='%TARGET_VBS%'; $s.WorkingDirectory='%~dp0'; $s.Save()"

echo.
echo [SUCCESS] ClaimDesk auto-start shortcut created in Windows Startup folder!
echo.
echo ClaimDesk will now automatically host itself in the background whenever your PC starts.
echo You can access the tool anytime at: http://localhost:8001
echo.
pause
