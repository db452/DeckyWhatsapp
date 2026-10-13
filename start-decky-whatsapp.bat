@echo off
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

set "DECK_PORT_BUSY="
if exist "%DECK_KEY%" (
    for /f "delims=" %%P in ('ssh -i "%DECK_KEY%" -o IdentitiesOnly=yes %DECK_USER%@%DECK_HOST% "ss -ltn ^| grep -q ':%BRIDGE_PORT% ' ^&^& echo BUSY" 2^>nul') do set "DECK_PORT_BUSY=%%P"
) else (
    for /f "delims=" %%P in ('ssh %DECK_USER%@%DECK_HOST% "ss -ltn ^| grep -q ':%BRIDGE_PORT% ' ^&^& echo BUSY" 2^>nul') do set "DECK_PORT_BUSY=%%P"
)

if defined DECK_PORT_BUSY (
    echo An old tunnel is using Deck port %BRIDGE_PORT%. Clearing it...
    if exist "%DECK_KEY%" (
        ssh -i "%DECK_KEY%" -o IdentitiesOnly=yes -t %DECK_USER%@%DECK_HOST% "sudo fuser -k %BRIDGE_PORT%/tcp"
    ) else (
        ssh -t %DECK_USER%@%DECK_HOST% "sudo fuser -k %BRIDGE_PORT%/tcp"
    )
)

echo Starting the WhatsApp bridge...
powershell.exe -NoProfile -Command "$connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort %BRIDGE_PORT% -State Listen -ErrorAction SilentlyContinue; if ($connection) { Write-Host ('Closing previous local bridge (PID ' + $connection[0].OwningProcess + ')...'); Stop-Process -Id $connection[0].OwningProcess -Force -ErrorAction SilentlyContinue }"
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
