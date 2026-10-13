# Decky WhatsApp plugin

This is the Gaming Mode frontend for the PC bridge in the parent directory.

For SSH remote forwarding, run this on the PC:

```powershell
ssh -N -T -o ExitOnForwardFailure=yes -R 8787:127.0.0.1:8787 deck@STEAM_DECK_IP
```

Replace `deck` and `STEAM_DECK_IP` with the Deck SSH account and address. The Decky plugin can then use its default bridge URL, `http://127.0.0.1:8787`.

The plugin is an early test build. It currently receives messages and sends text replies; conversation history, unread counts, notifications, and automatic tunnel startup will be added next.
