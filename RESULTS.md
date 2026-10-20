# DeckyWhatsapp verification results

This file holds detailed evidence moved from `PLAN.md`; the plan remains the source of approved scope and current checklist status. Results identify who supplied the evidence. Historical failures are retained where they explain later fixes. No private WhatsApp content, credentials, or tokens are recorded.

## Automated tests

### Phase 7 ordinary video — 2026-10-18

- Ordinary incoming WhatsApp videos now receive `[Video]` fallback text, typed `video` media, and bounded MP4/WebM download support. MIME validation is specific to media kind, strips codecs parameters, rejects image/audio payloads and unsupported video formats, and keeps GIF-marked video classified as GIF. The existing 12 MB limit, cache bounds, and view-once no-download behavior remain in place.
- The plugin renders ordinary video with native controls and `preload="metadata"`; it does not autoplay. The offline MOCK contains a fabricated 2,366-byte WebM. Its active React mount test checks the EBML signature/size, source, controls, no-autoplay behavior, unavailable fallback, and that view-once media exposes no video player/retry action.
- A local Puppeteer Chromium run recorded a synthetic 160×90 canvas at 10 fps as `video/webm`, then loaded the generated Blob into a Chromium `<video>` element and awaited `loadeddata`. The browser reported 1.211128 seconds, 160×90 dimensions, 2,366 bytes, and sufficient ready state. The one-off generator wrote only to the Windows temp directory and was removed after embedding its base64 payload into the MOCK provider. No network or WhatsApp data was used.
- `npm.cmd test` passed **115/115** using `NODE_OPTIONS=--import=<absolute file URL to scripts/mock-test-node-preload.mjs>`. A plain run first failed because this restricted Windows context returns `ENOMEM` from `os.userInfo()` before `tsx` loads. A run with a repository-relative preload passed 114/115; the remaining temporary-checkout test could not resolve that relative path. The absolute file URL preload resolved both environment issues.
- `npm.cmd run test:mock` passed **12/12**; `node --import tsx --test src/whatsapp.test.ts` passed **25/25**. Root and plugin typechecks, the production Rollup build, MOCK build, and `git diff --check` passed. The MOCK artifact was rebuilt and its five runtime file hashes were verified before staging.
- Independent review used all three permitted passes. Pass 1 required kind-specific MIME validation and a playable MOCK fixture; pass 2 confirmed MIME handling but still required the fixture; pass 3 returned **PASS** after the synthetic WebM was embedded and the updated MOCK tests passed. The reviewer independently reran the MOCK suite and both typechecks. Physical Deck playback and no-autoplay checks later passed; remaining physical checks are listed below.

### Phase 7 follow-up — video controller and notification session — 2026-10-18

- Y now starts or pauses ordinary video on the highlighted message; audio keeps its existing Y action, images and view-once video remain excluded, and text-entry focus suppresses the shortcut. The MOCK React mount simulates controller input and verifies play/pause. Independent review passed on pass 1; physical Y input remains unverified.
- A background notification event is accepted only while the notifications setting, Deck connection setting, and event socket are active, and only when its valid Unix-second timestamp is at or after the current socket-session watermark. The watermark is cleared on disconnect/stop, so older messages surfaced after reconnect are ignored. The subscription remains open when Quick Access is closed.
- The watermark rounds socket-open time up to the next whole second because WhatsApp message timestamps have second precision. This intentionally suppresses ambiguous events in the partial second when the socket opens; it assumes the Deck clock and WhatsApp timestamps are reasonably aligned.
- Notification-session unit tests passed **4/4**. Independent review passed on pass 1; the reviewer ran notification-session, notification-ID-cache, and connection tests **14/14**, MOCK/provider tests **12/12**, plugin typecheck, and `git diff --check` (line-ending warnings only). The reviewer found no actionable issue; physical toast behavior remains unverified.
- After adding the notification test to the root script, `npm.cmd test` passed **120/120** using `NODE_OPTIONS=--import=file:///C:/Users/dbett/Desktop/DeckyWhatsapp/scripts/mock-test-node-preload.mjs`. The implementation run also passed the plugin build and typecheck; the MOCK suite passed **12/12**.
- The previous remote production-only stage at `/home/deck/decky-whatsapp-production-video-20261018-112613` predates these follow-up changes and must not be installed. The current `deploy-decky-plugins.bat` rebuilds and stages both reviewed variants, validates identities and hashes, then prompts for `DEPLOY` and sudo before changing either installed plugin. No current follow-up artifact has been staged or installed yet.

### Phase 7 reaction notification fix — 2026-10-18

- The bridge now forwards the reaction ID, actor attribution, parent-message `fromMe`, and reaction timestamp from the pinned WhatsApp library event. The plugin notifies only for a non-empty reaction from another participant on a user-authored message. It fails closed when attribution, event identity, or timestamp is missing, deduplicates reactions separately from messages, and uses the existing active-session, gaming, sound, and preview settings. No message body or contact content is included in the reaction toast.
- Added a fabricated offline MOCK reaction event and focused eligibility/bridge tests. Validation reported by the explicitly invoked Fixer: focused bridge/reaction/session tests **31/31**, MOCK/provider tests **12/12**, root typecheck, plugin typecheck, plugin build, and `git diff --check` passed. Direct test startup required the repository preload because this Windows runner reports `ENOMEM` from `os.userInfo()`.
- The Fixer workflow does not include an independent review pass. No live WhatsApp account was accessed, and no files were staged or deployed.

### Dated Windows/Linux companion packages — 2026-10-18

- Ran `python scripts/package-companions.py --platform all --output-dir releases/2026-10-18`. The explicit platform allowlists produced `decky-whatsapp-pc-windows-v1.0.0.zip` and `decky-whatsapp-pc-linux-v1.0.0.zip`; the packager verified exact contents and excluded private/generated files.
- `python -m zipfile -t` passed for both archives. The Linux installer and launchers have ZIP mode `755`.
- SHA-256 — Windows: `9863b46a41186d9c28c18893689451ed499addb15b72db7d21a6d151f00a0e83`; Linux: `0794a267469cb32637fabdc6fc992b1d18230f473901848e49955d886ae873a1`.
- These are local release packages only; no GitHub release was created or modified.

### Release closeout checks — 2026-10-17

- On the repository checkout, `npm.cmd test` passed `112/112` before the CDP diagnostic correction and `113/113` after it; `npm.cmd run test:mock` passed `12/12`; root and plugin typechecks passed; the production Decky build and MOCK artifact build passed. The corrected CDP suite passed independent review on pass 1.
- Repeated those checks from an isolated temporary Windows checkout whose directory name contained spaces. The full suite passed `112/112`, the MOCK suite passed `12/12`, both typechecks passed, and both production and MOCK builds passed. The temporary copy excluded ignored authentication/config/log data and was removed after validation.
- `python scripts/package-companions.py --platform all --output-dir <temporary path with spaces>` built both v1.0.0 companion ZIPs. `python -m zipfile -t` passed for each archive; the explicit ZIP inspection confirmed the privacy filters and Linux launcher executable bits. Temporary archives were removed after validation.
- The GitHub-hosted `.github/workflows/linux-package.yml` workflow was removed per the user's decision to use the dedicated Ubuntu VM. Independent review passed on pass 1; no other GitHub Actions workflows or stale references remain. Local companion ZIP packaging remains available through `scripts/package-companions.py`. GitHub no longer runs these checks or automatically attaches ZIPs to releases; no release was published or modified.

### Phase 1 reliability and stale-tunnel checks — 2026-10-15

- Bridge owner identification passed independent review on pass 2. Windows `npm.cmd test` passed `31/31` with the temporary `os.userInfo()` preload; root typecheck, Decky frontend build, PowerShell parsing, and `git diff --check` passed.
- Bounded stale-forward retry passed independent review on pass 3. `npm.cmd test` passed `44/44`; typecheck, PowerShell parsing, and diff checks passed. The retry requires the existing local bridge to remain healthy and never kills a remote process. The OpenSSH success diagnostic is version-dependent.
- Deck SSH configuration was inspected read-only; effective `ClientAlive` values could not be verified without sudo. No Deck SSH configuration was changed. Safe recovery from a genuinely stale tunnel remains a manual check.

### Phase 2 controller and reply fixes — 2026-10-15

- The retry-uncertainty fix passed independent review and frontend build/typecheck. Uncertainty is retained for the mounted plugin session; it is not persisted across plugin remounts.
- Reply-field focus and Steam keyboard activation passed independent review on pass 2; frontend build/typecheck and scoped diff checks passed. The root suite passed `31/31` with the documented Windows preload.

