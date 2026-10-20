# Decky WhatsApp

Decky WhatsApp is a Steam Deck Decky plugin with a PC companion. The PC runs
WhatsApp Web and the local bridge; an SSH reverse tunnel lets the Deck plugin
connect to that bridge. WhatsApp calls are not supported.

## Platform support

- Plugin target: Steam Deck running SteamOS with Decky Loader and SSH enabled.
- Supported PC companion: Windows with Node.js 22 or newer, Git for Windows,
  and OpenSSH Client.
- Initial Linux PC target: Ubuntu or Debian x86_64 with Node.js 22 or newer
  (Node.js 24 LTS recommended). Physical Linux desktop runtime acceptance is
  pending. Linux ARM, Fedora, SteamOS as the PC host, and other distributions
  are not validated targets.
- PC and Deck must be able to reach one another over the network. Link a
  WhatsApp account that can use companion devices.

## Install and start

Download the PC companion ZIP and Decky plugin ZIP from the
[latest release](https://github.com/db452/DeckyWhatsapp/releases/latest). The
Windows and Linux companion ZIPs are separate assets; install the plugin ZIP
through Decky Loader. Set up SSH on the Deck using the
[Steam Deck SSH guide](https://github.com/popsUlfr/steam-deck-tricks/blob/main/README.md),
then follow the guide for your PC:

- [Windows install, startup, and troubleshooting](./docs/WINDOWS.md)
- [Linux install, startup, and troubleshooting](./docs/LINUX.md)

Start the PC bridge and tunnel only when you want to use the plugin. The
foreground launchers keep the bridge bound to PC loopback (`127.0.0.1:8787`);
the tunnel exposes it on Deck loopback. They do not configure login autostart
or a persistent service. Optional Windows background mode also requires a
manual `Start` command.

## Features and limits

The plugin supports conversations, text replies, reactions, message status,
images, stickers, voice messages, and ordinary video. View-once media cannot be
opened in Decky WhatsApp; check it on the phone. Optional voice typing is a beta
feature that requires a separate Deck-local Whisper installation; accuracy,
microphone support, and compatibility can vary. It is not needed for messaging
or media playback.

To try voice typing, download the optional
[`install-whisper-deck.sh`](https://raw.githubusercontent.com/db452/DeckyWhatsapp/main/install-whisper-deck.sh)
script onto the Deck, then run it from a Deck terminal as the normal `deck`
user, without `sudo`:

```sh
curl -L --fail -o install-whisper-deck.sh https://raw.githubusercontent.com/db452/DeckyWhatsapp/main/install-whisper-deck.sh
chmod +x install-whisper-deck.sh
./install-whisper-deck.sh
```

The installer uses `sudo` only for system package operations. It may temporarily
disable SteamOS read-only mode while preparing build tools, then restores
read-only mode before compiling Whisper locally and downloading its speech
model. This requires internet access, Git, and several hundred megabytes of
temporary and model storage. Voice recordings are transcribed locally; the
installer does not set up a server. The script is included in a repository
checkout and the Windows companion ZIP, but not in the Linux companion ZIP.

## Architecture and help

The [architecture guide](./docs/ARCHITECTURE.md) shows how the Deck plugin, SSH
tunnel, PC bridge, and WhatsApp Web interact. For common connection, media, or
pairing issues, use the platform guide above. Developers can find exact
[build, test, and packaging commands](./docs/DEVELOPMENT.md).

## Privacy and license

The project does not collect, sell, or transmit user data to its authors, and
has no analytics or telemetry service. Messages, media, contacts, and
authentication data are handled by WhatsApp and locally by the user's PC and
Deck. Keep `.wwebjs_auth/`, bridge tokens, SSH private keys, and sensitive logs
private. See [SECURITY.md](./docs/SECURITY.md) for reporting guidance and the
[third-party notices](./docs/THIRD-PARTY-NOTICES.md) for dependency licenses.
Original project code is licensed under the [MIT License](./LICENSE).

Decky WhatsApp is an unofficial project and is not affiliated with, endorsed
by, or sponsored by WhatsApp or Meta. WhatsApp Web compatibility may change
with upstream updates or policy enforcement. Use at your own risk; WhatsApp's
own service and privacy policies still apply.
