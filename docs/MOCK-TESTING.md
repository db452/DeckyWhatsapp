# Offline MOCK plugin

The mock variant reuses the Decky React panel and UI components while selecting an in-memory provider at build time. It has fabricated names and message histories only. Every send, reaction, edit, delete, read update, notification, and failure scenario changes disposable in-memory state.

## Build and inspect

From the repository root:

```powershell
npm.cmd run build:mock
if ($LASTEXITCODE -ne 0) { throw 'MOCK artifact build failed.' }
npm run test:mock
```

The output is `artifacts/decky-whatsapp-mock/`. Its Decky manifest name is `Decky WhatsApp MOCK`; the directory is intended to be installed under the distinct plugin directory `decky-whatsapp-mock`. The existing production build command is `npm --prefix decky-plugin run build`; it writes only `decky-plugin/dist`.

The mock artifact includes a minimal `package.json` with `type: module` so Decky loads its ESM frontend in module mode. Its manifest/runtime name and package name are distinct from production. The mock backend `main.py` has no voice RPC or filesystem access. The mock frontend imports only `mock-provider.ts`; its provider contains no fetch/WebSocket/Decky RPC integration and stores preferences under `decky-whatsapp-mock-*`.

## Repeatable combined Deck deployment

From the repository root on Windows, run `deploy-decky-plugins.bat` when you intentionally want to deploy both current variants. The batch file builds production and MOCK, checks their exact runtime file sets and identities, resolves a configured conventional Deck hostname (or asks you to enter a hostname/SSH alias), stages both variants under a unique `/home/deck/decky-whatsapp-deploy-*` path, and verifies staged SHA-256 hashes and manifests. It refuses to proceed if the installed production/MOCK directories, manifests, runtime files, symlinks, or active Decky service do not match its expected preflight.

Each noninteractive SSH/SCP command has a 120-second wall-clock limit in addition to OpenSSH's connection timeout. The helper prints output while the command runs. On timeout it terminates and waits for only the exact local SSH/SCP client process it started, reports the stage and possible partial remote staging path, and stops before continuing. It does not remove remote staging files automatically. The final SSH invocation remains interactive for the explicit `DEPLOY` step and sudo prompt; that command is intentionally not subject to the noninteractive timeout.

The batch file starts Windows PowerShell with `-ExecutionPolicy Bypass` for that process only so the companion script can run on hosts configured with a restrictive local execution policy. It does not change persistent policy, and a managed Group Policy execution-policy setting takes precedence and may still block the helper.

The script pauses and requires typing `DEPLOY` before it changes installed plugin files. Only then does it run the remote installer through an interactive SSH TTY; enter the Deck sudo password at that terminal prompt. It overwrites only `plugin.json`, `package.json`, `main.py`, `dist/index.js`, and `dist/index.js.map` in each existing plugin directory, verifies the copied hashes, and restarts `plugin_loader.service` once. It never creates or removes installed plugin directories and does not touch plugin settings, data, logs, the PC bridge, or WhatsApp. Staging is retained for diagnostics, including after cancellation or failure; no broad cleanup is performed.

**Running this batch file deploys both plugins and restarts Decky.** Do not run it while games are active. If a guard fails or the SSH session ends during deployment, treat the result as partial/unknown, inspect the exact printed staging path and installed files, and do not blindly rerun. The helper does not connect to WhatsApp or inspect production messages. It is intentionally not tested against the physical Deck as part of its implementation review.

## Local mock scenarios

The panel begins disconnected and requires an explicit start, preserving the deliberate-launch behavior. Open Settings to change sort/history preferences. Mock-only controls provide contact search, two session identifiers, incoming group messages, unavailable/reconnect, next-send failure, media failure/retry, delayed abortable responses, and reset. The group fixture has eight messages for paging; another contact has an empty history. Reset disconnects the mock panel, restores fixture data, preserves current preferences, and advances the generated event-ID namespace so cached notification IDs cannot suppress later test events. Existing conversation controls exercise local reply, reaction, edit, and deletion; fixtures include image and audio placeholders.

