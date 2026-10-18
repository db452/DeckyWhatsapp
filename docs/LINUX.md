# Linux PC companion

The initial Linux companion target is Ubuntu or Debian on x86_64, with Node.js
22 or newer. Node.js 24 LTS is recommended. The `whatsapp-web.js` dependency
uses Puppeteer's bundled Chrome; Linux ARM, Fedora, SteamOS, and other
distributions are not supported targets until browser and runtime behavior have
been validated there. Linux runtime acceptance is still pending on a physical
supported desktop.

Use the release asset named `decky-whatsapp-pc-linux-v<version>.zip`. It is a
separate PC companion package; it is not the Windows ZIP or the Decky plugin
archive.

## Install and start

1. Install Node.js 22 or newer (Node.js 24 LTS recommended), npm, and a
   terminal. The installer can offer to install missing Ubuntu/Debian browser
   libraries, Git, and OpenSSH client packages through apt. It asks separately
   before refreshing apt metadata and before installing the resolved package
   list. It does not install Node.js globally.
2. Extract the archive to a permanent directory you own, then run the installer
   from that directory (replace `1.0.0` with the version in the downloaded
   filename):

   ```sh
   unzip decky-whatsapp-pc-linux-v1.0.0.zip
   cd decky-whatsapp-pc-linux-v1.0.0
   ./install-decky-whatsapp-linux.sh
   ```

   If your file manager did not preserve executable permissions, run
   `bash ./install-decky-whatsapp-linux.sh` instead.
3. The installer checks the Steam Deck SSH connection and may offer optional
   SSH-key setup. Existing key files are not overwritten. Review each prompt;
   declining package or key setup leaves those steps for you to complete
   manually.
4. Start the bridge only when you want to use it:

   ```sh
   ./start-decky-whatsapp-linux.sh
   ```

   Keep this one terminal open and press Ctrl+C to stop the launcher's bridge
   and its own tunnel. The installer checks only `steamdeck.local`,
   `steamdeck.lan`, and `steamdeck` through the operating system's hostname
   resolver, then suggests the first resolvable hostname for you to confirm or
   replace. This bounded lookup is not LAN discovery and does not contact SSH
   or authenticate. If no candidate resolves, enter a hostname or IP manually.
   The installer saves the Deck hostname or IP you enter
   for later launches in `~/.config/decky-whatsapp/deck-host` (or the matching
   directory under `XDG_CONFIG_HOME`). The launcher does not open a second
   terminal window and does not install a system service, login autostart, or
   scheduled task.

   To change the saved address, run:

   ```sh
   ./start-decky-whatsapp-linux.sh --configure-deck-host
   ```

   This prompts with the saved address as its default and exits after saving;
   it does not start the bridge or SSH tunnel. You can supply a replacement
   directly with `./start-decky-whatsapp-linux.sh --configure-deck-host HOST`.

   For a one-time address override, use
   `./start-decky-whatsapp-linux.sh --deck-host HOST` or set
   `DECK_HOST=HOST` for that launch. `--help` lists the launcher options.
   Both launchers accept DNS hostnames and IPv4 addresses. Enter the host only,
   without a port or SSH option; IPv6 literals are not supported by the launchers.
5. On the first bridge start, scan the WhatsApp QR code if requested. WhatsApp
   authentication data is stored locally in `.wwebjs_auth/`; keep it private
   and back it up only through a secure method. `.env` is optional local
   configuration and is not included in the release archive.

## Chromium and Puppeteer troubleshooting

The release installs locked Node dependencies with `npm ci`. Puppeteer
downloads its expected Chrome build as part of that install. The installer
checks whether the browser executable exists and whether Linux shared-library
dependencies resolve. If Chrome is missing because npm install scripts were
disabled, from the extracted package directory run:

```sh
npx puppeteer browsers install chrome
```

If the installer reports shared libraries as `not found`, install the
corresponding Ubuntu/Debian packages for your release, then run the installer
again. Package names differ between Ubuntu/Debian releases; do not copy Fedora
package names or install an arbitrary browser in place of Puppeteer's bundled
version. If Chrome still fails to launch, check the terminal output and the
Puppeteer troubleshooting guide for the installed Puppeteer version. The
project currently retains Chromium `--no-sandbox` flags for compatibility;
this is a known security limitation pending Linux runtime validation.

## SSH and tunnel troubleshooting

- Ensure OpenSSH client is installed and SSH is enabled on the Deck.
- The installer saves the hostname or IP entered during installation. The
  launcher reuses it without prompting on later starts. If no address has been
  saved and no explicit override is supplied, it checks only
  `steamdeck.local`, `steamdeck.lan`, and `steamdeck` through the operating
  system's hostname resolver, then asks you to confirm or replace the first
  resolvable hostname. This bounded lookup does not scan the LAN, connect to
  SSH, or authenticate. If none resolve, enter a hostname or IP manually.
- The launcher prints that bridge and tunnel run in the same terminal. It
  reports when the SSH process has launched; that message alone does not prove
  authentication or remote-forward establishment. OpenSSH may prompt for the
  Deck password in this terminal. If SSH exits, the launcher reports the
  observed failure category and does not terminate remote processes.
- The main SSH connection reads interactive prompts from `/dev/tty`, so it can
  ask for a password in the terminal. The launcher captures raw SSH stderr in
  a private temporary file rather than mirroring it live. After exit, it
  reports a concise conflict summary and does not display the captured raw
  stream. This private capture applies to SSH stderr; bridge output is separate
  and may display the WhatsApp pairing QR when authentication is required. The
  temporary SSH capture is removed during normal cleanup. If the SSH process
  identity cannot be verified, the launcher leaves the process and its private
  capture untouched rather than risk signaling an unrelated process.
- A `remote port forwarding failed` message means the Deck refused the reverse
  forward. Another active DeckyWhatsapp session, an unrelated service, or SSH
  forwarding policy may be responsible. The launcher does not terminate remote
  processes. Verify the owner before taking action.
- For reliable prompting, run the launcher in an interactive terminal with a
  controlling TTY. Diagnostic owner probes use SSH batch mode and will not
  prompt for a second password.

The Linux launcher runs in the foreground and starts only after an explicit
user action. It does not enable a desktop autostart entry or persistent service.
