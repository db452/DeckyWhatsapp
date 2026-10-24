[CmdletBinding()]
param(
    [switch]$SkipNodeInstall,
    [switch]$InstallDeckKey,
    [switch]$SkipShortcuts
)

$ErrorActionPreference = "Stop"

$installerDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$adjacentLauncher = Join-Path $installerDirectory "start-decky-whatsapp.bat"
$projectRoot = if (Test-Path -LiteralPath $adjacentLauncher -PathType Leaf) { $installerDirectory } else { Split-Path -Parent $installerDirectory }
$launcher = Join-Path $projectRoot "start-decky-whatsapp.bat"
$launcherIcon = Join-Path $projectRoot "assets\decky-whatsapp.ico"
$sshDirectory = Join-Path $env:USERPROFILE ".ssh"
$sshKey = Join-Path $sshDirectory "decky_whatsapp_ed25519"
$sshPublicKey = "$sshKey.pub"

function Test-CommandAvailable {
    param([Parameter(Mandatory)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Add-NodeToCurrentPath {
    $nodeDirectory = Join-Path $env:ProgramFiles "nodejs"
    if ((Test-Path -LiteralPath $nodeDirectory) -and ($env:Path -notlike "*$nodeDirectory*")) {
        $env:Path = "$nodeDirectory;$env:Path"
    }
}

function Add-GitToCurrentPath {
    foreach ($gitDirectory in @(
        (Join-Path $env:ProgramFiles "Git\cmd"),
        (Join-Path $env:LOCALAPPDATA "Programs\Git\cmd")
    )) {
        if ((Test-Path -LiteralPath $gitDirectory) -and ($env:Path -notlike "*$gitDirectory*")) {
            $env:Path = "$gitDirectory;$env:Path"
        }
    }
}

if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "Could not find start-decky-whatsapp.bat at $launcher"
}
if (-not $SkipShortcuts -and -not (Test-Path -LiteralPath $launcherIcon -PathType Leaf)) {
    throw "Could not find the Decky WhatsApp launcher icon at $launcherIcon"
}

Write-Host "Checking Windows prerequisites..."

Add-NodeToCurrentPath
if (-not (Test-CommandAvailable "node") -or -not (Test-CommandAvailable "npm.cmd")) {
    if ($SkipNodeInstall) {
        throw "Node.js and npm are required. Re-run without -SkipNodeInstall or install Node.js manually."
    }

    if (-not (Test-CommandAvailable "winget.exe")) {
        throw "Node.js is missing and winget is unavailable. Install Node.js LTS manually, then run this script again."
    }

    Write-Host "Installing Node.js LTS with winget..."
    & winget.exe install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget could not install Node.js LTS."
    }
    Add-NodeToCurrentPath
}

if (-not (Test-CommandAvailable "node") -or -not (Test-CommandAvailable "npm.cmd")) {
    throw "Node.js or npm is still unavailable. Restart PowerShell after installing Node.js and run this script again."
}

if (-not (Test-CommandAvailable "ssh.exe") -or -not (Test-CommandAvailable "ssh-keygen.exe")) {
    throw "Windows OpenSSH client is required. Install it through Optional Features, then run this script again."
}

Add-GitToCurrentPath
if (-not (Test-CommandAvailable "git.exe")) {
    if (-not (Test-CommandAvailable "winget.exe")) {
        throw "Git is required by the pinned WhatsApp Web dependency. Install Git for Windows, then run this script again."
    }
    Write-Host "Installing Git for Windows with winget..."
    & winget.exe install --id Git.Git --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget could not install Git for Windows."
    }
    Add-GitToCurrentPath
    if (-not (Test-CommandAvailable "git.exe")) {
        throw "Git is still unavailable. Restart PowerShell and run this script again."
    }
}

