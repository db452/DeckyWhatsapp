@echo off
setlocal
title Decky WhatsApp plugin deployment

rem This command builds and stages both plugins, then asks before installing
rem them and restarting Decky's plugin loader. The PowerShell helper performs
rem the guarded deployment and requests sudo through an interactive SSH terminal.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-decky-plugins.ps1"
set "DEPLOY_EXIT=%ERRORLEVEL%"
if not "%DEPLOY_EXIT%"=="0" (
    echo.
    echo Deployment did not complete successfully. Review the messages above.
    exit /b %DEPLOY_EXIT%
)
echo.
echo Success!
timeout /t 3 /nobreak >nul
exit /b 0
