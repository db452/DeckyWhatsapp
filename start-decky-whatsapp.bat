@echo off
REM Deliberately start the PC bridge and supervise its Steam Deck SSH tunnel.
setlocal

set "PROJECT_DIR=%~dp0"
set "DECK_USER=deck"
set "DECK_NAME=steamdeck.lan"
set "DECK_HOST="
set "BRIDGE_PORT=8787"
set "DECK_KEY=%USERPROFILE%\.ssh\decky_whatsapp_ed25519"

echo Finding the Steam Deck at %DECK_NAME%...
for /f "tokens=2 delims=[]" %%I in ('ping -4 -n 1 %DECK_NAME% ^| findstr /i "Pinging"') do if not defined DECK_HOST set "DECK_HOST=%%I"

if not defined DECK_HOST (
    echo Could not find the Steam Deck at %DECK_NAME%.
    set /p "DECK_HOST=Enter the Steam Deck IP address manually: "
)

if not defined DECK_HOST (
    echo No Steam Deck address was provided. Exiting.
    pause
    exit /b 1
)

echo Steam Deck found at %DECK_HOST%.

echo Checking the local bridge port...
powershell.exe -NoProfile -Command "$client = New-Object System.Net.Sockets.TcpClient; try { $pending = $client.BeginConnect('127.0.0.1', %BRIDGE_PORT%, $null, $null); if ($pending.AsyncWaitHandle.WaitOne(500)) { $client.EndConnect($pending); Write-Host 'A bridge or another service is already using local port %BRIDGE_PORT%.'; Write-Host 'The launcher will leave it running. Close its window explicitly before starting another session.'; exit 1 } } catch { } finally { $client.Close() }"
if errorlevel 1 (
    pause
    exit /b 1
)

echo Starting the WhatsApp bridge...
start "Decky WhatsApp bridge" /D "%PROJECT_DIR%" cmd /c "npm.cmd start"

echo Waiting for the bridge to start...
set "BRIDGE_READY="
for /l %%N in (1,1,30) do (
    if not defined BRIDGE_READY (
        powershell.exe -NoProfile -Command "$c = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort %BRIDGE_PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 0 } else { exit 1 }"
        if not errorlevel 1 set "BRIDGE_READY=1"
        if not defined BRIDGE_READY timeout /t 1 /nobreak >nul
    )
)

if not defined BRIDGE_READY (
    echo The PC bridge did not start on port %BRIDGE_PORT%.
    echo Check the bridge window for the error, then press any key to exit.
    pause >nul
    exit /b 1
)

echo Starting the SSH tunnel to %DECK_USER%@%DECK_HOST%...
if exist "%DECK_KEY%" (
    start "Decky WhatsApp SSH tunnel" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%keep-ssh-tunnel.ps1" -DeckUser "%DECK_USER%" -DeckHost "%DECK_HOST%" -BridgePort %BRIDGE_PORT% -IdentityFile "%DECK_KEY%"
) else (
    start "Decky WhatsApp SSH tunnel" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%keep-ssh-tunnel.ps1" -DeckUser "%DECK_USER%" -DeckHost "%DECK_HOST%" -BridgePort %BRIDGE_PORT%
)

echo.
echo WhatsApp bridge and SSH tunnel started in separate windows.
echo Keep both windows open while using the Decky plugin.
endlocal
