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
    if "%DEPLOY_EXIT%"=="2" (
        echo Deployment was cancelled. The Deck plugins were not installed.
    ) else (
        echo Deployment did not complete successfully. Review the messages above.
    )
    echo.
    pause
    exit /b %DEPLOY_EXIT%
)
echo.
echo Both Decky plugin variants were installed and plugin_loader.service is active.
echo.
pause
exit /b 0
