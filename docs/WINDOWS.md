# Windows PC companion

The Windows companion runs the local WhatsApp bridge and connects the Steam
Deck to it over SSH. Use a Windows x64 PC with Node.js 22 or newer, Git for
Windows, and the Windows OpenSSH Client. The installer can offer to install
Node.js LTS and Git with `winget` when they are missing. A Deck with Decky
Loader and SSH enabled must be reachable from the PC.

Download `decky-whatsapp-pc-windows-v<version>.zip` and the separate
`decky-whatsapp-decky-plugin-*.zip` from the
[latest release](https://github.com/db452/DeckyWhatsapp/releases/latest).
Extract the companion ZIP to a permanent folder and keep its files together.
Install the plugin ZIP through Decky Loader.

## Recommended setup

Open PowerShell in the extracted companion directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-decky-whatsapp-windows.ps1
```

The installer checks Node.js, Git, and OpenSSH, installs the bridge's locked
dependencies, creates the dedicated SSH key if it does not already exist, and
creates an icon-bearing shortcut in the companion folder, on the Desktop, and
in the Start Menu.
It does not replace an existing key. Run the installer again to refresh those
shortcuts after moving the extracted companion folder.
If PowerShell blocks `npm.ps1`, the installer invokes `npm.cmd` directly.

To install the public key on the Deck for passwordless SSH startup, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-decky-whatsapp-windows.ps1 -InstallDeckKey
```

Enter the Deck hostname or IP when asked. The Deck password may be required for
this one-time step. The private key is kept in `%USERPROFILE%\.ssh\` and must
remain private.

Start from the **Decky WhatsApp** shortcut or run:

```powershell
.\start-decky-whatsapp.bat
```

The launcher checks a short list of conventional Deck hostnames concurrently
through Windows name resolution, with a 20-second overall deadline, and
automatically selects the first resolvable name in preference order. This is
not a LAN scan and does not authenticate. If no name resolves, enter a
hostname or IPv4 address manually. The launcher starts separate bridge and SSH
tunnel windows. Keep both open while using the plugin. The first bridge start
may display a WhatsApp QR code; scan it with the phone if requested.
Authentication data remains locally in `.wwebjs_auth/`.

The foreground launcher checks that the local bridge port is free before it
starts, and leaves an existing listener running. The bridge binds to
`127.0.0.1` by default. Keep this loopback binding; direct LAN exposure is not
supported.

## Optional manually started background mode

Background mode requires SSH that can authenticate without an interactive
password or unavailable key passphrase. It uses SSH batch mode and will fail
instead of waiting invisibly for credentials. From the companion directory,
run the commands explicitly as needed:

```powershell
.\manage-decky-whatsapp.ps1 Start
.\manage-decky-whatsapp.ps1 Status
.\manage-decky-whatsapp.ps1 Logs
.\manage-decky-whatsapp.ps1 Stop
```

`Start` checks `steamdeck.lan`, then prompts for a hostname or IPv4 address if
that name does not resolve. It starts only after the command is run; it does
not create a Windows service, scheduled task, or login startup entry. The
bridge and tunnel logs and process ownership records are kept in
`%LOCALAPPDATA%\DeckyWhatsapp\background`.

`Status` reports the recorded processes; use `Logs` to inspect bridge and
tunnel output and confirm SSH connection state. If using a hostname, the tunnel
resolves it again when reconnecting after sleep or network interruption. If
using an IP that changes, stop and start again with the current address.
`Stop` shuts down only the bridge and tunnel processes recorded and verified as
owned by this background session. If ownership or authenticated shutdown
cannot be confirmed, it leaves the process running for manual diagnosis.

## Manual setup

If you do not want to run the installer, install supported Node.js, Git for
Windows, and OpenSSH Client yourself. From the extracted directory:

```powershell
npm.cmd install
```

In one PowerShell window, start the bridge:

```powershell
.\node_modules\.bin\tsx.cmd src/server.ts
```

In another, start the reverse tunnel (replace the host):

```powershell
ssh -N -T -o ExitOnForwardFailure=yes -R 8787:127.0.0.1:8787 deck@STEAM_DECK_IP
```

Keep both windows open. The first bridge start may ask you to link WhatsApp Web
using the QR code. Do not share `.wwebjs_auth/`, bridge tokens, private keys,
or logs containing personal data.

## Troubleshooting

- **PowerShell blocks npm:** Run `npm.cmd install` rather than `npm install`, or
  use Command Prompt.
- **Missing Node.js, Git, or SSH:** Install Node.js 22+, Git for Windows, and
  the Windows OpenSSH Client optional feature. Restart PowerShell after an
  installation if the commands are not on `PATH`.
- **Bridge unavailable:** Confirm the bridge window says it is ready and the
  tunnel remains open. Restart both components if needed. Do not close an
  unknown process just because it uses port `8787`; identify and confirm its
  ownership first.
- **Remote port forwarding failed:** Another active Decky WhatsApp session, an
  unrelated service, or Deck SSH forwarding policy may own/block port `8787`.
  The launcher uses a bounded recovery window of up to 90 seconds and never
  identifies or stops a remote port owner. Confirm the cause and ownership
  before any manual cleanup.
- **SSH authentication or reconnect fails:** The initial foreground SSH
  connection may prompt. Automatic reconnects use batch mode and stop with
  guidance when credentials are unavailable. Confirm authentication, then
  restart the launcher manually. The Windows launcher verifies only its local
  bridge listener before retrying; it cannot establish who owns a remote port.
- **WhatsApp does not become ready:** Keep the bridge running while it loads.
  If it remains stuck, stop and restart the bridge and scan a new QR code if
  requested. Check **Settings → Linked devices** on the phone if the linked
  device limit has been reached.
- **Media does not load:** Keep WhatsApp Web connected until media downloads,
  then reload the conversation. Ordinary video is supported; view-once media
  cannot be opened here and must be checked on the phone.

If stale tunnels persist, a Deck administrator may optionally configure SSH
server keepalives. On the Deck, add and validate the settings, then reload SSH:

```sh
printf 'ClientAliveInterval 15\nClientAliveCountMax 3\n' | sudo tee /etc/ssh/sshd_config.d/99-decky-whatsapp-stale-tunnel.conf
sudo sshd -t && sudo systemctl reload sshd.service
sudo sshd -T | grep -E '^(clientaliveinterval|clientalivecountmax) '
```

The effective values should be `clientaliveinterval 15` and
`clientalivecountmax 3`. These settings apply to new SSH sessions and all SSH
clients on the Deck; a live but unresponsive client can be closed after roughly
45 seconds. If validation or reload fails, remove the drop-in and reload the
previous configuration:

```sh
sudo rm /etc/ssh/sshd_config.d/99-decky-whatsapp-stale-tunnel.conf
sudo systemctl reload sshd.service
```

Reload does not expire an already-established session. Diagnose any remaining
remote-forward conflict separately; the launcher will not terminate a remote
process based on its port.

For the bridge's data handling and security reporting, see
[SECURITY.md](./SECURITY.md). The PC bridge has no analytics or telemetry
service; WhatsApp data and authentication remain on your devices and are also
subject to WhatsApp's own policies.