### Phase 3 notifications and conversation usability — 2026-10-15

- Tasks 3.1–3.3 passed independent review; root suite `31/31`, root typecheck, frontend build/typecheck, and `git diff --check` passed with the temporary preload.
- A reviewer-run mocked callback harness checked notification deduplication, settings/privacy behavior, reconnect/stop/start, and bounded cache cleanup.

### Phase 4 Windows lifecycle — 2026-10-15

- Task 4.1 initially received four review findings: replacement-process shutdown safety, QR persistence in logs, port configuration, and supervisor lifetime after port reuse. After remediation, it passed review on pass 3. The root suite passed `37/37` with the temporary Windows preload; typecheck, PowerShell parsing, and diff checks passed.
- Task 4.2 passed review on pass 2; frontend build, frontend TypeScript check, and diff checks passed.
- The user confirmed all Phase 4 Windows manual checks passed; see **Manual tests**.

### Phase 5 fixes — 2026-10-16

- **Chronological ordering regression:** code sorts fetched history before selecting the latest window, preserves source order for messages with the same second-level timestamp, and sorts contacts and live/history updates. Bridge tests, typechecks, plugin build, and diff checks passed; independent review passed on pass 2.
- **Conversation update race:** a history response could replace a just-arrived live message with stale history. The merge fix passed automated checks and independent review on pass 3.
- The user later confirmed the final Linux/Windows/Deck Phase 5 behavior. Details and the user-reported custom-port exception are in **Manual tests**.
- Task 5.1 static audit and Task 5.2 installer passed independent review on pass 2; Git Bash syntax and trailing-whitespace checks passed. The Linux release ZIP was independently checked against its file allowlist and executable-mode requirements.
- Task 5.3 initially had review findings after pass 3; the user authorized fixes, and the FIFO lifetime and output-backpressure issues passed an independent follow-up review. Focused Linux SSH tests passed `2/2`, syntax/typecheck/diff checks passed, and the root suite passed `37/37` with the Windows preload.
- Task 5.4 packaging/documentation passed review on pass 2. Windows and Linux ZIPs were built reproducibly from explicit allowlists. Task 5.5 tunnel-reservation tests passed three consecutive runs; the root suite passed `46/46`, and typecheck, shell syntax, and diff checks passed.

### Ubuntu installer/runtime validation — 2026-10-16

- Environment: Ubuntu 26.04.1 LTS x86_64; Node 24.22.0/npm 11.19.1 were provisioned in the dedicated test directory; Git 2.53.0 and OpenSSH 10.2p1 were present. The local release archive was built for testing, not published. SHA-256 verified: `3707aed5c8dc5d478a99b36cb94ecf6aea529e9545631172efa6dccf7e6e2a31`.
- `npm ci --no-audit --no-fund` passed (326 packages). npm warned that Puppeteer and esbuild scripts were outside its allowlist; Chrome was nevertheless present and esbuild reported 0.28.2. `bash -n`, focused launcher config test, `npm run typecheck`, and `npm test` passed (39 passed, 0 failed, 14 Windows PowerShell-specific skipped). Chrome `about:blank` passed with bridge launch arguments.
- The bridge bound to `127.0.0.1:18787`; health reported `qr_required`. It was stopped through its owned session; port and child processes were released. No WhatsApp account was authenticated.
- Apt initially rejected repository metadata because guest time was about 19 hours behind. After the user corrected the clock, apt refresh succeeded and only `libxss1` (`1:1.2.3-1build4`) was installed. `ldd` found no missing Chrome libraries. `--no-sandbox` was required for Chrome in this Ubuntu 26.04/AppArmor VM; `--disable-setuid-sandbox` alone did not launch Chrome.
- The installer was run with `127.0.0.2`, and `no` was entered at the unknown SSH host-key prompt. The expected SSH verification failure was logged; the command returned exit code 0. The test config contained only the loopback host; no service/autostart/task was created. Logs were recorded under `/home/vboxuser/DeckyWhatsapp-linux-installer-test-20261016/`.

### Windows VM compatibility and installer testing — 2026-10-17

- Initial VM start attempts under the sandbox returned VirtualBox `E_FAIL`; no guest changes were made. Read-only diagnosis found different VirtualBox user contexts: the sandbox identity lacked VM write access, while the approved owner context could inspect/run the VM. `VBoxManage` was Oracle 7.2.20r175154. No ACL, security, snapshot, or sandbox changes were made.
- Guest baseline: Windows 11 Home build 26300 x64, 7.98 GiB RAM; Node/npm/Git absent; OpenSSH Client and `winget` present. The installer installed Node.js 24.20.0 and Git for Windows 2.55.0.5, installed 326 npm packages, applied the WhatsApp patch, and created guest-only SSH key/shortcuts. Reinstall completed and preserved the key and shortcuts. npm was 11.19.0. A fresh guest-only Puppeteer cache downloaded Chrome. `npm run typecheck` passed.
- `package.json` was changed to explicitly approve only pinned `puppeteer@24.38.0` install script; independent review passed. The esbuild install script remained unapproved; npm's warning was advisory and did not establish an installer failure.
- Early full-suite attempts were incomplete: one run had 64 pass, 11 fail, 10 cancelled, 1 skipped because an overlay helper was missing; another hung in six server lifecycle tests. The verified orphan child belonged to a mocked `src/server.ts` test, bound only to `127.0.0.1:50510`, and did not authenticate WhatsApp. It was stopped only after PID, command line, and parent chain checks. A later aggregate had 65 pass, 12 fail, 8 cancelled, 1 skipped. Reproduction showed Windows PowerShell 5.1 child startup took 3.47–4.42 seconds, exceeding existing waits.
- Test harness fixes added bounded waits, serial execution, test-owned child cleanup, realistic Windows PowerShell startup budgets, and fast Node HTTP probe mocks. Focused server/tunnel suite passed `27/27`. PowerShell 7.6.7 was installed in the guest; the isolated checkout's missing prompt script was copied and SHA-256 verified. Final `npm.cmd test` passed `86/86`, no skips; `npm.cmd run typecheck` passed. Chrome launched `about:blank` with default Windows arguments and closed. Final inspection found no residual Node process or listeners on ports 8787/18787. Real-session testing was intentionally omitted.

### Phase 6.1 PluginFix — 2026-10-17

- Root cause was not confirmed on hardware; evidence pointed to unguarded optional Steam resume/controller API registrations before UI render. A compatibility layer now guards registrations and cleanup and reuses listeners across bundle evaluations. Independent review passed on pass 3 after two remediation rounds.
- Focused compatibility tests passed `10/10`; full root suite passed `96/96` with the documented Windows `os.userInfo()` preload. Root typecheck, Decky frontend build, offline package-lock check, and scoped diff check passed. The user later confirmed the physical Deck validation passed; see **Manual tests**.

### Phase 6.1 modularization slices

- `ContactAvatar` and `MessageBubble` presentation slices, plus avatar initials/style helpers, passed independent review (one pass per slice). `npm.cmd run build`, `npm.cmd exec -- tsc --noEmit -p tsconfig.json`, and `git diff --check` passed. No dependency or state-management library was added. The user later confirmed physical Deck behavior passed; see **Manual tests**.

### Phase 6.4 local feature checks

- Deck-side Start/Stop and resume behavior was implemented; independent code review passed on pass 3, and typecheck, plugin build, and focused tests passed. The user later confirmed behavior on Deck.
- Incremental history loading (10 older messages per request, focus/highlight placement) passed independent review on pass 2 and automated tests. The user later confirmed physical controller scrolling/focus behavior.
- Suggested Deck address lookup uses bounded OS hostname candidates (`steamdeck.local`, `steamdeck.lan`, `steamdeck`), with no subnet scan or SSH/authentication during discovery; explicit/saved host and manual override precedence are retained. Independent review passed on pass 2; platform prompt tests and dock/Wi-Fi manual verification passed per user report.
- View-once support is explicitly unavailable through the installed WhatsApp media API. Detection and a phone fallback were added; media download is skipped and no “viewed” claim is shown. Fabricated photo/video/audio fixture and active React fallback/no-retry/no-player/Y-action assertions passed independent review on pass 1; `npm.cmd run test:mock` passed `12/12`. The user later confirmed physical MOCK fallback/navigation behavior.

### Phase 6 final automated verification — 2026-10-18

