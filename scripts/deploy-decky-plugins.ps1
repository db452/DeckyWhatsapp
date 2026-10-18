$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'invoke-bounded-process.ps1')

$RemoteCommandTimeoutSeconds = 120

function Stop-Deploy([string] $Message) {
    throw $Message
}

function Invoke-Checked([string] $File, [string[]] $Arguments, [string] $Description) {
    if ($File -ieq 'ssh.exe' -or $File -ieq 'scp.exe') {
        $null = Invoke-BoundedProcess $File $Arguments $Description $RemoteCommandTimeoutSeconds $script:remoteStage
        return
    }
    Write-Host "$Description..."
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { Stop-Deploy "$Description failed with exit code $LASTEXITCODE." }
    Write-Host "$Description complete."
}

function Get-Identity([string] $Root, [string] $Label) {
    $manifestPath = Join-Path $Root 'plugin.json'
    $packagePath = Join-Path $Root 'package.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        Stop-Deploy "$Label artifact is missing plugin.json or package.json."
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    return [pscustomobject]@{ Manifest = $manifest; Package = $package }
}

function Assert-Artifact([string] $Root, [string] $Label, [string] $Name, [string] $AppKey, [string] $PackageName) {
    if ((Get-Item -LiteralPath $Root).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Stop-Deploy "$Label artifact root must not be a symlink or reparse point."
    }
    $expected = @('main.py', 'package.json', 'plugin.json', 'dist/index.js', 'dist/index.js.map')
    foreach ($relative in $expected) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root ($relative -replace '/', '\')) -PathType Leaf)) {
            Stop-Deploy "$Label artifact is missing $relative."
        }
    }
    $actual = @(Get-ChildItem -LiteralPath $Root -File -Recurse | ForEach-Object {
        if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            Stop-Deploy "$Label artifact contains a symlink or reparse point: $($_.FullName)"
        }
        $_.FullName.Substring($Root.Length + 1).Replace('\', '/')
    } | Sort-Object)
    $directories = @(Get-ChildItem -LiteralPath $Root -Directory -Recurse | ForEach-Object {
        if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            Stop-Deploy "$Label artifact contains a symlink or reparse point: $($_.FullName)"
        }
        $_.FullName.Substring($Root.Length + 1).Replace('\', '/')
    } | Sort-Object)
    $expectedSorted = @($expected | Sort-Object)
    if (($actual -join "`n") -ne ($expectedSorted -join "`n")) {
        Stop-Deploy "$Label artifact contains unexpected or missing runtime files: $($actual -join ', ')"
    }
    if (($directories -join "`n") -ne 'dist') {
        Stop-Deploy "$Label artifact contains unexpected directories: $($directories -join ', ')"
    }
    $identity = Get-Identity $Root $Label
    if ($identity.Manifest.name -ne $Name -or $identity.Manifest.appkey -ne $AppKey -or
        $identity.Package.name -ne $PackageName -or $identity.Package.type -ne 'module') {
        Stop-Deploy "$Label artifact identity or ESM module metadata is unexpected."
    }
}

function New-HashManifest([string] $Root) {
    $lines = foreach ($file in @('plugin.json', 'package.json', 'main.py', 'dist/index.js', 'dist/index.js.map')) {
        $hash = (Get-FileHash -LiteralPath (Join-Path $Root ($file -replace '/', '\')) -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $file"
    }
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText((Join-Path $Root 'SHA256SUMS'), (($lines -join "`n") + "`n"), $utf8NoBom)
}

function Copy-ArtifactContents([string] $Source, [string] $Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container) -or
        -not (Test-Path -LiteralPath $Destination -PathType Container)) {
        Stop-Deploy 'Artifact copy source and destination must both be existing directories.'
    }
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        $target = Join-Path $Destination $item.Name
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            Stop-Deploy "Refusing artifact reparse point: $($item.FullName)"
        }
        if ($item.PSIsContainer) {
            New-Item -ItemType Directory -Path $target | Out-Null
            Copy-ArtifactContents $item.FullName $target
        } else {
            Copy-Item -LiteralPath $item.FullName -Destination $target
        }
    }
}

function Assert-RemoteHash([string] $Output, [string] $ExpectedHash) {
    $normalized = ($Output -join "`n")
    $match = [regex]::Match($normalized, '(?m)^([0-9a-fA-F]{64})\s+')
    if (-not $match.Success -or $match.Groups[1].Value.ToLowerInvariant() -ne $ExpectedHash.ToLowerInvariant()) {
        Stop-Deploy 'Remote SHA-256 output is missing, malformed, or does not match the local file.'
    }
}

