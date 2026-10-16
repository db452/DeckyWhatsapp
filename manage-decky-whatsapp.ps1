# Optional, manually controlled background mode for the Windows bridge and tunnel.
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("Start", "Status", "Logs", "Stop")]
    [string]$Action = "Start",
    [string]$DeckHost = "",
    [ValidateRange(1, 65535)] [int]$BridgePort = 8787,
    [string]$RuntimeDir = ""
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$deckName = "steamdeck.lan"
$deckUser = "deck"
$identityFile = Join-Path $env:USERPROFILE ".ssh\decky_whatsapp_ed25519"
$runtimeDir = if ($RuntimeDir) { $RuntimeDir } else { Join-Path $env:LOCALAPPDATA "DeckyWhatsapp\background" }
$statePath = Join-Path $runtimeDir "state.json"
$lockPath = Join-Path $runtimeDir "control.lock"

function Get-LogPaths {
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        return @($state.BridgeLog, $state.BridgeErrorLog, $state.TunnelLog, $state.TunnelErrorLog)
    }
    return @()
}

function Get-VerifiedProcess($record) {
    if (-not $record -or -not $record.Pid -or -not $record.StartTimeUtcTicks) { return $null }
    try {
        $runtime = Get-Process -Id ([int]$record.Pid) -ErrorAction Stop
        if (-not $runtime.Path -or [IO.Path]::GetFullPath($runtime.Path) -ne [IO.Path]::GetFullPath($record.ExecutablePath)) { return $null }
        if ($runtime.StartTime.ToUniversalTime().Ticks -ne [long]$record.StartTimeUtcTicks) { return $null }
        return $runtime
    } catch { return $null }
}

function Get-ProcessRecord([System.Diagnostics.Process]$process, [string]$executable, [string]$marker) {
    $process.Refresh()
    return [ordered]@{
        Pid = $process.Id
        StartTimeUtcTicks = $process.StartTime.ToUniversalTime().Ticks
        ExecutablePath = [IO.Path]::GetFullPath($executable)
        CommandLineMarker = $marker
    }
}

function Test-LocalPort([int]$port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($pending)
        return $true
    } catch { return $false }
    finally { $client.Close() }
}

function Get-BridgeHealthForOwnedProcess($record, [int]$port) {
    if (-not (Get-VerifiedProcess $record)) { return $false }
    if (-not (Test-LocalPort $port)) { return $false }
    $token = Read-BridgeToken $port
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 3
    if ([int]$health.processId -ne [int]$record.Pid) { return $false }
    if (-not (Get-VerifiedProcess $record)) { return $false }
    return [pscustomobject]@{ Token = $token; SessionId = [string]$health.sessionId }
}

function Read-BridgeToken([int]$port) {
    $response = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/bootstrap" -Headers @{ Origin = "https://steamloopback.host" } -TimeoutSec 3
    if ($response.token -notmatch '^[a-f0-9]{64}$') { throw "The local service did not return a valid DeckyWhatsapp bootstrap token." }
    return [string]$response.token
}

function Write-BridgeShutdown([int]$port, [string]$token, [string]$expectedSessionId) {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/shutdown" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body (@{ expectedSessionId = $expectedSessionId } | ConvertTo-Json -Compress) -TimeoutSec 3 | Out-Null
}

