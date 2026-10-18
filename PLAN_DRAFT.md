# PLAN.md — DeckyWhatsapp Standalone Steam Deck Edition

**Status:** DRAFT — Awaiting user review and approval<br>
**Project:** [db452/DeckyWhatsapp](https://github.com/db452/DeckyWhatsapp)<br>
**Proposal:** Run WhatsApp entirely on the Steam Deck, with no PC companion and no SSH tunnel.<br>
**Priority:** Minimize impact on gameplay performance, battery life, memory and SteamOS stability.

**Relationship to existing roadmap:** A separate, proposed migration plan. Do not replace the approved UX roadmap or begin implementation until authorized.

## 1. Objective and non-negotiable principles

DeckyWhatsapp should receive notifications, display conversations and send messages in SteamOS Gaming Mode using **only the Deck itself** and its normal internet connection. A smartphone is still required for WhatsApp account linking; an external computer or relay must not be required during use.

- **Performance first.** Idle background operation must be exceptionally light; receiving a message must not cause perceptible game stutter.
- **No browser by default.** Investigate a browserless WhatsApp transport before considering any Chromium-based implementation on the Deck.
- **Preserve existing functionality.** Keep the current controller UI, notification preferences, chat history, reactions, replies, media, voice-message playback, and optional local voice typing wherever the selected transport supports them.
- **No silent sacrifices.** Missing features, authentication risks, resource trade-offs and protocol incompatibilities require explicit review.
- **No unnecessary privileges.** Avoid modifying SteamOS's read-only system partition, globally installing Node, installing system services, or running the WhatsApp engine as root.
- **Deliberate activation.** A user-controlled Enable/Disable switch starts and stops the background WhatsApp connection. No automatic startup at OS login/boot. Clarify and test Decky reload behavior.
- **No unnecessary features.** Do not add persistent drafts, notification suppression for busy groups, a quiet mode, pinned contacts, or simultaneous multi-account support.
- **Safe rollback.** Keep the existing PC-bridge implementation usable until the standalone version is verified and explicitly approved as its replacement.

## 2. Current implementation: verified starting point

The October 16, 2026 source snapshot contains:

- `src/whatsapp.ts`: a WhatsApp client based on `whatsapp-web.js` and Puppeteer/Chromium, currently hosted on a companion computer.
- `src/server.ts` and `src/types.ts`: an Express/WebSocket loopback bridge, health/status reporting, QR events, message/chat endpoints and shared message/event structures.
- `decky-plugin/src/index.tsx` and `decky-plugin/src/connection.ts`: the Decky frontend, notifications, conversation handling, controller interaction and bridge reconnection.
- `decky-plugin/main.py`: an existing Python Decky backend currently used for optional local Whisper transcription; its `_main` and `_unload` do not supervise a messaging process yet.
- Existing Windows/Linux launchers and SSH tunnel supervision, which standalone operation should no longer require.

**Design implication:** Preserve the frontend-facing contracts wherever practical, replace the WhatsApp implementation behind an adapter, and move its process to the Deck. Do not copy `whatsapp-web.js`'s authentication folder into a new protocol client's session directory; those formats are not interchangeable by assumption.

## 3. Phase 0 — Baseline and performance specification (P0)

**Goal:** Establish measurable limits before writing the standalone implementation.

- [ ] Record the test Deck's model (LCD/OLED), SteamOS version, Decky version, power profile and software environment.
- [ ] Select repeatable test games/scenes, including at least one CPU-sensitive game and one demanding game at a constrained TDP (for example 8–10 W).
- [ ] Capture no-plugin baseline: frame times (including 1% lows), APU/GPU load, system memory, battery discharge/power and thermals where reliably available.
- [ ] Capture baseline with the *existing Decky UI enabled* but no active bridge, to separate frontend overhead from WhatsApp-engine overhead.
- [ ] Define consistent workloads: connected-idle; five messages received over 10 minutes; active chat browsing; media download; extended gaming session; sleep/resume.
- [ ] Record measurement procedures, tools, repeat count and variance; compare like-for-like runs at the same settings and game scene.
- [ ] Establish a baseline artifact under `docs/performance/` without including message content, credentials or personal identifiers.

**Provisional performance targets — proposals, not measured claims:**

| Metric | Initial target | Measurement / caveat |
|---|---|---|
| Incremental idle memory | ≤ 120 MiB PSS; review if above 180 MiB | Entire standalone process tree, not just the Node parent |
| Connected-idle CPU | ≤ 1% of one logical CPU on average | Sample over 10 minutes, after synchronization |
| Gaming frame-time / FPS effect | ≤ 2% average FPS change and ≤ 3% change in 1% lows | Repeated matched runs; investigate outliers and stutter |
| Added gaming power draw | Aim ≤ 0.5 W when connected-idle | Compare similar conditions; treat noisy readings as inconclusive |
| Disabled state | No running WhatsApp engine; no ongoing polling/network work | UI/backend may remain loaded as part of Decky |
| Resource growth | No sustained memory/cache growth across a 2-hour soak | Include media and reconnect cycles |

If the hardware or workload makes these thresholds unrealistic, **present actual measurements and a revised budget for approval**. Do not quietly weaken the thresholds. Short, bounded message-processing CPU bursts are permissible only if gameplay remains unaffected.

**Exit gate:** Approved benchmark protocol and provisional performance budget. No transport migration yet.

## 4. Phase 1 — Browserless WhatsApp feasibility spike (P0, hard gate)

**Preferred candidate:** Investigate [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys), a TypeScript/WebSocket WhatsApp client that does not require Chromium. Treat it as a candidate, not a committed dependency. Verify its currently supported release, Node runtime requirements, feature coverage, licenses and compatibility with WhatsApp's linked-device protocol.

- [ ] Create an **isolated proof of concept**, separate from the production WhatsApp bridge and authentication files.
- [ ] Prototype pairing on the Deck (QR shown in Gaming Mode; pairing code only if reliably supported).
- [ ] Confirm authenticating, saving credentials, stopping, restarting and reconnecting without repeated pairing.
- [ ] Demonstrate receiving/sending text, listing contacts/chats, unread metadata and reading recent history.
- [ ] Probe quoted replies, reactions, edits/deletions, acknowledgement status, profile photos, image/sticker/GIF media, and voice-message playback.
- [ ] Document features requiring new message/contact persistence: a browserless transport may **not** provide the same ready-made history store as `whatsapp-web.js`.
- [ ] Measure RAM/PSS, CPU, power indicators, reconnect behavior and network activity on the real Steam Deck while connected-idle and under message load.
- [ ] Investigate protocol-breakage risk, library maintenance, WhatsApp terms/account-risk implications and a safe update/pinning strategy.
- [ ] For comparison only, estimate or measure the existing Chromium-based engine on Deck hardware. **Do not adopt it as a fallback without explicit approval.**

**Decision record:** Produce a comparison of supported features, missing features, measured resource use, maintenance/security risks, required additional services and package size.

**GO:** A browserless approach successfully pairs, receives/sends messages, persists authentication, and is convincingly within the provisional resource budget.

**REVISE:** A modest adapter/storage change could resolve specific gaps without materially increasing overhead.

**NO-GO / STOP:** Performance, basic protocol reliability, account risk or essential feature parity is unacceptable; ask the user before proceeding or considering Chromium.

**Exit gate:** Explicit user approval of the chosen engine and its documented limitations.

## 5. Phase 2 — Deck-local architecture and lifecycle (P1)

**Proposed architecture:**

```text
WhatsApp network (direct, encrypted linked-device connection)
                         ↕
Deck-local lightweight WhatsApp engine (one session)
                         ↕
Local transport adapter + bounded message/cache storage
                         ↕
Loopback HTTP/WebSocket compatibility API (127.0.0.1 only)
                         ↕
Existing Decky frontend: chats, controllers, notifications

Decky Python backend: start/stop/health supervision of local engine
```

No Windows/Linux companion process, SSH forwarding, external relay, cloud database or additional always-running service.

- [ ] Introduce a provider-neutral WhatsApp adapter interface so the current PC engine and candidate Deck engine can coexist temporarily.
- [ ] Reuse or adapt the existing `BridgeEvent`, `IncomingMessage`, `ChatSummary`, HTTP routes and WebSocket event semantics; write contract tests first.
- [ ] Package a compatible **Linux x86_64** runtime and prebuilt application dependencies if required; do not assume Node exists on SteamOS.
- [ ] Test whether the existing Python Decky `main.py` can safely manage a long-lived subprocess via `_main`, explicit RPC start/stop, `_unload` and `_uninstall` without blocking Decky.
- [ ] Run the WhatsApp engine as an unprivileged process. Verify actual Decky backend execution identity and privilege separation before coding process launch.
- [ ] Keep authentication and cache data in a persistent, **user-owned** directory under the Deck user's home, outside plugin update/replacement paths; permissions should restrict access to the owner.
- [ ] Ensure only one Deck-local engine instance can run. Prevent duplicate process spawn, accidental port takeover and conflicting legacy PC bridge connections.
- [ ] Keep the API loopback-only; revise bootstrap/authentication where necessary. Do not treat a forgeable `Origin` header as sufficient authentication against other local programs.
- [ ] Implement bounded restarts with backoff, no infinite crash loops, no zombie processes and deterministic stop/uninstall behavior.
- [ ] Ensure ordinary closing of the Decky panel does not disconnect messaging **while the user has enabled it**; explicit Disable must stop the connection and free its resources.
- [ ] Check what happens after Decky reload, Gaming Mode restart, Deck suspend/resume, network changes and SteamOS updates. Do not silently enable a stopped session at boot.

**Exit gate:** A Deck-local engine can be started/stopped and used from the existing frontend, with no PC or SSH process, without privileged system modifications.

## 6. Phase 3 — Feature parity and bounded storage (P1)

- [ ] Preserve text sending/receiving, conversation lists, unread counts and read markers.
- [ ] Preserve quoted replies, reactions, edit/delete updates and delivery/acknowledgement states where supported; explicitly report unsupported semantics.
- [ ] Preserve contact metadata/profile photos and existing sorting/filtering modes.
- [ ] Preserve image, sticker, GIF and voice-message rendering/playback where supported.
- [ ] Keep notifications active when the Decky panel is closed but messaging is enabled, respecting existing preview/sound/while-gaming preferences.
- [ ] Preserve duplicate-notification prevention and existing controller/focus behavior.
- [ ] Support QR pairing directly in the Deck UI, clear authentication failure states, and explicit logout/unlink with confirmation.
- [ ] Design a small durable chat/message index if the selected transport needs it. Retain only bounded, useful recent history and metadata; do not load the entire WhatsApp archive into RAM.
- [ ] Lazy-load and size-limit media. Bound decoded images, attachments, thumbnails, message arrays and concurrent downloads; evict unused cache entries.
- [ ] Persist cryptographic session keys correctly and atomically. Avoid frequent unnecessary disk writes while ensuring message decryption remains reliable after power loss.
- [ ] Keep optional Whisper dictation **on demand only**; no idle speech-recognition process or model loaded into RAM.

**Acceptance:** All features listed as **required** in the Phase 1 compatibility matrix work on the Deck. Deviations require approval, not silent omission.

## 7. Phase 4 — Optimize specifically for gaming (P0 release gate)

- [ ] Use event-driven messaging, not aggressive status or chat polling. Rate-limit unnecessary UI refreshes and expensive reads without suppressing legitimate notifications.
- [ ] Minimize GC pressure, serialization and image/base64 copies; move heavy computation off the UI thread.
- [ ] Avoid persistent Chromium, offscreen browser windows, heavyweight databases and redundant network services.
- [ ] Apply bounded caches, queues, reconnect timers and worker tasks. Record idle process-tree memory, CPU wakeups, CPU bursts, storage writes and cache size.
- [ ] Ensure cryptography, media decoding and history synchronization cannot monopolize CPU during gameplay; throttle/queue nonurgent sync work where safe.
- [ ] Test at low TDP, low battery, poor Wi-Fi, large group/history, repeated media downloads, sleep/resume and at least a 2-hour gameplay soak.
- [ ] Compare A/B/A: **no plugin engine → standalone enabled → engine disabled**, repeat trials, document variance.
- [ ] Measure peak memory and memory growth, average/1% low FPS, frame-time spikes, battery draw, launch latency and idle network activity. Verify that optional Whisper is unloaded outside transcription.
- [ ] Stop release if targets materially fail; produce a performance diagnosis and seek approval for trade-offs.

**Hard acceptance:** No persistent stutter, resource leak or meaningful gameplay regression attributable to DeckyWhatsapp. Numerical targets from Phase 0 are met or an explicit exception is approved based on measured evidence.

## 8. Phase 5 — Installation, security, migration and rollback (P1)

- [ ] Build a **single standalone Decky plugin release ZIP** containing the frontend, backend, engine and required compatible runtime/dependencies. No Windows/Linux companion download.
- [ ] Provide an install/start/pair/disable/uninstall flow that works from SteamOS without changing the read-only root filesystem.
- [ ] Explicitly show disk footprint and any one-time setup requirements; no downloading a browser during install or first launch.
- [ ] Do not include authentication folders, live credentials, test accounts, saved messages or machine-specific keys in builds/logs/releases.
- [ ] Support fresh installation, plugin upgrade and rollback without accidentally deleting account credentials or chat indexes.
- [ ] Test session re-linking: a new protocol library may require a **new WhatsApp linked-device pairing**; never promise import from `.wwebjs_auth`.
- [ ] Keep existing legacy PC bridge in its own working release path until user signs off. Make selecting native versus legacy mode explicit during development; do not permit both to control the same Deck port simultaneously.
- [ ] Provide privacy-focused diagnostics (connection state, process health, cache sizes and benchmark output) without exposing tokens, QR secrets or message contents.
- [ ] Document unofficial-client risks and provide a clear unlink/remove-local-data workflow with confirmation.

**Acceptance:** Fresh installation, upgrade, disable, uninstall and rollback are understandable and do not require a PC or SSH tunnel for the standalone edition.

## 9. Phase 6 — Verification, release and handoff (P0)

**Automated:**

- [ ] Contract tests for adapter/API events and message types.
- [ ] Tests for authentication persistence, duplicate starts, explicit stop, crashes and bounded restart behavior.
- [ ] Tests for notifications, reconnects, media/cache bounds, message delivery states and storage corruption recovery.
- [ ] Linux x86_64 package/build checks and archive inspection for accidental credentials or Chromium artifacts.
- [ ] Existing project test suites, type checking and Decky frontend build remain green.

**Manual on a real Deck (cannot be claimed passed by CI alone):**

- [ ] Pair a WhatsApp account and reconnect after a deliberate application restart.
- [ ] Read/send messages and media, react, reply and check notifications in Gaming Mode.
- [ ] Confirm the plugin works when the PC is powered off and no SSH tunnel exists.
- [ ] Compare gaming frame-time/power results to the no-engine baseline.
- [ ] Verify suspend/resume, airplane mode, Wi-Fi dropouts, low TDP and long gaming sessions.
- [ ] Verify controller focus, audio playback, optional on-demand voice typing and proper process cleanup after Disable.
- [ ] Verify upgrade, rollback and SteamOS/Decky restart behavior, including the deliberate-enable policy.

**Release gate:** Do not publish the standalone edition as the default unless essential parity, performance targets, security review and real-Deck manual tests are satisfied. Publish known limitations with benchmark methods and results.

## 10. Execution workflow for Codex

**Do not begin work while this document is DRAFT.** After approval:

1. Use the existing orchestrator → implementer → independent reviewer workflow. The planner is optional for ambiguous work and must not re-plan already approved phases.
2. Execute **Phase 0, then the Phase 1 feasibility spike**, and stop for an explicit **GO/REVISE/NO-GO** decision before Phase 2.
3. Delegate small, bounded tasks. Preserve the existing Windows/Linux companion architecture until the standalone edition is proven.
4. Require a reviewer pass after each implementation scope. Limit remediation to two rounds before reporting unresolved findings to the user.
5. The orchestrator alone updates this `PLAN.md`, marking `[x]` only after verified implementation and recording tests, performance numbers, blockers, remaining manual Deck checks and approval gates.
6. Distinguish **code review PASS** from **runtime/gameplay acceptance PENDING**; never invent manual Steam Deck measurements.
7. Stop at every phase boundary for user review. Do not advance into a risky architecture decision without approval.
8. Never commit or disclose account credentials, cryptographic auth state, QR secrets or private message content.

## 11. Decisions for user review

1. **Performance budget:** Are the provisional CPU/PSS/frame-time/battery targets reasonable, or should they be made stricter after Phase 0?
2. **Protocol:** Approve evaluating Baileys first, knowing that it is unofficial and can break when WhatsApp changes?
3. **Feature parity:** Which current capabilities must be preserved for the first standalone release versus explicitly deferred?
4. **Enable/disable:** Should a saved Enable preference restore a session after a Decky reload within the same boot, or must the user always press Enable again? In either case, do not auto-start at OS login/boot.
5. **Release strategy:** Keep the companion-based edition fully supported during the standalone beta, then decide later whether to consolidate?

## 12. Definition of success

DeckyWhatsapp is standalone when a user can install it on a Steam Deck, pair WhatsApp, receive notifications and reply during gameplay **with no other computer, local SSH tunnel, or third-party relay required**. It must use the Deck's ordinary internet connection, remain unobtrusive in Gaming Mode, consume negligible resources while idle, recover after routine connectivity interruptions, and release those resources fully when disabled.

**Success is not merely that WhatsApp runs on the Deck. Success is that gaming still feels the same while it runs.**