Write-Host "Installing PC bridge dependencies..."
Push-Location $projectRoot
try {
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed in $projectRoot"
    }
}
finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $sshDirectory | Out-Null
if (-not (Test-Path -LiteralPath $sshKey -PathType Leaf)) {
    Write-Host "Creating the SSH key used by the launcher..."
    # Windows PowerShell 5.1 drops a native command's empty string argument.
    & ssh-keygen.exe -t ed25519 -f $sshKey -N '""' -C "decky-whatsapp"
    if ($LASTEXITCODE -ne 0) {
        throw "ssh-keygen could not create the Decky WhatsApp key."
    }
}

if ($InstallDeckKey) {
    $suggestedHost = ""
    $suggestionScript = Join-Path $projectRoot "scripts\suggest-deck-host.mjs"
    $promptHelper = Join-Path $projectRoot "scripts\deck-host-prompt.ps1"
    if (Test-Path -LiteralPath $suggestionScript -PathType Leaf) {
        try {
            $suggestionOutput = @(& node.exe $suggestionScript 2>$null)
            if ($LASTEXITCODE -eq 0 -and $suggestionOutput.Count -gt 0) {
                $suggestedHost = ([string]$suggestionOutput[0]).Trim()
            }
        }
        catch {
            $suggestedHost = ""
        }
    }

    if (-not (Test-Path -LiteralPath $promptHelper -PathType Leaf)) {
        throw "Could not find the Deck address prompt helper at $promptHelper"
    }
    . $promptHelper
    $deckHost = Get-DeckHostPromptResult -SuggestedHost $suggestedHost -ReadInput { param($prompt) Read-Host $prompt }
    if ([string]::IsNullOrWhiteSpace($deckHost)) {
        throw "A Steam Deck hostname or IP is required when -InstallDeckKey is used."
    }

    Write-Host "Installing the public key on $deckHost. The Deck password may be requested once."
    $publicKey = (Get-Content -LiteralPath $sshPublicKey -Raw).Trim()
    $remoteCommand = "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF '$publicKey' ~/.ssh/authorized_keys || printf '%s`n' '$publicKey' >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys"
    & ssh.exe "deck@$deckHost" $remoteCommand
    if ($LASTEXITCODE -ne 0) {
        throw "The SSH public key could not be installed on the Deck."
    }
}

if (-not $SkipShortcuts) {
    $shortcutLocations = @(
        (Join-Path ([Environment]::GetFolderPath("Desktop")) "Decky WhatsApp.lnk"),
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Decky WhatsApp.lnk")
    )
    $shell = New-Object -ComObject WScript.Shell
    foreach ($shortcutPath in $shortcutLocations) {
        $shortcutDirectory = Split-Path -Parent $shortcutPath
        New-Item -ItemType Directory -Force -Path $shortcutDirectory | Out-Null
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = Join-Path $env:WINDIR "System32\cmd.exe"
        $shortcut.Arguments = "/c `"$launcher`""
        $shortcut.WorkingDirectory = $projectRoot
        $shortcut.Description = "Start the Decky WhatsApp bridge and SSH tunnel"
        $shortcut.IconLocation = "$launcherIcon,0"
        $shortcut.Save()
    }

    $projectFolderShortcut = Join-Path $projectRoot "Decky WhatsApp.lnk"
    if (-not (Test-Path -LiteralPath $projectFolderShortcut)) {
        $shortcut = $shell.CreateShortcut($projectFolderShortcut)
        $shortcut.TargetPath = Join-Path $env:WINDIR "System32\cmd.exe"
        $shortcut.Arguments = "/c `"$launcher`""
        $shortcut.WorkingDirectory = $projectRoot
        $shortcut.Description = "Start the Decky WhatsApp bridge and SSH tunnel"
        $shortcut.IconLocation = "$launcherIcon,0"
        $shortcut.Save()
    }
}

Write-Host ""
Write-Host "Decky WhatsApp Windows setup is complete."
Write-Host "Project: $projectRoot"
Write-Host "SSH key: $sshKey"
if (-not $InstallDeckKey) {
    Write-Host "To install the public key on the Deck later, rerun with -InstallDeckKey."
}
Write-Host "Start the system with: $launcher"
