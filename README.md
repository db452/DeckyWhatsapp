# Decky WhatsApp

Decky WhatsApp is a Steam Deck Decky plugin backed by a PC service. The PC
service maintains the WhatsApp Web session, while the Deck connects to it over
an SSH reverse tunnel. This keeps the WhatsApp Web browser session and its
heavier processing on the PC.

The plugin supports WhatsApp messages, media, reactions, and voice messages.
WhatsApp calls are not supported.

The project contains:

- The PC bridge in [`src/`](./src/), which exposes the WhatsApp Web session.
- The Decky plugin in [`decky-plugin/`](./decky-plugin/).
- The normal Windows launcher in [`start-decky-whatsapp.bat`](./start-decky-whatsapp.bat).
- The Linux installer and launcher for supported x86_64 desktop systems.

## Set up SSH on the Steam Deck

Set up SSH on the Deck before continuing with the project installation. Follow
the [Steam Deck SSH setup guide](https://github.com/popsUlfr/steam-deck-tricks/blob/main/README.md).

## Requirements

- Windows PC with Node.js 22 or newer and Git for Windows, or a supported Linux PC (Ubuntu/Debian x86_64) with Node.js 22 or newer.
- A WhatsApp account that can link a companion device.
- Steam Deck with Decky Loader installed.
- PC and Steam Deck connected to the same network.
- SSH access to the Steam Deck as the `deck` user.

## Compatibility

- Windows PC with Node.js 22 or newer and Git for Windows.
- Linux companion target: Ubuntu or Debian x86_64 with Node.js 22 or newer; Node.js 24 LTS is recommended. Linux ARM, Fedora, SteamOS, and other distributions are not currently supported targets.
- Steam Deck running SteamOS with Decky Loader.
- A current WhatsApp account with companion-device linking available.
- The PC and Deck must be able to reach each other on the same local network.

The bridge uses a pinned `whatsapp-web.js` revision and a small compatibility
patch because WhatsApp Web changes over time. Third-party packages and bundled
components remain subject to their own licenses and terms.

Companion releases use separate assets: `decky-whatsapp-pc-windows-*.zip` for
Windows and `decky-whatsapp-pc-linux-*.zip` for supported Linux systems. The
Decky plugin ZIP is a separate asset. Older releases may still contain the
legacy Windows name `decky-whatsapp-pc-*.zip`. Linux install steps and
troubleshooting are in the [Linux companion guide](./docs/LINUX.md).

## First download: install and start the release

Download the Windows PC ZIP and Decky plugin ZIPs from the
[latest GitHub release](https://github.com/db452/DeckyWhatsapp/releases/latest).
The Windows PC ZIP is named `decky-whatsapp-pc-windows-*.zip`; the plugin ZIP
is named `decky-whatsapp-decky-plugin-*.zip`. The optional Whisper installer is
included inside the Windows PC ZIP. Older releases may have the legacy Windows
package name `decky-whatsapp-pc-*.zip`. Linux users should download the distinct
`decky-whatsapp-pc-linux-*.zip` archive and follow the Linux guide below.

Extract the PC release ZIP to a permanent folder on the Windows PC. Keep all
of its files together. Install the Decky plugin release ZIP through Decky
Loader.

### Automatic setup

This is the recommended path for most users.

1. Open PowerShell in the extracted PC package folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-decky-whatsapp-windows.ps1
```

The installer checks for Node.js, Git, and Windows OpenSSH, installs the PC bridge
dependencies, creates the SSH key used by the launcher, and creates shortcuts.
If Node.js or Git is missing and `winget` is available, it can install them
automatically.

2. Install the public SSH key on the Deck if you want passwordless startup:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-decky-whatsapp-windows.ps1 -InstallDeckKey
```

Enter the Deck hostname or IP when prompted. The Deck password may be needed
once during this step.

3. Start the system from the created **Decky WhatsApp** shortcut, or run:

```powershell
.\start-decky-whatsapp.bat
```

Keep the bridge and tunnel windows open while using the plugin. On the first
start, link WhatsApp Web by scanning the QR code if requested. The session is
then stored locally on the PC.

### Optional background operation

If you have non-interactive SSH authentication configured, you can start the
bridge and tunnel without keeping console windows open. This is still a manual
action and does not create a login task or Windows service. Background mode
uses SSH batch mode so it never waits invisibly for a password or key passphrase;
password-only SSH users should keep using `start-decky-whatsapp.bat`.

Open PowerShell in the extracted PC package folder and run:

```powershell
.\manage-decky-whatsapp.ps1 Start
.\manage-decky-whatsapp.ps1 Status
.\manage-decky-whatsapp.ps1 Logs
.\manage-decky-whatsapp.ps1 Stop
```

`Start` discovers `steamdeck.lan` and asks for an address if discovery fails.
When the Deck is found by hostname, the tunnel re-resolves that name when it
reconnects after sleep or a network interruption. If you entered an IP address
and that address changes, stop the background session and start it again with
the Deck's current IP. The status command reports whether the bridge and tunnel
supervisor are running; inspect the tunnel log to see whether SSH is connected
or retrying. Logs and process ownership records are stored under
`%LOCALAPPDATA%\DeckyWhatsapp\background`.

### Manual setup

Use this path if you prefer to install prerequisites and start each component
yourself.

1. Install Node.js 20 or newer and Git for Windows, and ensure Windows OpenSSH is available.
2. Open PowerShell in the extracted PC package folder and install dependencies:

```powershell
cd C:\Path\To\decky-whatsapp-pc
npm.cmd install
```

3. Start the PC bridge in one PowerShell window:

```powershell
.\node_modules\.bin\tsx.cmd src/server.ts
```

4. In a second PowerShell window, start the SSH reverse tunnel:

```powershell
ssh -N -T -o ExitOnForwardFailure=yes -R 8787:127.0.0.1:8787 deck@STEAM_DECK_IP
```

Keep both windows open while using the plugin. The first WhatsApp Web start
may ask you to link the device by scanning a QR code. The linked session is
stored locally in `.wwebjs_auth/`; keep that directory private.

## Linux companion

The initial Linux target is Ubuntu/Debian on x86_64 with Node.js 22 or newer
(Node.js 24 LTS recommended). Linux ARM, Fedora, SteamOS, and other
distributions are not supported until their browser dependencies and bridge
runtime are validated. Download only the `decky-whatsapp-pc-linux-*.zip` asset;
it is distinct from the Windows ZIP and Decky plugin ZIP.

Follow [the Linux installation and troubleshooting guide](./docs/LINUX.md).
The installer asks before refreshing apt metadata or installing the exact
missing Ubuntu/Debian packages it has resolved. It does not install Node.js
globally, create a system service, or configure login autostart. Start the
bridge only when you deliberately run `./start-decky-whatsapp-linux.sh`.

## Install the Decky plugin

Copy the supplied plugin ZIP to the Deck and install it through Decky Loader.
Keep the plugin’s bridge URL set to:

```text
http://127.0.0.1:8787
```

On the Deck, that address is provided by the SSH reverse tunnel described
below.

## Optional voice typing (BETA)

Voice typing is an optional **beta feature** and is not required for normal text
messaging, contacts, media, or voice message playback. Its functionality is
not guaranteed at this stage. Transcription accuracy, microphone support, and
compatibility may vary between Steam Deck setups.

If you want to test dictation, install Whisper separately on the Steam Deck
before using the voice typing button. The plugin checks for Whisper at runtime
and continues working normally when it is not installed.

The project includes [install-whisper-deck.sh](./install-whisper-deck.sh) as an
optional beta convenience installer. Run it only if you want to test voice
recognition. Run it from your normal `deck` account, without `sudo`; it invokes
sudo only for system package operations. It may temporarily unlock SteamOS while
installing build tools, then restores read-only mode before building Whisper
locally and downloading its speech model. This requires an internet connection,
Git, and several hundred megabytes of temporary and model storage. The installer
checks out a pinned Whisper release and verifies the model against the upstream
SHA-1 listed by its model card.

Voice recordings are transcribed locally on the Deck. The installer does not
install a Whisper server.

## SSH reverse tunnel

The tunnel makes the PC bridge available as `127.0.0.1:8787` on the Deck:

```powershell
ssh -N -T -o ExitOnForwardFailure=yes -R 8787:127.0.0.1:8787 deck@STEAM_DECK_IP
```

Leave this window open while using the plugin. The foreground launcher normally
starts and maintains this tunnel automatically. Before starting the bridge, it
checks only `steamdeck.local`, `steamdeck.lan`, and `steamdeck` through the
operating system's hostname resolver, then prompts you to confirm or replace
the suggested name. This bounded lookup is not LAN discovery or a network scan;
it does not try SSH or authenticate. If none resolve, enter the Deck's hostname
or current IP address manually. Keeping a hostname lets SSH resolve the Deck
again after it moves to another network; an IP address must be updated manually
if it changes.

The bridge itself binds to `127.0.0.1` by default. Keep that setting so the
WhatsApp service is not exposed directly to other devices on the network.

### Clear a stale reverse-forward port

The Windows launcher can make one automatic retry when the remote port owner
cannot be identified. It waits 60 seconds for the Deck's SSH server to expire a
disconnected client, verifies that the same local bridge process is still
listening, then retries once without prompting for another password. It never
stops a remote process. This recovery requires the Deck SSH server to check
unresponsive clients; `ClientAliveInterval 15` with
`ClientAliveCountMax 3` expires them in about 45 seconds.

The one-time retry uses OpenSSH verbose output to confirm the remote forward was
established. If SSH exits before that confirmation, the launcher stops with
diagnostic guidance. After confirmation, it returns to normal tunnel
supervision and reconnect behavior.

For the foreground Windows launcher, the local listener PID and process start
time are checked on Windows before retrying. This only verifies the PC bridge;
it does not identify or provide evidence about a process on the Deck. If the
one-time retry cannot authenticate in SSH batch mode, it stops with guidance
instead of prompting again or looping. Password-only SSH or a key requiring an
unavailable passphrase may therefore need you to stop and restart the launcher
manually after the Deck clears the stale connection.

To enable those SSH server settings, run these commands in a Steam Deck desktop
terminal. They add a global SSH server setting, validate it, reload `sshd`,
and print the effective values:

```sh
printf 'ClientAliveInterval 15\nClientAliveCountMax 3\n' | sudo tee /etc/ssh/sshd_config.d/99-decky-whatsapp-stale-tunnel.conf
sudo sshd -t && sudo systemctl reload sshd.service
sudo sshd -T | grep -E '^(clientaliveinterval|clientalivecountmax) '
```

The output should show `clientaliveinterval 15` and
`clientalivecountmax 3`. If validation or the service reload fails, remove the
drop-in and reload the SSH service to restore the prior configuration:

```sh
sudo rm /etc/ssh/sshd_config.d/99-decky-whatsapp-stale-tunnel.conf
sudo systemctl reload sshd.service
```

Reload applies the settings to new SSH sessions; it does not retroactively
expire a connection established before the change. If a port is already held
by such a connection, diagnose its owner separately and verify ownership before
any cleanup. The launcher will not terminate a remote process based on its port.
These settings apply to all SSH clients on the Deck; a live but unresponsive
SSH client will be closed after roughly 45 seconds.

## Common issues

### The plugin says “Bridge unavailable”

Check that the PC bridge is running and that the SSH tunnel is still open.
From the PC, verify the bridge with:

```powershell
$bridgeToken = (Invoke-RestMethod -Uri http://127.0.0.1:8787/bootstrap -Headers @{ Origin = 'https://steamloopback.host' }).token
(Invoke-RestMethod -Uri http://127.0.0.1:8787/health -Headers @{ Authorization = "Bearer $bridgeToken" }).status
```

This reports the bridge's WhatsApp state. Keep the token private.

If the tunnel was closed or the Deck’s IP address changed, restart
[`start-decky-whatsapp.bat`](./start-decky-whatsapp.bat) and enter the current
Deck IP when prompted.

### The SSH tunnel reports “remote port forwarding failed”

SSH could not establish remote forwarding on port `8787`. The port may be in
use by another DeckyWhatsapp bridge or another service, or the Deck's SSH
server may restrict remote forwarding. Check whether another bridge you own is
already connected and ask the Deck administrator to check its SSH forwarding
policy. The launcher will not stop remote processes; do not terminate an SSH
process unless you have identified and confirmed it is yours.

### SSH keeps asking for a password

Configure passwordless SSH using the external setup guide linked above, or
enter the Deck password when the launcher requests it.

### The launcher cannot find the Deck

Make sure the Deck and PC are on the same network and that SSH has been
configured using the external setup guide. You can bypass automatic discovery
by entering the Deck’s current IPv4 address when the launcher asks for it.

### WhatsApp Web does not authenticate or gets stuck loading

Keep the bridge window open and wait for `WhatsApp client ready`. If it remains
stuck, stop the bridge, start it again, and scan the QR code if one appears.
Check WhatsApp on the phone under **Settings → Linked devices** and remove an
old or unused linked session if the device limit has been reached.

### Conversations or contacts do not load

First confirm that the bridge is ready, then reload the Decky plugin. If the
problem persists, restart both the PC bridge and the SSH tunnel. A stale bridge
process can also keep port `8787` occupied; close the old process before
starting a new one.

### Images, stickers, or voice messages do not appear

Leave WhatsApp Web connected until the media finishes downloading, then reload
the conversation. If media fails repeatedly, restart the bridge so WhatsApp
Web can refresh its session and try again.

### PowerShell blocks `npm`

If PowerShell reports that `npm.ps1` cannot be loaded because scripts are
disabled while installing the PC dependencies, use the Windows command shim:

```powershell
npm.cmd install
```

Alternatively, run the commands from Command Prompt.

## Disclaimer

Decky WhatsApp is an unofficial project, it is not affiliated with,
endorsed by, or sponsored by WhatsApp or Meta. Use it at
your own risk; the unofficial WhatsApp Web connection may stop working or may
result in account restrictions if WhatsApp changes or enforces its service
policies.

The plugin does not collect, sell, or transmit user data to the project
authors, and it contains no analytics or telemetry service. WhatsApp messages,
media, contacts, and authentication data are handled on the user’s own PC and
Steam Deck as part of the local bridge connection.

The project’s original code is licensed under the [MIT License](./LICENSE).
Third-party dependencies remain subject to their own licenses; see the
[third-party notices](./docs/THIRD-PARTY-NOTICES.md) for the direct dependencies.

- `.wwebjs_auth/` contains private WhatsApp authentication data; never share it.
- Bridge tokens and local configuration files should remain private.
- WhatsApp data is still processed by WhatsApp according to WhatsApp’s own
  service and privacy policies.

See [SECURITY.md](./docs/SECURITY.md) for reporting guidance and a list of data
that must remain private.

### AI-assisted development

AI tools were used to assist with developing this plugin and its documentation.
AI-assisted contributions may contain errors and are reviewed and tested as part
of the project’s normal development process.
