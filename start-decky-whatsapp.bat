@echo off
REM Deliberately start the PC bridge and supervise its Steam Deck SSH tunnel.
setlocal

set "PROJECT_DIR=%~dp0"
set "DECK_USER=deck"
set "DECK_KEY=%USERPROFILE%\.ssh\decky_whatsapp_ed25519"

where node.exe >nul 2>&1 || goto :missing_node
where npm.cmd >nul 2>&1 || goto :missing_npm
where ssh.exe >nul 2>&1 || goto :missing_ssh
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
    echo Node.js 22 or newer is required. Install or select a supported Node.js version, then retry.
    pause
    exit /b 1
)

REM dotenv uses the inherited environment first, then the project .env, then 8787.
set "BRIDGE_PORT="
pushd "%PROJECT_DIR%" || goto :project_dir_error
for /f "delims=" %%P in ('node.exe scripts\read-bridge-port.mjs') do set "BRIDGE_PORT=%%P"
popd
if not defined BRIDGE_PORT (
    echo PORT must be a decimal integer from 1 to 65535. Check the environment or .env file.
    pause
    exit /b 1
)

call :resolve_deck_host

if not defined DECK_HOST (
    echo No Steam Deck address was provided. Exiting.
    pause
    exit /b 1
)

REM Validate a DNS name or IPv4 address and resolve it before starting the bridge.
powershell.exe -NoProfile -Command "$h=$env:DECK_HOST; $name='^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$'; $ip=$null; if ([Net.IPAddress]::TryParse($h,[ref]$ip) -and $ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) { exit 0 }; if ($h -notmatch $name -or $h.Contains(':')) { exit 1 }; try { [void][Net.Dns]::GetHostAddresses($h); exit 0 } catch { exit 1 }"
if errorlevel 1 (
    echo Invalid or unresolvable Deck address. Use an IPv4 address or DNS hostname without a port or SSH options.
    pause
    exit /b 1
)
echo.
echo   .--------------------------------.
echo   ^|  o  +--------------------+  o  ^|
echo   ^|     ^|   DECKY WHATSAPP   ^|     ^|
echo   '-----+--------------------+-----'
echo.
echo Using loopback bridge port %BRIDGE_PORT% and Steam Deck %DECK_USER%@%DECK_HOST%.

echo Checking the local bridge port...
powershell.exe -NoProfile -Command "$client = New-Object System.Net.Sockets.TcpClient; try { $pending = $client.BeginConnect('127.0.0.1', %BRIDGE_PORT%, $null, $null); if ($pending.AsyncWaitHandle.WaitOne(500)) { $client.EndConnect($pending); Write-Host 'A bridge or another service is already using local port %BRIDGE_PORT%.'; Write-Host 'The launcher will leave it running. Close its window explicitly before starting another session.'; exit 1 } } catch { } finally { $client.Close() }"
if errorlevel 1 (
    pause
    exit /b 1
)

echo Starting the WhatsApp bridge on port %BRIDGE_PORT%...
start "Decky WhatsApp bridge" /D "%PROJECT_DIR%" cmd /c "set PORT=%BRIDGE_PORT%&& npm.cmd start"

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
echo WhatsApp bridge is ready. The SSH tunnel process has been launched; connection and forwarding still need to succeed.
echo Keep both windows open while using the Decky plugin.
endlocal
exit /b 0

:missing_node
echo Node.js is not installed or is not on PATH. Install Node.js 22 or newer.
pause
exit /b 1
:project_dir_error
echo Could not switch to the project directory: %PROJECT_DIR%
pause
exit /b 1
:missing_npm
echo npm is not installed or is not on PATH. Repair the Node.js 22 or newer installation.
pause
exit /b 1
:missing_ssh
echo OpenSSH Client is not installed or ssh.exe is not on PATH. Enable the Windows OpenSSH Client feature.
pause
exit /b 1

:resolve_deck_host
if defined DECK_HOST exit /b 0
echo Checking a small set of conventional Steam Deck hostnames...
set "DECK_SUGGESTION="
pushd "%PROJECT_DIR%" || goto :project_dir_error
for /f "delims=" %%H in ('node.exe scripts\suggest-deck-host.mjs 2^>nul') do if not defined DECK_SUGGESTION set "DECK_SUGGESTION=%%H"
popd
if defined DECK_SUGGESTION (
    set "DECK_HOST=%DECK_SUGGESTION%"
    echo Automatically selected Steam Deck hostname %DECK_SUGGESTION%.
) else (
    echo No known Steam Deck hostname resolved.
    set /p "DECK_HOST=Enter the Steam Deck IPv4 address or DNS hostname manually: "
)
exit /b 0