try {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    Set-Location -LiteralPath $repoRoot

    Write-Host 'This will build and stage both Decky plugins, then install them and restart plugin_loader.service once.' -ForegroundColor Yellow
    Write-Host 'It modifies only the existing production and MOCK plugin runtime files. It does not change plugin data or settings.' -ForegroundColor Yellow

    Write-Host 'Building production plugin...'
    Invoke-Checked 'npm.cmd' @('--prefix', 'decky-plugin', 'run', 'build') 'Production plugin build'
    Write-Host 'Building isolated MOCK plugin...'
    Invoke-Checked 'npm.cmd' @('run', 'build:mock') 'MOCK plugin build'

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $deployRoot = Join-Path $repoRoot "artifacts\decky-whatsapp-deploy-$stamp"
    $productionArtifact = Join-Path $deployRoot 'decky-whatsapp'
    $mockArtifact = Join-Path $deployRoot 'decky-whatsapp-mock'
    if (Test-Path -LiteralPath $deployRoot) { Stop-Deploy "Local staging path already exists: $deployRoot" }
    New-Item -ItemType Directory -Path $deployRoot | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $productionArtifact 'dist') | Out-Null
    New-Item -ItemType Directory -Path $mockArtifact -Force | Out-Null
    foreach ($relative in @('main.py', 'plugin.json', 'package.json')) {
        Copy-Item -LiteralPath (Join-Path $repoRoot "decky-plugin\$relative") -Destination (Join-Path $productionArtifact $relative)
    }
    Copy-Item -LiteralPath (Join-Path $repoRoot 'decky-plugin\dist\index.js') -Destination (Join-Path $productionArtifact 'dist\index.js')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'decky-plugin\dist\index.js.map') -Destination (Join-Path $productionArtifact 'dist\index.js.map')
    Copy-ArtifactContents (Join-Path $repoRoot 'artifacts\decky-whatsapp-mock') $mockArtifact

    Assert-Artifact $productionArtifact 'Production' 'Decky WhatsApp' 'decky-whatsapp' 'decky-whatsapp-plugin'
    Assert-Artifact $mockArtifact 'MOCK' 'Decky WhatsApp MOCK' 'decky-whatsapp-mock' 'decky-whatsapp-mock'
    New-HashManifest $productionArtifact
    New-HashManifest $mockArtifact
    Write-Host "Verified exact production runtime files: $productionArtifact"
    Write-Host "Verified exact MOCK runtime files: $mockArtifact"

    $deckHost = $null
    $resolver = Join-Path $repoRoot 'scripts\suggest-deck-host.mjs'
    Write-Host 'Resolving conventional Deck hostname (each DNS lookup is time-limited)...'
    $resolverOutput = & node $resolver 2>$null
    if ($LASTEXITCODE -eq 0) { $deckHost = (($resolverOutput -join '').Trim()) }
    if ($deckHost) {
        Write-Host "Hostname resolution complete: $deckHost"
    } else {
        Write-Host 'Hostname resolution complete: no conventional name resolved; waiting for manual host input.'
    }
    if (-not $deckHost) {
        $deckHost = (Read-Host 'No conventional Deck hostname resolved. Enter a hostname or SSH config alias (no IP guessing)')
    }
    if ($deckHost -notmatch '^[A-Za-z0-9._-]+$') {
        Stop-Deploy 'Deck host must be a hostname or SSH alias using only letters, digits, dot, underscore, or hyphen.'
    }
    $remote = "deck@$deckHost"
    $remoteStage = "/home/deck/decky-whatsapp-deploy-$stamp"
    $sshOptions = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1')
    $scpOptions = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1')

    Write-Host "Selected Deck host: $remote"
    Invoke-Checked 'ssh.exe' ($sshOptions + @($remote, 'true')) 'Deck SSH connectivity check'
    $remoteStageCheck = "if test -e '$remoteStage' || test -L '$remoteStage'; then exit 1; fi"
    Invoke-Checked 'ssh.exe' ($sshOptions + @($remote, $remoteStageCheck)) 'Unique Deck staging path check'
    Invoke-Checked 'ssh.exe' ($sshOptions + @($remote, "mkdir -m 700 '$remoteStage'")) 'Deck staging directory creation'
    $remotePreflight = @'