- `npm.cmd test` passed **112/112** with `NODE_OPTIONS` pointing to the Windows test preload by absolute file URL. The initial attempt used a relative preload path; one child test running from a temporary directory could not resolve it. The isolated failing case then passed with the absolute preload, followed by the complete passing suite.
- `npm.cmd run test:mock` passed **12/12**, including the active React mount/remount and offline isolation checks. `npm.cmd run typecheck:plugin`, `npm.cmd run typecheck`, and `npm.cmd --prefix decky-plugin run build` passed.
- These results support the code-level completion of the reviewed Start/Stop/resume, history expansion, unsupported view-once fallback, suggested-host, and simulated controller-navigation tasks. They do not establish physical Deck behavior or the user's requested clean-snapshot installs.

### Final code review and artifact cleanup — 2026-10-18

- Independent reviewer verdict: **PASS**. No actionable release-blocking defect was found in the reviewed frontend/provider lifecycle, Steam compatibility, bridge/history/media handling, installers, launchers, deployment helper, or packaging allowlists. The reviewer independently ran both typechecks, 66 focused regression tests, 12 MOCK/provider tests, PowerShell parser checks, and `git diff --check`; full VM/install and physical Deck checks were not repeated.
- `.gitignore` now covers local environment overrides, private-key formats, credential/secret files, and generated Deck deployment bundles while keeping `.env.example` visible. Filename checks found no tracked private-key or credential files; the existing WhatsApp auth/cache directories remain ignored.
- Removed six stale generated directories from `artifacts/`: two earlier deploy bundles, three superseded MOCK update bundles, and an empty CDP scratch directory. Retained the current MOCK build and the latest combined no-viewer bundle referenced by installation evidence.

### Phase 6.2 regression and security checks — 2026-10-17

- Task 6.2 passed independent review on pass 1. Focused helper tests passed `4/4`; the full suite passed `50/50`, then `53/53` after Task 6.3 regressions, using the temporary Windows preload. Root typecheck, frontend build/typecheck, and scoped diff checks passed.
- Task 6.3 passed independent review on pass 3 after two remediation rounds. Synthetic redaction tests and corrected Python CI test discovery passed. Static review covered loopback binding, authentication boundaries, token-safe competing-bridge probes, and preservation of local authentication files; physical Deck log/session checks remain pending.

### Phase 1.4 stale-port / tunnel recovery

- Bounded Windows recovery for an unidentified stale remote-forward conflict passed independent review on pass 3. The `44/44` automated tests and code-level checks passed. The behavior avoids killing a remote process and confirms the existing local bridge remains active. Privileged Deck `sshd` dead-client-expiry configuration remains outside these automated results.

### Read-only Steam Deck CDP tunnel helper — 2026-10-17

- Independent review passed on pass 3. The opt-in PowerShell helper reuses a recognized endpoint, supports Start/Status/Stop, binds only to `127.0.0.1:9222`, and prints target metadata without WebSocket URLs.
- Start → Status → Stop cycles passed under PowerShell 7.6.6 and Windows PowerShell 5.1.26100.9711. Each request returned six SteamUI page targets; only the process launched by the helper was stopped, and port 9222 was confirmed closed.
- An earlier cycle exposed culture-sensitive timestamp parsing. The owned process was verified and stopped; the helper was corrected to store UTC ticks before final review. No SSH configuration, keys, firewall, plugin files, or system settings were changed.

### Optional Whisper installer static review — 2026-10-16

- Independent review passed on pass 1. The reviewed installer repairs missing header packages, restores SteamOS read-only mode after package preparation (and fails if restoration fails), stages and validates a pinned source checkout, verifies existing/downloaded models against a pinned digest, and rejects root execution. `bash -n` and scoped `git diff --check` passed. Installer execution and transcription were not part of the static checks; see **Manual tests**.

### Phase 6.2 MOCK implementation, active React, and deployment tooling — 2026-10-17

- MOCK isolation/build work passed independent review on pass 3. `npm run test:mock` passed `10/10`; plugin and root typechecks passed; full `npm.cmd test` passed `96/96` with `scripts/mock-test-node-preload.mjs` configured in `NODE_OPTIONS`. Reviewer independently reran the MOCK suite and typechecks.
- Active React mount test exercises effects, fabricated history/events, simulated send/reaction, cleanup/remount, no fetch/WebSocket or Decky RPC, MOCK-only storage, and a production-key sentinel. `npm.cmd run test:mock` passed `11/11`; plugin typecheck and root `96/96` passed; scoped diff check passed. Independent review passed.
- Focused image viewer modal options fix passed independent review pass 1. MOCK suite passed `11/11`, plugin typecheck passed, and root suite passed `101/101` using the documented preload.
- Added fictional view-once photo/video/audio fixtures without media bytes or URLs. Active React assertions check fallback text, no retry/audio player, Y does not open media, and no network/backend access. MOCK suite passed `12/12`; plugin typecheck, root suite `101/101`, and scoped `git diff --check` passed. Independent review passed on pass 1.
- MOCK deployment helper: `node --test scripts/suggest-deck-host.test.mjs` passed `7/7`; PowerShell parse and diff checks passed. `node --test scripts/deploy-process.test.mjs` passed `3/3` (successful output/exit, nonzero exit, and owned-process timeout). Both deployment scripts parsed; generated Bash passed `bash -n`; local regular-tree and symlink/junction rejection fixtures behaved as expected. Production/MOCK builds and diff checks passed. Independent review pass 3 passed after two remediation rounds.
- MOCK image viewer installation script passed review pass 3 after two remediation rounds. Embedded Python expressions passed AST parsing; Git Bash `bash -n` passed; staged script hash matched the recorded value. It verifies production tree integrity and all five MOCK artifact hashes before and after the MOCK-only write and restarts Decky once.
- **MOCK image viewer Y regression fix — 2026-10-18:** after the user confirmed that physical Y returned to contacts, the implementation added a fallback to the last focused message when `document.activeElement` does not reflect controller focus, plus a cancel guard so dismissing the image modal cannot also close its conversation. The active MOCK test now invokes the registered controller-Y callback and checks same-turn cancel propagation while preserving conversation/reply selection. Independent reviewer pass 1 returned **PASS**. `npm.cmd run test:mock` passed `12/12`; `npm.cmd run typecheck:plugin` and `npm --prefix decky-plugin run build` passed. The test harness does not render Decky's actual modal/focus implementation; physical verification requires deploying the updated MOCK build and retrying Y/B.
- CDP/manual execution results are separated below; local test results do not prove the updated viewer works on the Deck.

#### Reusable MOCK CDP harness — 2026-10-17

- Added the directly declared `chrome-remote-interface` client pinned to `0.34.0`, a repository-managed target/guard/diagnostics test suite, and a MOCK-only semantic scope that remains mounted across contacts, conversations, and settings. The CLI uses only loopback targets, retains the validated discovery target, rejects HTTP/WebSocket redirects, bounds commands and cleanup, and defaults to read-only inspection. Optional actions are restricted to exact MOCK controls.
- `node --test scripts/mock-deck-cdp.test.mjs` passed `11/11`, including rejected redirects, validated target retention, timeout/owned-socket cleanup, fail-closed MOCK guards, and sanitized diagnostics. `npm.cmd run test:mock` passed `12/12` and rebuilt `artifacts/decky-whatsapp-mock`. `npm.cmd run typecheck` and `npm.cmd run typecheck:plugin` passed.
- With `NODE_OPTIONS=--import=file:///C:/Users/dbett/Desktop/DeckyWhatsapp/scripts/mock-test-node-preload.mjs`, `npm.cmd test` passed `112/112` (0 failures; 105.5 seconds). The preload is needed on this host because plain startup can fail with `uv_os_get_passwd: ENOMEM`. An initial preload attempt using a Windows `C:/...` path failed with `ERR_UNSUPPORTED_ESM_URL_SCHEME`; rerunning with a `file:///` URL succeeded.
- Independent review pass 1 requested redirect, timeout, and layout-scope fixes. Review pass 2 passed the implementation and requested a timing clarification; review pass 3 passed that documentation correction. No physical Deck connection or controller interaction was performed during implementation/review.

### Phase 6 test environment limitations

- On the Windows host Node 24.20.0, plain `npm.cmd test` can fail before tests with `uv_os_get_passwd: ENOMEM` from `os.userInfo()`. The full passing runs used the absolute preload `scripts/mock-test-node-preload.mjs`; the preload was used only for tests.
- Ubuntu suite skips Windows PowerShell-specific tests. VM Chrome sandbox findings apply to that Ubuntu VM configuration.
- Physical Deck behavior of the new harness and SteamUI selectors remains unverified. Earlier CDP-driven MOCK actions do not verify physical controller input.
- No test connected or authenticated a live WhatsApp account. Any account-dependent runtime behavior is untested by automation.

