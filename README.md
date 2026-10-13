# Decky WhatsApp PC bridge

This is the PC-side service for a future Steam Deck Decky plugin. It exposes:

- `GET /health` for status checks.
- `POST /messages` to send a text message.
- `WS /events` for status, QR, and incoming-message events.

The first Decky client is in [`decky-plugin/`](./decky-plugin/). It connects to
the bridge over `127.0.0.1:8787`, which can be supplied on the Deck with an SSH
remote forward from the PC.

## Requirements

- Node.js 20 or newer.
- A WhatsApp account that can link a companion device.

## Run it

```powershell
npm install
npm run dev
```

On first start, the bridge emits a QR code event. The QR image is currently logged through the service API rather than displayed by a UI; the Decky client can render it in the next step.

The WhatsApp Web session is stored locally in `.wwebjs_auth/`, which is ignored by Git and must be treated as private credentials.

The service binds to `127.0.0.1` by default. Keep that setting and use an SSH tunnel for the Deck during development. Set `HOST=0.0.0.0` only when you intentionally want the service reachable over the LAN.

This uses an unofficial WhatsApp Web client. WhatsApp may change its web protocol or restrict accounts using unofficial clients.

## SSH connection to the Deck

Once the Decky plugin is installed, run this on the PC in a separate terminal:

```powershell
ssh -N -T -o ExitOnForwardFailure=yes -R 8787:127.0.0.1:8787 deck@STEAM_DECK_IP
```

Replace `deck` and `STEAM_DECK_IP` with the same SSH login details you already
use. Leave this tunnel open while testing the plugin.
