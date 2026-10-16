# PLAN.md — DeckyWhatsapp UX Improvement Roadmap

**Status:** APPROVED — Phase 1 is COMPLETE per the user's decision on 2026-10-15; Deck SSH keepalive configuration and physical stale-tunnel recovery verification remain deferred and unchecked. Phases 2, 3, and 4 implementation, code review, and required manual checks are complete per user confirmation. Phase 5 is ON HOLD per the user's decision on 2026-10-15 because no Linux test system is available today. Tasks 5.1–5.4 code work passed review; Linux runtime/manual acceptance, hosted Linux CI, and attachment of the package to a matching published GitHub Release remain pending. Phase 6 is IN PROGRESS.
**Current task:** Phase 6 — complete the remaining Deck manual checks. The optional Whisper installer fixes passed independent review on pass 1; SteamOS runtime checks remain pending. Phase 5 remains on hold at Task 5.5 until Linux testing can resume.
**Phase 3 review status:** Tasks 3.1–3.3 passed independent code review. Root tests passed 31/31 with a temporary preload for the Windows Node `os.userInfo()` ENOMEM issue; root typecheck, frontend build/typecheck, and diff check passed on 2026-10-15. The user confirmed all Phase 3 Gaming Mode manual checks passed on 2026-10-15. Phase 2 code review and implementation checks passed; the user also confirmed all Phase 2 Gaming Mode manual checks passed on 2026-10-15.
**Implementation status:** Phase 1 is complete per the user's confirmation on 2026-10-15. Windows Task 1.4 owner identification passed independent review pass 2. Verified on Windows: `npm.cmd test` (31/31, using a temporary `NODE_OPTIONS` preload for the Node `os.userInfo()` ENOMEM issue), `npm.cmd run typecheck`, `decky-plugin` `npm.cmd run build`, PowerShell parsing, and `git diff --check`. The user confirmed the applicable Phase 1 manual checks `[x]` and intentionally ignored the password-only SSH second-prompt check `[I]`. The user later considered Phase 1 complete while deferring Deck-side stale-tunnel verification. The Windows bounded-retry implementation passed independent review on pass 3; `npm.cmd test` passed 44/44 with the documented temporary `os.userInfo()` preload, and typecheck, PowerShell parsing, and `git diff --check` passed. The retry checks that the same local bridge remains active, never kills remote processes, and requires OpenSSH debug output confirming the remote forward was established before supervising reconnects. Deck SSH configuration was inspected read-only; effective `ClientAlive` values could not be verified without sudo, and no Deck configuration was changed. The user explicitly deferred configuring and verifying these Deck-side settings while considering Phase 1 complete. The debug success-message format is OpenSSH-version-dependent. Phase 5 Task 5.3 implementation passed independent follow-up review; actual Linux runtime and manual acceptance remain pending. Phase 2 was approved by the user on 2026-10-15. The focused Task 2.2 fix for retry timeouts after navigation passed independent code review on 2026-10-15, and its frontend build/typecheck passed. The reply-field focus and Steam keyboard activation follow-up passed independent code review on pass 2; its frontend build/typecheck and scoped diff check passed. The user confirmed in Gaming Mode that reply keyboard activation works; all Phase 2 manual checks passed and Phase 2 is complete. The focused retry fix records uncertainty for the mounted plugin session; it is not persisted across plugin remounts. Phase 3 was authorized by the user on 2026-10-15. Task 3.1 notification deduplication passed independent code review and automated frontend checks; its manual Deck checks passed per user confirmation. Phase 3 Tasks 3.1–3.3 passed independent code review and frontend build, typecheck, and diff checks on 2026-10-15. Phase 3 implementation and required Gaming Mode manual checks are complete per user confirmation. Phase 4 was approved by the user on 2026-10-15. Task 4.1's initial independent review returned CHANGES_REQUIRED with four findings (replacement-process shutdown safety, QR persistence in logs, port configuration, and supervisor lifetime on port reuse); those were addressed in remediation. Task 4.1 passed independent review on pass 3 on 2026-10-15. The full root suite passed 37/37 using a temporary preload for the Windows Node os.userInfo() ENOMEM issue; npm.cmd run typecheck, PowerShell parsing, and git diff --check passed. Task 4.1 passed independent review on pass 3; all Phase 4 Windows manual checks passed per user confirmation on 2026-10-15. Task 4.2 passed independent review on pass 2 on 2026-10-15. Frontend build, frontend TypeScript check, and diff check passed. Phase 4 is complete per user confirmation of all Windows manual checks on 2026-10-15. Phase 5 was approved by the user on 2026-10-15; Task 5.1 static audit and Task 5.2 installer passed independent review on pass 2; Linux runtime acceptance is pending. Phase 2 verification on Windows: `npm.cmd test` passed 31/31 with the temporary `NODE_OPTIONS` preload for the Node `os.userInfo()` ENOMEM issue; plain `npm.cmd test` fails before tests start with that environment error. `npm.cmd run typecheck`, `decky-plugin` `npm.cmd run build`, frontend `npm.cmd exec -- tsc --noEmit -p tsconfig.json`, and `git diff --check` passed. Task 3.1 verification: frontend build, frontend TypeScript check, and `git diff --check` passed; a reviewer-run mocked callback harness passed notification deduplication, settings/privacy, reconnect/stop/start, and cache-bound checks. Phase 2 and Phase 3 Gaming Mode checks are complete per user confirmation.
**Phase 5 progress:** Task 5.1 static audit passed independent review on pass 2 on 2026-10-15. Task 5.2 installer code passed independent review on pass 2; Git Bash `bash -n` and trailing-whitespace checks passed. The pinned Puppeteer 24.38.0 bundle supports Linux x86_64; initial support is limited to Ubuntu/Debian x86_64, with ARM excluded until a native browser is validated and Fedora deferred until tested. The dependencies declare Node >=18, but Node 20 is EOL; target supported Node 22/24 LTS and recommend Node 24. Linux install, apt, SSH, browser launch, QR authentication, message exchange, and tunnel behavior remain unverified on this Windows-only host and are reserved for Phase 5 manual verification. The existing `--no-sandbox` flags are retained and recorded as a security limitation pending Linux runtime validation. Task 5.3 initially received CHANGES_REQUIRED after review pass 3. The user authorized continued Phase 5 work on 2026-10-15; both FIFO lifetime and terminal-output findings were fixed and passed independent follow-up review. Linux runtime acceptance remains pending. The launcher resolves its own symlink target before deriving the package root so the Task 5.2 `~/.local/bin/decky-whatsapp` shortcut works. Task 5.4 packaging and documentation passed independent review on pass 2; its ZIP packaging update passed independent review. Both local ZIPs were built reproducibly from explicit allowlists: `releases/decky-whatsapp-pc-windows-v1.0.0.zip` and `releases/decky-whatsapp-pc-linux-v1.0.0.zip`. The actual release attachment and hosted workflow remain unverified. Task 5.5 test-only race synchronization passed independent review on pass 2. The focused tunnel reservation pair passed three consecutive runs and the full Windows suite passed 46/46 with a temporary `NODE_OPTIONS` preload for the Node `os.userInfo()` ENOMEM issue. Root `npm.cmd run typecheck`, `git diff --check`, and Git Bash syntax checks passed. Linux runtime/manual acceptance, hosted workflow execution, and release attachment remain pending while Phase 5 is on hold by user decision.
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
- [x] Add bounded Windows recovery for an unidentified stale remote-forward conflict, confirming the same local bridge remains active and never terminating a remote process. — INDEPENDENT REVIEW PASS 3 PASSED; 44/44 tests and code-level checks passed.
- [x] Assign an identifiable runtime session ID to each bridge instance, without exposing authentication secrets.
- [x] Consider exposing non-sensitive connection identification information through an authenticated health/status endpoint.
- [x] Display an informative error when a second computer attempts to connect to an already occupied Deck.
- [x] Do not disconnect the existing session automatically.
- [x] Allow an existing bridge to reconnect after temporary network loss, provided it does not displace another active session.
- [x] Make SSH port-binding failures authoritative, even if a previous port-availability check succeeded.
- [x] Ensure the existing Windows launcher follows the conflict policy.
- [ ] Configure Deck `sshd` dead-client expiry (`ClientAliveInterval 15`, `ClientAliveCountMax 3`) and verify the effective settings. — PENDING DECK ADMINISTRATOR ACTION; no privileged configuration has been changed.
- [x] Ensure the Linux launcher follows the same conflict policy. — IMPLEMENTED AND REVIEWED UNDER TASK 5.3; Linux runtime verification remains pending under Phase 5.
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