set -eu
P=/home/deck/homebrew/plugins/decky-whatsapp
M=/home/deck/homebrew/plugins/decky-whatsapp-mock
require_real_directory() {
  local path="$1" expected="$2" resolved
  if [ ! -d "$path" ] || [ -L "$path" ]; then
    printf 'Expected a real directory: %s\n' "$path" >&2
    return 1
  fi
  resolved=$(realpath -e -- "$path") || return 1
  if [ "$resolved" != "$expected" ]; then
    printf 'Unexpected resolved path: %s -> %s\n' "$path" "$resolved" >&2
    return 1
  fi
}
require_real_directory "$P" /home/deck/homebrew/plugins/decky-whatsapp
require_real_directory "$M" /home/deck/homebrew/plugins/decky-whatsapp-mock
require_real_directory "$(dirname "$P")" /home/deck/homebrew/plugins
require_real_directory "$(dirname "$M")" /home/deck/homebrew/plugins
require_real_directory "$P/dist" /home/deck/homebrew/plugins/decky-whatsapp/dist
require_real_directory "$M/dist" /home/deck/homebrew/plugins/decky-whatsapp-mock/dist
for f in plugin.json package.json main.py dist/index.js dist/index.js.map; do
  for d in "$P" "$M"; do
    if [ -L "$d/$f" ]; then
      printf 'Refusing destination symlink: %s\n' "$d/$f" >&2
      exit 1
    fi
  done
done
python3 - "$P/plugin.json" "$P/package.json" "$M/plugin.json" "$M/package.json" <<'PY'
import json, sys
p, pp, m, mp = [json.load(open(path, encoding="utf-8")) for path in sys.argv[1:]]
assert (p.get("name"), p.get("appkey"), pp.get("name"), pp.get("type")) == ("Decky WhatsApp", "decky-whatsapp", "decky-whatsapp-plugin", "module")
assert (m.get("name"), m.get("appkey"), mp.get("name"), mp.get("type")) == ("Decky WhatsApp MOCK", "decky-whatsapp-mock", "decky-whatsapp-mock", "module")
PY
for f in plugin.json package.json main.py dist/index.js dist/index.js.map; do
  for d in "$P" "$M"; do
    if [ -L "$d/$f" ]; then
      printf 'Refusing destination symlink: %s\n' "$d/$f" >&2
      exit 1
    fi
    if [ -e "$d/$f" ] && [ ! -f "$d/$f" ]; then
      printf 'Refusing non-file destination: %s\n' "$d/$f" >&2
      exit 1
    fi
  done
done
if ! systemctl is-active --quiet plugin_loader.service; then
  printf 'plugin_loader.service is not active.\n' >&2
  exit 1
fi
'@
    $remotePreflight = $remotePreflight.Replace("`r`n", "`n").Replace("`r", "`n")
    $localPreflight = Join-Path $deployRoot 'preflight-decky-plugins.sh'
    [System.IO.File]::WriteAllText($localPreflight, $remotePreflight, [System.Text.UTF8Encoding]::new($false))
    # Transfer and invoke a file instead of putting a multiline shell program in SSH arguments.
    $preflightRemote = "$remoteStage/preflight-decky-plugins.sh"
    Invoke-Checked 'scp.exe' ($scpOptions + @($localPreflight, "$remote`:$preflightRemote")) 'Deck preflight script transfer'
    Invoke-Checked 'ssh.exe' ($sshOptions + @($remote, "bash -n '$preflightRemote' && bash '$preflightRemote'")) 'Deck path and identity preflight'

    Invoke-Checked 'scp.exe' ($scpOptions + @('-r', $productionArtifact, $mockArtifact, "$remote`:$remoteStage/")) 'Plugin artifact transfer'
    Invoke-Checked 'scp.exe' ($scpOptions + @((Join-Path $productionArtifact 'SHA256SUMS'), "$remote`:$remoteStage/decky-whatsapp/")) 'Production hash manifest transfer'
    Invoke-Checked 'scp.exe' ($scpOptions + @((Join-Path $mockArtifact 'SHA256SUMS'), "$remote`:$remoteStage/decky-whatsapp-mock/")) 'MOCK hash manifest transfer'

    foreach ($variant in @('decky-whatsapp', 'decky-whatsapp-mock')) {
        $verifyStage = "cd '$remoteStage/$variant' || exit 1; sha256sum -c SHA256SUMS"
        Invoke-Checked 'ssh.exe' ($sshOptions + @($remote, $verifyStage)) "$variant staged hash verification"
    }

    $installScript = @'
