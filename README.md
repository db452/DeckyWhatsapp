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

## Set up SSH on the Steam Deck

Set up SSH on the Deck before continuing with the project installation. Follow
the [Steam Deck SSH setup guide](https://github.com/popsUlfr/steam-deck-tricks/blob/main/README.md).

## Requirements

- Windows PC with Node.js 20 or newer.
- A WhatsApp account that can link a companion device.
- Steam Deck with Decky Loader installed.
- PC and Steam Deck connected to the same network.
- SSH access to the Steam Deck as the `deck` user.

## Compatibility

- Windows PC with Node.js 20 or newer.
- Steam Deck running SteamOS with Decky Loader.
- A current WhatsApp account with companion-device linking available.
- The PC and Deck must be able to reach each other on the same local network.

The bridge uses a pinned `whatsapp-web.js` revision and a small compatibility
patch because WhatsApp Web changes over time. Third-party packages and bundled
components remain subject to their own licenses and terms.

## PC setup

From PowerShell, open the project directory and install the dependencies:

```powershell
cd C:\Users\YOUR_USER\Desktop\DeckyWhatsapp
npm install
```

The easiest way to start the bridge and its SSH tunnel is:

```powershell
.\start-decky-whatsapp.bat
```

The first WhatsApp Web start may ask you to link the device by scanning a QR
code. The linked session is stored locally in `.wwebjs_auth/`. This directory
contains private WhatsApp session data and should be kept private.

## Install the Decky plugin

Copy the supplied plugin ZIP to the Deck and install it through Decky Loader.
Keep the plugin’s bridge URL set to:

```text
http://127.0.0.1:8787
```

On the Deck, that address is provided by the SSH reverse tunnel described
below.

## Optional voice typing

Voice typing is optional and is not required for normal text messaging,
contacts, media, or voice message playback. If you want to dictate replies,
install the Deck-local Whisper engine using the separate voice installation
instructions. The setup requires both the Whisper executable and its model
file.

## SSH reverse tunnel

The tunnel makes the PC bridge available as `127.0.0.1:8787` on the Deck:

```powershell
ssh -N -T -o ExitOnForwardFailure=yes -R 8787:127.0.0.1:8787 deck@STEAM_DECK_IP
```

Leave this window open while using the plugin. The launcher normally starts and
maintains this tunnel automatically. If automatic discovery cannot find the
Deck, enter its current IP address when prompted.

The bridge itself binds to `127.0.0.1` by default. Keep that setting so the
WhatsApp service is not exposed directly to other devices on the network.

## Common issues

### The plugin says “Bridge unavailable”

Check that the PC bridge is running and that the SSH tunnel is still open.
From the PC, verify the bridge with:

```powershell
curl http://127.0.0.1:8787/health
```

If the tunnel was closed or the Deck’s IP address changed, restart
[`start-decky-whatsapp.bat`](./start-decky-whatsapp.bat) and enter the current
Deck IP when prompted.

### The SSH tunnel reports “remote port forwarding failed”

Port `8787` is already being used on the Deck, usually by an old tunnel. Close
the old launcher or SSH window, then run the launcher again. If necessary, use
the Deck to find and stop the stale SSH process before reconnecting.

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