## Manual tests

### Phase 7 ordinary video — 2026-10-18

- **Install and isolation:** The user installed the staged MOCK-only artifact. Read-only verification found `plugin_loader.service` active, MOCK identity `Decky WhatsApp MOCK` / `decky-whatsapp-mock`, and all five installed runtime hashes matching the reviewed bundle: `plugin.json` `f0069bfe102e829426bca041f577bd1a2377bcbb1770d9292749fcbf1da5603a`, `package.json` `ea93c4086d9a92c7ec84367953504fbff17172b2607ca26ce953a83c5fcf851c`, `main.py` `cebdf0fb9dbbc65eb0f19ad04a93f18d66013b3e8f0e0fdfbef159f33198a93bf3`, `dist/index.js` `a7b4e06fc994d5ec2136f324e9e3c12412a68f141cca221139944d57bd9adf87`, and `dist/index.js.map` `82076b51080e21d6ce4211c194ce279cb06c6337f5a26c28900acb82a636d306`. The production plugin tree hash remains `12517be3ff25c86587a6ed960e43cdb9f0360a2e09a9818154246d5557af15ef`.
- **Preflight and isolation:** Before interaction, the helper found no common game-runtime process names. `QuickAccess_uid2` contained the exact MOCK provider/label/scope marker. Sanitized diagnostics reported zero forbidden bridge/WhatsApp requests, zero console errors, and zero JavaScript exceptions. No production panel, conversation, data, or credentials were accessed.
- **Playback:** Opened Ava's fabricated conversation and found exactly one `mock-ava-video` element labeled `mock-video.webm`. It had native controls, `preload="metadata"`, and no autoplay attribute; the player began paused with the play control visible. After playback, read-only player state reported `currentTime=1.211`, `duration=1.211`, `readyState=4`, `ended=true`, `paused=true`, `autoplay=false`, and no media error. The user also reported seeing the video move. A captured screenshot showed the fabricated offline video and native controls; temporary screenshots created for this check were removed. This verifies playback and no-autoplay, but not a separate controller-input path.
- **Safe navigation tooling:** The existing helper's `open-ava` action failed closed because the CEF hit-test node omitted ancestry IDs. A bounded DOM check confirmed the hit-tested backend node was a descendant of the exact MOCK Ava button; the follow-up click was restricted to that target inside the validated MOCK panel. No repository code was changed for this test.
- **Remaining manual checks:** Pause/resume through the player controls, controller navigation, playback-error fallback, and the physical view-once fallback/no-player behavior remain pending. Local automated MOCK tests cover the error and view-once fallback paths; no physical video error was induced.
- **Next combined deployment:** `deploy-decky-plugins.bat` is the intended Windows workflow for rebuilding/staging both current variants and, after explicit `DEPLOY` plus the user's sudo entry, installing both and restarting `plugin_loader.service` once. Do not use the older production-only stage above.
- **Pending controller and notification checks:** On MOCK, press Y to start, pause, and resume the fabricated ordinary video and confirm image/view-once exclusions. On production, the user should confirm that messages received while DeckyWhatsapp is disabled/offline do not create delayed toasts after reconnect, while a fresh incoming message during an active session can notify even with Quick Access closed. Codex did not connect to or interact with WhatsApp.
- **Tunnel cleanup:** The tunnel helper's recorded process PID `15140` was absent when cleanup ran, so it stopped no process. The CDP endpoint still returned SteamUI targets but was not confirmed as owned by the helper; it was left untouched rather than risking termination of another session. The local helper metadata remains for inspection.

### Phase 7 combined production and MOCK version check — 2026-10-18

- Read-only SSH to `deck@steamdeck.lan` confirmed `plugin_loader.service` is active and both installed plugin directories are real directories at their expected paths. Production identity is `Decky WhatsApp` / `decky-whatsapp`, package `decky-whatsapp-plugin`, ESM; MOCK identity is `Decky WhatsApp MOCK` / `decky-whatsapp-mock`, package `decky-whatsapp-mock`, ESM.
- Compared all five runtime file SHA-256 values for each installed variant with local artifact `artifacts/decky-whatsapp-deploy-20261018-114509-439`; every file matched. Production hashes: `plugin.json` `74626aa21c364187250dddf6d816d536272445c4d65767ddbcda71b204ecf6df`, `package.json` `cfe3e157d73fa7b1ed2cb6e4a697941d629cf4f3922076196f6953c640c1148f`, `main.py` `a81823cb4d6b779f11fe5b996532c50953473cc6b6ed1444934fc7a39ffacb21`, `dist/index.js` `c2878abd1a4571b2388dcb10040920b54a71940cddd069df2ee55035bbc8b792`, `dist/index.js.map` `5a3ea6b234bddd554b85768088fdc1bd6f1afb215cad1e5d1fbebadee705e75b`. MOCK hashes: `plugin.json` `f0069bfe102e829426bca041f577bd1a2377bcbb1770d9292749fcbf1da5603a`, `package.json` `ea93c4086d9a92c7ec84367953504fbff17172b2607ca26ce953a83c5fcf851c`, `main.py` `cebdf0fb9dbbc65eb0f19ad04a93f18d66013b3f8e0fdfbef159f33198a93bf3`, `dist/index.js` `fcc0b4afd4a00c35d6e81eb25e4bc62f33e9f74dfb34afb0d79abac220cea684`, `dist/index.js.map` `d6996f91428769acdc6622ba83adf0a06477341521b842b48f5c359b56b625cc`.
- No files were copied and no service was restarted during this check. Hash/identity installation verification passed; independent Gaming Mode loading and UI behavior checks remain pending.

### Phase 7 reaction notifications — manual verification pending

- The reaction notification fix has not been deployed or tested in Gaming Mode. After deployment, verify that another participant reacting to one of the user's sent messages produces one notification, while self-reactions, reactions to another person's message, and reaction removals do not. Check preview and sound settings. Codex did not connect to WhatsApp or inspect conversations.

### Closeout session attempt — 2026-10-17

- Read-only SSH confirmed `plugin_loader.service` active and distinct production (`Decky WhatsApp` / `decky-whatsapp`) and MOCK (`Decky WhatsApp MOCK` / `decky-whatsapp-mock`) identities. The first no-game process scan was invalid because it matched its own SSH command text; the corrected scan reported no matching Steam game/compatibility path.
- The existing CDP endpoint returned SteamUI target metadata but was not owned by the tunnel helper. Before a diagnostic fix, `node scripts/mock-deck-cdp.mjs --endpoint http://127.0.0.1:9222` returned a sanitized generic error. After the reviewed fix, it reported `Verified MOCK panel scope is absent; no UI action was taken.` No UI action occurred. The tunnel was left running; no new tunnel was launched or stopped.
- Retried the no-game check and read-only MOCK scope probe after the user said they were opening the panel: the game-path scan again returned `false`, but the MOCK scope was still absent. No interaction was attempted.
- The first Ubuntu SSH attempt in this closeout session could not reach the VM. On 2026-10-18, read-only VirtualBox inventory confirmed the registered Ubuntu VM was powered off; it was started headlessly after approval, SSH became available after boot, and the VM was shut down gracefully after testing. No snapshot was read or changed.
- No production panel or conversation was opened, no WhatsApp account was connected, and no physical controller input or dock/network transition was performed.

### Linux checkout-with-spaces verification — 2026-10-18

- Created an isolated source snapshot from the current workspace, excluding ignored files, authentication/configuration data, logs, build outputs, dependency directories, and planning/results documents. Transferred it into `/home/vboxuser/Desktop/DeckyWhatsapp checkout with spaces 20261017` on the Ubuntu VM. The VM used its existing Node.js `v24.22.0` and npm `11.19.1`; no system packages were installed.
- `npm ci` and `npm ci --prefix decky-plugin --no-audit --no-fund` both completed from that path containing spaces.
- `npm test`: 113 total, 98 passed, 15 skipped (Windows-only), 0 failed. `npm run test:mock`: 12 passed, 0 failed.
- `npm run typecheck`, `npm run typecheck:plugin`, `npm --prefix decky-plugin run build`, and `npm run build:mock` all passed from the spaced path.
- `bash -n` passed for the Linux installer, Linux launcher, tunnel helper, launcher validation helper, and both Linux launcher regression scripts. `bash tests/launcher-validation.test.sh` and `bash tests/linux-launcher-config.test.sh` both passed.
- npm printed upstream dependency deprecation/integrity notices and an `esbuild` install-script notice; these did not prevent tests, typechecks, or builds. The isolated checkout and temporary source archive were removed afterward.
- A final read-only Deck check again found no game-path process. The CDP harness still reported `Verified MOCK panel scope is absent; no UI action was taken.` No UI action was attempted.

