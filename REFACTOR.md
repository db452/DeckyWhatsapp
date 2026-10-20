# DeckyWhatsapp — Codebase Simplification & Refactoring Plan

**Objective:** Make DeckyWhatsapp substantially easier to understand, maintain, extend, and debug before beginning the next development macrophase.

**Scope:** Refactoring, restructuring, deduplication, documentation consolidation, removal of unused code, and evidence-based performance improvements.

**Primary rule:** Preserve existing functionality. This is not a feature-development phase.

## 0. Orchestration and safety

Follow the existing local `AGENTS.md` instructions and `.codex/agents/` configuration.

Use the established orchestrator → implementer → independent reviewer workflow. The orchestrator alone maintains checklist and task status. Allow no more than three independent review passes per task.

Do not automatically begin the next development macrophase upon completing this work.

### Non-negotiable safeguards

- Treat the local working copy as authoritative. GitHub does not contain all project files, and its state may differ from local development.
- Inspect tracked, untracked, and ignored project files before proposing deletions. Do not reveal credentials or private session contents in reports.
- Preserve `AGENTS.md`, `.codex/`, local agent configurations, `.env` files, WhatsApp authentication/session data, SSH keys, tokens, VM-related configuration, release archives, and other ignored local assets.
- Do not use destructive blanket cleanup commands such as `git clean -fdx`.
- Never assume a script is unused merely because it is not referenced by another tracked source file. Check launch instructions, generated shortcuts, release packaging, developer workflows, tests, and local configurations.
- Preserve the Windows and Linux companion architecture, SSH reverse tunneling, existing Decky plugin behavior, and production/MOCK separation.
- Do not introduce automatic startup at OS login or boot.
- Do not alter the Steam Deck, run live WhatsApp authentication, modify VM snapshots, publish releases, or push commits without authorization.
- Avoid adding dependencies or new architectural frameworks unless clearly justified and approved.
- Keep code readable. Fewer lines do not automatically mean better code.

## Phase 1 — Full repository audit

**Status: COMPLETE — baseline metrics and retained findings are summarized in Phase 10; temporary audit removed at closeout. The user approved Phase 2 structural work on 2026-10-18.**

Perform this phase before changing production code.

### Tasks

1. Inventory the complete local project, including relevant ignored files. Distinguish source code, test code, documentation, generated artifacts, release packaging, configuration, and local runtime data.
2. Make this inventory reusable throughout the refactoring. Store relevant working notes temporarily and transfer retained findings into the final assessment before deleting them at closeout.
3. Identify the purpose, entry points, imports, exports, and consumers of every significant script and module.
4. Measure tracked source file counts, lines of code, documentation size, large modules, and root-directory clutter.
5. Identify potential dead code, obsolete scripts, duplicate implementations, redundant utilities, and overlapping documentation.
6. Map dependencies between the PC bridge, Windows/Linux installers, tunnel supervisors, Decky frontend, MOCK implementation, and tests.
7. Identify dynamically referenced files and generated shortcuts that static import analysis would miss.
8. Identify complex functions, repeated state, excessive coupling, unnecessary allocations, redundant network calls, and other potential maintainability problems.
9. Run the existing applicable tests, typechecks, and builds to establish an actual baseline. Record failures and skips rather than assuming they pass.
10. Review `.gitignore` to ensure sensitive and generated local data remain excluded without hiding source files that genuinely belong in version control.

### Deliverables

Produce a concise refactoring audit containing:

- Current functional architecture and directory map.
- Largest and most difficult-to-maintain files.
- Duplicate code and unused-code candidates, with evidence.
- Files that must be preserved for compatibility.
- Proposed new directory structure.
- Risk assessment, prioritized by impact and likelihood of regressions.
- Baseline test/build results.
- A before/after measurement framework.

**Approval gate:** Present the audit and proposed target structure before making major moves, deletions, or architectural changes.