#!/usr/bin/env bash
set -euo pipefail
STAGE=__STAGE__
P=/home/deck/homebrew/plugins/decky-whatsapp
M=/home/deck/homebrew/plugins/decky-whatsapp-mock

validate_tree() {
  local root="$1" expected_name="$2" expected_key="$3" expected_package="$4"
  require_real_directory "$root" "$root"
  require_real_directory "$root/dist" "$root/dist"
  python3 - "$root/plugin.json" "$root/package.json" "$expected_name" "$expected_key" "$expected_package" <<'PY'
import json, sys
m, p = [json.load(open(path, encoding="utf-8")) for path in sys.argv[1:3]]
assert (m.get("name"), m.get("appkey"), p.get("name"), p.get("type")) == (*sys.argv[3:6], "module")
PY
}
require_real_directory() {
  local path="$1" expected="$2" resolved
  if [ ! -d "$path" ] || [ -L "$path" ]; then
    printf 'Expected a real directory: %s\n' "$path" >&2
    return 1
  fi
  resolved=$(realpath -e -- "$path") || return 1
  if [ "$resolved" != "$expected" ]; then
    printf 'Unexpected resolved path: %s -> %s\n' "$path" "$resolved" >&2
    return 1
  fi
}
validate_tree "$P" 'Decky WhatsApp' decky-whatsapp decky-whatsapp-plugin
validate_tree "$M" 'Decky WhatsApp MOCK' decky-whatsapp-mock decky-whatsapp-mock
require_real_directory "$(dirname "$P")" /home/deck/homebrew/plugins
require_real_directory "$(dirname "$M")" /home/deck/homebrew/plugins
if ! systemctl is-active --quiet plugin_loader.service; then
  printf 'plugin_loader.service is not active.\n' >&2
  exit 1
fi

for variant in decky-whatsapp decky-whatsapp-mock; do
  src="$STAGE/$variant"
  require_real_directory "$src" "$src"
  links=$(find "$src" -type l -print -quit) || exit 1
  if [ -n "$links" ]; then
    printf 'Refusing staged symlink under %s\n' "$src" >&2
    exit 1
  fi
  (
    cd "$src"
    sha256sum -c SHA256SUMS
  )
  actual=$(find "$src" -type f ! -name SHA256SUMS -printf '%P\n' | LC_ALL=C sort) || exit 1
  expected=$(printf '%s\n' main.py package.json plugin.json dist/index.js dist/index.js.map | LC_ALL=C sort)
  if [ "$actual" != "$expected" ]; then
    printf 'Unexpected staged runtime file set in %s\n' "$src" >&2
    exit 1
  fi
done
python3 - "$STAGE/decky-whatsapp/plugin.json" "$STAGE/decky-whatsapp/package.json" "$STAGE/decky-whatsapp-mock/plugin.json" "$STAGE/decky-whatsapp-mock/package.json" <<'PY'
import json, sys
p, pp, m, mp = [json.load(open(path, encoding="utf-8")) for path in sys.argv[1:]]
assert (p.get("name"), p.get("appkey"), pp.get("name"), pp.get("type")) == ("Decky WhatsApp", "decky-whatsapp", "decky-whatsapp-plugin", "module")
assert (m.get("name"), m.get("appkey"), mp.get("name"), mp.get("type")) == ("Decky WhatsApp MOCK", "decky-whatsapp-mock", "decky-whatsapp-mock", "module")
PY

for root in "$P" "$M"; do
  for file in plugin.json package.json main.py dist/index.js dist/index.js.map; do
    if [ -L "$root/$file" ]; then
      printf 'Refusing destination symlink: %s\n' "$root/$file" >&2
      exit 1
    fi
    if [ -e "$root/$file" ] && [ ! -f "$root/$file" ]; then
      printf 'Refusing non-file destination: %s\n' "$root/$file" >&2
      exit 1
    fi
  done
done

printf 'All destination paths, plugin identities, staged file sets, hashes, and service state passed pre-write checks.\n'
printf 'Installing only the five listed runtime files in each existing plugin directory.\n'
for variant in decky-whatsapp decky-whatsapp-mock; do
  src="$STAGE/$variant"
  dst="/home/deck/homebrew/plugins/$variant"
  sudo install -o root -g root -m 644 -- "$src/plugin.json" "$dst/plugin.json"
  sudo install -o root -g root -m 644 -- "$src/package.json" "$dst/package.json"
  sudo install -o root -g root -m 644 -- "$src/main.py" "$dst/main.py"
  sudo install -o root -g root -m 644 -- "$src/dist/index.js" "$dst/dist/index.js"
  sudo install -o root -g root -m 644 -- "$src/dist/index.js.map" "$dst/dist/index.js.map"