### Phase 1 — user decision, 2026-10-15

- User marked Phase 1 passed. This is a user decision, not a claim that every explicitly deferred stale-tunnel/Deck SSH keepalive check passed; those items remain deferred in `PLAN.md`.
- The password-only SSH diagnostic probe was intentionally ignored by the user and was not verified. Safe recovery from a genuinely stale tunnel and Deck `sshd` keepalive configuration remain deferred.

### Phase 2 and Phase 3 Gaming Mode — user-confirmed, 2026-10-15

- User reported all Phase 2 and Phase 3 manual checks complete. The plan records those phases as complete per the user confirmations.

### Phase 4 Windows checks — user-confirmed, 2026-10-15

- User confirmed the Phase 4 background start/stop, notification/disconnect/shutdown distinction, sleep/IP reconnect, and no-login-autostart checks passed.

### Phase 5 Linux/Windows/Deck checks — user-confirmed, 2026-10-16

- User reported that Phase 5 manual checks passed and declared the phase complete. Their confirmation covers installation, bridge/tunnel behavior, messaging, chronological ordering, reconnects/restart, and controller focus/scroll follow-ups.
- The custom-port check was intentionally ignored by the user. The Linux companion asset was later published in GitHub release v1.1.0; see the release record below.
- Historical Linux manual test was initially partial: install completed after manual Deck address entry; SSH was reachable and QR authentication succeeded, but the plugin remained “Computer unavailable, retrying connection,” and the launcher re-prompted for the Deck address. Address persistence/startup-status fixes were later reviewed, and the user subsequently confirmed final Phase 5 checks passed.
- Ubuntu VM installer host prompt used `127.0.0.2` and declined an unknown host key. User said install/key flow appeared successful and confirmed generating an unencrypted test key. Exact `ssh-copy-id` output was not captured; that specific setup result is user-reported, not independently verified. No Deck login or tunnel was attempted in that VM test.

### Phase 6 Windows/Ubuntu VM manual inputs — 2026-10-17

- Ubuntu: the user corrected the VM clock after apt rejected repository metadata as “not valid yet”; subsequent package refresh/install succeeded. The installer/key setup was reported successful by the user. There was no WhatsApp login or pairing. Guest was gracefully shut down and observed `poweroff`.
- Windows: user reported the VM could be started from their interactive PowerShell. The VM was later available through the approved owner context. The automated installer, reinstall, browser smoke, and test suite passed as recorded above. No real WhatsApp session was used; so existing-session preservation and account behavior were not tested.
- Physical Deck integration from Ubuntu was limited to a TCP 22 reachability check: `steamdeck.lan` resolved to `192.168.1.242`; port 22 was unavailable while Deck was off and reachable after user powered it on. No SSH login occurred.

### Phase 6.1 PluginFix physical checks — completed per user report (2026-10-18)

- These checks were pending when the compatibility fix was first reviewed. The user later confirmed startup, controller behavior, suspend/resume, session preservation, and existing functionality passed; see the final verification summary below.

### Phase 6.1 modularization / Phase 6.4 runtime checks — completed per user report (2026-10-18)

- These checks were pending at the automated review checkpoint. The user later confirmed the refactored UI, Start/Stop/reconnect, OFF-by-default behavior, suspend/resume, history focus/scroll, suggested-host flow across docked Ethernet/Wi-Fi, and MOCK view-once/navigation checks passed. Windows and Linux checkout-with-spaces checks are also complete; see the final verification summary below.

### Optional Whisper installer — runtime checks pending

- **PENDING:** execute the reviewed installer on Steam Deck and verify package preparation/read-only recovery, pinned source/model validation, and successful transcription. Controlled transcription failure/log redaction also remains unverified. No installation or transcription was performed as part of the static review.

### Phase 6.2 MOCK preflight, installation, and Gaming Mode — 2026-10-17

- **Read-only preflight:** Decky Loader v3.2.10; `plugin_loader.service` active; production plugin path `/home/deck/homebrew/plugins/decky-whatsapp`, identity `Decky WhatsApp` / `decky-whatsapp`; MOCK path `/home/deck/homebrew/plugins/decky-whatsapp-mock`, identity `Decky WhatsApp MOCK` / `decky-whatsapp-mock`, ESM. Loader source indicates ESM support and per-manifest-name frontend routing. Before initial install, MOCK plugin/settings/data/log paths were absent; no game executable was found under Steam's `steamapps/common`. User authorization covered MOCK-only install and restart.
- **Initial MOCK install and integrity:** user ran the reviewed install script and Decky restart. Read-only checks found exactly the five expected runtime files with artifact-matching hashes, `root:root`, directory mode 755 and file mode 644; service active; production identity unchanged and production tree hash unchanged (`b3bc…8a6e` at that checkpoint). Loader logs reported MOCK loaded. A DeckMTP `stop_mtp()` TypeError was also observed; it was attributed to DeckMTP, not MOCK. The MOCK process exceeded the loader's five-second stop wait and was SIGKILLed during reload; this was an observation, not a confirmed MOCK defect.
- **Initial offline CDP subset:** user opened only MOCK. CDP confirmed `data-decky-provider="mock"`; Start loaded five `mock-` contacts. Tests used fabricated Ava/Garden/group conversations and synthetic IDs only: local send/reaction, incoming notification, stop/start, close/reopen, reset, and history expansion from 5 to 8 messages passed. Reply/edit/delete/reset also passed in a focused run. Observed zero production bridge/WhatsApp endpoint requests, runtime exceptions, or console errors. No production conversation was opened. The owned tunnel process was stopped and local port 9222 confirmed released after that test session.
- **Combined Windows deploy batch:** the user ran the reviewed batch to build, stage, and deploy production and MOCK. Subsequent read-only inspection reported both expected plugin identities and an active Loader. The exact MOCK-only update and production-integrity check are recorded below.
- **Image viewer issue and fix:** an earlier Y-trigger attempt for mock image `mock-ava-2` returned Quick Access to contacts and no viewer appeared; physical controller input was not established at that checkpoint. A modal-options fix passed local active-mount testing and review. Later artifact added view-once photo/video/audio placeholders and safe unsupported fallback; local checks verify no retry/player/Y-open and no network access. The viewer was later removed from release scope; the replacement image-Y no-op/inline-preview/audio behavior and physical MOCK checks passed per the user's later report.
- **Updated MOCK deployment:** the user ran the reviewed installer at `/home/deck/decky-whatsapp-mock-update-20261017-193010/install-mock.sh`, entering sudo locally. Their terminal reported all guards passed, “Production tree remains unchanged,” matching five hashes, and active `plugin_loader.service`. Independent read-only check confirmed MOCK identity/ESM and all five installed hashes; production identity/tree hash remained unchanged (`ca76…49bc0` at this later checkpoint). No settings/data/log contents were read.
- **Immediate post-restart checkpoint:** CDP could see `QuickAccess_uid2`, but the MOCK provider marker was not mounted. The subsequent read-only CDP / MOCK-only retest is recorded below.

#### Read-only CDP / MOCK-only retest — 2026-10-17

- Reused the existing CDP tunnel at `127.0.0.1:9222`; it was not started by this retest and was left running. The exact Quick Access MOCK panel marker was present.
- MOCK started OFF. Clicking its exact Start control loaded five fabricated contacts with `mock-*` IDs. Opening the fake Beta contact showed three view-once rows, each with the expected phone fallback; no audio/video element or retry button appeared. Opening Ava showed three fabricated message IDs and its embedded SVG image preview.
- A synthetic keydown on the fake image row was handled/default-prevented, and invoking that row's React `onKeyDown` handler also reported handled. Neither exposed an image viewer or “Close image” control; the panel returned to contacts. Screenshot attempt captured the contacts panel rather than a viewer. **Viewer remains unresolved.** These DOM/CDP actions do not constitute physical controller verification.
- Target-scoped monitoring recorded zero requests to `127.0.0.1:8787` or WhatsApp domains, zero runtime exceptions, and zero console errors. The exact MOCK Stop control was clicked; final state showed Start with zero chats, messages, or media.
- Production plugin/account was not opened or interacted with. Existing tunnel was left running.