## Phase 2 — Define a clean, intuitive project structure

**Status: COMPLETE — grouped Decky plugin modules by responsibility, updated internal and test/build references, and preserved public root paths and separate production/MOCK identities. Independent review: PASS. Both typechecks, the 49 focused layout/cross-component tests, and 13 provider/MOCK-artifact tests passed. The fresh MOCK build was later completed in Phase 9; follow-up physical Deck checks are recorded below from the user's report.**

Reorganize by responsibility, not merely by file extension.

The following tree is an illustrative target, not a mandatory specification:

```text
DeckyWhatsapp/
├── README.md
├── PLAN.md
├── package.json
├── package-lock.json
├── install-decky-whatsapp-windows.ps1
├── install-decky-whatsapp-linux.sh
├── start-decky-whatsapp.bat
├── start-decky-whatsapp-linux.sh
│
├── src/
│   ├── server.ts
│   ├── bridge/
│   └── whatsapp/
│
├── decky-plugin/
│   ├── src/
│   │   ├── index.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── state/
│   │   └── utils/
│   └── ...
│
├── scripts/
│   ├── install/
│   ├── launch/
│   ├── release/
│   └── lib/
│
├── tests/
│
├── docs/
│   ├── architecture.md
│   ├── development.md
│   ├── windows.md
│   ├── linux.md
│   └── archive/
│
└── patches/
```

Keep only directories that genuinely earn their existence. Do not create empty folders or unnecessary one-function modules simply to match the diagram.

### Structural principles

- Keep the root minimal and immediately understandable.
- Preserve public installer and launcher filenames, potentially as thin compatibility entry points, if moving their implementations provides a real benefit.
- Keep platform-specific code clearly separated.
- Keep application entry points small.
- Place reusable logic close to its consumers.
- Prefer focused modules with clear responsibilities.
- Avoid circular imports and excessive abstraction layers.
- Avoid excessively deep nesting.
- Ensure every directory name makes its purpose obvious.
- Preserve any paths required by Decky Loader, installers, launchers, releases, tests, or existing deployments.

## Phase 3 — Remove dead code and consolidate duplication

**Status: COMPLETE — strict unused-symbol checks found one unused `BridgeEvent` type import and one intentionally unused MOCK transport-error callback; both were cleaned up. The repository audit found no demonstrably unreachable module, script, or configuration entry. Apparent duplication between production/MOCK providers and Windows/Linux tools protects required isolation or platform behavior; the small query-limit expressions have distinct bounds/fallbacks, while media classification remains in the later bridge refactor. Independent review: PASS for the cleanup; both typechecks with strict unused checks and the 13 provider tests passed. No live account or Steam Deck was used.**

### Tasks

1. Identify unused functions, types, imports, variables, constants, scripts, and configuration entries.
2. Confirm whether each candidate is referenced by dynamic execution, installer logic, shell scripts, build tooling, tests, or external entry points.
3. Remove demonstrably obsolete or unreachable code after the corresponding evidence has been documented.
4. Consolidate repeated validation, parsing, error handling, and data-conversion logic where this removes meaningful duplication.
5. Merge near-identical scripts when they genuinely share behavior, without obscuring important platform-specific differences.
6. Simplify overly complicated conditional branches and repeated calculations.
7. Replace avoidable repeated state with derived values when it improves correctness and readability.
8. Remove old workarounds only when the original compatibility requirement has clearly disappeared.
9. Avoid rewriting stable code merely because it has a different style.

### Acceptance criteria

Every deletion has a defensible reason. Existing interfaces and entry points continue functioning, and relevant tests still pass.

## Phase 4 — Simplify the Decky frontend

**Status: IMPLEMENTATION COMPLETE — diagnostics, settings, contact browsing, conversation rendering, message actions, reply controls, and media presentation are components; voice input, conversation history, connection health/events/polling, and message action workflows are focused hooks. Combined independent review: PASS. The final reaction stale-result guard was checked by the orchestrator after the reviewer agent hit its usage limit. Plugin typecheck/build: PASS. The fresh MOCK build later passed in Phase 9, and physical Deck UI/runtime checks were subsequently reported complete by the user; see the follow-up manual-check status below.**

