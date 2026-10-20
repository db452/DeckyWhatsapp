# Supervises the deliberately started bridge's reverse SSH tunnel and owner diagnostics.
param(
    [Parameter(Mandatory = $true)] [string]$DeckUser,
    [Parameter(Mandatory = $true)] [string]$DeckHost,
    [Parameter(Mandatory = $true)] [int]$BridgePort,
    [int]$BridgeProcessId = 0,
    [long]$BridgeStartTimeUtcTicks = 0,
    [ValidateRange(1, 300)] [int]$RecoveryDelaySeconds = 60,
    [ValidateRange(1, 300)] [int]$RecoveryWindowSeconds = 90,
    [string]$IdentityFile = "",
    [string]$SshExecutable = "ssh.exe",
    [switch]$NonInteractive,
    [string]$SshArgumentsOverrideBase64 = "",
    [string]$DiagnosticProbeOverrideBase64 = ""
)

$remote = "$DeckUser@$DeckHost"
$remoteForward = ("{0}:127.0.0.1:{0}" -f $BridgePort)
$sshArguments = @(
    "-N",
    "-T",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "TCPKeepAlive=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ExitOnForwardFailure=yes",
    "-R", $remoteForward
)

# Hidden background operation must never block on a password or passphrase prompt.
if ($NonInteractive) { $sshArguments = @("-o", "BatchMode=yes") + $sshArguments }

if ($IdentityFile) {
    $sshArguments = @("-i", $IdentityFile, "-o", "IdentitiesOnly=yes") + $sshArguments
}

# Process overrides let local tests substitute mock SSH commands.
if ($SshArgumentsOverrideBase64) {
    $overrideJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($SshArgumentsOverrideBase64))
    $sshArguments = [string[]](ConvertFrom-Json -InputObject $overrideJson)
    $remoteArgument = @()
} else {
    $remoteArgument = @($remote)
}

