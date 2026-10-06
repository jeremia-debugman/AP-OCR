' =========================================================================
' Demo ERP AP-OCR Background Host Wrapper
' Launches start_services.bat completely hidden with zero command windows
' =========================================================================

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir

' Launch start_services.bat in background (WindowStyle 0 = Hidden, WaitOnReturn False)
targetBat = scriptDir & "\start_services.bat"
WshShell.Run "cmd.exe /c """ & targetBat & """ /no-pause", 0, False