**Primary candidate:** `decky-plugin/src/index.tsx`

This file currently handles substantial UI state and operational behavior. Refactor it into cohesive responsibilities while preserving Decky Loader integration.

### Tasks

1. Keep `index.tsx` primarily responsible for plugin registration, lifecycle, and top-level composition.
2. Extract substantial presentation areas, where useful, such as contact browsing, conversation display, reply controls, settings, diagnostics, and voice input.
3. Extract reusable stateful behavior into focused hooks or controllers, especially around connection health, message history, selected conversation state, and reply workflows.
4. Centralize genuinely shared types and constants while avoiding overly broad global utility modules.
5. Review event subscriptions, intervals, timeouts, and React effects for duplicated work, stale closures, and missed cleanup.
6. Simplify complicated conditional rendering without changing keyboard or controller interactions.
7. Preserve MOCK-specific controls and behavior without allowing MOCK code to interfere with production sessions.
8. Preserve Steam Deck focus restoration, controller navigation, notifications, message ordering, scroll behavior, and Steam keyboard interactions.
9. Avoid introducing extra rerenders, polling, subscriptions, or background processing.

Do not force unrelated state into one global state object merely to reduce the number of React hooks.

### Acceptance criteria

The frontend's major responsibilities can be located independently. `index.tsx` becomes substantially easier to read, and all existing behavior remains intact.

## Phase 5 — Simplify the PC bridge

**Status: IMPLEMENTATION COMPLETE — extracted message normalization and media payload validation into `src/whatsapp/runtime.ts` and `src/whatsapp/media.ts`, preserving the WhatsApp client lifecycle and `server.ts` boundaries. Added both modules to the Windows/Linux companion package allowlists and bounded the profile-picture cache to 50 entries and 32 MiB estimated storage. Independent review: PASS after one remediation (2 passes total). Typecheck and scoped diff check: PASS. Follow-up VM install/startup/shutdown and process-cleanup checks, plus Deck Start/Stop/reconnect checks, were reported passed by the user. RESULTS.md does not separately identify a browser-child-process-specific check.**

**Primary candidates:** `src/whatsapp.ts` and `src/server.ts`

### Tasks

1. Review whether WhatsApp client lifecycle, reconnect scheduling, message normalization, media handling, cache management, and event publishing can be separated into clearer modules.
2. Preserve the existing WhatsApp client implementation and compatibility patch.
3. Keep HTTP/WebSocket authentication, routing, and bridge lifecycle boundaries explicit.
4. Centralize duplicate input validation and error formatting only where it improves clarity.
5. Review message caches for bounded memory use, unnecessary copying, duplicate downloads, and safe eviction behavior.
6. Preserve message ordering, deduplication, acknowledgements, reactions, edits, deletes, quoted replies, view-once handling, and media privacy.
7. Preserve graceful shutdown, reconnection guarantees, event ordering, and browser process cleanup.
8. Avoid changing the public bridge protocol or JSON structures unless absolutely necessary.
9. Keep `server.ts` small where practical, but do not fragment already coherent logic.

### Acceptance criteria

The bridge has clearer internal responsibilities without changing the behavior expected by the Decky plugin or launchers.

## Phase 6 — Consolidate installers, launchers, and tunnel management

**Status: IMPLEMENTATION COMPLETE — shared Linux Deck-address read/write handling now lives in `scripts/linux-deck-host-config.sh`; the tunnel supervisor’s embedded Node log capture, bridge identity/shutdown, port checks, and HTTP owner probe live in `scripts/linux-bridge-helper.mjs`. Both helpers are included in Linux companion packaging, and the existing log-reader test now targets the extracted helper. Public root entry points and Windows-specific scripts remain intact. Independent review: PASS after remediation (2 passes total). Bash syntax, Node syntax, Python AST, and scoped diff/whitespace checks: PASS. Windows and Ubuntu VM install/reinstall checks were later completed; user-reported results are summarized below.**