#### MOCK-only frontend refresh prepared and staged — 2026-10-18

- **Reason:** the strict CDP probe found the Quick Access provider-ready marker but no MOCK panel scope or Start/Stop controls. Comparing hashes showed that the installed MOCK `dist/index.js` and source map were older than the current local artifact; its metadata and backend files matched. The missing current scope marker explains why the safe harness refused to interact.
- **Deck preflight:** `plugin_loader.service` was active, the unique staging path was unused, and no game-path process was found after excluding the SSH inspection process and its shell ancestry. The installed MOCK bundle hashes matched the previously observed older bundle. No plugin files were changed during preflight.
- **Bundle review:** the first independent pass found that the installer’s two post-copy hash loops skipped the final checksum row when `SHA256SUMS` lacked a terminating newline. The bundle was corrected. The second independent pass returned **PASS**: both loops process all five files, including `dist/index.js.map`; paths, identities, production-integrity checks, MOCK-only destinations, and the single Loader restart guard were accepted.
- **Local validation:** `bash -n install-mock.sh`, strict five-file checksum verification, exact payload-set checks, LF checks, and a loop harness proving both verification loops cover all five files passed.
- **Staging:** the reviewed five-file MOCK runtime, `SHA256SUMS`, and `install-mock.sh` were copied to `/home/deck/decky-whatsapp-mock-update-20261018-001340`. Remote checks confirmed the exact staged file set, all five hashes, and valid shell syntax.
- **Install attempt:** the user ran the staged installer. All five staged checksums passed, then its pre-write production integrity guard stopped with actual tree hash `75d44da2e2b659f2d177468ba5191934853f95afb029c4806f65ca5aca431a42`, differing from pinned preflight hash `ca76e1cef3d4f39dec6234f9b70f0dcb273bdfaa3142bd44883fa742a7a49bc0`. The installer exited before copying MOCK files or restarting `plugin_loader.service`; no install occurred. Per the approved procedure, further Deck inspection or installation is paused pending user guidance. The user authorized a read-only comparison of the five production runtime file hashes, recorded below.
- **Read-only production runtime comparison:** after user authorization, hashes were collected for only `plugin.json`, `package.json`, `main.py`, `dist/index.js`, and `dist/index.js.map`. All five match the previously recorded production runtime hashes exactly. The full-tree hash mismatch therefore comes from another path or filesystem metadata in the tree, not these five runtime files. No settings, credentials, logs, or message data were inspected. A metadata-only inventory found the expected six entries under the root (the `dist` directory and five runtime files), with no symlinks or extra files. The root directory is mode 0755; `dist` is mode 0700 and owned by uid/gid 1000; all five files are mode 0644 and owned by uid/gid 0. Because the tree-hash command normalizes owner/group and mtime but retains modes, the `dist` directory mode is the likely source of the hash mismatch. This is not confirmed against a prior mode inventory. No file contents were read and no Deck files were changed.
- **Authorized guard update and restaging:** the user approved changing only `EXPECTED_PRODUCTION_HASH` in the MOCK-only installer to the observed value `75d44da2e2b659f2d177468ba5191934853f95afb029c4806f65ca5aca431a42`. Independent review returned **PASS**; the reviewer confirmed the sole diff, existing integrity guards, corrected five-entry checksum loops, and shell syntax. The updated installer was copied to the same staging path. Its remote SHA-256 matches the reviewed local script; remote `bash -n` and all five payload hashes passed. No plugin files were installed and `plugin_loader.service` was not restarted.
- **Successful MOCK refresh — 2026-10-18:** the user reran the staged installer. All five staged checksum checks passed; the updated production tree guard matched `75d44da2e2b659f2d177468ba5191934853f95afb029c4806f65ca5aca431a42` before and after the MOCK copy and service restart. The user-reported output confirmed `plugin_loader.service` active. Independent read-only verification confirmed the exact five current MOCK artifact hashes, MOCK identity `Decky WhatsApp MOCK` / `decky-whatsapp-mock`, production identity unchanged, root-owned 755 directories and 644 files in MOCK, and the same production tree hash. No game-path process was found; no production settings, messages, credentials, or logs were inspected.
- **Immediate post-refresh CDP checkpoint:** `node scripts/mock-deck-cdp.mjs --endpoint http://127.0.0.1:9222` returned `Verified MOCK panel scope is absent; no UI action was taken.` The panel was subsequently reopened by the user; the later retest is recorded below.

#### MOCK-only CDP retest — 2026-10-18

- `node scripts/mock-deck-cdp.mjs --endpoint http://127.0.0.1:9222` found `QuickAccess_uid2`, `mockReady: true`, zero forbidden bridge/WhatsApp requests, zero console errors, and zero exceptions. A fresh SSH process/service check was denied by the local execution context (`ssh: connect to host steamdeck.lan port 22: Permission denied`); the most recent earlier no-game check had passed. The existing CDP tunnel was reused and not started or stopped by this retest.
- The reviewed `--exercise open-ava` path failed closed. Inspection identified that `DOM.describeNode` returned no `parentId` for the hit node, so the helper could not walk the hit-test ancestry. No helper source change was made after its third reviewer pass. A temporary, one-off guarded diagnostic checked the full DOM tree and exact MOCK marker before dispatching a click only to the Ava MOCK control; it opened Ava's fabricated conversation. A read-only inspection found 3 fabricated message rows, including 1 image row.
- A guarded click selected the fabricated image row and a CDP `y` key event was sent while that MOCK row was focused. The sanitized screenshot afterward showed the MOCK contacts page, with no image viewer visible. This is a **failed observed outcome**; the cause remains inconclusive. It was synthetic keyboard input, not a physical controller Y press, and B-close/focus restoration was not tested.
- The final CDP diagnostic still found the strict MOCK marker and zero forbidden requests, console errors, or exceptions. No production plugin, messages, credentials, or settings were accessed. The temporary scripts and screenshot were removed from the repository workspace.
- **User-reported physical retest:** pressing Y on the MOCK image also returns from the conversation to contacts without loading the viewer. Because the viewer did not open, its B-close and focus-restoration behavior could not be checked.

#### MOCK image viewer Y fix and deployment bundle — 2026-10-18

- **Active Deck inspection:** the user reopened the MOCK panel. The existing loopback CDP endpoint returned `QuickAccess_uid2`; the strict MOCK marker was present. The read-only harness reported zero forbidden requests to the production bridge/WhatsApp domains, zero console errors, and zero exceptions. No production panel or conversation was opened.
- **Installed-version check:** read-only SHA-256 inspection showed `plugin.json`, `package.json`, and `main.py` match the reviewed artifact, but installed `dist/index.js` (`4218bc7b...`) and `dist/index.js.map` (`3a649d17...`) are older than the Y-fix artifact (`8408327c...` and `18411f3e...`). Therefore, the user's just-reopened panel was still running the earlier frontend and did not exercise the reviewed fix. The production tree hash was independently rechecked and remains `75d44da2e2b659f2d177468ba5191934853f95afb029c4806f65ca5aca431a42`.
- **Source fix and review:** the implementation uses the last controller-focused message when Steam's focus is absent from `document.activeElement`, and consumes the viewer's cancel event so it cannot bubble into closing the conversation. Source review pass 1 returned **PASS**. `npm.cmd run test:mock` passed 12/12, `npm.cmd run typecheck:plugin` passed, `npm --prefix decky-plugin run build` passed, the viewer unit suite passed 6/6 with the existing Windows preload, and `git diff --check` passed. The local active mount simulates `showModal`; it does not mount Decky's real `ModalRoot` or prove Gaming Mode focus behavior.
- **Deployment bundle review:** a fresh MOCK-only bundle was created at `artifacts/decky-whatsapp-mock-update-20261018-image-y-01/`. Independent review pass 1 returned **PASS**. It pins the existing MOCK destination and the observed production tree hash; it installs only five runtime files and checks MOCK identity, exact file sets, hashes, modes/ownership, active service, game-process absence, and production integrity before/after install and restart. The source artifact hashes match `SHA256SUMS`; remote Bash syntax was checked.
- **Deck preflight and staging:** a first game-process preflight matched its own SSH command text and stopped before creating a directory or copying files. Repeating it with the path fragments assembled separately passed: MOCK and production identities matched, Loader was active, production tree hash matched, no game-path process was found, and the unique staging path was unused. The seven expected staging files were copied to `/home/deck/decky-whatsapp-mock-update-20261018-image-y-01`; remote verification passed for the exact file set, all five payload checksums, both manifest identities and ESM format, Bash syntax, and the install-script SHA-256 (`b4e21156...`). No installed plugin file was changed and `plugin_loader.service` was not restarted.
- **Next manual step:** in Windows Command Prompt or PowerShell, run `ssh.exe -tt -o BatchMode=yes -o ConnectTimeout=10 deck@steamdeck.lan "bash /home/deck/decky-whatsapp-mock-update-20261018-image-y-01/install-mock.sh"` and enter the Deck sudo password in that terminal prompt. The installer stops on any path/hash/game/service guard failure. After it succeeds, reopen MOCK and repeat physical Y, then B-close/focus restoration checks. Do not use the combined production-and-MOCK deploy batch for this fix.

