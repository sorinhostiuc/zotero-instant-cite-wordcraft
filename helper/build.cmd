@echo off
rem Builds WordCraftCite.exe with the .NET Framework 4 compiler that ships with Windows.
setlocal
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
set WPF=%FW%\WPF
"%FW%\csc.exe" /nologo /optimize+ /target:winexe /platform:anycpu ^
  /out:"%~dp0..\addon\chrome\content\helper\WordCraftCite.exe" ^
  /r:"%WPF%\UIAutomationClient.dll" /r:"%WPF%\UIAutomationTypes.dll" /r:"%WPF%\WindowsBase.dll" ^
  /r:System.Windows.Forms.dll ^
  "%~dp0WordCraftCite.cs"
