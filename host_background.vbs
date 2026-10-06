' =========================================================================
' Legacy background host wrapper (kept for backward compatibility with the
' "ClaimDeskHost" Startup shortcut installed by setup_autostart.bat). Fixed
' to resolve its directory dynamically from its own file location instead of
' a hardcoded path — the project was renamed/moved since this file was
' written, so the old literal path no longer exists. Delegates to the same
' start_services.bat used by start_hidden.vbs so both the backend AND the
' frontend launch, instead of only the backend.
' =========================================================================

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir

targetBat = scriptDir & "\start_services.bat"
WshShell.Run "cmd.exe /c """ & targetBat & """ /no-pause", 0, False
