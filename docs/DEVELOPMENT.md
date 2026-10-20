# Development

## Setup

Use Node.js 22 or newer. Install the root bridge dependencies and the plugin
dependencies from the repository root:

```sh
npm ci
npm ci --prefix decky-plugin
```

The bridge dependency uses a pinned `whatsapp-web.js` revision and a local
compatibility patch. Do not update either as part of unrelated changes.

## Typecheck, tests, and builds

Run these from the repository root:

```sh
npm run typecheck
npm run typecheck:plugin
npm test
npm run test:mock
npm --prefix decky-plugin run build
npm run build:mock
```

`npm run test:mock` builds the offline MOCK artifact before running its tests.
The production plugin build writes to `decky-plugin/dist`; the MOCK build
writes to `artifacts/decky-whatsapp-mock/` and checks that the production output
was not changed.

Package PC companion archives with Python 3 from the repository root:

```sh
python scripts/package-companions.py --platform all --output-dir releases
```

Use `--platform windows` or `--platform linux` to package only one companion.
The packaging script uses explicit per-platform allowlists, includes the
documentation linked by the companion README, rejects private/generated
entries, and refuses to overwrite an existing archive.

## Contribution and privacy

- Keep changes focused and preserve Windows, supported Linux, SteamOS, and
  production/MOCK boundaries.
- Never use a real WhatsApp account for tests or debugging. Connecting an
  authenticated client may change remote state even when the intent is to read.
  Use fabricated fixtures and the offline MOCK provider; leave unsafe checks
  unrun and identify them as requiring MOCK or a dedicated test account.
- Do not include `.wwebjs_auth/`, bridge tokens, `.env` files, SSH keys, QR
  codes, message text, contact details, or sensitive logs in commits, reports,
  screenshots, or test output.
- Preserve deliberate startup: do not add login autostart, boot startup,
  scheduled tasks, or persistent services without explicit approval.
- Confirm process ownership before cleanup. Do not stop unknown SSH processes,
  alter the production bridge, or change physical Deck installations as part of
  local development.
- Keep user-facing docs consistent with the current launchers and package
  allowlists. Preserve security guidance, license information, and third-party
  notices.