The user confirmed the `[x]` checks passed and marked `[I]` checks as intentionally ignored. `I` means excluded by the user's personal decision; it does not mean the test passed.

- [x] In Gaming Mode, interrupt and restore bridge connectivity; confirm the connection warning clears and the plugin reconnects without reopening while loaded contacts remain available.
- [x] Confirm today, Yesterday, and older-contact timestamps display in the Deck’s local timezone and locale without truncating names.
- [x] Exercise loading, no-match/empty, computer-unavailable, authentication-required, and Retry states in the plugin.
- [x] With PC A connected, attempt PC B; verify the owner diagnostic identifies the responding DeckyWhatsapp bridge and PC A can continue sending and receiving.
- [x] Where a safe test service is available, verify another HTTP service is not labeled DeckyWhatsapp; verify non-HTTP or unresponsive owners receive an ambiguous, non-destructive diagnostic.
- [I] If using password-only SSH, confirm the diagnostic probe does not prompt for a second password. — INTENTIONALLY IGNORED BY USER; not verified.
- [ ] Demonstrate safe recovery from a genuinely stale tunnel without disturbing a live bridge or unrelated service. — WINDOWS IMPLEMENTATION AND CODE REVIEW COMPLETE; PENDING DECK SSH CONFIGURATION AND MANUAL VERIFICATION.

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

