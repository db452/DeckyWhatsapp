# Third-party notices

This project includes or depends on the following direct third-party packages.
The versions below are the versions currently recorded in the project lockfiles.
Transitive dependencies are recorded in `package-lock.json` files and remain
under their respective licenses.

## PC bridge

| Package | Version | License | Source |
| --- | --- | --- | --- |
| `dotenv` | 17.4.2 | BSD-2-Clause | [repository](https://github.com/motdotla/dotenv) |
| `express` | 5.3.0 | MIT | [repository](https://github.com/expressjs/express) |
| `qrcode` | 1.5.4 | MIT | [repository](https://github.com/soldair/node-qrcode) |
| `qrcode-terminal` | 0.12.0 | Apache-2.0 | [repository](https://github.com/gtanner/qrcode-terminal) |
| `whatsapp-web.js` | 1.34.7 | Apache-2.0 | [upstream repository](https://github.com/wwebjs/whatsapp-web.js) |
| `ws` | 8.22.0 | MIT | [repository](https://github.com/websockets/ws) |

The `whatsapp-web.js` dependency is pinned to a specific Git revision and is
also covered by the compatibility patch in [`patches/`](../patches/).

## Decky plugin

| Package | Version | License | Source |
| --- | --- | --- | --- |
| `@decky/api` | 1.1.3 | LGPL-2.1 | [repository](https://github.com/SteamDeckHomebrew/loader-api) |
| `@decky/ui` | 4.12.1 | LGPL-2.1 | [repository](https://github.com/SteamDeckHomebrew/decky-frontend-lib) |
| `react` | 18.3.1 | MIT | [repository](https://github.com/facebook/react) |
| `react-dom` | 18.3.1 | MIT | [repository](https://github.com/facebook/react) |
| `react-icons` | 5.7.0 | MIT | [repository](https://github.com/react-icons/react-icons) |

## Build and development tools

| Package | Version | License | Source |
| --- | --- | --- | --- |
| `@decky/rollup` | 1.0.2 | BSD-3-Clause | [npm package](https://www.npmjs.com/package/@decky/rollup) |
| `patch-package` | 8.0.1 | MIT | [repository](https://github.com/ds300/patch-package) |
| `rollup` | 4.64.5 | MIT | [repository](https://github.com/rollup/rollup) |
| `tsx` | 4.23.15 | MIT | [repository](https://github.com/privatenumber/tsx) |
| `typescript` | 5.9.3 | Apache-2.0 | [repository](https://github.com/microsoft/TypeScript) |

Type declaration packages used only for development are also listed in the
lockfiles. Their license notices are provided by their respective packages.