Semantic readiness hooks use `data-decky-chat-id`, `data-decky-message-id`, `data-decky-provider`, and stable button labels. The active local React mount test renders the built MOCK panel with simulated Decky UI components, runs effects, opens fixture conversations, simulates incoming events, sending and reactions, then verifies cleanup and remount behavior. Network, Decky RPC, and production-storage spies remain unused by the MOCK panel. This is a simulated renderer check, not a Gaming Mode test.

## Optional read-only CDP harness

Install the repository dependencies, ensure the existing localhost CDP forward is available, then run `node scripts/mock-deck-cdp.mjs`. The default operation selects only the `QuickAccess_uid2` page target and inspects the MOCK marker and sanitized diagnostics. It attaches to the exact validated WebSocket URL from discovery, rejects HTTP/WebSocket redirects, and bounds connection, commands, total operation, and cleanup. It does not click controls. UI actions require an explicit `--exercise start`, `--exercise stop`, or `--exercise open-ava`; these actions require the exact MOCK provider, label, and panel scope markers and click only a named control inside that scope. It never uses arbitrary page JavaScript for UI actions.

CDP tests use local fake HTTP/WebSocket servers and a fake protocol client, so the normal automated suite does not require the Deck or tunnel. The no-redirect transport is intentionally coupled to the pinned `chrome-remote-interface` 0.34.0 implementation and is guarded by an integration test.

## Read-only Steam Deck preflight

The read-only preflight found Decky Loader **v3.2.10** and the production plugin at `/home/deck/homebrew/plugins/decky-whatsapp`. Production identity is manifest name `Decky WhatsApp`, appkey `decky-whatsapp`, and package name `decky-whatsapp-plugin`. The MOCK identity is manifest name `Decky WhatsApp MOCK`, appkey `decky-whatsapp-mock`, and package name `decky-whatsapp-mock`; its package declares `"type": "module"`.