**Status: COMPLETE — all Phase 4 Windows manual checks passed per user confirmation on 2026-10-15.**

### Task 4.1 — Introduce optional background operation

**Current behavior:** The Windows launcher starts the WhatsApp bridge and SSH tunnel in separate windows that must remain open.

**Proposed improvement:** Allow DeckyWhatsapp to run without requiring persistent console windows, while preserving deliberate manual startup.

**Implementation:**

- [x] Preserve the existing launcher as the reliable fallback.
- [x] Add optional background launch for the bridge and tunnel without persistent console windows.
- [x] Provide commands to inspect logs and determine whether each process is running.
- [x] Consider a Windows tray application only if it offers meaningful benefits. — Script commands provide the needed controls without a tray app.
- [x] Ensure users can stop the system cleanly, including recovery from partial startup.
- [x] Avoid duplicate bridge processes and conflicting tunnels.
- [x] Validate recovery when the Steam Deck reconnects after sleep or its IP address changes. — USER CONFIRMED PASSED 2026-10-15
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

- [x] Start background operation deliberately, inspect running state and logs (confirm the pairing QR and bridge token are absent), then stop it; verify the bridge and its owned tunnel exit cleanly. — USER CONFIRMED PASSED 2026-10-15
- [x] Confirm notification disablement, plugin disconnect, and PC bridge shutdown have distinct, accurate effects and labels. — USER CONFIRMED PASSED 2026-10-15
- [x] Verify reconnect after Deck sleep or IP change, and confirm no bridge or tunnel starts automatically at Windows login. — USER CONFIRMED PASSED 2026-10-15

---

## 6. Phase 5 — Linux installer and bridge compatibility

**Priority: P1/P2 — New platform support**