**Primary candidates:** Windows and Linux installer scripts, management scripts, and SSH tunnel supervisors.

### Tasks

1. Map the responsibilities of each script and determine which scripts are public entry points.
2. Identify repeated dependency checks, path resolution, environment validation, process-management logic, SSH settings, and user-facing messages.
3. Consolidate shared behavior within each platform where appropriate.
4. Review inline embedded scripts, especially substantial Node.js logic inside shell scripts, and extract them when doing so improves testing and readability.
5. Preserve Bash/PowerShell-specific behavior where a shared implementation would be harder to maintain.
6. Separate installer concerns from launcher and runtime-management concerns.
7. Ensure existing shortcuts and launcher commands continue working.
8. Verify packaging includes every required internal helper after any file moves.
9. Ensure execution works from directories containing spaces, paths with special characters, and supported OS configurations.
10. Preserve explicit startup, SSH ownership checks, single-active-bridge protection, bounded reconnect attempts, and safe process termination.
11. Preserve existing credentials and configurations during reinstallations.

### Acceptance criteria

A developer can clearly distinguish installation, startup, tunnel supervision, background management, and release packaging.

Windows and Linux installers continue working in their designated VMs, with user approval for VM testing and no automatic snapshot operations.

## Phase 7 — Rewrite and consolidate documentation

**Status: COMPLETE — condensed the README into the primary user entry point; added concise Windows, architecture, and developer guides; retained the Linux guide and linked documentation in both companion package allowlists. Restored optional Deck-local Whisper setup and Windows stale-tunnel SSH keepalive guidance. Physical Deck runtime checks were later reported complete by the user; optional Whisper testing remains outside this refactoring closeout. Independent review: PASS after one focused remediation (2 passes total). Relative links and scoped whitespace checks: PASS. Tests, builds, and package archives were not run in this documentation phase; history files and license/security/notices were preserved.**

The goal is a small set of concise, useful documents rather than lengthy overlapping explanations.

### README.md

Make the README the primary user-facing entry point, containing:

- What DeckyWhatsapp does.
- Supported platforms and requirements.
- Basic installation and startup.
- Links to Windows/Linux instructions.
- Brief architecture overview.
- Relevant troubleshooting and development links.

### Other documentation

1. Consolidate duplicated installation and troubleshooting instructions.
2. Maintain one concise architecture guide showing the main components and their interactions.
3. Maintain a short developer guide covering builds, tests, packaging, and contribution conventions.
4. Preserve essential test evidence and historical decisions, including material from `RESULTS.md` and `tests/Tests.md`.
5. Remove obsolete documentation only after verifying that nothing still relies on it.
6. Fix links and path references after reorganizing the repository.
7. Preserve all required license, security, and third-party attribution information.
8. Favor concise explanations and examples over repetitive prose.

### Code comments

Remove comments that simply restate obvious operations. Keep concise comments explaining non-obvious decisions, invariants, compatibility workarounds, security constraints, timing behavior, and platform quirks.

Do not remove important explanations solely to decrease line count.

## Phase 8 — Performance and efficiency review

**Status: IMPLEMENTATION COMPLETE — batched Deck contact-avatar state updates in groups of eight or after a 100 ms scheduling delay, with a final flush and teardown cleanup. Independent review: PASS (1 pass). `npm run typecheck:plugin`: PASS. Source-level operation analysis indicates fewer full-list updates for clustered responses. The user later reported Deck responsiveness passed, but no instrumented runtime or CPU/memory profile was recorded; quantitative performance impact remains unmeasured.**

Efficiency improvements must be based on evidence, not speculation.