done

for variant in decky-whatsapp decky-whatsapp-mock; do
  src="$STAGE/$variant"
  dst="/home/deck/homebrew/plugins/$variant"
  for file in plugin.json package.json main.py dist/index.js dist/index.js.map; do
    expected=$(awk -v f="$file" '$2 == f {print $1}' "$src/SHA256SUMS")
    actual=$(sha256sum "$dst/$file" | awk '{print $1}')
    if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
      printf 'Installed hash mismatch: %s\n' "$dst/$file" >&2
      exit 1
    fi
    if [ -L "$dst/$file" ] || [ ! -f "$dst/$file" ]; then
      printf 'Installed destination is not a regular file: %s\n' "$dst/$file" >&2
      exit 1
    fi
  done
done
validate_tree "$P" 'Decky WhatsApp' decky-whatsapp decky-whatsapp-plugin
validate_tree "$M" 'Decky WhatsApp MOCK' decky-whatsapp-mock decky-whatsapp-mock
printf 'Both plugin variants match the staged hashes. Restarting plugin_loader.service once.\n'
sudo systemctl restart plugin_loader.service
if ! systemctl is-active --quiet plugin_loader.service; then
  printf 'plugin_loader.service did not return to active state.\n' >&2
  exit 1
fi
printf 'Deployment complete. plugin_loader.service is active. Staged files retained at %s for diagnostics.\n' "$STAGE"
'@
    $installScript = $installScript.Replace('__STAGE__', $remoteStage)
    $installScript = $installScript.Replace("`r`n", "`n").Replace("`r", "`n")
    $localInstall = Join-Path $deployRoot 'install-decky-plugins.sh'
    [System.IO.File]::WriteAllText($localInstall, $installScript, [System.Text.UTF8Encoding]::new($false))
    Invoke-Checked 'scp.exe' ($scpOptions + @($localInstall, "$remote`:$remoteStage/install-decky-plugins.sh")) 'Remote installer transfer'
    $scriptHash = (Get-FileHash -LiteralPath $localInstall -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host 'Checking remote installer SHA-256...'
    $remoteHashResult = Invoke-BoundedProcess 'ssh.exe' ($sshOptions + @($remote, "sha256sum '$remoteStage/install-decky-plugins.sh'")) 'Remote installer SHA-256 check' $RemoteCommandTimeoutSeconds $remoteStage
    Assert-RemoteHash $remoteHashResult.StdOut $scriptHash
    Write-Host 'Remote installer SHA-256 verified.'
    Invoke-Checked 'ssh.exe' ($sshOptions + @($remote, "bash -n '$remoteStage/install-decky-plugins.sh'")) 'Remote installer syntax check'

    Write-Host ''
    Write-Host "Deck: $remote"
    Write-Host "Production destination: /home/deck/homebrew/plugins/decky-whatsapp"
    Write-Host "MOCK destination:      /home/deck/homebrew/plugins/decky-whatsapp-mock"
    Write-Host "Unique staging path:   $remoteStage"
    Write-Host 'The next command will overwrite only the five verified runtime files per plugin and restart plugin_loader.service once.' -ForegroundColor Yellow
    Write-Host 'Preflight and staging checks passed. Awaiting your explicit deployment confirmation.' -ForegroundColor Yellow
    $answer = Read-Host 'Type DEPLOY to continue; any other response cancels'
    if ($answer -cne 'DEPLOY') {
        Write-Host "Cancelled. No privileged install or service restart was run. Staged files remain at $remoteStage."
        exit 2
    }

    Write-Host 'Enter your sudo password only at the Steam Deck SSH password prompt.' -ForegroundColor Yellow
    Write-Host 'Connecting to the Deck for installation; enter your sudo password at its prompt.'
    & ssh.exe -tt -o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 $remote "bash '$remoteStage/install-decky-plugins.sh'"
    if ($LASTEXITCODE -ne 0) {
        Stop-Deploy "Remote deployment returned exit code $LASTEXITCODE. Treat the result as partial/unknown; inspect the printed stage path before retrying. No automatic cleanup was attempted."
    }
    Write-Host 'Both plugin variants were installed and plugin_loader.service is active.' -ForegroundColor Green
    exit 0
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'No automatic remote staging cleanup or rollback was attempted.' -ForegroundColor Yellow
    exit 1
}