**Status: ON HOLD per the user's decision on 2026-10-15 — no Linux test system is available today. Resume at Task 5.5 runtime and manual verification.**

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
- [x] Check the pinned dependency Node.js engine ranges and select a currently supported LTS target (Node 22/24; recommend 24 for new installations). — Linux runtime compatibility still requires manual verification.
- [x] Confirm the pinned `whatsapp-web.js` dependency and Puppeteer's official Linux target: Ubuntu/Debian x86_64 initially; exclude ARM pending a validated native browser, and defer Fedora until tested.
- [x] Identify required Chromium system libraries and note distribution-specific package-name differences.
- [x] Review browser executable discovery and sandbox settings. — Puppeteer uses its bundled Chrome for Testing by default; the existing bridge disables Chromium sandboxing.
- [x] Identify configuration, log and authentication path behavior. — `.env`, LocalAuth and the WhatsApp cache depend on the process working directory; Linux launchers must start from the package directory.
- [x] Avoid changing the existing Windows implementation unnecessarily.

**Acceptance criteria:** The existing WhatsApp bridge can start, authenticate and exchange messages on a supported Linux computer.

**Runtime acceptance:** PENDING — no Linux host is available in this Windows environment. Verify clean installation, browser launch, QR authentication, persistent session and message exchange during Phase 5 manual testing.

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

**Implementation review:** Passed independent review on pass 2 on 2026-10-15. Git Bash `bash -n` and trailing-whitespace checks passed. The installer was not executed; Linux package installation, SSH, browser launch and persistent data checks remain pending manual verification.

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

**Implementation review:** Initial review returned CHANGES_REQUIRED on pass 3 on 2026-10-15 for FIFO lifetime and terminal-output backpressure. After the user authorized continuation, both findings were resolved and passed an independent follow-up review. Git Bash `bash -n`, focused Linux SSH tests (2/2, using the temporary Windows `os.userInfo()` preload), `npm.cmd run typecheck`, and `git diff --check` passed. No Linux runtime test was run; password prompting, tunnel establishment, reconnection, bridge ownership, messaging, and shutdown remain pending manual verification.

