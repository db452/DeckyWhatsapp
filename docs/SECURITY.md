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

The bridge is intended for local use through the SSH tunnel. Do not expose the
bridge directly to the public internet or bind it to a public interface unless
you understand the security consequences.

## Supported versions

Security fixes are currently provided for the latest version on the default
branch. Because this project depends on an unofficial WhatsApp Web client,
security and compatibility can also depend on upstream changes.