function ConvertTo-WindowsArgument([string]$Value) {
    if ($Value -notmatch '[\s"]') { return $Value }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes += 1
        } elseif ($character -eq '"') {
            [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
            [void]$builder.Append('"')
            $backslashes = 0
        } else {
            [void]$builder.Append(('\' * $backslashes))
            [void]$builder.Append($character)
            $backslashes = 0
        }
    }
    [void]$builder.Append(('\' * ($backslashes * 2)))
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Test-BridgeProcess {
    if ($BridgeProcessId -gt 0) {
        try {
            $bridgeProcess = Get-Process -Id $BridgeProcessId -ErrorAction Stop
            return $BridgeStartTimeUtcTicks -gt 0 -and $bridgeProcess.StartTime.ToUniversalTime().Ticks -eq $BridgeStartTimeUtcTicks
        } catch { return $false }
    }
    return $true
}

function Capture-BridgeIdentity {
    # The foreground launcher does not have the bridge PID. Capture the process
    # that owns the already-listening local bridge socket so recovery can verify
    # that same process still owns it after waiting for Deck sshd to expire a
    # dead SSH client.
    if ($BridgeProcessId -gt 0) { return }
    try {
        $processIds = @(Get-ListeningProcessIds)
        if ($processIds.Count -ne 1 -or [int]$processIds[0] -le 0) { return }
        $bridgeProcess = Get-Process -Id ([int]$processIds[0]) -ErrorAction Stop
        $script:BridgeProcessId = $bridgeProcess.Id
        $script:BridgeStartTimeUtcTicks = $bridgeProcess.StartTime.ToUniversalTime().Ticks
    } catch { }
}

function Get-ListeningProcessIds {
    # netstat works for unprivileged users where Get-NetTCPConnection may deny
    # access to its system-wide connection table.
    $portSuffix = ":$BridgePort"
    $processIds = @()
    foreach ($line in (& netstat.exe -ano -p tcp 2>$null)) {
        $columns = @($line -split '\s+' | Where-Object { $_ })
        if ($columns.Count -lt 5 -or $columns[0] -ne "TCP") { continue }
        if ($columns[1] -notlike "*$portSuffix" -or $columns[3] -ne "LISTENING") { continue }
        $processId = 0
        if ([int]::TryParse($columns[4], [ref]$processId) -and $processId -gt 0) { $processIds += $processId }
    }
    return @($processIds | Select-Object -Unique)
}

function Test-BridgeListening {
    if (-not (Test-BridgeProcess)) { return $false }
    if ($BridgeProcessId -gt 0) {
        try {
            $processIds = @(Get-ListeningProcessIds)
            if ($processIds -notcontains $BridgeProcessId) { return $false }
        } catch { return $false }
    }
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connect = $client.BeginConnect("127.0.0.1", $BridgePort, $null, $null)
        if (-not $connect.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($connect)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Test-RemoteForwardEstablished([string]$ErrorPath) {
    try {
        if (-not (Test-Path -LiteralPath $ErrorPath)) { return $false }
        $errorText = [System.IO.File]::ReadAllText($ErrorPath)
        $portPattern = [regex]::Escape([string]$BridgePort)
        return $errorText -match ("(?im)remote forward success for:\s*listen\s+(?:[^\s,]+:)?$portPattern\b")
    } catch { return $false }
}

function Stop-OwnedTunnel([System.Diagnostics.Process]$Process) {
    if (-not $Process -or $Process.HasExited) { return }
    Write-Host "The PC bridge is no longer running. Closing this launcher's SSH tunnel."
    $Process.Kill()
    $Process.WaitForExit()
}

function Get-RemotePortOwner {
    # Use a second, batch-mode SSH connection for a read-only HTTP fingerprint.
    # It never sends bridge credentials and is always terminated by this launcher.
    $probePortListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    try {
        $probePortListener.Start()
        $probePort = ([System.Net.IPEndPoint]$probePortListener.LocalEndpoint).Port
    } finally {
        $probePortListener.Stop()
    }

    $probeStdout = Join-Path $env:TEMP ("decky-whatsapp-probe-" + [guid]::NewGuid().ToString("N") + ".out")
    $probeStderr = Join-Path $env:TEMP ("decky-whatsapp-probe-" + [guid]::NewGuid().ToString("N") + ".err")
    $probeProcess = $null
    try {
        if ($DiagnosticProbeOverrideBase64) {
            $probeArguments = [string[]](ConvertFrom-Json -InputObject ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DiagnosticProbeOverrideBase64))))
            $probeArguments = @($probeArguments | ForEach-Object { $_ -replace '\{PORT\}', [string]$probePort })
            $probeRemoteArgument = @()
        } else {
            $probeArguments = @("-N", "-T", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-L", ("127.0.0.1:{0}:127.0.0.1:{1}" -f $probePort, $BridgePort))
            if ($IdentityFile) { $probeArguments = @("-i", $IdentityFile, "-o", "IdentitiesOnly=yes") + $probeArguments }
            $probeRemoteArgument = @($remote)
        }
        $probeCommandLine = (($probeArguments + $probeRemoteArgument) | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join " "
        $probeProcess = Start-Process -FilePath $SshExecutable -ArgumentList $probeCommandLine -PassThru -NoNewWindow -RedirectStandardOutput $probeStdout -RedirectStandardError $probeStderr

        $deadline = [DateTime]::UtcNow.AddSeconds(3)
        $listenerReady = $false
        while ([DateTime]::UtcNow -lt $deadline -and -not $probeProcess.HasExited) {
            $client = New-Object System.Net.Sockets.TcpClient
            try {
                $connect = $client.BeginConnect("127.0.0.1", $probePort, $null, $null)
                if ($connect.AsyncWaitHandle.WaitOne(100)) {
                    $client.EndConnect($connect)
                    $listenerReady = $true
                    break
                }
            } catch { }
            finally { $client.Close() }
            Start-Sleep -Milliseconds 100
        }
        if (-not $listenerReady) { return "unknown" }

        $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$probePort/health")
        $request.Method = "GET"
        $request.Proxy = $null
        $request.AllowAutoRedirect = $false
        $request.Timeout = 2000
        $request.ReadWriteTimeout = 250
        $responseDeadline = [DateTime]::UtcNow.AddSeconds(2)
        $response = $null
        $bodyBuffer = $null
        $asyncResponse = $null
        try {
            $asyncResponse = $request.BeginGetResponse($null, $null)
            $remainingMilliseconds = [int]($responseDeadline - [DateTime]::UtcNow).TotalMilliseconds
            if ($remainingMilliseconds -le 0 -or -not $asyncResponse.AsyncWaitHandle.WaitOne($remainingMilliseconds)) {
                $request.Abort()
                return "unknown"
            }
            try {
                $response = [System.Net.HttpWebResponse]$request.EndGetResponse($asyncResponse)
            } catch [System.Net.WebException] {
                if (-not $_.Exception.Response) { return "unknown" }
                $response = [System.Net.HttpWebResponse]$_.Exception.Response
            }

            if ([int]$response.StatusCode -ne 401) { return "other-http-service" }

            # Only inspect the fixed unauthorized fingerprint. Bound both bytes
            # and wall time so a service cannot hold the launcher with a large
            # or slowly streamed response body.
            $maximumFingerprintBytes = 128
            if ($response.ContentLength -gt $maximumFingerprintBytes) { return "unknown" }
            $responseStream = $response.GetResponseStream()
            $bodyBuffer = New-Object System.IO.MemoryStream
            $chunk = New-Object byte[] 64
            $complete = $false
            while ([DateTime]::UtcNow -lt $responseDeadline) {
                $remainingMilliseconds = [int]($responseDeadline - [DateTime]::UtcNow).TotalMilliseconds
                if ($remainingMilliseconds -le 0) { break }
                $responseStream.ReadTimeout = [Math]::Min(250, $remainingMilliseconds)
                $bytesToRead = [Math]::Min($chunk.Length, ($maximumFingerprintBytes + 1) - [int]$bodyBuffer.Length)
                if ($bytesToRead -le 0) { return "unknown" }
                try {
                    $bytesRead = $responseStream.Read($chunk, 0, $bytesToRead)
                } catch [System.IO.IOException] {
                    return "unknown"
                }
                if ($bytesRead -eq 0) {
                    $complete = $true
                    break
                }
                if (($bodyBuffer.Length + $bytesRead) -gt $maximumFingerprintBytes) { return "unknown" }
                $bodyBuffer.Write($chunk, 0, $bytesRead)
            }
            if (-not $complete) { return "unknown" }
            $body = [System.Text.Encoding]::UTF8.GetString($bodyBuffer.ToArray())
            if ($body -match '^\s*\{\s*"error"\s*:\s*"Bridge authorization required"\s*\}\s*$') { return "decky-whatsapp" }
            return "unknown"
        } finally {
            try { if ($response) { $response.Dispose() } } catch { }
            try { $request.Abort() } catch { }
            try { if ($bodyBuffer) { $bodyBuffer.Dispose() } } catch { }
            try { if ($asyncResponse) { $asyncResponse.AsyncWaitHandle.Close() } } catch { }
        }
    } catch {
        return "unknown"
    } finally {
        try {
            if ($probeProcess -and -not $probeProcess.HasExited) {
                $probeProcess.Kill()
                $probeProcess.WaitForExit()
            }
        } catch { }
        Remove-Item -LiteralPath $probeStdout, $probeStderr -Force -ErrorAction SilentlyContinue
    }
}

Capture-BridgeIdentity
$canSafelyRetryStaleForward = $BridgeProcessId -gt 0 -and $BridgeStartTimeUtcTicks -gt 0
$staleRecoveryAttempted = $false
$staleRecoveryRetryPending = $false
$staleRecoveryForwardEstablished = $false
$staleRecoveryDeadline = [DateTime]::MinValue
$hasAttemptedAuthentication = $NonInteractive.IsPresent

while ($true) {
    if (-not (Test-BridgeListening)) {
        Write-Host "The PC bridge is no longer running. No SSH tunnel was started."
        exit 0
    }

    $stdoutPath = Join-Path $env:TEMP ("decky-whatsapp-ssh-" + [guid]::NewGuid().ToString("N") + ".out")
    $stderrPath = Join-Path $env:TEMP ("decky-whatsapp-ssh-" + [guid]::NewGuid().ToString("N") + ".err")
    $currentSshArguments = $sshArguments
    if ($hasAttemptedAuthentication -and -not $staleRecoveryRetryPending -and -not $SshArgumentsOverrideBase64) {
        $currentSshArguments = @("-o", "BatchMode=yes") + $currentSshArguments
    }
    $isStaleRecoveryRetry = $staleRecoveryRetryPending
    if ($staleRecoveryRetryPending) {
        # Capture OpenSSH's positive bind confirmation without allowing another prompt.
        if (-not $SshArgumentsOverrideBase64) { $currentSshArguments = @("-v", "-o", "BatchMode=yes") + $sshArguments }
        $staleRecoveryRetryPending = $false
    }
    $arguments = (($currentSshArguments + $remoteArgument) | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join " "
    $sshProcess = $null

    try {
        Write-Host "Starting SSH tunnel to $remote..."
        $sshProcess = Start-Process -FilePath $SshExecutable -ArgumentList $arguments -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $hasAttemptedAuthentication = $true

        while (-not $sshProcess.HasExited) {
            if (-not (Test-BridgeListening)) {
                Stop-OwnedTunnel $sshProcess
                if ($isStaleRecoveryRetry -and -not $staleRecoveryForwardEstablished -and (Test-RemoteForwardEstablished $stderrPath)) {
                    $staleRecoveryForwardEstablished = $true
                    Write-Host "OpenSSH confirmed that the remote forward was established. Normal tunnel supervision is active."
                }
                exit 0
            }
            Start-Sleep -Milliseconds 500
        }

        $sshExitCode = $sshProcess.ExitCode
        $sshOutput = @()
        if (Test-Path -LiteralPath $stdoutPath) { $sshOutput += Get-Content -LiteralPath $stdoutPath }
        if (Test-Path -LiteralPath $stderrPath) { $sshOutput += Get-Content -LiteralPath $stderrPath }
        $sshText = $sshOutput -join [Environment]::NewLine

        # Read the redirected stderr after SSH exits so Windows has released the
        # file handle. This signal must appear before an exit is reconnectable.
        if ($isStaleRecoveryRetry -and -not $staleRecoveryForwardEstablished -and (Test-RemoteForwardEstablished $stderrPath)) {
            $staleRecoveryForwardEstablished = $true
            Write-Host "OpenSSH confirmed that the remote forward was established. Normal tunnel supervision is active."
        }

        if ($isStaleRecoveryRetry -and -not $staleRecoveryForwardEstablished) {
            if (-not (Test-BridgeListening)) {
                Write-Host "The PC bridge is no longer running. Closing after the stale-port retry."
                exit 0
            }
            if ($sshText -match '(?i)(permission denied|authentication failed|no more authentication methods|too many authentication failures|passphrase)') {
                if ($sshOutput) { $sshOutput | ForEach-Object { Write-Host $_ } }
                Write-Host "The one-time stale-port retry could not authenticate without prompting. Password-only SSH or a key that requires an unavailable passphrase cannot recover automatically. Confirm SSH authentication, then manually restart the launcher."
                Write-Host "The launcher is stopping without prompting or retrying again. It will not stop remote processes."
                exit 1
            } elseif ($sshText -match '(?i)(administratively prohibited|remote forwarding.*disabled)') {
                if ($sshOutput) { $sshOutput | ForEach-Object { Write-Host $_ } }
                Write-Host "The SSH server denied remote forwarding by policy. Ask the Deck administrator to allow forwarding; no automatic retry was made."
                exit 1
            } elseif ([DateTime]::UtcNow -lt $staleRecoveryDeadline) {
                Write-Host "OpenSSH did not confirm the remote forward yet. Retrying in 5 seconds within the bounded stale-port recovery window."
                Start-Sleep -Seconds 5
                $staleRecoveryRetryPending = $true
                continue
            } else {
                if ($sshOutput) { $sshOutput | ForEach-Object { Write-Host $_ } }
                Write-Host "The one-time non-interactive stale-port retry ended with SSH exit code $($sshExitCode). The port may still be occupied, or SSH may have a transport, host-key, or other connection error. Review the SSH output, confirm the Deck keepalive setting and connection, then restart the launcher manually."
            }
            Write-Host "The launcher is stopping without prompting or retrying again. It will not stop remote processes."
            exit 1
        }

        if ($isStaleRecoveryRetry -and $staleRecoveryForwardEstablished) {
            $sshOutput = @($sshOutput | Where-Object { $_ -notmatch '^\s*debug1:' })
        }

        if ($sshExitCode -ne 0 -and $sshText -match '(?i)(permission denied|authentication failed|no more authentication methods|too many authentication failures|passphrase)') {
            if ($sshOutput) { $sshOutput | ForEach-Object { Write-Host $_ } }
            Write-Host "SSH authentication failed during an automatic reconnect. BatchMode will not prompt for a password or unavailable key passphrase; confirm SSH authentication, then restart the launcher manually."
            if (-not $NonInteractive) { Read-Host "Press Enter to close this window" }
            exit 1
        }

        if ($sshExitCode -ne 0 -and $sshText -match '(?i)(remote port forwarding failed|cannot listen to port|address already in use|administratively prohibited)') {
            if ($sshOutput) { $sshOutput | ForEach-Object { Write-Host $_ } }
            Write-Host "SSH could not establish remote forwarding on port $BridgePort."
            if ($sshText -match '(?i)administratively prohibited') {
                Write-Host "The SSH server reported that remote forwarding is restricted. Ask the Deck administrator to allow remote forwarding."
            } else {
                $owner = Get-RemotePortOwner
                if ($owner -eq "decky-whatsapp") {
                    Write-Host "A DeckyWhatsapp bridge is responding on remote port $BridgePort. Another DeckyWhatsapp session appears to be connected to this Steam Deck. Close the existing connection before starting another."
                } elseif ($owner -eq "other-http-service") {
                    Write-Host "An HTTP service that does not identify as DeckyWhatsapp is responding on remote port $BridgePort."
                } else {
                    Write-Host "The port may be held by an unresponsive or stale tunnel, a non-HTTP service, or SSH forwarding may be restricted. The owner could not be identified safely."
                    if (-not $staleRecoveryAttempted -and $canSafelyRetryStaleForward) {
                        $staleRecoveryDeadline = [DateTime]::UtcNow.AddSeconds($RecoveryWindowSeconds)
                        Write-Host "Waiting up to $RecoveryDelaySeconds seconds for the Deck SSH server to expire an unresponsive client. No remote process will be stopped."
                        $recoveryDeadline = [DateTime]::UtcNow.AddSeconds($RecoveryDelaySeconds)
                        while ([DateTime]::UtcNow -lt $recoveryDeadline) {
                            if (-not (Test-BridgeListening)) {
                                Write-Host "The same local bridge process is no longer listening. Stopping without retrying the remote forward."
                                exit 0
                            }
                            $remainingMilliseconds = [int]($recoveryDeadline - [DateTime]::UtcNow).TotalMilliseconds
                            if ($remainingMilliseconds -gt 0) { Start-Sleep -Milliseconds ([Math]::Min(250, $remainingMilliseconds)) }
                        }
                        if (-not (Test-BridgeListening)) {
                            Write-Host "The same local bridge process is no longer listening. Stopping without retrying the remote forward."
                            exit 0
                        }
                        $staleRecoveryAttempted = $true
                        $staleRecoveryRetryPending = $true
                        Write-Host "The same local bridge process is still active; starting non-interactive SSH retries within the bounded recovery window."
                        continue
                    }
                    if (-not $canSafelyRetryStaleForward) {
                        Write-Host "Automatic stale-port recovery is unavailable because this launcher could not verify the local bridge process identity."
                    } elseif ($staleRecoveryAttempted) {
                        Write-Host "The single stale-tunnel recovery attempt did not clear the port. Confirm the Deck sshd keepalive setting is active, then stop and restart the launcher."
                    }
                }
            }
            Write-Host "This launcher will not stop remote processes. Check the port owner or SSH forwarding policy, then try again."
            if (-not $NonInteractive) { Read-Host "Press Enter to close this window" }
            exit 1
        }

        if ($sshOutput) { $sshOutput | ForEach-Object { Write-Host $_ } }
        if (-not (Test-BridgeListening)) {
            Write-Host "The PC bridge is no longer running. Closing the SSH tunnel."
            exit 0
        }

        if ($staleRecoveryForwardEstablished) {
            # A confirmed recovered connection earns a new bounded recovery
            # allowance if a later suspend leaves another stale remote forward.
            $staleRecoveryAttempted = $false
            $staleRecoveryForwardEstablished = $false
        }

        Write-Host "SSH tunnel disconnected. Retrying in 3 seconds..."
        Start-Sleep -Seconds 3
    } finally {
        if ($sshProcess -and -not $sshProcess.HasExited) { Stop-OwnedTunnel $sshProcess }
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}