**GitHub issue tracking:** Opened [#3 — Avoid SSH FIFO startup race](https://github.com/db452/DeckyWhatsapp/issues/3) and [#4 — Keep SSH log draining independent of terminal output](https://github.com/db452/DeckyWhatsapp/issues/4) on 2026-10-15. GitHub CLI authentication succeeded outside the network sandbox.

**Local checks:** Git Bash `bash -n` passed for both scripts; trailing-whitespace scan passed; `npm.cmd run typecheck` passed. Plain `npm.cmd test` failed before tests started because this Windows Node environment returned `uv_os_get_passwd` ENOMEM. Re-running with the temporary `NODE_OPTIONS` compatibility preload passed 37/37. These checks do not establish Linux runtime behavior.

### Task 5.4 — Update release packaging and documentation

**Implementation:**

- [ ] Create and verify a Linux companion package asset in GitHub Releases. — The local platform ZIPs exist. The workflow attaches them to a matching user-published release. The current latest release is v1.0.0, which predates these uncommitted Phase 5 changes; do not attach these builds to that tag. Publish from a matching future version after the Phase 5 changes are included in its source.
- [x] Create distinct Windows and Linux companion ZIPs under local `releases/` with the files required for each platform. — Independently reviewed; both archives match explicit allowlists and retain Linux executable modes.
- [x] Include the Linux installer and launcher.
- [x] Keep Windows and Linux releases distinguishable.
- [x] Update README compatibility requirements.
- [x] Document Linux-specific installation and troubleshooting.
- [x] Document supported Linux distributions and architectures.
- [x] Include guidance on Chromium installation problems.
- [x] Ensure no private session data or local tokens enter release archives. — Verified by independent archive inspection and explicit allowlist checks.
- [x] Add automated Linux installation/build checks where practical. — Workflow is configured; hosted execution remains pending.

**Proposed artifacts:**

- `decky-whatsapp-pc-windows-*.zip`
- `decky-whatsapp-pc-linux-*.zip`
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

Complete these on at least one supported Linux distribution and on Windows for parity, in addition to the relevant Section 8 checks. **PENDING; Phase 5 is on hold until a Linux test system is available.**

- [ ] Install and launch on a supported Linux desktop; verify missing-dependency guidance, SSH setup, and deliberate startup work without unnecessary privilege escalation. — PENDING MANUAL REVIEW; no supported Linux host is available in this Windows session.
- [ ] Complete WhatsApp QR authentication, send and receive text/media, and verify notifications and session persistence after a deliberate restart. — PENDING MANUAL REVIEW; Linux runtime has not been exercised.
- [ ] Interrupt and restore the network; verify the tunnel recovers and a competing Windows or Linux bridge cannot displace the active session. — PENDING MANUAL REVIEW; Linux tunnel runtime has not been exercised.
- [ ] Repeat installation and confirm configuration, WhatsApp authentication data, and existing SSH keys are preserved; verify neither OS starts the bridge automatically. — PENDING MANUAL REVIEW on Linux and Windows.

---

## 7. Phase 6 — Maintainability and regression protection

**Priority: P2 — After core UX improvements**

**Status: IN PROGRESS per user approval on 2026-10-15. Tasks 6.1 and 6.2 code work passed independent review. Task 6.3 passed independent review on pass 3 on 2026-10-16 after two remediation rounds. The optional Whisper installer fixes passed independent review on pass 1; Git Bash syntax and scoped diff checks passed. Steam Deck manual checks, representative runtime-log inspection, voice-typing runtime validation, and the physical session-persistence check remain pending. Hosted Linux CI and Chromium sandbox validation remain pending under the Phase 5 hold.**

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

- [x] Extract small, isolated UI components first. — `ContactAvatar` is extracted and used by contacts and the conversation header; independent review passed on pass 1.
- [x] Extract pure formatting and state helpers. — Avatar initials and deterministic style helpers moved to `utils/avatar.ts`; independent review passed on pass 1.
- [x] Reuse common message and chat types where practical. — `ChatSummary` is shared from `types/chat.ts`; independent review passed on pass 1.
- [x] Avoid introducing unnecessary state-management libraries. — No dependencies or state-management libraries added.
- [ ] Preserve existing behavior throughout the refactor. — ContactAvatar and MessageBubble layout, labels, and parent event ownership passed independent code review; physical Deck visual/interaction verification remains pending below.
- [x] Keep architecture changes separate from user-facing feature changes. — This slice changes component/module boundaries only.

**Implementation progress:** ContactAvatar and MessageBubble presentation slices passed independent review (one pass each). `npm.cmd run build`, `npm.cmd exec -- tsc --noEmit -p tsconfig.json`, and `git diff --check` passed. Deck visual and interaction review remains pending.

**Acceptance criteria:** The codebase becomes easier to maintain without changing observable behavior.

### Task 6.2 — Expand automated regression tests

**Implementation:**

- [x] Test connection failure and recovery states. — Existing connection and connection-state tests passed in the 50/50 full suite.
- [x] Test timestamp formatting. — Existing formatter tests passed in the 50/50 full suite.
- [x] Test message sending states. — Added coverage for sent, delivered, read, sending, failed, and uncertain states; independently reviewed.
- [x] Test notification deduplication. — Added coverage for duplicate IDs and bounded oldest-entry eviction; independently reviewed.
- [ ] Test controller navigation where practical. — No isolated unit-test seam without Decky focus/controller runtime; retain the manual Deck checks below.
- [x] Test multiple competing bridges and session ownership. — Existing server/tunnel tests passed in the 50/50 full suite.
- [x] Test SSH port conflicts and launcher recovery behavior. — Existing tunnel recovery/conflict tests passed in the 50/50 full suite.
- [x] Include Linux compatibility checks in CI where practical. — Ubuntu workflow runs tests, typecheck, and shell/package checks; hosted execution remains pending under Phase 5.
- [x] Extend the existing test infrastructure rather than replacing it unnecessarily. — Extended the existing Node `node:test` suite without adding dependencies.

**Implementation review:** Passed independent review on pass 1. Focused helper tests passed 4/4; the full suite passed 50/50 for Task 6.2 and later 53/53 including Task 6.3 regressions, using a temporary `os.userInfo()` preload for the known Windows Node `uv_os_get_passwd` ENOMEM issue. Root typecheck, frontend build/typecheck, and scoped `git diff --check` passed. Plain `npm.cmd test` remains unable to start in this Windows environment without the documented preload. Controller navigation remains a manual Deck check.

**Acceptance criteria:** Previously fixed bugs have regression coverage, particularly GitHub issues #1 and #2.

### Task 6.3 — Review security without disrupting UX

- [ ] Check whether Chromium's `--no-sandbox` flags are necessary on each supported operating system. — Linux runtime is unavailable while Phase 5 is on hold; do not claim the flags are necessary or remove them without runtime validation.
- [x] Preserve loopback-only bridge binding. — Explicit host allowlist rejects non-loopback values; `.env.example` and `docs/SECURITY.md` now document the enforced loopback binding and supported SSH tunnel.
- [x] Review bridge authentication boundaries. — Static review confirms origin checks, per-process bearer-token HTTP auth, WebSocket token checks, and expected-session shutdown validation.
- [x] Ensure diagnostic logs do not inadvertently expose sensitive message content or tokens. — Remediated malformed-body, WebSocket event, Whisper output, and WhatsApp dependency-exception logging. Synthetic redaction regressions and corrected Python CI test discovery passed; independent review passed on pass 3. Representative runtime-log inspection remains pending below.
- [x] Preserve local WhatsApp authentication files and existing sessions. — Static installer/shutdown review found no session deletion; physical reinstall/restart check remains pending below.
- [x] Avoid unnecessary dependency upgrades during UX work. — Dependency versions and lockfiles are unchanged.
- [x] Ensure multiple-bridge detection does not expose credentials or session tokens. — Static review confirms probes use bounded unauthenticated health fingerprints and do not bootstrap tokens.

### Manual completion checks — Phase 6

Complete these after maintainability and regression-protection changes, in addition to the relevant Section 8 checks.

- [ ] Run the core Deck workflow after refactoring: open contacts and conversations, send/reply, react, play voice messages, and return to the game. — PENDING MANUAL REVIEW
- [ ] Verify connection recovery, notification behavior, and competing-bridge protection still match the pre-refactor behavior. — PENDING MANUAL REVIEW
- [ ] Inspect representative diagnostics and logs to confirm they contain no message contents, bridge tokens, or WhatsApp authentication data. — PENDING MANUAL REVIEW; automated synthetic checks passed, but runtime logs have not been inspected on the Deck.
- [ ] Verify voice typing returns a successful transcript and that a controlled transcription failure exposes no dictated content in the UI or logs. — PENDING MANUAL REVIEW; automated sentinel coverage passed and installer code review passed, but SteamOS installation and transcription have not been tested.
- [ ] Restart or reinstall the plugin deliberately and confirm the linked WhatsApp authentication session is preserved. — PENDING MANUAL REVIEW; only static preservation checks have been completed.

**Optional Whisper installer review — PASS on review pass 1 (2026-10-16):** The installer now explicitly repairs missing header packages, restores SteamOS read-only mode after package preparation and returns failure if restoration fails, stages and validates a pinned source checkout, verifies existing and downloaded models against a pinned digest, and rejects root execution. `bash -n` and scoped `git diff --check` passed. The installer was not run; package installation, recovery behavior, and transcription remain pending Steam Deck manual verification.

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
