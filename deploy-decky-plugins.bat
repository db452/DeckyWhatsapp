@echo off
setlocal
title Decky WhatsApp plugin deployment

rem This command builds and stages both plugins, then asks once before installing
rem them and restarting Decky's shared plugin loader. The PowerShell helper
rem performs the guarded deployment and requests sudo through an interactive SSH terminal.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-decky-plugins.ps1" -Variant both
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
echo Both Decky plugin variants were installed and verified. The shared plugin_loader.service restarted automatically, reloading all Decky plugins.
echo.
pause
exit /b 0
