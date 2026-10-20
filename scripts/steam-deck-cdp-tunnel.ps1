[CmdletBinding()]
param(
    [ValidateSet("Start", "Status", "Stop")]
    [string]$Action = "Status",

    [ValidateNotNullOrEmpty()]
    [string]$DeckHost = "192.168.1.196",

    [ValidateNotNullOrEmpty()]
    [string]$DeckUser = "deck"
)

$ErrorActionPreference = "Stop"
$LocalAddress = "127.0.0.1"
$LocalPort = 9222
$RemoteAddress = "127.0.0.1"
$RemotePort = 8081
$StateDirectory = Join-Path $env:LOCALAPPDATA "DeckyWhatsapp"
$StatePath = Join-Path $StateDirectory "steam-deck-cdp-tunnel.json"

function Get-CdpTargets {
    param([int]$TimeoutSeconds = 2)

    try {
        $response = Invoke-RestMethod -Uri "http://${LocalAddress}:${LocalPort}/json/list" -Method Get -TimeoutSec $TimeoutSeconds -UseBasicParsing
        return @($response)
    }
    catch {
        return @()
    }
}

function Get-SteamUiTargets {
    param([object[]]$Targets)

    return @($Targets | Where-Object {
        $_.type -eq "page" -and [string]$_.title -match "QuickAccess|MainMenu|Big Picture|Screensaver|notificationtoasts|Steam"
    })
}

function Test-SteamUiTargets {
    param([object[]]$Targets)

    return (@(Get-SteamUiTargets -Targets $Targets).Count -gt 0)
}

function Write-TargetSummary {
    param([object[]]$Targets)

    Write-Output "SteamUI CDP endpoint is available. Target metadata:"
    foreach ($target in $Targets) {
        $safeId = [string]$target.id
        $safeTitle = [string]$target.title
        $safeType = [string]$target.type
        Write-Output ("  {0} | {1} | {2}" -f $safeType, $safeTitle, $safeId)
    }
}

function Test-LocalPortOccupied {
    try {
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
        $matchingListeners = @($listeners | Where-Object { [int]$_.LocalPort -eq $LocalPort })
        return ($matchingListeners.Count -gt 0)
    }
    catch {
        throw "Unable to verify whether local port $LocalPort is occupied. Refusing to start or remove tunnel state; no process or metadata was changed."
    }
}

function Get-StateRecord {
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
        return $null
    }
    try {
        return (Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json)
    }
    catch {
        throw "Tunnel state metadata is unreadable at '$StatePath'. Inspect or remove that file manually; no process was changed."
    }
}