The installed loader's v3.2.10 frontend routes a plugin bundle using the manifest name, and the backend uses each plugin's metadata for its plugin-specific paths. The backend also selects ESM loading from package metadata. These rules were checked against the official [v3.2.10 frontend loader source](https://github.com/SteamDeckHomebrew/decky-loader/blob/v3.2.10/frontend/src/plugin-loader.tsx) and [backend plugin loader source](https://github.com/SteamDeckHomebrew/decky-loader/blob/v3.2.10/backend/decky_loader/plugin/plugin.py). The distinct manifest/appkey and ESM package metadata therefore support a side-by-side MOCK installation. This establishes loader-format compatibility only; it does not verify frontend execution in Gaming Mode.

At preflight time, `/home/deck/homebrew/plugins/decky-whatsapp-mock` and the MOCK-specific settings, data, and log directories were absent. On 2026-10-17 the user installed the MOCK beside production. A subsequent read-only audit confirmed its five artifact hashes, `root:root` ownership, directory/file modes, distinct identity, active Decky service, and unchanged normalized production plugin tree hash. The audit did not read production settings, runtime data, or log contents.

## Physical Gaming Mode verification — 2026-10-17

The user opened only `Decky WhatsApp MOCK` in Gaming Mode after CDP navigation paused. Quick Access showed separate MOCK and production entries. The MOCK provider marker appeared, five fabricated contacts loaded after the explicit Start action, and a fabricated conversation rendered. CDP exercised local sending, a reaction, simulated incoming messages and the MOCK-labeled notification, Stop/Start, close/reopen, reset, and history expansion from five visible messages to all eight fixture messages. Reset removed test-generated messages, and testing ended with the MOCK connection disabled.

The CDP network monitor counted zero requests to the local production bridge (`127.0.0.1:8787`) or WhatsApp domains. It counted zero JavaScript runtime exceptions and zero console errors during the interactions. The MOCK provider has no voice controls; the active local React isolation suite separately verifies no fetch/WebSocket, production RPC, or production-storage access. No message text or endpoint URLs were emitted by the monitor. Screenshots were captured for local visual inspection and remain outside the repository.

The production plugin tree hash remained unchanged at `b3bcad3a8458ac0aac808893fd14fff3c0440e3a216be226cbbb9d1d51b88a6e`. Production settings, runtime-data, and log contents were not inspected. CDP clicked MOCK controls; physical controller-only navigation remains unverified. During the earlier authorized Decky service restart, filtered logs showed a `stop_mtp()` TypeError in the separate DeckMTP plugin and reported the MOCK process still alive after the loader's five-second stop wait before SIGKILL. That shutdown cause is unresolved and was not reproduced by the UI interaction test; no MOCK source defect or fix is confirmed, and no redeploy or additional service restart was performed.

## Reviewed installation procedure

The physical installation was authorized by the user and verified on 2026-10-17. For repeatable installs, run the following in Windows PowerShell from the repository root. It targets only `/home/deck/homebrew/plugins/decky-whatsapp-mock`; stop if any identity, path, hash, or mode check differs. Do not adapt these commands to the production directory. The Bash payload is written as a UTF-8 file with LF line endings, transferred with SCP, syntax-checked on the Deck, then executed by its remote file path. Do not pass the multiline payload as an SSH command argument.

### 1. Build and verify the local artifact

```powershell
$ErrorActionPreference = 'Stop'
npm.cmd run build:mock
if ($LASTEXITCODE -ne 0) { throw 'MOCK artifact build failed.' }
$Artifact = (Resolve-Path 'artifacts/decky-whatsapp-mock').Path
$ExpectedFiles = @('main.py', 'package.json', 'plugin.json', 'dist/index.js', 'dist/index.js.map')
foreach ($File in $ExpectedFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $Artifact $File) -PathType Leaf)) {
        throw "Missing MOCK artifact file: $File"
    }
}
$Manifest = Get-Content -Raw (Join-Path $Artifact 'plugin.json') | ConvertFrom-Json
$Package = Get-Content -Raw (Join-Path $Artifact 'package.json') | ConvertFrom-Json
if ($Manifest.name -ne 'Decky WhatsApp MOCK' -or $Manifest.appkey -ne 'decky-whatsapp-mock') { throw 'Unexpected MOCK manifest identity.' }
if ($Package.name -ne 'decky-whatsapp-mock' -or $Package.type -ne 'module') { throw 'Unexpected MOCK package identity or module format.' }
Get-ChildItem -LiteralPath $Artifact -Recurse -File | Select-Object FullName, Length
```

### 2. Resolve the current Deck host and check the destination

The bounded resolver checks only the configured conventional Deck hostnames. If it returns no hostname, stop and resolve the current host before continuing. Use the existing SSH configuration and credentials; do not create or replace keys.

```powershell
$DeckHost = (node scripts/suggest-deck-host.mjs).Trim()
if (-not $DeckHost) { throw 'Could not resolve a configured Steam Deck hostname.' }
$DeckUser = 'deck'
$Remote = "$DeckUser@$DeckHost"
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$RemoteStage = "/home/deck/decky-whatsapp-mock-stage-$Stamp"
$ProductionDir = '/home/deck/homebrew/plugins/decky-whatsapp'
$MockDir = '/home/deck/homebrew/plugins/decky-whatsapp-mock'
ssh.exe -o BatchMode=yes -o ConnectTimeout=10 $Remote "test -d '$ProductionDir' && test ! -e '$MockDir' && test ! -e '$RemoteStage'"
if ($LASTEXITCODE -ne 0) { throw 'Production path missing, MOCK path already exists, or staging path is occupied. Stop without copying.' }
$ProductionManifest = ssh.exe -o BatchMode=yes $Remote "cat '$ProductionDir/plugin.json'" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $ProductionManifest.name -ne 'Decky WhatsApp' -or $ProductionManifest.appkey -ne 'decky-whatsapp') {
    throw 'Production manifest identity does not match the verified installation.'
}
ssh.exe -o BatchMode=yes $Remote "mkdir -m 700 '$RemoteStage'"
if ($LASTEXITCODE -ne 0) { throw 'Could not create the unique temporary staging directory.' }
```

Confirm the output identifies the existing production plugin as `Decky WhatsApp` / `decky-whatsapp`, and confirm the MOCK destination is absent. If the MOCK directory already exists, do not overwrite it; inspect and ask for direction.

### 3. Stage and verify the files

The preceding command creates the unique temporary destination first. SCP therefore places the artifact directory at `$RemoteStage/decky-whatsapp-mock/`. This transfers files only; it does not install the plugin or restart Decky.

```powershell
scp.exe -r $Artifact "${Remote}:$RemoteStage"
if ($LASTEXITCODE -ne 0) { throw 'SCP staging failed.' }
ssh.exe -o BatchMode=yes $Remote "test -f '$RemoteStage/decky-whatsapp-mock/plugin.json' && test -f '$RemoteStage/decky-whatsapp-mock/package.json' && test -f '$RemoteStage/decky-whatsapp-mock/main.py' && test -f '$RemoteStage/decky-whatsapp-mock/dist/index.js'"
if ($LASTEXITCODE -ne 0) { throw 'Staged MOCK artifact is incomplete.' }
$StagedManifest = ssh.exe -o BatchMode=yes $Remote "cat '$RemoteStage/decky-whatsapp-mock/plugin.json'" | ConvertFrom-Json
$StagedPackage = ssh.exe -o BatchMode=yes $Remote "cat '$RemoteStage/decky-whatsapp-mock/package.json'" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $StagedManifest.name -ne 'Decky WhatsApp MOCK' -or $StagedManifest.appkey -ne 'decky-whatsapp-mock') {
    throw 'Staged MOCK manifest identity is incorrect.'
}
if ($StagedPackage.name -ne 'decky-whatsapp-mock' -or $StagedPackage.type -ne 'module') { throw 'Staged MOCK package identity or module format is incorrect.' }
```

Before installation, verify the staged `plugin.json` reports name `Decky WhatsApp MOCK` and appkey `decky-whatsapp-mock`, and `package.json` reports name `decky-whatsapp-mock` and type `module`. Do not proceed if these checks fail.

### 4. Install only MOCK with root-owned files, then restart

Use a reviewed artifact and the exact staging path from Step 3. This command checks the production identity and previously recorded tree hash before installation, installs only the five verified MOCK files with `root:root` ownership, verifies their SHA-256 values and modes, compares the production hash again, and only then restarts Decky. It stops on any failed guard. The current approved physical test uses production hash `b3bcad3a8458ac0aac808893fd14fff3c0440e3a216be226cbbb9d1d51b88a6e`; re-record and review this value before using the procedure for a later test.

```powershell
$ExpectedProductionHash = 'b3bcad3a8458ac0aac808893fd14fff3c0440e3a216be226cbbb9d1d51b88a6e'
if ($ExpectedProductionHash -notmatch '^[0-9a-f]{64}$') { throw 'Invalid recorded production hash.' }
$RemoteSource = "$RemoteStage/decky-whatsapp-mock"
$InstallAndRestart = @'
set -euo pipefail
SOURCE=__REMOTE_SOURCE__
PRODUCTION=/home/deck/homebrew/plugins/decky-whatsapp
MOCK=/home/deck/homebrew/plugins/decky-whatsapp-mock
EXPECTED_PRODUCTION_HASH=__EXPECTED_HASH__

test -d "$PRODUCTION"
test ! -L "$PRODUCTION"
test "$(realpath -e -- "$PRODUCTION")" = "$PRODUCTION"
test -f "$PRODUCTION/plugin.json"
test "$(realpath -e -- "$(dirname "$MOCK")")" = /home/deck/homebrew/plugins
test ! -e "$MOCK"
test ! -L "$MOCK"
test -d "$SOURCE"
test "$(realpath -e -- "$SOURCE")" = "$SOURCE"

python3 - "$PRODUCTION/plugin.json" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
assert (manifest["name"], manifest["appkey"]) == ("Decky WhatsApp", "decky-whatsapp")
PY

verify_artifact() {
    python3 - "$1" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
expected = {
    "plugin.json": "f0069bfe102e829426bca041f577bd1a2377bcbb1770d9292749fcbf1da5603a",
    "package.json": "ea93c4086d9a92c7ec84367953504fbff17172b2607ca26ce953a83c5fcf851c",
    "main.py": "cebdf0fb9dbbc65eb0f19ad04a93f18d66013b3f8e0fdfbef159f33198a93bf3",
    "dist/index.js": "8077ab5d337e1ea4c6e6689f0c0b9f832d44bd680723d318603372a1853318df",
    "dist/index.js.map": "66d9338dd5db4f2942488e1a9f90448d2b1497cadd456db83839ede38d169b5c",
}
assert root.is_dir() and not root.is_symlink()
assert not any(path.is_symlink() for path in root.rglob("*"))
actual = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}
assert actual == set(expected), f"unexpected artifact contents: {sorted(actual)}"
for name, digest in expected.items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name
manifest = json.loads((root / "plugin.json").read_text(encoding="utf-8"))
package = json.loads((root / "package.json").read_text(encoding="utf-8"))
assert (manifest["name"], manifest["appkey"]) == ("Decky WhatsApp MOCK", "decky-whatsapp-mock")
assert (package["name"], package["type"]) == ("decky-whatsapp-mock", "module")
PY
}

production_hash() {
    sudo tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -cf - -C "$PRODUCTION" . | sha256sum | awk '{print $1}'
}

verify_artifact "$SOURCE"
BEFORE=$(production_hash)
test "$BEFORE" = "$EXPECTED_PRODUCTION_HASH"
printf 'PRODUCTION_HASH_BEFORE=%s\n' "$BEFORE"

sudo install -o root -g root -m 755 -d -- "$MOCK" "$MOCK/dist"
for file in plugin.json package.json main.py; do
    sudo install -o root -g root -m 644 -- "$SOURCE/$file" "$MOCK/$file"
done
for file in index.js index.js.map; do
    sudo install -o root -g root -m 644 -- "$SOURCE/dist/$file" "$MOCK/dist/$file"
done

verify_artifact "$MOCK"
test "$(stat -c '%U:%G:%a' "$MOCK")" = root:root:755
test "$(stat -c '%U:%G:%a' "$MOCK/dist")" = root:root:755
for file in plugin.json package.json main.py dist/index.js dist/index.js.map; do
    test "$(stat -c '%U:%G:%a' "$MOCK/$file")" = root:root:644
done
AFTER=$(production_hash)
test "$AFTER" = "$EXPECTED_PRODUCTION_HASH"
printf 'PRODUCTION_HASH_AFTER_INSTALL=%s\n' "$AFTER"

if ! sudo systemctl restart plugin_loader.service; then
    printf 'Decky service restart failed; stop and inspect without touching production.\n' >&2
    exit 1
fi
ACTIVE=$(systemctl is-active plugin_loader.service)
test "$ACTIVE" = active
POST_RESTART=$(production_hash)
test "$POST_RESTART" = "$EXPECTED_PRODUCTION_HASH"
printf 'MOCK_INSTALLED=%s\nDECKY_SERVICE=%s\nPRODUCTION_HASH_AFTER_RESTART=%s\n' "$MOCK" "$ACTIVE" "$POST_RESTART"
'@
$InstallAndRestart = $InstallAndRestart.Replace('__REMOTE_SOURCE__', $RemoteSource).Replace('__EXPECTED_HASH__', $ExpectedProductionHash)
$InstallAndRestart = $InstallAndRestart.Replace("`r`n", "`n").Replace("`r", "`n")
$LocalInstallScript = Join-Path $env:TEMP 'decky-whatsapp-mock-install.sh'
$RemoteInstallScript = "$RemoteStage/install-mock-$(Get-Date -Format 'yyyyMMdd-HHmmss').sh"
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($LocalInstallScript, $InstallAndRestart, $Utf8NoBom)
if ([System.IO.File]::ReadAllBytes($LocalInstallScript) -contains 13) { throw 'Local Bash script still contains CR bytes.' }
$LocalScriptHash = (Get-FileHash -LiteralPath $LocalInstallScript -Algorithm SHA256).Hash.ToLowerInvariant()

ssh.exe -o BatchMode=yes -o ConnectTimeout=10 $Remote "test -d '$RemoteStage' && test ! -e '$RemoteInstallScript' && test ! -L '$RemoteInstallScript'"
if ($LASTEXITCODE -ne 0) { throw 'The exact remote stage or script destination is unavailable; stop without overwriting files.' }
scp.exe $LocalInstallScript "${Remote}:$RemoteInstallScript"
if ($LASTEXITCODE -ne 0) { throw 'SCP transfer of the install script failed.' }
$RemoteScriptHashOutput = ssh.exe -o BatchMode=yes -o ConnectTimeout=10 $Remote "sha256sum '$RemoteInstallScript'"
if ($LASTEXITCODE -ne 0) { throw 'Could not verify the transferred script hash.' }
$RemoteScriptHashMatch = [regex]::Match(($RemoteScriptHashOutput -join "`n"), '(?m)^([0-9a-f]{64})\s+')
if (-not $RemoteScriptHashMatch.Success -or $RemoteScriptHashMatch.Groups[1].Value -ne $LocalScriptHash) { throw 'Transferred script hash differs from the local LF-terminated file.' }
ssh.exe -o BatchMode=yes -o ConnectTimeout=10 $Remote "bash -n '$RemoteInstallScript'"
if ($LASTEXITCODE -ne 0) { throw 'Remote Bash syntax check failed; do not execute the script.' }
ssh.exe -tt -o BatchMode=yes -o ConnectTimeout=10 $Remote "bash '$RemoteInstallScript'"
if ($LASTEXITCODE -ne 0) { throw 'A MOCK installation guard or Decky restart failed; stop without retrying.' }
```

The command prompts for the Deck sudo password in the PowerShell terminal. Enter it there only; do not paste it into chat. If any check fails, preserve the output, do not retry, and do not remove a partial MOCK directory until the failure has been reviewed. The production hash must match before and after installation and after service restart. The installed tree must contain the five reviewed files only, owned by `root:root` with directories mode 755 and files mode 644. The transferred Bash script remains in the unique staging directory for diagnostics; remove only that exact file after successful verification if desired.

### 5. Verify loader recognition and Gaming Mode

After the command succeeds, check `plugin_loader.service` is active and both manifests have distinct identities. In Gaming Mode with no game running, confirm both Decky entries are present, open only `Decky WhatsApp MOCK`, and verify its `MOCK / OFFLINE` label and fabricated fixtures. Exercise a simulated message/reaction and confirm the MOCK UI updates. Do not open production conversations or invoke production actions. If the MOCK fails to load, capture sanitized loader errors; do not alter or replace production to troubleshoot it.

## MOCK-only rollback

Rollback requires separate authorization. First verify the exact MOCK path and its manifest identity. Remove only that directory; never run a wildcard cleanup and never target `/home/deck/homebrew/plugins/decky-whatsapp`.

```powershell
$RollbackCommand = @'
set -e
MockDir=/home/deck/homebrew/plugins/decky-whatsapp-mock
test "$MockDir" = /home/deck/homebrew/plugins/decky-whatsapp-mock
test -f "$MockDir/plugin.json"
python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); assert (m["name"],m["appkey"]) == ("Decky WhatsApp MOCK","decky-whatsapp-mock")' "$MockDir/plugin.json"
sudo rm -r -- "$MockDir"
'@
ssh.exe -t $Remote $RollbackCommand
if ($LASTEXITCODE -ne 0) { throw 'MOCK identity/path guard failed; nothing else should be removed.' }
```

Restart `plugin_loader.service` after rollback only if that restart has also been separately authorized. Verify the MOCK directory is absent, production directory remains present, and its before/after tree hash still matches. The unique staging directory is separate from the installed plugin; remove only that exact staging path when it is no longer needed.