Investigate:

- Unnecessary network requests and polling.
- Excessive state updates and React rerenders.
- Redundant JSON parsing, conversions, and allocations.
- Duplicate media retrieval or expensive downloads.
- Unbounded or oversized caches.
- Timers, event listeners, sockets, and subprocesses left alive unnecessarily.
- Excessive logging and repeated work.
- Startup and shutdown overhead.
- Unnecessary dependencies and bundle weight.

### Special requirement: Steam Deck performance

The plugin must remain lightweight while games are running. Avoid additional background work, persistent polling, or larger frontend bundles without clear justification.

Measure relevant before/after performance characteristics wherever practical.

Do not introduce memoization, shared mutable variables, complex abstractions, or aggressive optimizations merely to make code shorter.

Treat behavior-changing performance work separately from mechanical refactoring and obtain approval where appropriate.

### Phase 8 audit notes

- Before batching, each successful avatar response mapped the full chat list and called `setChats`. With `N` chats and `P` successful profile pictures, that produced up to `P` full-list maps (`P × N` row checks). In a clustered-response model with `N = P = 200`, groups of eight produce 25 maps / 5,000 row checks instead of 200 maps / 40,000 checks. This is an operation-count model, not a runtime benchmark; sparse responses can still flush one at a time, and CEF scheduling can delay the 100 ms timer.
- The panel checks bridge health every 60 seconds; each active socket checks for suspend every 30 seconds. Both clean up on teardown. The PC profile cache is capped at 50 entries / 32 MiB and the media cache at 50 entries / 64 MiB. Recent live messages and notification IDs are also capped.
- Retained measurement debt: frontend profile URLs and bridge contact-name/reaction caches have no explicit bound; open-conversation live history can grow; concurrent profile requests can duplicate work across effect restarts; the Windows tunnel supervisor starts `netstat.exe` every 500 ms while monitoring the bridge. No runtime workload or physical Deck profile was used, so these were left unchanged pending measurement. Profile request coalescing is not implemented; media-download coalescing is.

## Phase 9 — Regression testing and independent review

**Status: PASS — automated and dedicated VM validation completed. Physical Deck checks were subsequently reported complete by the user; quantitative performance profiling remains unmeasured.**

### Phase 9 validation record

- `npm test` passed **126/126** tests on the Windows host. `NODE_OPTIONS` loaded `scripts/mock-test-node-preload.mjs` to work around the host's `uv_os_get_passwd` `ENOMEM` error.
- The full tunnel suite passed **25/25** tests in the Windows 11 test VM (Node 24.20.0). Root and VM cases use local mock bridges, fake SSH processes, and fabricated data.
- `npm run typecheck` and `npm run typecheck:plugin` passed. Production and MOCK plugin builds were run in isolated temporary workspaces; the MOCK suite passed **13/13** tests and its bundle/source map were checked for production transport and endpoint leakage.
- `node --test scripts/deploy-process.test.mjs` passed **3/3**; `python -m unittest discover -s tests` in `decky-plugin` passed **1/1**. The launcher validation shell test passed. The Linux launcher config shell test passed with two Windows Git Bash skips (symlink emulation and missing `script(1)`).
- Sanitized Linux and Windows companion archives were created from the packaging allowlists and inspected; they contained no `.env` beyond `.env.example`, session data, or authentication material.
- The packaged Linux installer passed install and reinstall in Ubuntu 26.04.1 x86_64 using checksum-verified Node 24.22.0. Locked dependencies installed, and Puppeteer Chrome plus shared-library checks passed. The Deck address was the reserved test address `192.0.2.1`; SSH timed out without authentication. No apt packages were installed.
- The packaged Windows installer passed install and reinstall in Windows 11 build 26300 using checksum-verified Node 24.22.0 and Git 2.55.0.5 from winget. Dependencies installed, Puppeteer's browser was present, and the second run preserved the generated test key. The key stayed in the isolated temp profile and was removed after testing; `-InstallDeckKey` was not used and shortcuts were disabled.
- Independent review passed for both scoped Phase 9 changes: MOCK provider resolution and tunnel-test prompt synchronization (one review pass each).
- Windows `npm install` reported **9 high severity dependency advisories** and warned that the `esbuild` postinstall script was not covered by npm 11's `allowScripts` list. No dependency updates or audit fixes were applied during this refactor.
- Codex did not access live WhatsApp credentials, mutate an account, change snapshots, or perform the physical Deck checks. The user later reported passing production-session and MOCK Deck checks; details and limits are recorded in the follow-up manual-check status below.

