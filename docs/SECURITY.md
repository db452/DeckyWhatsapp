# Security policy

## Reporting a security issue

Please do not publish credentials, WhatsApp session files, bridge tokens, QR
codes, or private message content in a public issue.

If GitHub private vulnerability reporting is enabled for this repository, use
that channel. Otherwise, contact the repository owner privately through
GitHub and include only the information needed to reproduce the issue.

## Sensitive files and data

Treat the following as private:

- `.wwebjs_auth/` and any WhatsApp Web session data.
- Bridge tokens and local configuration files.
- SSH private keys.
- Logs containing message text, contact names, media paths, or account details.

The bridge rejects non-loopback host bindings. Keep `HOST=127.0.0.1` (the
default) and connect the Steam Deck through the supported SSH reverse tunnel.
Direct LAN binding is not supported.

## Supported versions

Security fixes are currently provided for the latest version on the default
branch. Because this project depends on an unofficial WhatsApp Web client,
security and compatibility can also depend on upstream changes.