function Invoke-ControlLock([scriptblock]$operation) {
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $lock = $null
    try {
        $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch { throw "Another DeckyWhatsapp background control command is running. Try again shortly." }
    try { & $operation }
    finally { $lock.Dispose() }
}

function Start-Background {
    Invoke-ControlLock {
        $oldState = $null
        if (Test-Path -LiteralPath $statePath) {
            try { $oldState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { }
        }
        if ($oldState -and (Get-VerifiedProcess $oldState.Tunnel)) {
            throw "A previously recorded tunnel supervisor is still running. Use 'Status', 'Logs', or 'Stop' before starting another session."
        }
        if ($oldState -and (Get-VerifiedProcess $oldState.Bridge)) {
            throw "A DeckyWhatsapp background bridge is already running. Use 'Status', 'Logs', or 'Stop' first."
        }
        if (Test-LocalPort $BridgePort) {
            throw "Local port $BridgePort is already occupied. The launcher will leave its owner running; inspect it or stop the session that started it."
        }

        $target = $DeckHost.Trim()
        if (-not $target) {
            Write-Host "Looking for the Steam Deck at $deckName..."
            try {
                Resolve-DnsName $deckName -Type A -ErrorAction Stop | Out-Null
                $target = $deckName
            } catch {
                $target = Read-Host "Enter the Steam Deck IP address or hostname"
            }
        }
        if (-not $target) { throw "No Steam Deck address was provided." }
        if ($target -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$') { throw "Enter a hostname or IPv4 address without spaces." }

        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $bridgeLog = Join-Path $runtimeDir "bridge-$stamp.out.log"
        $bridgeErrorLog = Join-Path $runtimeDir "bridge-$stamp.err.log"
        $tunnelLog = Join-Path $runtimeDir "tunnel-$stamp.out.log"
        $tunnelErrorLog = Join-Path $runtimeDir "tunnel-$stamp.err.log"
        $bridgeArgs = "--import tsx src/server.ts"
        $hadPort = Test-Path Env:PORT
        $previousPort = $env:PORT
        $hadBackgroundFlag = Test-Path Env:DECKY_WHATSAPP_BACKGROUND
        $previousBackgroundFlag = $env:DECKY_WHATSAPP_BACKGROUND
        try {
            $env:PORT = [string]$BridgePort
            $env:DECKY_WHATSAPP_BACKGROUND = "1"
            $bridgeProcess = Start-Process -FilePath $node -ArgumentList $bridgeArgs -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $bridgeLog -RedirectStandardError $bridgeErrorLog
        } finally {
            if ($hadPort) { $env:PORT = $previousPort } else { Remove-Item Env:PORT -ErrorAction SilentlyContinue }
            if ($hadBackgroundFlag) { $env:DECKY_WHATSAPP_BACKGROUND = $previousBackgroundFlag } else { Remove-Item Env:DECKY_WHATSAPP_BACKGROUND -ErrorAction SilentlyContinue }
        }
        $bridgeRecord = Get-ProcessRecord $bridgeProcess $node "src/server.ts"

        $ready = $false
        $expectedSessionId = $null
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Seconds 1
            if (-not (Get-VerifiedProcess $bridgeRecord)) { break }
            try {
                $ownedHealth = Get-BridgeHealthForOwnedProcess $bridgeRecord $BridgePort
                if ($ownedHealth -and $ownedHealth.SessionId -match '^[a-f0-9-]{36}$') {
                    $expectedSessionId = $ownedHealth.SessionId
                    $ready = $true
                    break
                }
            } catch { }
        }
        if (-not $ready) {
            $recoveredHealth = $null
            for ($attempt = 0; $attempt -lt 10 -and (Get-VerifiedProcess $bridgeRecord); $attempt++) {
                try {
                    $candidateHealth = Get-BridgeHealthForOwnedProcess $bridgeRecord $BridgePort
                    if ($candidateHealth -and $candidateHealth.SessionId -match '^[a-f0-9-]{36}$' -and (-not $expectedSessionId -or $candidateHealth.SessionId -eq $expectedSessionId)) {
                        $recoveredHealth = $candidateHealth
                        $expectedSessionId = $candidateHealth.SessionId
                        break
                    }
                } catch { }
                Start-Sleep -Milliseconds 500
            }
            if ($recoveredHealth) {
                try { Write-BridgeShutdown $BridgePort $recoveredHealth.Token $expectedSessionId } catch { }
            }
            for ($attempt = 0; $attempt -lt 10 -and (Get-VerifiedProcess $bridgeRecord); $attempt++) { Start-Sleep -Milliseconds 500 }
            $ownedBridge = Get-VerifiedProcess $bridgeRecord
            if ($ownedBridge) {
                # The authenticated endpoint was unavailable or did not exit. This handle
                # was re-verified by PID, start time, and executable path above.
                try { $ownedBridge.Kill(); $ownedBridge.WaitForExit() } catch { }
            }
            $partialState = [ordered]@{
                Version = 1; StartedAt = (Get-Date).ToString("o"); DeckHost = $target; BridgePort = $BridgePort; ExpectedSessionId = $expectedSessionId
                Bridge = $bridgeRecord; Tunnel = $null; BridgeLog = $bridgeLog; BridgeErrorLog = $bridgeErrorLog
                TunnelLog = $tunnelLog; TunnelErrorLog = $tunnelErrorLog
            }
            $partialState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
            throw "The bridge did not become ready. Its log is at $bridgeLog. No tunnel was started."
        }

        $state = [ordered]@{
            Version = 1; StartedAt = (Get-Date).ToString("o"); DeckHost = $target; BridgePort = $BridgePort; ExpectedSessionId = $expectedSessionId
            Bridge = $bridgeRecord; Tunnel = $null; BridgeLog = $bridgeLog; BridgeErrorLog = $bridgeErrorLog
            TunnelLog = $tunnelLog; TunnelErrorLog = $tunnelErrorLog
        }
        $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8

        $tunnelScript = Join-Path $projectDir "keep-ssh-tunnel.ps1"
        $ps = (Get-Command powershell.exe -ErrorAction Stop).Source
        $tunnelArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$tunnelScript`"", "-DeckUser", $deckUser, "-DeckHost", $target, "-BridgePort", [string]$BridgePort, "-BridgeProcessId", [string]$bridgeRecord.Pid, "-BridgeStartTimeUtcTicks", [string]$bridgeRecord.StartTimeUtcTicks, "-NonInteractive")
        if (Test-Path -LiteralPath $identityFile) { $tunnelArgs += @("-IdentityFile", "`"$identityFile`"") }
        $tunnelProcess = Start-Process -FilePath $ps -ArgumentList $tunnelArgs -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelErrorLog
        $tunnelRecord = Get-ProcessRecord $tunnelProcess $ps "keep-ssh-tunnel.ps1"
        $state.Tunnel = $tunnelRecord
        $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
        Write-Host "Background bridge started for $target on local port $BridgePort."
        Write-Host "Use: .\manage-decky-whatsapp.ps1 Status | Logs | Stop"
        Write-Host "Logs: $bridgeLog and $tunnelLog"
    }
}

function Show-Status {
    if (-not (Test-Path -LiteralPath $statePath)) { Write-Host "No background session is recorded."; return }
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $bridge = Get-VerifiedProcess $state.Bridge
    $tunnel = Get-VerifiedProcess $state.Tunnel
    Write-Host "Deck: $($state.DeckHost)"
    Write-Host "Bridge: $(if ($bridge) { 'running' } else { 'stopped or no longer owned' })"
    Write-Host "Tunnel supervisor: $(if ($tunnel) { 'running (connected or retrying; see log)' } else { 'stopped' })"
    Write-Host "Bridge logs: $($state.BridgeLog) | $($state.BridgeErrorLog)"
    Write-Host "Tunnel logs: $($state.TunnelLog) | $($state.TunnelErrorLog)"
}

function Show-Logs {
    $paths = Get-LogPaths
    if (-not $paths.Count) { Write-Host "No background logs are recorded."; return }
    foreach ($path in $paths) {
        Write-Host "`n===== $path ====="
        if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path -Tail 100 } else { Write-Host "(not created yet)" }
    }
}

function Stop-Background {
    Invoke-ControlLock {
        if (-not (Test-Path -LiteralPath $statePath)) { Write-Host "No background session is recorded."; return }
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        $bridge = Get-VerifiedProcess $state.Bridge
        $tunnel = Get-VerifiedProcess $state.Tunnel
        if ($bridge) {
            try {
                $ownedHealth = Get-BridgeHealthForOwnedProcess $state.Bridge ([int]$state.BridgePort)
                if (-not $ownedHealth) { throw "Bridge process no longer owns its listener." }
                if ($state.ExpectedSessionId -and $ownedHealth.SessionId -ne $state.ExpectedSessionId) { throw "Bridge session changed." }
                $state.ExpectedSessionId = $ownedHealth.SessionId
                $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
                Write-BridgeShutdown ([int]$state.BridgePort) $ownedHealth.Token ([string]$state.ExpectedSessionId)
            } catch {
                throw "Could not request authenticated shutdown of the owned bridge. It was left running. Check the bridge log and try again."
            }
            for ($attempt = 0; $attempt -lt 20 -and (Get-VerifiedProcess $state.Bridge); $attempt++) { Start-Sleep -Milliseconds 500 }
            if (Get-VerifiedProcess $state.Bridge) { throw "The bridge did not exit after its authenticated shutdown request; the tunnel was left under its supervisor." }
        }
        if ($tunnel) {
            for ($attempt = 0; $attempt -lt 20 -and (Get-VerifiedProcess $state.Tunnel); $attempt++) { Start-Sleep -Milliseconds 500 }
            if (Get-VerifiedProcess $state.Tunnel) { throw "The tunnel supervisor has not exited yet; it was left running to clean up its SSH child safely." }
        }
        Write-Host "Background bridge and its supervised tunnel have stopped. Logs remain available with the Logs command."
    }
}

switch ($Action) {
    "Start" { Start-Background }
    "Status" { Show-Status }
    "Logs" { Show-Logs }
    "Stop" { Stop-Background }
}
