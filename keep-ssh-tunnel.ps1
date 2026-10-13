param(
    [Parameter(Mandatory = $true)] [string]$DeckUser,
    [Parameter(Mandatory = $true)] [string]$DeckHost,
    [Parameter(Mandatory = $true)] [int]$BridgePort,
    [string]$IdentityFile = ""
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

while ($true) {
    $bridge = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue
    if (-not $bridge) {
        Write-Host "The PC bridge is no longer running. Closing the SSH tunnel."
        exit 0
    }

    Write-Host "Starting SSH tunnel to $remote..."
    & ssh @sshArguments $remote

    $bridge = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue
    if (-not $bridge) {
        Write-Host "The PC bridge is no longer running. Closing the SSH tunnel."
        exit 0
    }

    Write-Host "SSH tunnel disconnected. Retrying in 3 seconds..."
    Start-Sleep -Seconds 3
}
