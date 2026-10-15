# PLAN.md — DeckyWhatsapp UX Improvement Roadmap

**Status:** APPROVED — Phase 2 and Phase 3 implementation, code review, and required manual Gaming Mode checks are complete per user confirmation on 2026-10-15. Phase 1 retains its previously accepted Task 1.4 deferral; Phase 4 and later have not started.
**Current task:** Phase 2 and Phase 3 are complete. Phase 4 is the next roadmap phase and awaits user approval before implementation.
**Phase 3 review status:** Tasks 3.1–3.3 passed independent code review. Root tests passed 31/31 with a temporary preload for the Windows Node `os.userInfo()` ENOMEM issue; root typecheck, frontend build/typecheck, and diff check passed on 2026-10-15. The user confirmed all Phase 3 Gaming Mode manual checks passed on 2026-10-15. Phase 2 code review and implementation checks passed; the user also confirmed all Phase 2 Gaming Mode manual checks passed on 2026-10-15.
**Implementation status:** Phase 1 is complete per the user's confirmation on 2026-10-15. Windows Task 1.4 owner identification passed independent review pass 2. Verified on Windows: `npm.cmd test` (31/31, using a temporary `NODE_OPTIONS` preload for the Node `os.userInfo()` ENOMEM issue), `npm.cmd run typecheck`, `decky-plugin` `npm.cmd run build`, PowerShell parsing, and `git diff --check`. The user marked the applicable Phase 1 manual checks `[x]` and intentionally ignored two checks `[I]`: the password-only SSH second-prompt check and demonstration of safe recovery from a genuinely stale tunnel. Safe stale-tunnel recovery remains unimplemented and its Task 1.4 item stays unchecked; the current diagnostic leaves stale or non-HTTP owners ambiguous. This is an explicit user-accepted Phase 1 deferral, not implemented functionality. Linux launcher parity remains deferred to Phase 5. Phase 2 was approved by the user on 2026-10-15. The focused Task 2.2 fix for retry timeouts after navigation passed independent code review on 2026-10-15, and its frontend build/typecheck passed. The reply-field focus and Steam keyboard activation follow-up passed independent code review on pass 2; its frontend build/typecheck and scoped diff check passed. The user confirmed in Gaming Mode that reply keyboard activation works; all Phase 2 manual checks passed and Phase 2 is complete. The focused retry fix records uncertainty for the mounted plugin session; it is not persisted across plugin remounts. Phase 3 was authorized by the user on 2026-10-15. Task 3.1 notification deduplication passed independent code review and automated frontend checks; its manual Deck checks passed per user confirmation. Phase 3 Tasks 3.1–3.3 passed independent code review and frontend build, typecheck, and diff checks on 2026-10-15. Phase 3 implementation and required Gaming Mode manual checks are complete per user confirmation. Phase 4 and later remain out of scope. Phase 2 verification on Windows: `npm.cmd test` passed 31/31 with the temporary `NODE_OPTIONS` preload for the Node `os.userInfo()` ENOMEM issue; plain `npm.cmd test` fails before tests start with that environment error. `npm.cmd run typecheck`, `decky-plugin` `npm.cmd run build`, frontend `npm.cmd exec -- tsc --noEmit -p tsconfig.json`, and `git diff --check` passed. Task 3.1 verification: frontend build, frontend TypeScript check, and `git diff --check` passed; a reviewer-run mocked callback harness passed notification deduplication, settings/privacy, reconnect/stop/start, and cache-bound checks. Phase 2 and Phase 3 Gaming Mode checks are complete per user confirmation.
**Project:** [db452/DeckyWhatsapp](https://github.com/db452/DeckyWhatsapp)

**Focus:** Steam Deck user experience, reliability, Linux compatibility and ease of use

## 1. Project objective

Make DeckyWhatsapp feel like a natural extension of SteamOS Gaming Mode rather than a separate application that requires technical attention.

The ideal experience is:

- Start DeckyWhatsapp deliberately on a Windows or Linux computer.
- Receive WhatsApp notifications while gaming.
- Open DeckyWhatsapp, read messages and respond using the controller.
- Return to the game immediately.
- Recover automatically from brief connectivity interruptions.
- Avoid conflicts if multiple computers attempt to connect to the same Steam Deck.

**Core principle:** Improve what already works. Avoid unnecessary rewrites, additional dependencies and major architectural changes.

Preserve the current architecture consisting of a computer-hosted WhatsApp bridge and an SSH reverse tunnel to the Steam Deck.

**Startup policy:** DeckyWhatsapp must only start following an explicit user action. Never introduce automatic startup at operating system login or boot.

---

## 2. Phase 1 — Reliability and immediate UX fixes

**Priority: P0 — Implement first**

### Task 1.1 — Fix persistent connection warnings

**Related issue:** [#1 — Connection warning does not disappear](https://github.com/db452/DeckyWhatsapp/issues/1)

**Current problem:** Connection error messages can remain visible after connectivity has been restored.

**Implementation:**

- [x] Separate connection errors from messaging/action errors.
- [x] Track HTTP bridge availability, WebSocket connectivity and WhatsApp readiness independently.
- [x] Clear connection warnings once the relevant connection has recovered.
- [x] Preserve historical errors in Diagnostics without displaying them as active errors.
- [x] Display understandable connection states: Connected, Connecting, Reconnecting, Computer unavailable, Authentication required.
- [x] Avoid repeated error notifications during temporary interruptions.

**Relevant files:** `decky-plugin/src/index.tsx`, `decky-plugin/src/connection.ts`

**Acceptance criteria:**

- A disconnected bridge triggers a clear warning.
- Restoring the connection removes the warning automatically.
- Reconnection does not require reopening the plugin.
- A healthy HTTP connection does not incorrectly imply that WhatsApp or the WebSocket is ready.
- Sending errors are not accidentally erased by unrelated health checks.

### Task 1.2 — Replace clock icons with message timestamps

**Related issue:** [#2 — Contacts showing clock instead of time](https://github.com/db452/DeckyWhatsapp/issues/2)

**Implementation:**

- [x] Replace the static clock icon in contact rows with the last-message timestamp.
- [x] Show `14:35` for messages received today.
- [x] Show `Yesterday` for messages received yesterday.
- [x] Show a short date for older conversations.
- [x] Respect the Deck's local timezone and locale.
- [x] Handle missing or invalid timestamps gracefully.

**Relevant file:** `decky-plugin/src/index.tsx`

**Acceptance criteria:** Every contact with a valid message timestamp displays a meaningful time or date without truncating the contact name.

### Task 1.3 — Improve loading and empty states

**Current problem:** An empty contact list can mean no conversations match the selected filter, that conversations are still loading, or that WhatsApp is unavailable.

**Implementation:**

- [x] Show a loading indicator while fetching contacts.
- [x] Distinguish an empty list from a connection failure.
- [x] Provide a Retry option when appropriate.
- [x] Show a helpful message when WhatsApp needs authentication.
- [x] Preserve already loaded contacts during temporary reconnection attempts where safe.

**Acceptance criteria:** Users can understand why conversations are unavailable without opening Diagnostics.

### Task 1.4 — Handle multiple WhatsApp bridge connections to the same Deck

**Priority: P0 — Prevent accidental session takeover**

**Current problem:** Multiple computers or bridge instances may attempt to connect to the same Steam Deck using the same SSH reverse-tunnel port.

The existing Windows launcher attempts to clear an occupied remote port. This can potentially interrupt an existing working session.

**Desired behavior:** Only one WhatsApp bridge should actively serve the Deck at a time, unless multi-account support is explicitly introduced in a future release.

**Proposed default policy: First connected session wins.**

**Implementation:**

- [x] Investigate how the current launcher handles occupied ports and active SSH tunnels.
- [x] Remove automatic termination of arbitrary processes occupying the Deck's bridge port.
- [x] Detect a responding DeckyWhatsapp bridge on the occupied remote port without exposing its session ID or token.
- [x] Distinguish a responding DeckyWhatsapp bridge from another HTTP service where safely possible; leave stale, non-HTTP, and otherwise unidentifiable owners ambiguous.
- [ ] Recover a verified stale SSH tunnel without terminating unrelated processes. — DEFERRED BY USER; Phase 1 accepted with this item outstanding.
- [x] Assign an identifiable runtime session ID to each bridge instance, without exposing authentication secrets.
- [x] Consider exposing non-sensitive connection identification information through an authenticated health/status endpoint.
- [x] Display an informative error when a second computer attempts to connect to an already occupied Deck.
- [x] Do not disconnect the existing session automatically.
- [x] Allow an existing bridge to reconnect after temporary network loss, provided it does not displace another active session.
- [x] Make SSH port-binding failures authoritative, even if a previous port-availability check succeeded.
- [x] Ensure the existing Windows launcher follows the conflict policy.
- [ ] Ensure the future Linux launcher follows the same conflict policy (Phase 5 implementation).
- [x] Add tests for simultaneous connection attempts and competing reconnection loops.

**Example behavior:**

Computer A connects successfully to the Steam Deck.

Computer B subsequently attempts to connect.

Computer B should report:

> Another DeckyWhatsapp session appears to be connected to this Steam Deck. Close the existing connection before starting another.

Computer A remains connected and unaffected.

**Optional future enhancement:** Explicit session switching, with user confirmation, after safe ownership and termination mechanisms have been implemented.

**Not in scope:** Simultaneously displaying multiple WhatsApp accounts within one DeckyWhatsapp interface.

**Acceptance criteria:**

- Multiple bridges cannot silently take over each other's connections.
- Existing working sessions remain uninterrupted.
- Genuine stale connections can be recovered safely.
- No launcher kills arbitrary SSH or unrelated processes.
- Simultaneous startup races are handled predictably.

### Manual completion checks — Phase 1

The user confirmed the `[x]` checks passed and marked `[I]` checks as intentionally ignored. `I` means excluded by the user's personal decision; it does not mean the test passed.

- [x] In Gaming Mode, interrupt and restore bridge connectivity; confirm the connection warning clears and the plugin reconnects without reopening while loaded contacts remain available.
- [x] Confirm today, Yesterday, and older-contact timestamps display in the Deck’s local timezone and locale without truncating names.
- [x] Exercise loading, no-match/empty, computer-unavailable, authentication-required, and Retry states in the plugin.
- [x] With PC A connected, attempt PC B; verify the owner diagnostic identifies the responding DeckyWhatsapp bridge and PC A can continue sending and receiving.
- [x] Where a safe test service is available, verify another HTTP service is not labeled DeckyWhatsapp; verify non-HTTP or unresponsive owners receive an ambiguous, non-destructive diagnostic.
- [I] If using password-only SSH, confirm the diagnostic probe does not prompt for a second password. — INTENTIONALLY IGNORED BY USER; not verified.
- [I] Demonstrate safe recovery from a genuinely stale tunnel without disturbing a live bridge or unrelated service. — INTENTIONALLY IGNORED BY USER; stale-tunnel recovery remains unimplemented.

---

## 3. Phase 2 — Steam Deck controller experience

**Priority: P1 — Highest UX impact**

**Status: COMPLETE — all Phase 2 Gaming Mode manual checks passed per user confirmation on 2026-10-15.**

### Task 2.1 — Improve controller navigation

**Goal:** Make the entire messaging workflow comfortable without touch input.

**Proposed controls:**

| Button | Action |
|---|---|
| A | Open conversation / select message |
| B | Return to previous view |
| D-pad | Navigate contacts and messages |
| X | React to highlighted message |
| Y | Play/pause highlighted voice message |
| Steam keyboard | Enter message text |

These mappings are proposals. Existing working controls and SteamOS conventions take precedence.

**Implementation:**

- [x] Audit focus behavior throughout the interface.
- [x] Ensure returning from a conversation restores focus to the previously selected contact.
- [x] Make message actions discoverable without requiring experimentation.
- [x] Add contextual controller hints where useful.
- [x] Prevent shortcuts from activating while typing.
- [x] Avoid overriding SteamOS controller behavior outside the plugin.
- [x] Separate selecting a message from automatically beginning a quoted reply when appropriate.

**Acceptance criteria:** Read, reply, react, play audio and return to a game using controller controls alone.

### Task 2.2 — Streamline the reply interface

**Implementation:**

- [x] Make the text input and Send action easy to reach using the controller.
- [x] Improve focus restoration after sending.
- [x] Display a clear sending state.
- [x] Prevent accidental duplicate submission.
- [x] Allow quoted replies to be cancelled easily.
- [x] When choosing “Reply to selected message,” focus the reply field and open the Steam keyboard automatically. — IMPLEMENTED; CODE REVIEW PASSED ON PASS 2; GAMING MODE CHECK PASSED PER USER CONFIRMATION
- [x] Keep failed messages distinguishable from messages with uncertain delivery status.
- [x] Avoid unexpected scrolling when new messages arrive while the user is reading older ones.

**Acceptance criteria:** Replying is quick, predictable and does not unexpectedly change the selected message or scroll position.

### Manual completion checks — Phase 2

Complete these in Steam Deck Gaming Mode in addition to the relevant Section 8 checks.

- [x] Navigate contacts, conversations, messages, reactions, and voice playback using only the controller; verify focus returns to the previous contact. — USER CONFIRMED PASSED
- [x] Use the Steam keyboard to send and reply; verify shortcuts do not fire while typing, quoted replies can be cancelled, and sending cannot be triggered twice accidentally. — USER CONFIRMED PASSED
- [x] Choose “Reply to selected message” with the controller; confirm focus enters the reply field, the Steam keyboard opens automatically, and typed text stays in the quoted reply. — USER CONFIRMED PASSED
- [x] While reading older messages, receive a new message and confirm selection and scroll position remain predictable; leave and reopen the conversation. — USER CONFIRMED PASSED
- [x] Retry an eligible failed message, navigate away before the request times out, return, and confirm delivery uncertainty persists and Retry stays unavailable. — USER CONFIRMED PASSED
- [x] From a conversation, press B and confirm it returns to contacts with the previous contact focused; confirm B in contacts/settings and while the Steam keyboard is active retains expected behavior. — USER CONFIRMED PASSED

---

## 4. Phase 3 — Notifications and conversation usability

**Priority: P1/P2**

**Status: COMPLETE — all Phase 3 Gaming Mode manual checks passed per user confirmation on 2026-10-15.**

### Task 3.1 — Polish notifications while gaming

The existing notification system should be retained and improved rather than replaced.

**Implementation:**

- [x] Confirm notifications continue working when the Decky panel is closed. — USER CONFIRMED PASSED
- [x] Prevent duplicate notifications for the same incoming message.
- [x] Respect existing settings for previews, sounds and notifications while gaming.
- [x] Make sure disabling previews never exposes private message content in notifications.
- [x] Test behavior following bridge reconnection and Deck sleep/resume. — USER CONFIRMED PASSED
- [x] Ensure legitimate new messages continue generating notifications according to existing preferences.

**Acceptance criteria:** Incoming notifications are timely, accurate and never duplicated due to reconnection.

### Task 3.2 — Improve conversation history navigation

**Implementation:**

- [x] Preserve the existing compact-history preference.
- [x] Investigate incremental loading of older messages.
- [x] If supported reliably, introduce paginated history loading rather than repeatedly fetching large histories. — NOT APPLICABLE: the current API exposes no reliable cursor or offset; pagination UI was correctly deferred.
- [x] Preserve the user's reading position when older messages load.
- [x] Avoid jumping to the bottom unless the user opens a conversation or explicitly requests it.
- [x] Display clear media-loading, unavailable, and retry states.
- [x] Keep network requests cancellable when switching conversations.

**Acceptance criteria:** Reading older messages feels continuous, without unexpected scroll jumps or repeated unnecessary downloads.

**Important:** Do not add pagination UI unless the backend actually supports reliable pagination.

### Task 3.3 — Improve the contact list

**Implementation:**

- [x] Preserve all four existing contact sorting/filtering modes and saved preference.
- [x] Make unread counts visually clearer with a high-contrast badge and accessible exact count.
- [x] Improve truncation of long contact names and message previews.
- [x] Keep timestamps consistently aligned.
- [x] Ensure profile picture downloads do not block contact-list interaction.

**Acceptance criteria:** Recently active conversations and unread messages are immediately recognizable.

### Manual completion checks — Phase 3

Complete these with the plugin running in Gaming Mode in addition to the relevant Section 8 checks.

- [x] Close the Decky panel and receive new messages; verify notifications are timely and not duplicated after reconnect or sleep/resume. — USER CONFIRMED PASSED
- [x] Toggle previews, sounds, and gaming notifications; verify disabled previews never reveal message content. — USER CONFIRMED PASSED
- [x] Browse older history and media while scrolling, receiving new messages, and switching conversations; verify reading position is preserved, requests cancel safely, and media retry works. — USER CONFIRMED PASSED
- [x] Exercise all contact sort/filter modes and verify unread counts, long names, previews, and timestamps remain clear while profile pictures load. — USER CONFIRMED PASSED

---

## 5. Phase 4 — Simplify Windows startup

**Priority: P2 — Convenience improvement**

### Task 4.1 — Introduce optional background operation

**Current behavior:** The Windows launcher starts the WhatsApp bridge and SSH tunnel in separate windows that must remain open.

**Proposed improvement:** Allow DeckyWhatsapp to run without requiring persistent console windows, while preserving deliberate manual startup.

**Implementation:**

- [ ] Preserve the existing launcher as the reliable fallback.
- [ ] Explore launching the bridge and tunnel without persistent console windows.
- [ ] Provide a clear way to inspect logs and determine whether each process is running.
- [ ] Consider a Windows tray application only if it offers meaningful benefits.
- [ ] Ensure users can stop the system cleanly.
- [ ] Avoid duplicate bridge processes and conflicting tunnels.
- [ ] Validate recovery when the Steam Deck reconnects after sleep or its IP address changes.
- [ ] Ensure background operation only begins after explicit user initiation.
- [ ] Ensure closing a background application actually terminates its owned processes or clearly distinguishes minimizing from stopping.

**Strict requirement: No automatic startup.**

Do not register Windows startup entries, scheduled login tasks, persistent auto-start services or equivalent mechanisms.

**Acceptance criteria:** The user can deliberately start DeckyWhatsapp and leave it running without persistent terminal windows, then explicitly stop it when finished.

### Task 4.2 — Clarify service lifecycle controls

**Implementation:**

- [ ] Review the distinction between disabling notifications, disconnecting the plugin and shutting down the PC bridge.
- [ ] Use descriptive button labels.
- [ ] Avoid accidentally terminating the bridge when the user only intends to close the interface.
- [ ] Make the current running state obvious.
- [ ] Ensure the shutdown workflow remains compatible with existing scripts.
- [ ] Preserve the explicit-startup requirement.

**Acceptance criteria:** Users understand exactly what Start, Stop and notification controls do.

### Manual completion checks — Phase 4

Complete these on Windows in addition to the relevant Section 8 checks.

- [ ] Start background operation deliberately, inspect running state and logs, then stop it; verify the bridge and its owned tunnel exit cleanly. — PENDING IMPLEMENTATION + MANUAL REVIEW
- [ ] Confirm notification disablement, plugin disconnect, and PC bridge shutdown have distinct, accurate effects and labels. — PENDING IMPLEMENTATION + MANUAL REVIEW
- [ ] Verify reconnect after Deck sleep or IP change, and confirm no bridge or tunnel starts automatically at Windows login. — PENDING IMPLEMENTATION + MANUAL REVIEW

---

## 6. Phase 5 — Linux installer and bridge compatibility

**Priority: P1/P2 — New platform support**

### Objective

Allow DeckyWhatsapp's companion WhatsApp bridge to run on a Linux desktop or laptop rather than requiring Windows.

The Steam Deck will continue running the same Decky plugin. The main difference is which operating system hosts the WhatsApp bridge.

**Initial platform targets:**

- Ubuntu and Debian-based Linux distributions.
- Other common distributions, such as Fedora, after dependency and installation testing.

**Important:** Running the bridge directly on SteamOS is not part of this phase. The existing Steam Deck Whisper installer remains separate.

### Task 5.1 — Audit the bridge for cross-platform compatibility

**Implementation:**

- [ ] Identify Windows-specific assumptions in the existing bridge and launcher.
- [ ] Verify Node.js 20+ compatibility on Linux.
- [ ] Confirm the pinned `whatsapp-web.js` dependency and Puppeteer can run on supported Linux environments.
- [ ] Identify required Chromium system libraries.
- [ ] Review browser executable discovery and sandbox settings.
- [ ] Ensure configuration, logs and authentication paths work correctly on Linux.
- [ ] Avoid changing the existing Windows implementation unnecessarily.

**Acceptance criteria:** The existing WhatsApp bridge can start, authenticate and exchange messages on a supported Linux computer.

### Task 5.2 — Create a Linux installation script

**Proposed file:** `install-decky-whatsapp-linux.sh`

**Implementation:**

- [ ] Detect the Linux distribution and architecture.
- [ ] Check for Node.js, npm, Git and OpenSSH client availability.
- [ ] Check for necessary Chromium/Puppeteer system dependencies.
- [ ] Provide installation guidance for missing requirements.
- [ ] Offer supported dependency installation where appropriate.
- [ ] Install Node.js dependencies using the project's lockfile.
- [ ] Check SSH connectivity to the Steam Deck.
- [ ] Offer explicit setup of passwordless SSH authentication.
- [ ] Create convenient launcher shortcuts where supported.
- [ ] Preserve existing WhatsApp authentication data during reinstallation.
- [ ] Display understandable installation errors and recovery steps.

**Security and installation requirements:**

- No unnecessary root privileges.
- Request elevated privileges only when genuinely needed and with user confirmation.
- Do not modify SteamOS system configuration unnecessarily.
- Never overwrite existing SSH keys without explicit consent.
- Do not erase WhatsApp sessions during upgrades.
- Do not install automatic startup mechanisms.

**Acceptance criteria:** A Linux user can install the bridge using a guided process without manually assembling all dependencies and scripts.

### Task 5.3 — Create a Linux launcher and SSH tunnel manager

**Proposed files:**

- `start-decky-whatsapp-linux.sh`
- `keep-ssh-tunnel.sh`
- Optional stop script if useful.

**Implementation:**

- [ ] Start the WhatsApp bridge using the installed Node.js environment.
- [ ] Locate the Steam Deck by hostname or IP address.
- [ ] Allow manually entering the Deck's address when automatic discovery fails.
- [ ] Establish the existing SSH reverse tunnel.
- [ ] Keep the bridge bound to the local loopback interface.
- [ ] Detect SSH forwarding failures.
- [ ] Recover from temporary network interruptions.
- [ ] Respect the single-active-bridge policy from Task 1.4.
- [ ] Stop the launcher-owned bridge and tunnel cleanly.
- [ ] Preserve explicit manual startup.
- [ ] Support ordinary terminal execution first; optionally offer a manually launched background mode.

**Acceptance criteria:** A Linux computer can provide the same core messaging functionality as the Windows companion application.

### Task 5.4 — Update release packaging and documentation

**Implementation:**

- [ ] Create a Linux companion package in GitHub Releases.
- [ ] Include the Linux installer and launcher.
- [ ] Keep Windows and Linux releases distinguishable.
- [ ] Update README compatibility requirements.
- [ ] Document Linux-specific installation and troubleshooting.
- [ ] Document supported Linux distributions and architectures.
- [ ] Include guidance on Chromium installation problems.
- [ ] Ensure no private session data or local tokens enter release archives.
- [ ] Add automated Linux installation/build checks where practical.

**Proposed artifacts:**

- `decky-whatsapp-pc-windows-*.zip`
- `decky-whatsapp-pc-linux-*.tar.gz`
- `decky-whatsapp-decky-plugin-*.zip`

These filenames are proposals and should be reconciled with the existing release workflow.

**Acceptance criteria:** Users can identify, install and run the correct companion package for their operating system.

### Task 5.5 — Cross-platform verification

- [ ] Windows installation and startup continue working.
- [ ] Linux installation works on at least one supported distribution.
- [ ] WhatsApp QR authentication works on Linux.
- [ ] Session persistence works after a deliberate restart.
- [ ] Text messages, media and notifications work through the Linux bridge.
- [ ] SSH reconnection behaves correctly.
- [ ] Windows/Linux bridge conflicts are handled safely.
- [ ] No operating system launches DeckyWhatsapp automatically.
- [ ] Installation can be repeated without destroying configuration or authentication data.

**Acceptance criteria:** Linux support introduces no regressions for existing Windows users.

### Manual completion checks — Phase 5

Complete these on at least one supported Linux distribution and on Windows for parity, in addition to the relevant Section 8 checks.

- [ ] Install and launch on a supported Linux desktop; verify missing-dependency guidance, SSH setup, and deliberate startup work without unnecessary privilege escalation. — PENDING IMPLEMENTATION + MANUAL REVIEW
- [ ] Complete WhatsApp QR authentication, send and receive text/media, and verify notifications and session persistence after a deliberate restart. — PENDING IMPLEMENTATION + MANUAL REVIEW
- [ ] Interrupt and restore the network; verify the tunnel recovers and a competing Windows or Linux bridge cannot displace the active session. — PENDING IMPLEMENTATION + MANUAL REVIEW
- [ ] Repeat installation and confirm configuration, WhatsApp authentication data, and existing SSH keys are preserved; verify neither OS starts the bridge automatically. — PENDING IMPLEMENTATION + MANUAL REVIEW

---

## 7. Phase 6 — Maintainability and regression protection

**Priority: P2 — After core UX improvements**

### Task 6.1 — Gradually modularize the frontend

The primary frontend file currently combines UI rendering, networking, notification handling, controller integration and state management.

**Proposed structure:**

- `components/ContactList.tsx`
- `components/ConversationView.tsx`
- `components/MessageBubble.tsx`
- `components/SettingsPanel.tsx`
- `components/DiagnosticsPanel.tsx`
- `hooks/useBridgeConnection.ts`
- `utils/formatters.ts`

These paths are suggestions, not mandatory requirements.

**Implementation:**

- [ ] Extract small, isolated UI components first.
- [ ] Extract pure formatting and state helpers.
- [ ] Reuse common message and chat types where practical.
- [ ] Avoid introducing unnecessary state-management libraries.
- [ ] Preserve existing behavior throughout the refactor.
- [ ] Keep architecture changes separate from user-facing feature changes.

**Acceptance criteria:** The codebase becomes easier to maintain without changing observable behavior.

### Task 6.2 — Expand automated regression tests

**Implementation:**

- [ ] Test connection failure and recovery states.
- [ ] Test timestamp formatting.
- [ ] Test message sending states.
- [ ] Test notification deduplication.
- [ ] Test controller navigation where practical.
- [ ] Test multiple competing bridges and session ownership.
- [ ] Test SSH port conflicts and launcher recovery behavior.
- [ ] Include Linux compatibility checks in CI where practical.
- [ ] Extend the existing test infrastructure rather than replacing it unnecessarily.

**Acceptance criteria:** Previously fixed bugs have regression coverage, particularly GitHub issues #1 and #2.

### Task 6.3 — Review security without disrupting UX

- [ ] Check whether Chromium's `--no-sandbox` flags are necessary on each supported operating system.
- [ ] Preserve loopback-only bridge binding.
- [ ] Review bridge authentication boundaries.
- [ ] Ensure diagnostic logs do not inadvertently expose sensitive message content or tokens.
- [ ] Preserve local WhatsApp authentication files and existing sessions.
- [ ] Avoid unnecessary dependency upgrades during UX work.
- [ ] Ensure multiple-bridge detection does not expose credentials or session tokens.

### Manual completion checks — Phase 6

Complete these after maintainability and regression-protection changes, in addition to the relevant Section 8 checks.

- [ ] Run the core Deck workflow after refactoring: open contacts and conversations, send/reply, react, play voice messages, and return to the game. — PENDING IMPLEMENTATION + MANUAL REVIEW
- [ ] Verify connection recovery, notification behavior, and competing-bridge protection still match the pre-refactor behavior. — PENDING IMPLEMENTATION + MANUAL REVIEW
- [ ] Inspect representative diagnostics and logs to confirm they contain no message contents, bridge tokens, or WhatsApp authentication data. — PENDING IMPLEMENTATION + MANUAL REVIEW

---

## 8. Testing and release requirements

Each implementation phase must pass relevant automated checks.

**Bridge (Windows and Linux):**

```bash
npm test
npm run typecheck
```

**Decky frontend:**

```bash
cd decky-plugin
npm run build
```

Run these after installing the existing project dependencies.

**Manual Steam Deck smoke tests:**

These checks require physical validation on the Steam Deck or the relevant desktop environment. Keep them unchecked until verified.

- [x] Plugin opens and contacts load. — USER CONFIRMED DURING PHASE 1 MANUAL CHECKS
- [x] Controller navigation functions in Gaming Mode. — USER CONFIRMED PASSED FOR PHASE 2
- [x] Messages can be sent and received. — USER CONFIRMED DURING PHASE 1 MANUAL CHECKS
- [x] Replies, reactions and deletion still function. — USER CONFIRMED PASSED FOR PHASE 2
- [x] Voice messages continue playing correctly. — USER CONFIRMED PASSED FOR PHASE 2
- [x] Optional voice typing remains unaffected. — USER CONFIRMED PASSED FOR PHASE 2
- [x] Notifications work with the Decky panel closed. — USER CONFIRMED PASSED FOR PHASE 3
- [x] Network loss and reconnection recover appropriately. — USER CONFIRMED DURING PHASE 1 MANUAL CHECKS
- [x] Deck sleep/resume does not require unnecessary manual intervention. — USER CONFIRMED PASSED FOR PHASE 3
- [x] Closing and reopening conversations does not corrupt UI state. — USER CONFIRMED PASSED FOR PHASES 2/3
- [ ] Existing Windows startup and shutdown procedures still function. — PENDING MANUAL REVIEW
- [x] A second computer cannot silently replace an active bridge. — USER CONFIRMED DURING PHASE 1 MANUAL CHECKS
- [ ] Linux and Windows launchers follow the same connection-conflict policy. — PENDING PHASE 5 IMPLEMENTATION + MANUAL REVIEW
- [ ] Neither platform starts the companion service automatically at login. — PENDING MANUAL REVIEW

Any behavior that cannot be validated automatically must be included in the implementation report as a manual test requirement.

---

## 9. Execution instructions for Codex

**This document is a proposal. Do not begin implementation until the user approves the plan.**

Once approved:

1. Execute one task or closely related group of tasks at a time.
2. Inspect the relevant source and tests before changing code.
3. Prefer minimal, targeted modifications.
4. Maintain compatibility with the existing bridge, message protocol and deployment procedures.
5. Avoid unrelated refactoring.
6. Add appropriate regression tests.
7. Run existing tests, type checks and the frontend build.
8. Report changes, tests executed, limitations and required manual Deck verification.
9. Stop after each phase for review rather than automatically proceeding through the entire roadmap.
10. **The orchestrator is responsible for keeping `PLAN.md` up to date throughout implementation:**
    - Automatically mark completed checklist items as `[x]` only after implementation and verification.
    - Leave incomplete or blocked tasks unchecked.
    - Update the current phase and implementation status.
    - Record outstanding issues and blockers.
    - Never mark a phase complete until all required tasks and tests have passed.
    - Ensure `PLAN.md` accurately reflects the actual state of the codebase before ending each session.
    - Add a phase-specific manual completion checklist at the end of every phase, in addition to Section 8, and do not mark the phase complete until its applicable manual checks pass.

If a task requires major architectural changes, additional dependencies or alterations to authentication/session handling, present the trade-offs for approval before implementation.

### Recommended implementation order

| Order | Task | Priority |
|---|---|---|
| 1 | Fix persistent connection warnings | P0 |
| 2 | Replace clock icons with timestamps | P0 |
| 3 | Improve loading and connection states | P0 |
| 4 | Prevent competing bridges from taking over active connections | P0 |
| 5 | Improve controller navigation | P1 |
| 6 | Streamline replying | P1 |
| 7 | Improve notifications | P1 |
| 8 | Improve history and contact-list UX | P2 |
| 9 | Simplify deliberate Windows startup | P2 |
| 10 | Add Linux bridge installation and launcher support | P1/P2 |
| 11 | Modularize frontend and expand tests | P2 |

---

## 10. Explicitly out of scope

For this development cycle:

- Standalone WhatsApp operation directly on the Steam Deck.
- WhatsApp voice/video calling.
- Cloud hosting or publicly accessible message bridges.
- Replacing the existing WhatsApp integration library.
- Complete frontend rewrites.
- Large unrelated dependency upgrades.
- Automatic startup at Windows or Linux login.
- Automatically installing persistent system services.
- Simultaneous multi-account WhatsApp support in one Decky interface.
- Unfinished-message draft persistence.
- Notification throttling for busy group conversations.
- Dedicated gaming quiet mode.
- Favorites or pinned contacts.

These features are not required for this roadmap.

---

## 11. Definition of success

DeckyWhatsapp should be considered meaningfully improved when:

1. Connection interruptions recover without confusing or stale warnings.
2. Contacts and unread messages are easy to identify.
3. Reading and replying using the Steam Deck controller is comfortable.
4. Notifications behave consistently during gameplay.
5. Multiple bridges cannot silently disrupt an existing session.
6. Existing messaging features continue working.
7. Windows startup and shutdown require less manual intervention while remaining deliberate.
8. Linux users can install and run a compatible companion bridge.
9. Windows and Linux behavior is consistent wherever practical.

**Target outcome:** A Steam Deck messaging experience that is reliable enough to use throughout normal gaming sessions, easy to launch when wanted, and compatible with both Windows and Linux companion computers.