Run targeted checks after each coherent change, not just at the end.

### Automated verification

- Root Node.js test suite.
- Root TypeScript typecheck.
- Decky plugin typecheck and production build.
- MOCK tests and MOCK build.
- Installer and launcher tests.
- Cross-platform process startup/shutdown tests.
- File-path and release packaging checks.
- Dependency, license, and secret-exposure checks as applicable.

Use the actual test commands and baseline established during the Phase 1 audit rather than assuming a historical test count.

### Platform validation

Verify Windows and Ubuntu installation/reinstallation where changes affect installers or launchers.

Use the existing VM permissions and approval process. Do not create, restore, or delete snapshots.

### Manual verification

Explicitly identify any checks that still require physical Steam Deck testing, WhatsApp authentication, or the user's interaction.

Never mark manual tests passed based only on automated tests.

### Review

For each implementation task, the independent reviewer must check:

- Behavior preservation.
- Readability and simplicity.
- Correct handling of moved or deleted code.
- Dependency and import integrity.
- Security and privacy regressions.
- Resource usage and cleanup.
- Cross-platform compatibility.
- Test coverage and test results.

Allow at most three review passes per task; unresolved issues are reported rather than hidden or automatically waived.

## Phase 10 — Final maintainability assessment

**Status: PASS — maintainability assessment recorded, temporary audit removed, and independently reviewed (1 pass). No subsequent development macrophase was started.**

Produce a before/after report including:

| Metric | Before (Phase 1 working copy) | After (working tree) |
|---|---|---|
| Source/tool files and lines | 71 / 11,993 | 92 / 13,341 |
| Implementation/tool files and lines | 50 / 7,679 | 69 / 8,704 |
| Test files and lines | 21 / 4,314 | 23 / 4,637 |
| Largest frontend entry | `decky-plugin/src/index.tsx`: 1,626 lines | 778 lines |
| Largest bridge entry | `src/whatsapp.ts`: 825 lines | 736 lines; media/runtime responsibilities extracted |
| Root tracked files | 19 | 19; public root entry points retained |
| Product Markdown | 10 / 2,629 lines | 13 / 2,623 lines |
| Direct dependencies (root; plugin) | 6 runtime + 9 dev; 4 runtime + 7 dev | Unchanged |
| Root tests | Blocked at bootstrap: 16 files failed to load, 0 assertions | 126/126 passed with the documented host preload |
| Production plugin output (`index.js` + map) | 1,765,810 bytes | 1,817,232 bytes (+51,422 / 2.9%) |
| Performance evidence | No runtime baseline | Avatar batching operation-count model only; no runtime benchmark |

Counts use the same source extensions and test-path/name rules as Phase 1. The baseline counts tracked files in the Phase 1 working copy, including local edits already present at audit time; the after counts include present working-tree files, including newly created modules and tests not yet tracked by Git. Product Markdown excludes this task record and the local agent instructions. Bundle sizes compare the baseline production build with an isolated Phase 9 production build; they are not a runtime performance measure.

### Final architecture and navigation

