# PLAN.md — DeckyWhatsapp UX Improvement Roadmap

**Overall status:** APPROVED. Phases 1–6 are complete per user decisions and manual verification. The Phase 5 Linux release asset remains pending an authorized matching release. The user removed the GitHub-hosted package workflow; Linux verification remains available through the dedicated VM.
**Current task:** Created and verified dated Windows and Linux v1.0.0 companion ZIPs in `releases/2026-10-18/`. Phase 6 manual checks, the final code review, sensitive-file ignore audit, and stale artifact cleanup are complete. GitHub publication remains pending explicit authorization.
**Implementation status:** Phase 6.1 core work, Tasks 6.2–6.4 code-level work, Task 6.3 security review, approved MOCK work, and the reusable CDP harness are reviewed. The full suite passed 112/112; MOCK suite passed 12/12; both typechecks and the production build passed. Windows and Linux tests/builds from checkout paths containing spaces passed; Linux launcher checks and companion ZIP inspections passed. After three review passes and failed physical retesting, image expansion was removed from both builds; inline previews and audio Y remain. The combined update passed review pass 2 and is installed. Read-only Deck verification confirmed both plugin identities, all seven expected frontend/MOCK hashes, active `plugin_loader.service`, and production tree hash `12517be3ff25c86587a6ed960e43cdb9f0360a2e09a9818154246d5557af15ef`. The user reported all remaining Phase 6 manual checks passed; details are in [RESULTS.md](RESULTS.md#user-manual-test-checklist). Optional Whisper verification and publication of the Phase 5 Linux asset remain outside this closeout.

## Release closeout — existing scope only

**Status: NOT READY TO PUBLISH.** Phase 6 manual checks are complete per user confirmation. The remaining external step is attaching the matching Linux companion ZIP to an authorized GitHub release. Use [RESULTS.md](RESULTS.md#user-manual-test-checklist) for evidence and any remaining optional checks.

1. **Complete — Deck regression checks.** Phase 6.1 startup/controller/lifecycle, Start/Stop/reconnect, and existing UI behavior passed per user report. Keep private production messages and credentials out of diagnostics.
2. **Complete — isolated MOCK checks.** Production isolation, physical controller navigation, image-Y no-op behavior with inline previews, view-once fallbacks, and reset/remount behavior passed per user report. The separate-screen image viewer was removed after three review passes did not resolve its Deck behavior.
3. **Complete — manual cross-platform checks.** The suggested-host flow across docked Ethernet/Wi-Fi passed per user report. Windows and Linux suite/build checks from paths containing spaces, Linux launcher regression checks, and Ubuntu installer/runtime validation passed; details are in [RESULTS.md](RESULTS.md).
4. **Local artifacts ready; publication pending.** Local Windows and Linux ZIP builds and inspections passed. Attach the matching archives to a GitHub release only after the user authorizes that external change.

For any required code fix, use at most three independent review passes total. If a non-critical feature still fails after that, leave it out of the release rather than expanding scope. Phase 1–5 user-confirmed checks do not need to be repeated. The optional Whisper runtime check and previously deferred Phase 1 Deck SSH/stale-tunnel checks are not release-closeout work.

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

**Status: COMPLETE per the user's decision on 2026-10-15.** Deck SSH keepalive configuration and physical stale-tunnel recovery verification remain explicitly deferred and unchecked; completion does not mean those checks passed.

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

**Desired behavior:** Only one WhatsApp bridge should actively serve the Deck at a time, unless multi-account support is explicitly introduced in a future release. When a prior SSH client disappears uncleanly, Deck `sshd` should expire that dead connection and the Windows launcher should retry binding the port for a bounded period. The launcher must never kill a process based only on its port number.

**Proposed default policy: First connected session wins.**

**Implementation:**

- [x] Investigate how the current launcher handles occupied ports and active SSH tunnels.
- [x] Remove automatic termination of arbitrary processes occupying the Deck's bridge port.
- [x] Detect a responding DeckyWhatsapp bridge on the occupied remote port without exposing its session ID or token.
- [x] Distinguish a responding DeckyWhatsapp bridge from another HTTP service where safely possible; leave stale, non-HTTP, and otherwise unidentifiable owners ambiguous.
- [x] Add bounded Windows recovery for an unidentified stale remote-forward conflict, confirming the same local bridge remains active and never terminating a remote process.
- [x] Assign an identifiable runtime session ID to each bridge instance, without exposing authentication secrets.
- [x] Consider exposing non-sensitive connection identification information through an authenticated health/status endpoint.
- [x] Display an informative error when a second computer attempts to connect to an already occupied Deck.
- [x] Do not disconnect the existing session automatically.
- [x] Allow an existing bridge to reconnect after temporary network loss, provided it does not displace another active session.
- [x] Make SSH port-binding failures authoritative, even if a previous port-availability check succeeded.
- [x] Ensure the existing Windows launcher follows the conflict policy.
- [ ] Configure Deck `sshd` dead-client expiry (`ClientAliveInterval 15`, `ClientAliveCountMax 3`) and verify the effective settings. — Pending Deck administrator action.
- [x] Ensure the Linux launcher follows the same conflict policy.
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
- A genuinely stale SSH forward clears through dead-client expiry and a bounded retry without terminating an unrelated or live owner.
- No launcher kills arbitrary SSH or unrelated processes.
- Simultaneous startup races are handled predictably.

### Manual completion checks — Phase 1

Phase 1 status reflects the user's confirmation. `[I]` marks a check the user intentionally excluded, not a passed test; see [RESULTS.md](RESULTS.md#manual-tests).

- [x] In Gaming Mode, interrupt and restore bridge connectivity; confirm the connection warning clears and the plugin reconnects without reopening while loaded contacts remain available.
- [x] Confirm today, Yesterday, and older-contact timestamps display in the Deck’s local timezone and locale without truncating names.
- [x] Exercise loading, no-match/empty, computer-unavailable, authentication-required, and Retry states in the plugin.
- [x] With PC A connected, attempt PC B; verify the owner diagnostic identifies the responding DeckyWhatsapp bridge and PC A can continue sending and receiving.
- [x] Where a safe test service is available, verify another HTTP service is not labeled DeckyWhatsapp; verify non-HTTP or unresponsive owners receive an ambiguous, non-destructive diagnostic.
- [I] If using password-only SSH, confirm the diagnostic probe does not prompt for a second password.
- [ ] Demonstrate safe recovery from a genuinely stale tunnel without disturbing a live bridge or unrelated service. — Manual verification pending; see RESULTS.md.

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
- [x] When choosing “Reply to selected message,” focus the reply field and open the Steam keyboard automatically.
- [x] Keep failed messages distinguishable from messages with uncertain delivery status.
- [x] Avoid unexpected scrolling when new messages arrive while the user is reading older ones.

**Acceptance criteria:** Replying is quick, predictable and does not unexpectedly change the selected message or scroll position.

### Manual completion checks — Phase 2

Complete these in Steam Deck Gaming Mode in addition to the relevant Section 8 checks.

- [x] Navigate contacts, conversations, messages, reactions, and voice playback using only the controller; verify focus returns to the previous contact.
- [x] Use the Steam keyboard to send and reply; verify shortcuts do not fire while typing, quoted replies can be cancelled, and sending cannot be triggered twice accidentally.
- [x] Choose “Reply to selected message” with the controller; confirm focus enters the reply field, the Steam keyboard opens automatically, and typed text stays in the quoted reply.
- [x] While reading older messages, receive a new message and confirm selection and scroll position remain predictable; leave and reopen the conversation.
- [x] Retry an eligible failed message, navigate away before the request times out, return, and confirm delivery uncertainty persists and Retry stays unavailable.
- [x] From a conversation, press B and confirm it returns to contacts with the previous contact focused; confirm B in contacts/settings and while the Steam keyboard is active retains expected behavior.

---

## 4. Phase 3 — Notifications and conversation usability

**Priority: P1/P2**

**Status: COMPLETE — all Phase 3 Gaming Mode manual checks passed per user confirmation on 2026-10-15.**

### Task 3.1 — Polish notifications while gaming

The existing notification system should be retained and improved rather than replaced.

**Implementation:**

- [x] Confirm notifications continue working when the Decky panel is closed.
- [x] Prevent duplicate notifications for the same incoming message.
- [x] Respect existing settings for previews, sounds and notifications while gaming.
- [x] Make sure disabling previews never exposes private message content in notifications.
- [x] Test behavior following bridge reconnection and Deck sleep/resume.
- [x] Ensure legitimate new messages continue generating notifications according to existing preferences.

**Acceptance criteria:** Incoming notifications are timely, accurate and never duplicated due to reconnection.

### Task 3.2 — Improve conversation history navigation

**Implementation:**

- [x] Preserve the existing compact-history preference.
- [x] Investigate incremental loading of older messages.
- [x] If supported reliably, introduce paginated history loading rather than repeatedly fetching large histories. — Deferred: the current history API has no reliable cursor or offset.
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

- [x] Close the Decky panel and receive new messages; verify notifications are timely and not duplicated after reconnect or sleep/resume.
- [x] Toggle previews, sounds, and gaming notifications; verify disabled previews never reveal message content.
- [x] Browse older history and media while scrolling, receiving new messages, and switching conversations; verify reading position is preserved, requests cancel safely, and media retry works.
- [x] Exercise all contact sort/filter modes and verify unread counts, long names, previews, and timestamps remain clear while profile pictures load.

---

## 5. Phase 4 — Simplify Windows startup

**Priority: P2 — Convenience improvement**

**Status: COMPLETE — all Phase 4 Windows manual checks passed per user confirmation on 2026-10-15.**

### Task 4.1 — Introduce optional background operation

**Current behavior:** The Windows launcher starts the WhatsApp bridge and SSH tunnel in separate windows that must remain open.

**Proposed improvement:** Allow DeckyWhatsapp to run without requiring persistent console windows, while preserving deliberate manual startup.

**Implementation:**

- [x] Preserve the existing launcher as the reliable fallback.
- [x] Add optional background launch for the bridge and tunnel without persistent console windows.
- [x] Provide commands to inspect logs and determine whether each process is running.
- [x] Consider a Windows tray application only if it offers meaningful benefits.
- [x] Ensure users can stop the system cleanly, including recovery from partial startup.
- [x] Avoid duplicate bridge processes and conflicting tunnels.
- [x] Validate recovery when the Steam Deck reconnects after sleep or its IP address changes.
- [x] Ensure background operation only begins after explicit user initiation.
- [x] Ensure closing the management command does not silently stop the session; provide a distinct explicit Stop command and explain it in the README.

**Strict requirement: No automatic startup.**

Do not register Windows startup entries, scheduled login tasks, persistent auto-start services or equivalent mechanisms.

**Acceptance criteria:** The user can deliberately start DeckyWhatsapp and leave it running without persistent terminal windows, then explicitly stop it when finished.

### Task 4.2 — Clarify service lifecycle controls

**Implementation:**

- [x] Review the distinction between disabling notifications, disconnecting the plugin and shutting down the PC bridge.
- [x] Use descriptive button labels.
- [x] Avoid accidentally terminating the bridge when the user only intends to close the interface.
- [x] Make the current running state obvious.
- [x] Ensure the shutdown workflow remains compatible with existing scripts.
- [x] Preserve the explicit-startup requirement.

**Acceptance criteria:** Users understand exactly what Start, Stop and notification controls do.

### Manual completion checks — Phase 4

Complete these on Windows in addition to the relevant Section 8 checks.

- [x] Start background operation deliberately, inspect running state and logs (confirm the pairing QR and bridge token are absent), then stop it; verify the bridge and its owned tunnel exit cleanly.
- [x] Confirm notification disablement, plugin disconnect, and PC bridge shutdown have distinct, accurate effects and labels.
- [x] Verify reconnect after Deck sleep or IP change, and confirm no bridge or tunnel starts automatically at Windows login.

---

## 6. Phase 5 — Linux installer and bridge compatibility

**Priority: P1/P2 — New platform support**

**Status: COMPLETE per user confirmation on 2026-10-16.** The user confirmed the Linux and Windows behavior and all Phase 5 manual checks work as expected. The future GitHub Release asset under Task 5.4 remains unchecked because it requires a matching authorized release.

### Objective

Allow DeckyWhatsapp's companion WhatsApp bridge to run on a Linux desktop or laptop rather than requiring Windows.

The Steam Deck will continue running the same Decky plugin. The main difference is which operating system hosts the WhatsApp bridge.

**Initial platform targets:**

- Ubuntu and Debian-based Linux distributions.
- x86_64 architecture for the initial support target; the pinned Puppeteer 24.38.0 browser bundle does not establish Linux ARM support.
- Other common distributions, such as Fedora, after dependency and installation testing.

**Important:** Running the bridge directly on SteamOS is not part of this phase. The existing Steam Deck Whisper installer remains separate.

### Task 5.1 — Audit the bridge for cross-platform compatibility

**Implementation:**

- [x] Identify Windows-specific assumptions in the existing bridge and launcher.
- [x] Check the pinned dependency Node.js engine ranges and select a currently supported LTS target (Node 22/24; recommend 24 for new installations).
- [x] Confirm the pinned `whatsapp-web.js` dependency and Puppeteer's official Linux target: Ubuntu/Debian x86_64 initially; exclude ARM pending a validated native browser, and defer Fedora until tested.
- [x] Identify required Chromium system libraries and note distribution-specific package-name differences.
- [x] Review browser executable discovery and sandbox settings.
- [x] Identify configuration, log and authentication path behavior.
- [x] Avoid changing the existing Windows implementation unnecessarily.

**Acceptance criteria:** The existing WhatsApp bridge can start, authenticate and exchange messages on a supported Linux computer.

**Runtime acceptance:** COMPLETE per user confirmation on 2026-10-16. Detailed evidence and earlier partial runs are in [RESULTS.md](RESULTS.md).

### Task 5.2 — Create a Linux installation script

**Proposed file:** `install-decky-whatsapp-linux.sh`

**Implementation:**

- [x] Detect the Linux distribution and architecture (Ubuntu/Debian x86_64 initial target).
- [x] Check for Node.js 22+, npm, Git and OpenSSH client availability; recommend Node 24 LTS.
- [x] Check for necessary Chromium/Puppeteer system dependencies, including apt package alternatives.
- [x] Provide installation guidance for missing requirements.
- [x] Offer apt dependency installation only after explicit consent, with a separate confirmation for the resolved package list.
- [x] Install Node.js dependencies using the project's lockfile with `npm ci`.
- [x] Check SSH connectivity to the Steam Deck.
- [x] Offer explicit setup of passwordless SSH authentication without replacing existing keys.
- [x] Create a user-level launcher shortcut where supported, without overwriting an existing command.
- [x] Preserve existing WhatsApp authentication data, configuration, cache and SSH keys during reinstallation.
- [x] Display understandable installation errors and recovery steps.

**Implementation review:** See [RESULTS.md](RESULTS.md#automated-tests). The declined-host-key test validates only the expected SSH failure path; the live Deck path is not included in that test.

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

- [x] Start the WhatsApp bridge using the installed Node.js environment.
- [x] Locate the Steam Deck by hostname or IP address.
- [x] Allow manually entering the Deck's address when automatic discovery fails.
- [x] Establish the existing SSH reverse tunnel.
- [x] Keep the bridge bound to the local loopback interface.
- [x] Detect SSH forwarding failures.
- [x] Recover from temporary network interruptions.
- [x] Respect the single-active-bridge policy from Task 1.4.
- [x] Stop the launcher-owned bridge and tunnel cleanly.
- [x] Preserve explicit manual startup.
- [x] Support ordinary terminal execution first; optionally offer a manually launched background mode.

**Acceptance criteria:** A Linux computer can provide the same core messaging functionality as the Windows companion application.

**Implementation review and automated checks:** See [RESULTS.md](RESULTS.md#automated-tests). The user confirmed the Linux runtime and manual checks passed; see [RESULTS.md](RESULTS.md#manual-tests).

**GitHub issue tracking:** Opened [#3 — Avoid SSH FIFO startup race](https://github.com/db452/DeckyWhatsapp/issues/3) and [#4 — Keep SSH log draining independent of terminal output](https://github.com/db452/DeckyWhatsapp/issues/4) on 2026-10-15. GitHub CLI authentication succeeded outside the network sandbox.

**Automated checks:** See [RESULTS.md](RESULTS.md#automated-tests). These checks do not replace the Linux runtime checks listed under [Manual tests](RESULTS.md#manual-tests).

### Task 5.4 — Update release packaging and documentation

**Implementation:**

- [ ] Create and verify a Linux companion package asset in GitHub Releases. — Pending a matching authorized release; see RESULTS.md.
- [x] Create distinct Windows and Linux companion ZIPs under local `releases/` with the files required for each platform.
- [x] Include the Linux installer and launcher.
- [x] Keep Windows and Linux releases distinguishable.
- [x] Update README compatibility requirements.
- [x] Document Linux-specific installation and troubleshooting.
- [x] Document supported Linux distributions and architectures.
- [x] Include guidance on Chromium installation problems.
- [x] Ensure no private session data or local tokens enter release archives.
- [x] Add automated Linux installation/build checks where practical. Ubuntu VM validation passed; see [RESULTS.md](RESULTS.md).

**Proposed artifacts:**

- `decky-whatsapp-pc-windows-*.zip`
- `decky-whatsapp-pc-linux-*.zip`
- `decky-whatsapp-decky-plugin-*.zip`

These filenames are proposals and should be reconciled with the existing release workflow.

**Acceptance criteria:** Users can identify, install and run the correct companion package for their operating system.

### Task 5.5 — Cross-platform verification

- [x] Windows installation and startup continue working.
- [x] Linux installation works on at least one supported distribution.
- [x] WhatsApp QR authentication works on Linux.
- [x] Session persistence works after a deliberate restart.
- [x] Text messages, media and notifications work through the Linux bridge.
- [x] SSH reconnection behaves correctly.
- [NA] Windows/Linux bridge conflicts are handled safely.
- [x] No operating system launches DeckyWhatsapp automatically.
- [x] Installation can be repeated without destroying configuration or authentication data.

**Acceptance criteria:** Linux support introduces no regressions for existing Windows users.

### Manual completion checks — Phase 5

Complete these on at least one supported Linux distribution and on Windows for parity, in addition to the relevant Section 8 checks. **COMPLETE per user confirmation on 2026-10-16.** Code-level fixes passed independent review and automated checks; the user confirms final Linux and Windows runtime behavior works.

- [X] Install and launch on a supported Linux desktop; verify missing-dependency guidance, SSH setup, and deliberate startup work without unnecessary privilege escalation.
- [x] Complete WhatsApp QR authentication, send and receive text/media, and verify notifications and session persistence after a deliberate restart.

- [x] On Linux, confirm Disconnect, verify the bridge and owned SSH tunnel exit, the terminal command ends, port 8787 is released, and another computer can connect.
- [x] Repeat on Windows; verify the bridge and owned SSH windows close, the ports release, and another computer can connect.
- [x] After network recovery, confirm contact previews refresh without opening conversations, including while new messages arrive.
- [x] Confirm messages remain chronological after Linux reconnect and after switching back to Windows; include a sent message and reply within the same second and verify the latest-history window contains the newest messages.
- [x] On Linux, send a message in the selected conversation and confirm it appears there as soon as the contact preview updates; verify it remains after history refresh/reopen and does not duplicate.
- [IGNORED] Configure a non-default `PORT` through `.env` and the process environment; verify each platform starts the bridge and SSH forward on that same port and rejects invalid values with a clear error.
- [x] Reconnect or replace the bridge while a conversation is open; confirm messages from the prior session do not appear, current-session live messages survive initial history loading, and the conversation loading indicator clears.
- [x] Repeat send, delivery/read acknowledgement, reaction, edit, and delete updates on Windows; confirm each remains correct after history refresh or reconnect.
- [x] Expand older conversation history and confirm message order and reading position remain correct.
- [x] Confirm a failed-send placeholder appears in the right chronological position.
- [X] Restart the Deck and confirm contact previews and conversation order remain correct after reconnect.
- [x] Cancel the shutdown confirmation and verify the active connection stays up; run the confirmed shutdown from Diagnostics; while the computer is unreachable, use “Disconnect this Deck only” and confirm local retries/notifications stop without claiming the PC bridge exited.
- [x] Repeat installation and confirm configuration, WhatsApp authentication data, and existing SSH keys are preserved; verify neither OS starts the bridge automatically.

### Phase 5 follow-up notes

- [x] Show the failed-send status directly beneath the failed message and above the reply control, where it remains visible when the top of the panel is off-screen.
- [x] Make controller B return to contacts when the reply field is focused.
- [x] On contact open, scroll the overall plugin viewport to the bottom once and focus the newest message control without selecting it. D-pad Up should move to the previous message.
- [x] Remove the explanatory PC bridge disconnect text beneath the connection control.

**Manual checks for these notes — COMPLETE per user confirmation on 2026-10-16:**

- [x] Cause a send to fail and confirm the failure is shown beneath the failed message, above the reply control, and remains visible at the bottom of a long conversation. Retry it and simulate a lost response; confirm the notice changes to delivery uncertain and does not suggest retrying again. Confirm no misleading success message appears.
- [x] Focus the reply field with the Steam keyboard closed, press controller B, and confirm the plugin returns to contacts rather than the Decky menu; verify ordinary typed “b” input still works.
- [x] Open conversations with five or fewer messages and with more than five messages. Confirm each nonempty conversation scrolls to the bottom once and the newest message gets controller highlight without opening actions. Press Up and confirm the previous message receives focus; confirm A is needed to select a message. From the contacts page, D-pad Down from Disconnect should follow normal contact order. Refresh history, use reply controls, then press B.
- [x] Open Diagnostics and confirm the explanatory PC bridge disconnect text beneath the connection control is gone while the disconnect action and its confirmation safety warning still work.

---

## 7. Phase 6 — Maintainability and regression protection

**Priority: P2 — After core UX improvements**

**Status: COMPLETE per user confirmation on 2026-10-18.** Required Phase 6 manual checks passed per the user's report; see [RESULTS.md](RESULTS.md#user-manual-test-checklist). Optional Whisper validation remains unchecked and is not a release-closeout requirement.

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

- [x] Extract small, isolated UI components first.
- [x] Extract pure formatting and state helpers.
- [x] Reuse common message and chat types where practical.
- [x] Avoid introducing unnecessary state-management libraries.
- [x] Preserve existing behavior throughout the refactor. Automated regressions and the user's clean Windows/Ubuntu installs and production Deck session passed per user report; see [RESULTS.md](RESULTS.md#user-manual-test-checklist).
- [x] Keep architecture changes separate from user-facing feature changes.

**Acceptance criteria:** The codebase becomes easier to maintain without changing observable behavior.

### Task 6.2 — Expand automated regression tests

**Implementation:**

- [x] Test connection failure and recovery states.
- [x] Test timestamp formatting.
- [x] Test message sending states.
- [x] Test notification deduplication.
- [x] Test controller navigation where practical. Active React MOCK tests dispatch controller events and verify navigation/action handling; physical controller verification passed per user report.
- [x] Test multiple competing bridges and session ownership.
- [x] Test SSH port conflicts and launcher recovery behavior.
- [x] Verify Linux compatibility in the dedicated Ubuntu VM. The user removed the GitHub-hosted workflow on 2026-10-17; evidence is in [RESULTS.md](RESULTS.md).
- [x] Extend the existing test infrastructure rather than replacing it unnecessarily.

**Implementation review:** See [RESULTS.md](RESULTS.md#automated-tests). Controller navigation also passed its manual Deck check per user report.

**Acceptance criteria:** Previously fixed bugs have regression coverage, particularly GitHub issues #1 and #2.

### Task 6.3 — Review security without disrupting UX

- [x] Check whether Chromium's `--no-sandbox` flags are necessary on each supported operating system.
- [x] Preserve loopback-only bridge binding.
- [x] Review bridge authentication boundaries.
- [x] Ensure diagnostic logs do not expose message content or tokens.
- [x] Preserve local WhatsApp authentication files and existing sessions.
- [x] Avoid unnecessary dependency upgrades during UX work.
- [x] Ensure multiple-bridge detection does not expose credentials or session tokens.

### Task 6.4 -- Remaining features

- [x] Use a simple local Start/Stop control without a confirmation warning. Stop only Deck-side activity; leave the existing bridge and tunnel running. Start reconnects to the configured bridge, and resume recovery is gated by the enabled plugin session. Implementation passed review on pass 3 and focused automated tests; physical Start/Stop, reconnect, and sleep/resume checks passed per user report.

- [x] Evaluate the image viewer request. After three review passes and physical retesting, Y still returned to contacts; the viewer was removed from release scope under the release rule. Inline previews remain and image Y is now a consumed no-op. See [RESULTS.md](RESULTS.md).

- [x] Handle view-once media as unsupported: detect photo/video/audio fixtures, show the phone fallback, skip media downloads, and do not claim the message was viewed. The installed WhatsApp media API exposes no safe view-once operation; actual playback and a viewed-state confirmation remain unsupported. MOCK fallback/navigation verification passed per user report.

- [x] Add a safe suggested Deck host to the Windows/Linux installers and launchers. Discovery checks only the fixed conventional names `steamdeck.local`, `steamdeck.lan`, and `steamdeck` with bounded lookups; it does not scan the network or connect/authenticate. Users can accept the suggestion or enter a hostname/IP. Implementation and prompt tests passed independent review; docked Ethernet/Wi-Fi behavior passed per user report.

- [x] Load 10 older messages per request and allow repeated expansion. After each expansion, restore focus/highlight to the message immediately before the prior oldest visible boundary (message 6, then 16, and so on), with guarded single scroll/focus restoration. Automated tests, independent review, and physical controller focus/scroll verification passed per user report.
### Manual completion checks — Phase 6

Complete these after maintainability and regression-protection changes, in addition to the relevant Section 8 checks.

- [x] Run the core Deck workflow after refactoring: open contacts and conversations, send/reply, react, play voice messages, and return to the game. User reported success; see [RESULTS.md](RESULTS.md#user-manual-test-checklist).
- [x] Verify connection recovery, notification behavior, and competing-bridge protection still match the pre-refactor behavior. User reported success.
- [x] Inspect representative diagnostics and logs to confirm they contain no message contents, bridge tokens, or WhatsApp authentication data. User reported the manual check passed; Codex did not inspect private production logs.
- [x] Verify voice typing returns a successful transcript and that a controlled transcription failure exposes no dictated content in the UI or logs. User reported success.
- [x] Restart or reinstall the plugin deliberately and confirm the linked WhatsApp authentication session is preserved. User reported success.

- [x] After the Chromium sandbox change, start the bridge deliberately on Windows and confirm Chrome launches with its default sandbox and the existing WhatsApp session works; repeat on Linux to confirm the retained Linux flags still start the bridge. User reported success.
- [x] Toggle the Deck connection off and on. Confirm stop closes only Deck-side activity while the PC bridge, owned tunnel, and bridge port remain active; Start reconnects to the same configured bridge; plugin restart begins OFF; and Deck sleep/resume reconnects while enabled. User reported success.
- [x] In the replacement MOCK build, press Y on a still image and confirm the conversation remains open with message/reply selection unchanged; confirm inline preview remains visible. Confirm audio-message Y playback still works. User reported success.
- [x] In Gaming Mode, confirm a conversation initially shows the newest 5 messages; each “Load more messages” click adds the next 10 older messages and highlights/focuses message 6, then 16, etc. Confirm each expansion makes one scroll adjustment, does not alter reply selection, remains navigable with the controller, and handles a partial final batch, new incoming messages, and exhausted history without a dead button. User reported success.
- [x] Test the suggested Deck address flow on Windows and Linux: accept a resolved hostname, replace it with a manual hostname/IP, and verify a saved hostname is resolved again after moving between docked Ethernet and Wi-Fi. User reported success.
- [x] Run the Windows full suite, MOCK suite, typechecks, and builds from a checkout path containing spaces. See [RESULTS.md](RESULTS.md).
- [x] Run the checkout-with-spaces check on Linux in the Ubuntu VM. Automated results are recorded in [RESULTS.md](RESULTS.md).
- [x] Check incoming view-once photo, video, and audio messages in the isolated MOCK. Confirm the phone fallback, no media retry, no viewed claim, safe B navigation, and ordinary media behavior. User reported success; no real production conversation was opened for this check.

**User final sign-off — complete per user confirmation on 2026-10-18.** Fresh snapshots are user-managed. Detailed scope is in [RESULTS.md](RESULTS.md#user-manual-test-checklist).

- [x] Clean-install and check functionality from the fresh Windows VM snapshot. Passed per user report.
- [x] Clean-install and check functionality from the fresh Ubuntu VM snapshot. Passed per user report.
- [x] Complete an approximately one-hour Gaming Mode session with the production plugin active. Passed per user report.
- [x] Complete the separate MOCK-only controller, history, media fallback, and isolation checks. Passed per user report.

---

## Phase 6.1 — PluginFix

**Status: COMPLETE per user confirmation on 2026-10-18.** Implementation and independent review are complete; startup, controller, suspend/resume, session-preservation, and existing-functionality checks passed per user report.

### Task: Fix Decky WhatsApp SteamUI startup crash and improve future compatibility

## Context

The Decky WhatsApp plugin is currently failing to load on the Steam Deck, producing this error:

```text
TypeError: SteamClient.System.Regi...
at http://127.0.0.1:1337/plugin...
at Module.<anonymous> (...)
at PluginLoader.importReactPlugin (...)
at async PluginLoader.importPlugin (...)
```

The error appears during frontend module loading, before the plugin can render.

Our goals are:

1. Fix the current startup crash.
2. Make the frontend substantially more resilient to future SteamOS, SteamUI, and Decky Loader updates.
3. Preserve all existing WhatsApp functionality and controller support.

Read the repository's `AGENTS.md` (if present), `PLAN.md`, and relevant source code before making changes. Follow the existing agent orchestration and review workflow where applicable.

## Part 1 — Identify the root cause

Investigate the exact source of the `SteamClient.System.Register...` exception.

- Inspect `decky-plugin/src/index.tsx`, its imports, the Rollup configuration, and relevant dependencies.
- Search all frontend code, dependencies, and generated bundles for references to `SteamClient.System`, particularly `RegisterFor*` functions.
- Identify whether the exception originates in our code, `@decky/ui`, `@decky/api`, or another dependency.
- Inspect the frontend bundle and source maps where available to trace the failing module.
- Check current official Decky Loader development guidance and compatible package versions.
- Investigate the conflicting `@decky/ui` version ranges in `decky-plugin/package.json` (`^4.1.0` and `^4.11.0`).
- Determine whether the plugin relies on outdated, undocumented, or removed Steam APIs.

Do not assume the incomplete screenshot identifies the exact failing method. Establish the actual cause using available evidence.

## Part 2 — Fix the crash

Implement a proper fix addressing the root cause.

Prefer current supported Decky APIs and components rather than direct Steam internals wherever possible.

If an optional Steam API is unavailable:

- Detect its availability before invoking it.
- Avoid throwing during module initialization.
- Degrade gracefully without disabling unrelated functionality.
- Report useful diagnostic information without exposing sensitive data.

If a dependency causes the error during module import, correct the dependency problem or isolate the incompatible import. A React error boundary alone is not sufficient for exceptions thrown during module evaluation.

Keep changes as focused as possible.

## Part 3 — Future-proof the Steam interface

Perform a targeted compatibility audit of the plugin frontend.

### A. Centralized Steam API compatibility layer

Where justified, introduce a small compatibility module, such as `steam-compat.ts`.

Centralize direct Steam API interactions behind well-defined, type-safe wrappers.

The compatibility layer should:

- Support missing or undefined Steam API namespaces.
- Check that functions exist before invoking them.
- Handle registration failures gracefully.
- Handle absent or invalid subscription handles.
- Safely unregister event listeners on cleanup.
- Avoid duplicate listeners across remounts or plugin reloads.
- Provide explicit capability checks for optional functionality.
- Produce useful, non-sensitive diagnostic logs.

Do not build an unnecessarily complicated abstraction or introduce speculative fallback APIs.

### B. Reduce dependence on Steam internals

Audit usage of:

- `SteamClient.*`
- SteamUI-specific global objects
- Undocumented Steam APIs
- Internal React component discovery
- Steam-generated CSS class names
- Steam DOM structures and selectors
- Controller input registration
- Navigation and focus management

Prefer public `@decky/api` and `@decky/ui` interfaces whenever available.

For UI elements, prefer stable React components and locally controlled styling rather than relying on Steam's internal DOM implementation.

### C. Graceful degradation

A missing optional API should never crash the whole plugin.

For example:

- If a controller input registration API disappears, the WhatsApp interface should still load and remain usable through standard controls.
- If a notification integration becomes unavailable, messaging should continue functioning.
- If a Steam-specific focus-management feature fails, preserve ordinary interaction wherever possible.

Essential failures should produce a readable error state with recovery instructions rather than an uncaught exception.

### D. Dependency compatibility

Audit and rationalize Decky-specific dependencies.

- Resolve inconsistent version declarations.
- Compare the project's versions with current official Decky guidance and template.
- Check Rollup externals and bundling behavior.
- Avoid unnecessary major-version upgrades.
- Keep dependency and lockfile changes consistent.
- Verify that the compiled artifact is compatible with the intended Decky Loader runtime.

Do not blindly upgrade every dependency.

## Part 4 — Regression tests

Add automated tests for the compatibility boundaries.

At minimum, test these situations:

1. Expected Steam APIs are available.
2. `SteamClient` is undefined.
3. `SteamClient.System` exists but a registration function is missing.
4. A Steam API registration call throws.
5. A listener returns no valid unregister handle.
6. Controller input registration is unavailable.
7. The plugin is mounted and unmounted repeatedly.
8. Optional integrations fail without preventing the main UI from loading.

Test that unavailable optional functionality does not break WhatsApp messaging, contacts, settings, or navigation.

Where practical, include a frontend startup/import smoke test that catches failures before rendering.

Mock the necessary Decky and Steam APIs rather than relying on a real Steam Deck for every automated test.

Run the relevant builds, TypeScript checks, and existing regression tests.

## Part 5 — Preserve existing functionality

Do not introduce regressions in:

- WhatsApp messages and conversation history
- Notifications
- Contacts and filtering
- Sending messages and replies
- Reactions
- Images, audio, and other media
- Controller navigation and button shortcuts
- Multiple WhatsApp sessions, where supported
- PC bridge connectivity and SSH tunneling
- Windows and Linux companion compatibility
- Settings and connection-state handling

Do not rewrite the PC bridge or modify authentication and SSH functionality unless a change is demonstrably required to fix this issue.

Preserve existing data and configuration.

## Deliverables

Implement the necessary source-code changes, tests, and relevant documentation.

At completion, report:

1. The confirmed or most strongly supported root cause, with code references.
2. The exact changes made to fix it.
3. The compatibility safeguards introduced.
4. Any remaining SteamUI or Decky dependencies that cannot realistically be future-proofed.
5. Test/build results, including any tests that could not run.
6. Manual verification steps for the Steam Deck.
7. Whether a new Decky plugin ZIP is ready to package and install.

Do not claim the issue is fixed on real hardware until it has been verified there.

Do not automatically deploy, publish a release, modify SteamOS, or change the SSH setup without authorization.

**Priority: Fix the crash first, then implement focused future-proofing without compromising the existing plugin.**

### Phase 6.1 implementation checklist

- [x] Trace the startup exception to the strongest-supported source and identify remaining runtime limitations.
- [x] Guard optional resume/controller registration and cleanup so missing Steam APIs cannot prevent plugin loading or unrelated UI use.
- [x] Prevent stale/duplicate listeners across remounts and plugin bundle reloads; cover missing and invalid handles in regression tests.
- [x] Exercise startup degradation through the production plugin descriptor path and include those tests in the standard suite.
- [x] Resolve the `@decky/ui` declaration conflict consistently with the current official template and lockfile.
- [x] Pass the complete automated suite, root typecheck, Decky frontend build, and package-lock consistency check.

### Phase 6.1 manual Steam Deck verification checklist

- [x] Install the reviewed plugin build and confirm it loads on the affected SteamUI without the startup exception; contacts and settings render. User reported success.
- [x] Confirm controller navigation and the X reaction / Y media actions still work. User reported success.
- [x] With the plugin enabled, suspend and resume the Deck; verify reconnection. Disable/re-enable and reload the plugin; confirm actions do not duplicate. User reported success.
- [x] Confirm representative messaging, notifications, history, media, settings, bridge connectivity, and existing WhatsApp session/configuration remain intact. User reported success.
- [x] Inspect startup/runtime diagnostics for useful compatibility warnings and confirm they contain no message contents, bridge tokens, or authentication data. User reported success; Codex did not inspect private production logs.

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

- [x] Plugin opens and contacts load.
- [x] Controller navigation functions in Gaming Mode.
- [x] Messages can be sent and received.
- [x] Replies, reactions and deletion still function.
- [x] Voice messages continue playing correctly.
- [x] Optional voice typing remains unaffected.
- [x] Notifications work with the Decky panel closed.
- [x] Network loss and reconnection recover appropriately.
- [x] Deck sleep/resume does not require unnecessary manual intervention.
- [x] Closing and reopening conversations does not corrupt UI state.
- [x] Existing Windows startup and shutdown procedures still function.
- [x] A second computer cannot silently replace an active bridge.
- [x] Linux and Windows launchers follow the same connection-conflict policy.
- [x] Neither platform starts the companion service automatically at login.

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

---

## Proposed amendment — Phase 6.2: Real-Deck inspection and isolated MOCK testing

**Status: APPROVED FOR ISOLATED MOCK IMPLEMENTATION, PHYSICAL MOCK INSTALLATION, A REQUIRED DECKY RESTART, AND MOCK-ONLY GAMING MODE/CDP TESTING (2026-10-17).** The authorization covers only /home/deck/homebrew/plugins/decky-whatsapp-mock and requires production identity/hash guards. Production plugin and WhatsApp account access remain prohibited.

### Preflight summary — 2026-10-17

- Initial direct CDP access was blocked in the default command context. A later approved tunnel enabled read-only Deck inspection; details are in [RESULTS.md](RESULTS.md#manual-tests).
- Preflight identified the need for separate manifest identity, storage namespace, backend data paths, and offline transport. The approved MOCK implementation addresses these isolation requirements; implementation and test evidence is in [RESULTS.md](RESULTS.md#automated-tests).

### Proposed scope and acceptance criteria

1. Re-establish read-only Deck SSH/CDP access from the Codex context without changing sandbox policy or replacing an existing tunnel. Verify the installed Decky Loader version and collect only sanitized plugin-loader/frontend diagnostics. Do not read chat contents or invoke account APIs.
2. Verify side-by-side plugin behavior against the installed Loader version. Use a distinct plugin directory and distinct manifest `name`/RPC identity, visible `MOCK` label, separately generated asset path, and isolated settings/data/log paths. Do not rely on the `appkey` field alone. Stop if the installed Loader cannot safely host both variants.
3. Build the mock variant with compile-time offline provider wiring. It must not contain a route to the PC bridge, WhatsApp endpoints, QR/authentication flows, or production credentials. Give it a distinct `localStorage` namespace and either omit the voice backend or use a mock-only backend that never reads production Whisper configuration or files.
4. Provide deterministic invented contacts, groups, histories, media placeholders, and incoming events. Simulated sends, reactions, deletion, typing, and navigation may mutate only disposable mock state. Unknown network requests fail closed; automated negative tests prove production bridge and credential access are blocked.
5. Add a directly declared, established CDP client and tests for target discovery, plugin rendering, controller/UI navigation within the mock target, startup exceptions, and sanitized diagnostics. Read-only production inspection may observe target metadata, exception/log events, and DOM snapshots; capture screenshots only when they cannot expose private content. Do not run arbitrary page JavaScript or send input to games.
6. Run all automated interactions only after the mock isolation tests pass. Stage to a distinct temporary directory and install on the physical Deck only after separate user approval. Never overwrite production, restart Decky/Steam, or alter the existing bridge/tunnel.

**Proposed completion evidence:** automated isolation tests and frontend checks pass; read-only SteamUI inspection captures sanitized startup results; authorized side-by-side mock installation and Gaming Mode checks pass; production plugin files, credentials, settings, storage, bridge, and WhatsApp account remain untouched.

### Approved implementation subset — isolated MOCK plugin

**Status: COMPLETE per user confirmation on 2026-10-18.** The initial offline CDP interaction subset passed. A guarded synthetic Y attempt and the user's physical Y attempt did not open the image viewer; after three review passes, it was removed from release scope. The replacement build makes image Y a no-op while keeping inline previews and audio Y playback; the user reported the replacement MOCK checks passed. The CDP helper's click ancestry check remains unresolved after its three review passes and is not required for the approved release behavior. See [RESULTS.md](RESULTS.md).

**Approved follow-up — combined Windows Deck deployment helper:** Build and stage both plugin variants, verify identities and hashes, and install only to their existing directories after explicit confirmation and interactive sudo. Implementation and user-confirmed Deck verification are recorded in [RESULTS.md](RESULTS.md).

- [x] Add a Windows `.bat` entry point and PowerShell runner that build both variants, validate exact artifact files/identities, resolve the configured Deck host, stage and verify SHA-256 hashes, request an explicit `DEPLOY` confirmation, install only the five known runtime files in the two existing plugin directories via interactive SSH TTY/sudo, and restart `plugin_loader.service` once.
- [x] Add fail-closed remote checks for destination and staged path identity, directory/file symlinks, file types, hashes, and service state; document the process-scoped PowerShell execution policy and the effects of running the batch.
- [x] Build both variants, validate the deployment scripts and fixtures, and pass independent review.
- [x] Complete physical verification of the combined deployment: interactive sudo and artifact hashes/identities are confirmed, the Loader is active, and the reviewed installer restarts it once. The user reports both entries and their separate behavior passed; Codex did not inspect private production settings or logs. See [RESULTS.md](RESULTS.md#user-manual-test-checklist).

- [x] Bound each candidate DNS lookup so unavailable/misconfigured name resolution returns control to the user within a fixed interval.
- [x] Print progress before host resolution; test success/failure/never-resolving lookup paths and lingering child-process handles; pass independent review.

- [x] Print each build/resolve/connect/preflight/transfer/hash/confirmation stage and report success after silent native commands; the success path now prints `Success!` and waits three seconds before closing.
- [x] Bound SSH/SCP connection attempts and report partial staging on timeout.
- [x] User ran the batch; installed identities/hashes and active Loader were independently verified. See [RESULTS.md](RESULTS.md#manual-tests).

**Deployment helper requirement:** Bound noninteractive SSH/SCP stages, report possible partial staging on timeout, and keep the final interactive sudo install step user-driven. Implementation and verification evidence: [RESULTS.md](RESULTS.md#automated-tests).
- [x] Bound noninteractive SSH/SCP command duration and make timeout failures name the stage and state that a staging directory may be partial.
- [x] Test timeout and successful command paths using owned local stub processes; pass independent review. Do not deploy.

- [x] Verify distinct mock identity, output layout, backend RPC identity, and storage/data/log paths from official Decky Loader source; preserve the production manifest and artifacts.
- [x] Share production UI/components while introducing compile-time provider wiring that excludes production bridge and WhatsApp transport from the mock bundle.
- [x] Add deterministic fabricated contacts, groups, multiple mock sessions, histories, media placeholders, notifications, stateful local message/reaction/edit/delete behavior, reset, and error/reconnect scenarios.
- [x] Ensure mock backend performs no production voice-file/config access and mock storage uses a distinct namespace.
- [x] Add negative isolation tests for forbidden bridge/WhatsApp URLs, credential loading, production RPC/backend calls, transport mutations, storage collisions, missing configuration fallback, artifact overwrite, and duplicate subscriptions.
- [x] Add separate production/mock build outputs and commands; verify building either variant does not overwrite the other.
- [x] Add stable semantic selectors and local CDP readiness documentation without installing or interacting with the physical Deck.
- [x] Run builds, typechecks, automated tests, artifact inspection, and independent code review.
- [x] Exercise the mounted React panel's effects and representative UI handlers in an active local harness; verify fabricated send/reaction, cleanup/remount, and forbidden production access
- [x] Complete the read-only Steam Deck Loader and side-by-side installation preflight.
- [x] Install MOCK beside production and verify its identity, hashes, service state, and unchanged production tree.
- [x] Complete the initial offline MOCK CDP interaction subset. The user also confirmed the physical view-once and controller checks passed; the image viewer was removed from scope after three review passes.
- [x] Add a reusable, directly declared CDP client and repository-managed tests for target discovery, MOCK rendering, startup diagnostics, and sanitized exceptions. Local checks and independent review passed; physical target/controller checks passed per user report. See [RESULTS.md](RESULTS.md#automated-tests).

### Manual checks required before Phase 6.2 can be considered complete

- [x] Read-only preflight confirms installed Decky Loader v3.2.10, ESM support, production identity/path, and an absent MOCK plugin/settings/data/log path. This does not verify a physical installation or runtime load.
- [x] Install `Decky WhatsApp MOCK` in its distinct directory; verify its five artifact hashes, manifest/package identity, ownership/modes, active loader service, and unchanged production plugin tree hash.
- [x] Run the reviewed combined viewer-removal update at `/home/deck/decky-whatsapp-update-20261018-no-viewer-01`; read-only verification confirmed both production frontend hashes, all five MOCK hashes and identities, active `plugin_loader.service`, and the updated production tree. The installer checked the unaffected production files/layout before and after the restart.
- [x] Confirm MOCK loads without changing production settings, runtime data, logs, or RPC identity. User reports isolation checks passed; Codex did not inspect private production settings or logs.
- [x] In Gaming Mode, use controller navigation to exercise fabricated conversations/actions, older history, inline previews, image Y no-op behavior, audio Y playback, and notifications. User reports these physical checks passed; see [RESULTS.md](RESULTS.md#manual-tests).
- [x] Reset and remount MOCK; verify fixture reset, settings, subscriptions, and production isolation. User reports these Deck checks passed; see [RESULTS.md](RESULTS.md#manual-tests).
