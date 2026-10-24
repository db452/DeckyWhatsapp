@echo off
setlocal
title Decky WhatsApp production deployment
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-decky-plugins.ps1" -Variant production
set "DEPLOY_EXIT=%ERRORLEVEL%"
if not "%DEPLOY_EXIT%"=="0" (
    echo.
    if "%DEPLOY_EXIT%"=="2" (
        echo Production deployment was cancelled before installation.
    ) else (
        echo Production deployment did not complete successfully. Review the messages above.
    )
    echo.
    pause
    exit /b %DEPLOY_EXIT%
)
echo.
echo Production plugin files were installed and verified. The shared plugin_loader.service restarted, reloading all Decky plugins.
echo.
pause
exit /b 0