function Get-ValidatedOwnedProcess {
    param([object]$Record)

    if ($null -eq $Record -or -not $Record.Pid -or -not $Record.CommandLine -or -not $Record.ExecutablePath) {
        return $null
    }
    if ($null -eq (Get-RecordStartUtcTicks -Record $Record)) {
        return $null
    }

    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Record.Pid)" -ErrorAction SilentlyContinue
    if ($null -eq $processInfo) {
        return $null
    }

    $expectedForward = "${LocalAddress}:${LocalPort}:${RemoteAddress}:${RemotePort}"
    $expectedDestination = "$($Record.DeckUser)@$($Record.DeckHost)"
    $savedSignature = [string]$Record.CommandLine
    $actualCommand = [string]$processInfo.CommandLine
    if ($savedSignature.IndexOf($expectedForward, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $savedSignature.IndexOf($expectedDestination, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $savedSignature.IndexOf("-N", [StringComparison]::Ordinal) -lt 0 -or
        $savedSignature.IndexOf("BatchMode=yes", [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $savedSignature.IndexOf("ExitOnForwardFailure=yes", [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        [string]$processInfo.ExecutablePath -ine [string]$Record.ExecutablePath -or
        [System.IO.Path]::GetFileName([string]$processInfo.ExecutablePath) -ine "ssh.exe" -or
        $actualCommand.IndexOf($expectedForward, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $actualCommand.IndexOf($expectedDestination, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $actualCommand.IndexOf("-N", [StringComparison]::Ordinal) -lt 0 -or
        $actualCommand.IndexOf("BatchMode=yes", [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $actualCommand.IndexOf("ExitOnForwardFailure=yes", [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        return $null
    }

    $actualStartUtcTicks = Get-ProcessCreationUtcTicks -CreationDate $processInfo.CreationDate
    $recordStartUtcTicks = Get-RecordStartUtcTicks -Record $Record
    if ($null -eq $actualStartUtcTicks -or $null -eq $recordStartUtcTicks) {
        return $null
    }
    if ([Math]::Abs([double]($actualStartUtcTicks - $recordStartUtcTicks)) -gt ([TimeSpan]::TicksPerSecond * 2)) {
        return $null
    }

    return $processInfo
}

function Get-ProcessCreationUtcTicks {
    param([object]$CreationDate)

    if ($CreationDate -is [DateTime]) {
        return [long]$CreationDate.ToUniversalTime().Ticks
    }
    if ($CreationDate -is [string] -and $CreationDate -match '^\d{14}\.\d{6}[+-]\d{3}$') {
        return [long][System.Management.ManagementDateTimeConverter]::ToDateTime($CreationDate).ToUniversalTime().Ticks
    }
    return $null
}

function Get-RecordStartUtcTicks {
    param([object]$Record)

    if ($null -ne $Record.StartTimeUtcTicks) {
        return [long]$Record.StartTimeUtcTicks
    }
    if ($null -eq $Record.StartTimeUtc) {
        return $null
    }
    if ($Record.StartTimeUtc -is [DateTime]) {
        return [long]$Record.StartTimeUtc.ToUniversalTime().Ticks
    }
    if ($Record.StartTimeUtc -is [string]) {
        try {
            $parsed = [DateTime]::Parse(
                $Record.StartTimeUtc,
                [System.Globalization.CultureInfo]::InvariantCulture,
                [System.Globalization.DateTimeStyles]::RoundtripKind
            )
            return [long]$parsed.ToUniversalTime().Ticks
        }
        catch {
            return $null
        }
    }
    return $null
}

function Assert-ValidStateRecord {
    param([object]$Record)

    $recordPid = 0
    $recordLocalPort = 0
    $recordRemotePort = 0
    $requiredStrings = @("CommandLine", "ExecutablePath", "DeckHost", "DeckUser")
    if ($Record -isnot [System.Management.Automation.PSCustomObject] -or
        $null -eq $Record.Pid -or
        -not [int]::TryParse([string]$Record.Pid, [ref]$recordPid) -or
        $recordPid -le 0 -or
        $null -eq (Get-RecordStartUtcTicks -Record $Record) -or
        (Get-RecordStartUtcTicks -Record $Record) -le 0 -or
        [string]$Record.LocalAddress -ne $LocalAddress -or
        -not [int]::TryParse([string]$Record.LocalPort, [ref]$recordLocalPort) -or
        $recordLocalPort -ne $LocalPort -or
        [string]$Record.RemoteAddress -ne $RemoteAddress -or
        -not [int]::TryParse([string]$Record.RemotePort, [ref]$recordRemotePort) -or
        $recordRemotePort -ne $RemotePort) {
        throw "Tunnel state metadata is malformed at '$StatePath'. Inspect it manually; no process or metadata was changed."
    }
    foreach ($propertyName in $requiredStrings) {
        $property = $Record.PSObject.Properties[$propertyName]
        if ($null -eq $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
            throw "Tunnel state metadata is malformed at '$StatePath'. Inspect it manually; no process or metadata was changed."
        }
    }

    $expectedForward = "${LocalAddress}:${LocalPort}:${RemoteAddress}:${RemotePort}"
    $expectedDestination = "$($Record.DeckUser)@$($Record.DeckHost)"
    $savedCommand = [string]$Record.CommandLine
    if ([System.IO.Path]::GetFileName([string]$Record.ExecutablePath) -ine "ssh.exe" -or
        $savedCommand.IndexOf($expectedForward, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $savedCommand.IndexOf($expectedDestination, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $savedCommand.IndexOf("-N", [StringComparison]::Ordinal) -lt 0 -or
        $savedCommand.IndexOf("BatchMode=yes", [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $savedCommand.IndexOf("ExitOnForwardFailure=yes", [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Tunnel state metadata is malformed at '$StatePath'. Inspect it manually; no process or metadata was changed."
    }
}

function Test-RecordedProcessInstance {
    param(
        [object]$ProcessInfo,
        [object]$Record
    )

    if ($null -eq $ProcessInfo) {
        return $false
    }
    $creationTicks = Get-ProcessCreationUtcTicks -CreationDate $ProcessInfo.CreationDate
    $recordTicks = Get-RecordStartUtcTicks -Record $Record
    if ($null -eq $creationTicks -or $null -eq $recordTicks) {
        return $false
    }
    return ([Math]::Abs([double]($creationTicks - $recordTicks)) -le ([TimeSpan]::TicksPerSecond * 2))
}

function Wait-ForRecordedProcessExit {
    param(
        [object]$Record,
        [int]$TimeoutSeconds = 5
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Record.Pid)" -ErrorAction Stop
        if ($null -eq $processInfo -or -not (Test-RecordedProcessInstance -ProcessInfo $processInfo -Record $Record)) {
            return $true
        }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Remove-StateFile {
    if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
        Remove-Item -LiteralPath $StatePath -Force
    }
}

function Invoke-Start {
    # Reuse a working SteamUI endpoint without starting or recording another SSH process.
    $existingTargets = @(Get-CdpTargets)
    if ($existingTargets.Count -gt 0) {
        $steamTargets = @(Get-SteamUiTargets -Targets $existingTargets)
        if ($steamTargets.Count -gt 0) {
            Write-TargetSummary -Targets $steamTargets
            Write-Output "Reusing the existing local endpoint; no SSH process was started."
            return
        }
        throw "Port $LocalPort already serves a CDP endpoint, but it did not contain recognizable SteamUI targets. Refusing to take over the port."
    }

    if (Test-LocalPortOccupied) {
        throw "Local port $LocalPort is occupied but did not return recognizable SteamUI CDP targets. Refusing to take over the port."
    }

    $priorRecord = Get-StateRecord
    if ($null -ne $priorRecord) {
        Assert-ValidStateRecord -Record $priorRecord
        $recordPid = [int]$priorRecord.Pid
        try {
            $recordedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $recordPid" -ErrorAction Stop
        }
        catch {
            throw "Unable to determine whether recorded PID $recordPid exists. Inspect '$StatePath' manually; no process or metadata was changed."
        }

        if ($null -ne $recordedProcess) {
            if ($null -ne (Get-ValidatedOwnedProcess -Record $priorRecord)) {
                throw "A tunnel process is already recorded and running (PID $($priorRecord.Pid)), but its CDP endpoint is not ready. Use Status to inspect it; refusing to launch a second tunnel."
            }
            throw "Recorded PID $recordPid exists, but its process identity cannot be validated. Inspect '$StatePath' manually; no process or metadata was changed."
        }

        # Remove only an intact record whose PID lookup succeeded and found no
        # process, after rechecking that the configured forwarding port is free.
        if (Test-LocalPortOccupied) {
            throw "Tunnel PID $recordPid is absent, but local port $LocalPort is occupied. Inspect '$StatePath' manually; no process or metadata was changed."
        }
        Remove-StateFile
    }

    $sshCommand = Get-Command ssh.exe -ErrorAction Stop
    $sshPath = [System.IO.Path]::GetFullPath($sshCommand.Source)
    $destination = "$DeckUser@$DeckHost"
    $forward = "${LocalAddress}:${LocalPort}:${RemoteAddress}:${RemotePort}"

    # Check noninteractive SSH reachability first so a hidden tunnel failure has a useful reason.
    $sshProbeOutput = @(& $sshPath -o BatchMode=yes -o ConnectTimeout=5 $destination "exit" 2>&1)
    if ($LASTEXITCODE -ne 0) {
        $safeDiagnostic = ($sshProbeOutput | ForEach-Object { [string]$_ }) -join "`n"
        if ([string]::IsNullOrWhiteSpace($safeDiagnostic)) {
            $safeDiagnostic = "SSH exited with code $LASTEXITCODE and provided no diagnostic."
        }
        throw "SSH connectivity check failed for $destination. No tunnel was started. Diagnostic: $safeDiagnostic"
    }

    $arguments = @(
        "-N",
        "-o", "BatchMode=yes",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "ServerAliveInterval=30",
        "-o", "ServerAliveCountMax=3",
        "-L", $forward,
        $destination
    )

    if (-not (Test-Path -LiteralPath $StateDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
    }

    $startedProcess = $null
    $record = $null
    $stateWritten = $false
    try {
        $startedProcess = Start-Process -FilePath $sshPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
        $record = [ordered]@{
            Pid = $startedProcess.Id
            StartTimeUtc = $startedProcess.StartTime.ToUniversalTime().ToString("o")
            StartTimeUtcTicks = $startedProcess.StartTime.ToUniversalTime().Ticks
            ExecutablePath = $sshPath
            CommandLine = "ssh.exe -N -o BatchMode=yes -o ExitOnForwardFailure=yes -L $forward $destination"
            DeckHost = $DeckHost
            DeckUser = $DeckUser
            LocalAddress = $LocalAddress
            LocalPort = $LocalPort
            RemoteAddress = $RemoteAddress
            RemotePort = $RemotePort
        }
        $record | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
        $stateWritten = $true

        Start-Sleep -Milliseconds 300
        $startedProcess.Refresh()
        if ($startedProcess.HasExited) {
            throw "SSH exited before the tunnel became available. Check the configured host and existing SSH credentials."
        }

        $deadline = (Get-Date).AddSeconds(15)
        do {
            $startedProcess.Refresh()
            if ($startedProcess.HasExited) {
                throw "SSH exited while establishing the tunnel. Check host connectivity and the existing SSH configuration."
            }
            $targets = @(Get-CdpTargets -TimeoutSeconds 2)
            $steamTargets = @(Get-SteamUiTargets -Targets $targets)
            if ($steamTargets.Count -gt 0) {
                Write-TargetSummary -Targets $steamTargets
                Write-Output ("Started SSH tunnel; owned process ID {0}." -f $startedProcess.Id)
                return
            }
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $deadline)

        throw "Tunnel process stayed alive, but the local endpoint did not return recognizable SteamUI targets within 15 seconds."
    }
    catch {
        $startupError = $_.Exception.Message
        if ($null -ne $startedProcess) {
            try {
                $startedProcess.Refresh()
                if ($startedProcess.HasExited) {
                    if ($stateWritten) {
                        Remove-StateFile
                        $stateWritten = $false
                    }
                }
                else {
                    if (-not $stateWritten -and $null -ne $record) {
                        $record | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
                        $stateWritten = $true
                    }

                    $owned = if ($null -ne $record) { Get-ValidatedOwnedProcess -Record $record } else { $null }
                    if ($null -eq $owned) {
                        throw "The launched process identity could not be verified. Its state record was retained; no process was stopped."
                    }

                    Stop-Process -Id $startedProcess.Id -Force
                    [void]$startedProcess.WaitForExit(5000)
                    $startedProcess.Refresh()
                    if (-not $startedProcess.HasExited) {
                        throw "The launched SSH process did not exit after the cleanup request. Its state record was retained."
                    }
                    if ($stateWritten) {
                        Remove-StateFile
                        $stateWritten = $false
                    }
                }
            }
            catch {
                $metadataStatus = if ($stateWritten) {
                    "Ownership metadata was retained at '$StatePath'."
                }
                else {
                    "Ownership metadata could not be saved at '$StatePath'."
                }
                throw "Startup failed: $startupError Cleanup failed: $($_.Exception.Message) $metadataStatus"
            }
        }
        throw
    }
}

function Invoke-Status {
    $targets = @(Get-CdpTargets)
    if ($targets.Count -gt 0) {
        $steamTargets = @(Get-SteamUiTargets -Targets $targets)
        if ($steamTargets.Count -gt 0) {
            Write-TargetSummary -Targets $steamTargets
            $record = Get-StateRecord
            if ($null -ne $record -and $null -ne (Get-ValidatedOwnedProcess -Record $record)) {
                Write-Output ("Owned tunnel process is running (PID {0})." -f $record.Pid)
            }
            else {
                Write-Output "The endpoint is available, but it is not confirmed as owned by this script."
            }
            return
        }
        throw "Port $LocalPort returned a CDP list without recognizable SteamUI targets."
    }

    if (Test-LocalPortOccupied) {
        throw "Local port $LocalPort is occupied, but its endpoint is unavailable or is not CDP."
    }
    Write-Output "No CDP endpoint is available at http://${LocalAddress}:${LocalPort}; no tunnel is running there."
}

function Invoke-Stop {
    $record = Get-StateRecord
    if ($null -eq $record) {
        Write-Output "No recorded tunnel process belongs to this script; no process was stopped."
        return
    }

    $owned = Get-ValidatedOwnedProcess -Record $record
    if ($null -eq $owned) {
        throw "The recorded PID is absent or no longer matches the saved process identity. No process was stopped; inspect '$StatePath' manually."
    }

    Stop-Process -Id ([int]$record.Pid) -Force
    if (-not (Wait-ForRecordedProcessExit -Record $record)) {
        throw "The recorded SSH process did not exit after the stop request. Its ownership metadata was retained at '$StatePath'."
    }
    Remove-StateFile
    Write-Output ("Stopped the recorded SSH tunnel process (PID {0})." -f $record.Pid)
}

switch ($Action) {
    "Start" { Invoke-Start }
    "Status" { Invoke-Status }
    "Stop" { Invoke-Stop }
}