#### Physical retest after Y-fix install and listener-isolation finding — 2026-10-18

- **User result:** after installing the corrected MOCK artifact, the user still sees Y return to contacts without opening the image viewer.
- **Installed artifact verification:** all five installed MOCK files match the reviewed Y-fix artifact hashes (including `dist/index.js` `8408327c...` and source map `18411f3e...`); `plugin_loader.service` is active. The production tree hash remains `75d44da2e2b659f2d177468ba5191934853f95afb029c4806f65ca5aca431a42`.
- **Read-only CDP:** the strict MOCK marker was present; diagnostics reported zero requests to the production bridge or WhatsApp domains, zero console errors, and zero exceptions. This does not identify whether Steam delivered Y to the plugin callback or which cancel path closed the conversation.
- **Independent review pass 2:** **CHANGES_REQUIRED**. The reviewer found both separately bundled variants use the same global `Symbol.for("decky-whatsapp.steam-listener-registry")`; module evaluation clears every callback in that registry. A local two-module/fake-Steam test reproduced production input callbacks being cleared when MOCK loads. The reviewer did not establish that this caused the viewer failure, but it is an actionable coexistence risk. A further narrowly scoped MOCK diagnostic is feasible after fixing the listener collision: fixed-label traces can record event sequence/booleans for Y receipt, viewer activation/showModal return or throw, parent cancel, and mount/dismount; no message IDs/content or extra Steam input listener is needed.
- **Action at that point:** implementation round 2 addressed listener ownership/isolation and added sanitized MOCK-only traces with both bundle load orders covered. The listener fix passed local review; the viewer remained physically broken and was later removed from release scope after the third review pass.

#### Remove image expansion from production and MOCK builds — 2026-10-18

- **User report and scope:** the physical Y test still returns to contacts. The user asked to drop image expansion after three review passes and clarified that image-Y expansion must also be removed from the production Deck build. The shared panel now treats image Y as a consumed no-op; inline image previews and the existing audio Y play/pause action remain in both variants.
- **Implementation review:** viewer-removal review pass 1 returned **PASS** for source behavior and local evidence. The reviewer noted the test-document intro still said 86 tests; it was corrected to 112 tests across 15 files and passed documentation review pass 2. The reviewer confirmed both bundles contain no viewer/modal path or temporary trace strings, inline previews/audio Y remain, and listener namespaces remain isolated. Physical image-Y/audio-Y/coexistence checks were pending at that point and were later confirmed passed by the user.
- **Local validation:** `npm.cmd run typecheck:plugin`, `npm.cmd --prefix decky-plugin run build`, `npm.cmd run test:mock` (**12/12**), `npm.cmd test` with the existing Windows preload workaround (**112/112**), and `git diff --check` passed as reported by the implementer. The reviewer independently passed the 15 message-action/Steam tests and MOCK suite. The MOCK artifact build and fresh production build both completed; neither bundle contains viewer/modal/debug-trace markers. Fresh bundle hashes are recorded in `artifacts/decky-whatsapp-update-20261018-no-viewer-01/SHA256SUMS`.
- **Deck preflight:** read-only SSH confirmed production identity `Decky WhatsApp` / `decky-whatsapp`, active `plugin_loader.service`, and the expected pre-update production tree hash `75d44da2e2b659f2d177468ba5191934853f95afb029c4806f65ca5aca431a42`. Installed production frontend hashes were `f01e571c...` and `3f84dcce...`; no plugin files were modified by this preflight.
- **Prepared update and review:** the bundle contains only production `dist/index.js` and its source map plus the five MOCK runtime files. Its installer pins the inspected production baseline, writes only those two production frontend files and the five files within the MOCK directory, checks exact payload hashes, game state, plugin identities, and active Loader, then restarts `plugin_loader.service` once. Deployment-bundle review pass 1 returned **CHANGES_REQUIRED** because the unchanged-production metadata fingerprint sorted individual fields instead of complete records. The implementer replaced it with deterministic length-delimited records including the production root and each unaffected entry's path/type/UID/GID/mode; the separate file-content hash remains. Review pass 2 returned **PASS**. Git Bash syntax and all seven strict payload checks passed.
- **Staging and final remote verification:** read-only preflight confirmed both plugin identities, active Loader, no game-path process, and the same production baseline hash. The nine-file bundle was transferred to `/home/deck/decky-whatsapp-update-20261018-no-viewer-01`; remote exact-file-set checks, seven payload hashes, Bash syntax, and installer SHA-256 (`891074b0...`) passed. An initial verification command failed due to a malformed local check, not the staged files; the follow-up read-only verification passed.
- **Installation and read-only verification:** the user ran the staged installer. The installation completed and `plugin_loader.service` is active. Read-only verification confirmed production identity `Decky WhatsApp` / `decky-whatsapp` and MOCK identity `Decky WhatsApp MOCK` / `decky-whatsapp-mock`. Production `dist/index.js` and its source map match the reviewed no-viewer artifact; the five MOCK runtime files match their reviewed artifact. The post-install production tree hash is `12517be3ff25c86587a6ed960e43cdb9f0360a2e09a9818154246d5557af15ef`. The installer checked the unaffected production files/layout before and after restart. No production message data, credentials, settings, or logs were inspected.

### Phase 6 manual verification — complete per user report (2026-10-18)

- The user confirmed that all remaining Phase 6 manual checks passed, including the fresh Windows and Ubuntu installs, suggested-host flow across docked Ethernet/Wi-Fi, the production Deck session, and MOCK-only controller/history/media/isolation checks. These are user-reported results and were not independently repeated in this code review.
- **REMOVED FROM RELEASE SCOPE:** the separate image viewer did not work after three review passes and physical retesting. Its code and modal path have been removed. The replacement (image Y no-op, inline preview retained, audio Y retained) passed per user report.
- The user reports that view-once photo/video/audio fallback, no media retry, no unsupported “viewed” claim, safe B navigation, ordinary MOCK media behavior, reset/remount, and duplicate-subscription checks passed. Codex did not inspect private production settings, logs, or message data.
- **NOT TESTED BY DESIGN:** any live WhatsApp account login, conversation read, send, reaction, edit, delete, or other account-side action.
- **Still outside release closeout:** the optional Whisper installer check and privileged Deck `sshd` stale-client-expiry configuration remain unchecked. A matching Linux GitHub Release asset also awaits explicit publication authorization.

### Final user verification — complete per user report (2026-10-18)

The user completed these checks. Snapshots remain user-managed; Codex did not create, restore, or modify any snapshot.

- [x] **Fresh Windows VM snapshot:** clean installation, prerequisite handling, install/reinstall, bridge startup/shutdown and process cleanup, normal functionality, Chromium sandbox behavior, and suggested-host/manual-override flow passed per user report.
- [x] **Fresh Ubuntu VM snapshot:** clean installation, prerequisite handling, package/browser setup, launcher startup/shutdown and cleanup, normal functionality, retained Chromium flags, and suggested-host/manual-override flow passed per user report.
- [x] **Production Steam Deck session (about one hour):** OFF-by-default, Start/Stop and reconnect, notifications, return to the game, suspend/resume, voice typing and sanitized failure behavior, session preservation, and responsiveness passed per user report.
- [x] **Separate MOCK-only Deck check:** fabricated conversations, controller navigation, history batches/focus, image-Y no-op with inline preview retained, audio-Y playback, view-once fallback/safe navigation, and reset/reopen/remount isolation passed per user report. No production conversation was used for these MOCK checks.

## User manual-test checklist