```text
src/                         PC bridge entry points and WhatsApp adapter
└── whatsapp/                Message runtime and media validation
decky-plugin/src/
├── index.tsx                Plugin registration and top-level composition
├── components/              Contact, conversation, message, settings, diagnostics UI
├── connection/              Connection state and transport behavior
├── hooks/                   Bridge, history, conversation actions, voice typing
├── messages/                Formatting, history, actions, reactions, status, sync
├── notifications/           Notification identity/session and reaction handling
├── platform/                Steam compatibility capabilities
├── providers/               Build-selected production and isolated MOCK providers
├── types/                   Chat, conversation, and message types
└── utils/                   Avatar helpers
scripts/                     Packaging, deployment, tunnel, and host configuration tools
docs/                        Architecture, development, platform, MOCK, security, notices
```

Root installers, launchers, tunnel supervisors, management entry points, package metadata, and deployment wrapper remain in their established locations for compatibility. The Linux-only shared host-config and bridge-process helpers are under `scripts/` and included by the Linux package allowlist.

### Simplification, movement, and size changes

- `decky-plugin/src/index.tsx` is 848 lines shorter (1,626 → 778). Responsibilities now live in named component, hook, connection, message, notification, platform, provider, type, and utility modules. The new largest focused frontend modules are `useBridgeConnection.ts` (331 lines) and `useConversationHistory.ts` (313 lines); the entry point remains the largest at 778 lines.
- Existing frontend modules and their tests were moved into the corresponding `connection/`, `messages/`, `notifications/`, `platform/`, and `providers/` folders. The former root-level provider, Steam compatibility, history, message action, format, and notification-cache paths were removed after imports/tests were updated. Components and hooks were extracted from the entry point.
- `src/whatsapp.ts` is 89 lines shorter (825 → 736); message runtime normalization and media validation live in `src/whatsapp/runtime.ts` and `src/whatsapp/media.ts`. Event/lifecycle and public bridge boundaries remain intact, and package allowlists include the new files.
- Linux Deck-host configuration and embedded bridge process/probe logic moved from the tunnel script into `scripts/linux-deck-host-config.sh` and `scripts/linux-bridge-helper.mjs`. The Windows and Linux supervisors remain separate because their process and shell behavior differs.
- README was rewritten as the user entry point. Architecture, development, and Windows guides were added; the Linux, MOCK, security, and attribution documents remain. Product Markdown moved from 10 documents / 2,629 lines to 13 / 2,623 lines: three additional focused documents with six fewer total lines.
- Overall source/tooling increased by 21 files and 1,348 lines, including 19 more implementation/tool files (+1,025 lines) and two more test files (+323 lines). These increases reflect focused module boundaries and expanded regression coverage; they are not a code-size reduction.
- The production bundle and source map together increased by 51,422 bytes (2.9%); `index.js` is 150,275 bytes versus 134,193 before. This is recorded as bundle growth; the size comparison does not establish its cause or user-visible runtime cost.

### Duplication, compatibility, and retained debt

- Phase 1 found no provably dead script or module, and Phase 3 confirmed that. The old file paths listed above were reorganized, not dead-code deletions. The production and MOCK providers/manifests remain separate to protect offline isolation and identity. Windows and Linux tunnel/installer code remains platform-specific. No broad deduplication was justified.
- Tracked root-file count remains 19. Existing public installers, launchers, management scripts, tunnel names, plugin manifests/backend identities, package scripts, bridge routes/protocol, and deployment wrapper paths remain in place. No migration step is identified for this refactor; internal module imports and package allowlists were updated.
- Direct dependency counts are unchanged: root 6 runtime / 9 development, plugin 4 runtime / 7 development. Windows installation reported 9 high-severity npm advisories and an npm 11 `allowScripts` warning for the esbuild postinstall; dependency updates were outside this refactor and remain open.
- The Windows tunnel supervisor still invokes `netstat.exe` every 500 ms while monitoring the bridge. Frontend profile URLs, bridge contact-name/reaction caches, and open-conversation history are not explicitly bounded; profile requests may duplicate work after effect restarts. These were retained pending workload evidence. The PC profile and media caches are bounded, and media-download coalescing is implemented.
- The user reported passing physical Deck startup, Gaming Mode UI/controller/focus, Start/Stop/reconnect, suspend/resume, and responsiveness checks; see RESULTS.md's final user verification and Phase 6 physical Deck checks. These are user-reported results, not independently repeated by Codex. Instrumented CPU/memory impact remains unmeasured. Codex did not connect to or mutate a live WhatsApp account. Phase 8's clustered 200-avatar example estimates 25 full-list maps / 5,000 row checks with batching versus 200 / 40,000 before; this is an operation-count model, not a measured runtime result.

