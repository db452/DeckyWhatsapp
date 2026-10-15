# Supervises the deliberately started bridge's reverse SSH tunnel and owner diagnostics.
param(
    [Parameter(Mandatory = $true)] [string]$DeckUser,
    [Parameter(Mandatory = $true)] [string]$DeckHost,
    [Parameter(Mandatory = $true)] [int]$BridgePort,
    [string]$IdentityFile = "",
    [string]$SshExecutable = "ssh.exe",
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
    "-o", "ExitOnForwardFailure=yes",
    "-R", $remoteForward
)

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

function Test-BridgeListening {
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

while ($true) {
    if (-not (Test-BridgeListening)) {
        Write-Host "The PC bridge is no longer running. No SSH tunnel was started."
        exit 0
    }

    $stdoutPath = Join-Path $env:TEMP ("decky-whatsapp-ssh-" + [guid]::NewGuid().ToString("N") + ".out")
    $stderrPath = Join-Path $env:TEMP ("decky-whatsapp-ssh-" + [guid]::NewGuid().ToString("N") + ".err")
    $arguments = (($sshArguments + $remoteArgument) | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join " "
    $sshProcess = $null

    try {
        Write-Host "Starting SSH tunnel to $remote..."
        $sshProcess = Start-Process -FilePath $SshExecutable -ArgumentList $arguments -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

        while (-not $sshProcess.HasExited) {
            if (-not (Test-BridgeListening)) {
                Stop-OwnedTunnel $sshProcess
                exit 0
            }
            Start-Sleep -Milliseconds 500
        }

        $sshExitCode = $sshProcess.ExitCode
        $sshOutput = @()
        if (Test-Path -LiteralPath $stdoutPath) { $sshOutput += Get-Content -LiteralPath $stdoutPath }
        if (Test-Path -LiteralPath $stderrPath) { $sshOutput += Get-Content -LiteralPath $stderrPath }
        $sshText = $sshOutput -join [Environment]::NewLine

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
                }
            }
            Write-Host "This launcher will not stop remote processes. Check the port owner or SSH forwarding policy, then try again."
            Read-Host "Press Enter to close this window"
            exit 1
        }

        if ($sshOutput) { $sshOutput | ForEach-Object { Write-Host $_ } }
        if (-not (Test-BridgeListening)) {
            Write-Host "The PC bridge is no longer running. Closing the SSH tunnel."
            exit 0
        }

        Write-Host "SSH tunnel disconnected. Retrying in 3 seconds..."
        Start-Sleep -Seconds 3
    } finally {
        if ($sshProcess -and -not $sshProcess.HasExited) { Stop-OwnedTunnel $sshProcess }
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}