Use this checklist to track checks that require the user's physical Deck, VM interaction, or explicit confirmation. Completed historical items reflect the user's reports; they were not independently repeated in this session. The detailed evidence and limits are recorded in the sections above.

### Previously user-confirmed

- [x] Phase 1 manual checks; one password-only SSH diagnostic probe was intentionally ignored.
- [x] Phase 2 and Phase 3 Gaming Mode checks.
- [x] Phase 4 Windows lifecycle, reconnect, sleep/resume, and no-login-autostart checks.
- [x] Phase 5 Linux/Windows/Deck checks, including chronological message ordering and controller focus/scroll follow-ups; the custom-port check was intentionally ignored.
- [x] Phase 6 Ubuntu installer/key setup and Windows VM installer/lifecycle acceptance inputs, without connecting a live WhatsApp account.
- [x] Install the separate MOCK plugin, verify its identity/artifact hashes, confirm Decky is active, and confirm the production plugin tree remained unchanged.
- [x] MOCK-only basic offline interaction subset: fabricated conversations, local send/reaction, notifications, stop/start, reset, reopen, and history expansion.

### Phase 6 physical Deck checks — complete per user report (2026-10-18)

- [x] Rerun the reviewed MOCK-only installer with the updated production integrity baseline for the prior bundle; verify the production tree stayed unchanged, its five hashes, distinct identities, and active Loader. A later hash check found that its frontend bundle predates the Y fix.
- [x] Install the reviewed Y-fix bundle staged at `/home/deck/decky-whatsapp-mock-update-20261018-image-y-01`; all five artifact hashes match, the production tree hash is unchanged, and the Loader is active.
- [x] Reopen MOCK after the plugin Loader restart and confirm the strict MOCK panel marker is present before resuming CDP/UI tests.
- [x] Confirm MOCK remains distinct from production after restart and that settings/runtime data/logs and subscriptions remain isolated; do not inspect private production message contents or credentials. Passed per user report.
- [x] Use the physical controller to navigate MOCK contacts/actions/history/previews/notifications, and confirm the rendered focus/highlight behavior. Passed per user report.
- [x] Run the reviewed combined update staged at `/home/deck/decky-whatsapp-update-20261018-no-viewer-01`; read-only verification confirmed both plugin identities, production frontend and MOCK artifact hashes, the updated production tree, and active `plugin_loader.service`. The installer checked unaffected production files/layout before and after restart.
- [x] In MOCK, confirm image Y keeps the fake conversation and reply selection open, inline preview remains available, and audio Y playback still works. Do not open a real production conversation to test Y; production bundle hashes and artifact inspection establish that the viewer path was removed there. Passed per user report.
- [x] Verify view-once photo/video/audio fallbacks, no media retry or unsupported “viewed” claim, safe B navigation, and ordinary MOCK media behavior. Passed per user report.
- [x] Reset, close/reopen, and remount MOCK; confirm fixture state resets as expected and interactions/subscriptions are not duplicated. Passed per user report.
- [x] Phase 6.1 PluginFix: confirm startup, controller behavior, suspend/resume, session preservation, and existing functionality on Deck. Passed per user report.
- [x] Phase 6.1/6.4 UI and lifecycle: compare refactored visuals; check Start/Stop, reconnect, OFF-by-default after plugin restart, suspend/resume, and Load more focus/scroll behavior. Passed per user report.
- [I] Production view-once fallback was not tested by Codex because it would require opening a real conversation; the isolated MOCK fallback was tested per user report.
- [x] Verify suggested Deck host acceptance/manual override/saved-host resolution across docked Ethernet and Wi-Fi on Windows and Linux. Passed per user report.
- [x] Verify the checkout-with-spaces path on Linux in the Ubuntu VM. The Windows full-suite/typecheck/build run also passed from a temporary spaced checkout on 2026-10-17.
- [ ] Optional Whisper installer: run on the Deck, verify read-only recovery/package/model validation and a successful transcription, plus a controlled failure with sanitized logs.

### Phase 7 ordinary video — physical MOCK checks

- [x] Install the reviewed MOCK-only video artifact and verify installed hashes, MOCK identity, and active `plugin_loader.service`.
- [x] Open the fabricated video in Gaming Mode, confirm it starts paused, then confirm it plays to completion without a media error.
- [x] Verify the production plugin runtime tree hash remains `12517be3ff25c86587a6ed960e43cdb9f0360a2e09a9818154246d5557af15ef`; all five installed MOCK hashes match the reviewed artifact.
- [ ] Confirm pause/resume controls and physical controller navigation remain usable.
- [ ] Confirm the video playback-error fallback and fabricated view-once fallback (no player or retry) in Gaming Mode.

### Intentionally excluded

- [ ] Custom bridge-port check (user chose to ignore it).
- [ ] Any real WhatsApp login/pairing, conversation read, message/reaction/edit/delete, or other account-side mutation; these remain prohibited by the project safety rules.

### GitHub release publication — 2026-10-18

- Published [Decky WhatsApp 1.1.0](https://github.com/db452/DeckyWhatsapp/releases/tag/v1.1.0), tag v1.1.0, targeting commit d9a39b2. GitHub reports it as the latest release.
- Built the production Decky frontend with `npm.cmd --prefix decky-plugin run build` (passed) and packaged the installable runtime allowlist using the same `decky-whatsapp/` archive layout as the previous plugin ZIP: `plugin.json`, `package.json`, `main.py`, `dist/index.js`, and `dist/index.js.map`. ZIP integrity and production manifest/package identity checks passed. The ZIP was not installed from Decky Loader as part of this publishing task.
- The release contains these local files:
  - `decky-whatsapp-decky-plugin-v1.1.0.zip` — SHA-256 `4C2562E8290074D07401D003B43D53E4989132F3379EACE49B6063D17FC995F1`.
  - `decky-whatsapp-pc-windows-v1.1.0.zip` — SHA-256 `9863B46A41186D9C28C18893689451ED499ADDB15B72DB7D21A6D151F00A0E83`.
  - `decky-whatsapp-pc-linux-v1.1.0.zip` — SHA-256 `0794A267469CB32637FABDC6FC992B1D18230F473901848E49955D886AE873A1`.
  - `SHA256SUMS-v1.1.0.txt` — SHA-256 `5A8AA4198BAC6839BF7EE2C3880D5982572E7974AFA11D7E3CD5D6B8BBE07F32`.
- Renamed the Windows and Linux archive files to v1.1.0 as requested; their verified package contents were preserved.
- The v1.1.0 release asset names and GitHub tag are updated; existing internal package/manifest version fields remain 1.0.0 from the source commit.
- Downloaded every release asset and compared its SHA-256 with the corresponding local file; all four matched. The v1.1.0 release now lists only the corrected versioned filenames and is the latest release.

### Phase 7 production test staging — 2026-10-18

- Built the production Deck frontend with `npm.cmd --prefix decky-plugin run build` (passed). Verified production identity `Decky WhatsApp` / `decky-whatsapp`, package `decky-whatsapp-plugin`, and ESM format.
- Read-only Deck preflight confirmed the existing production directory and `dist` are real directories, the production identity matches, and `plugin_loader.service` is active. Before staging, the five installed runtime hashes were recorded.
- Staged the five runtime files and SHA-256 manifest at `/home/deck/decky-whatsapp-production-video-20261018-112613/decky-whatsapp`. All five remote checksums and manifest identity passed. A production-only guarded installer was staged at `/home/deck/decky-whatsapp-production-video-20261018-112613/install-production.sh`; its remote SHA-256 is `07454d387c9d4da7c5e501cc69888be933c3c7b13a84733c743be059561b10fc` and `bash -n` passed.
- After staging, all five installed production hashes still matched the preflight values and `plugin_loader.service` remained active. No installed production file was changed, no Decky restart was run, and no PC bridge was started or stopped.
- The matching Windows companion package was prepared at `artifacts/decky-whatsapp-video-windows-companion-20261018/decky-whatsapp-pc-windows-v1.0.0.zip`. The allowlisted ZIP passed integrity and contents checks (19 files; includes updated `src/whatsapp.ts`; excludes `.env` and WhatsApp auth data). SHA-256: `7fd9146dd81a7482eeb3c487e6e92a668ef7130678a9390f7cf5d577265df665`. The archive name reflects the current root `package.json` version; it is a local test package, not a published release.
- **Pending:** the user must run the guarded installer after closing any game, then update/restart the PC companion from the matching Windows package before end-to-end production testing. Production video playback and the remaining physical MOCK checks have not been verified by this staging task.