### Final verification and manual checks

- Phase 9 automated verification: root `npm test` 126/126; Windows VM tunnel suite 25/25; MOCK suite 13/13; deploy-process tests 3/3; plugin Python test 1/1; root and plugin typechecks passed; launcher checks passed with two documented Windows Git Bash skips. Production/MOCK builds and sanitized companion archives were inspected in isolated locations.
- Ubuntu 26.04.1 x86_64 and Windows 11 build 26300 packaged install/reinstall checks passed as recorded in Phase 9. The Windows VM was verified powered off after testing; the already-running Ubuntu VM was left running.
- Independent reviews passed for the scoped implementation tasks and Phase 9 fixes, with remediation rounds recorded in their phase statuses. Phase 10 received one independent review pass; the reviewer reproduced current metrics and bundle sizes and verified the removed-audit references. It is a documentation/measurement closeout, so tests were not rerun. `git diff --check` passed; Git reported existing LF-to-CRLF working-copy warnings.

#### Follow-up manual-check status — 2026-10-20

- **Physical Deck — PASS per user report (2026-10-18):** production session checks covered OFF-by-default, Start/Stop/reconnect, notifications, return to game, suspend/resume, voice typing/failure handling, session preservation, and responsiveness. Separate MOCK checks covered fabricated conversations, controller navigation, history/focus, media behavior, and reset/reopen/remount isolation. See RESULTS.md for the detailed checklist. Codex did not repeat these checks.
- **Windows/Ubuntu VM manual checks — PASS per user report (2026-10-18):** fresh install/reinstall, startup/shutdown, and process cleanup passed; the packaged installer validation is also recorded in Phase 9.
- **Still unmeasured:** instrumented Deck CPU/memory/runtime profiling. RESULTS.md reports general responsiveness, which is qualitative and does not provide a performance benchmark.
- **Specific evidence gap:** the user report confirms process cleanup, but does not separately name browser-child-process cleanup. No live WhatsApp account testing was performed by Codex; account-side actions remain outside this refactoring verification.

Report increases as well as decreases. A few new focused files may be worthwhile if they eliminate a monolithic module.

Provide:

1. A concise explanation of the final architecture.
2. The new directory tree and each main directory's responsibility.
3. A list of removed, merged, moved, and substantially rewritten files.
4. Measured simplifications and any performance differences.
5. Test results and unresolved manual checks.
6. Known technical debt intentionally retained.
7. Any changes requiring future compatibility or migration work.

### Definition of done

The project must be easier for a human developer to navigate and reason about, without unnecessary abstractions or hidden behavior changes.

All applicable automated verification must pass, with remaining manual tests explicitly identified.

No future development macrophase begins until this refactoring has been reviewed and approved by the user.

## Execution instructions

1. First perform Phase 1 and produce a proposed target structure and prioritized implementation tasks.
2. Stop for approval before destructive cleanup or large file moves.
3. After approval, implement one coherent refactoring task at a time through the existing agent workflow.
4. Run relevant tests and obtain independent review after each task.
5. Update the refactoring checklist without overwriting unrelated existing project progress.
6. Pause at approval boundaries and do not silently advance into the next macrophase.

**Ultimate priority: understandable, reliable, maintainable software—not the smallest possible number of lines.**
