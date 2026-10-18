# Automated test guide

This guide describes each test file included by the root `npm test` script in `package.json`. The script currently includes **112 tests across 15 files**. Tests may be skipped on platforms they do not target, especially the Windows PowerShell tests.

Run the full root suite with:

```sh
npm test
```

The tests use mocked WhatsApp clients, local sockets, temporary files, and child processes. They do not sign in to a WhatsApp account or contact a physical Steam Deck.

## `scripts/suggest-deck-host.test.mjs` — 3 tests

- **“suggests the first candidate that resolves and preserves its hostname”** — Tries the supported Deck hostname candidates in order and returns the first one that resolves, without replacing the hostname with its IP address.
- **“returns no suggestion when every bounded candidate fails to resolve”** — Confirms discovery stops after the finite candidate list and returns no suggestion when none resolve.
- **“does not accept an empty lookup result as a resolved host”** — Ensures a lookup that returns no addresses is treated as a failed resolution.

## `src/whatsapp.test.ts` — 22 tests

- **“Chromium sandbox overrides are limited to Linux”** — Checks that the no-sandbox flags are supplied on Linux and omitted on Windows.
- **“background QR pairing keeps the plugin QR event but suppresses terminal credentials”** — Ensures background pairing still sends the QR event to the plugin but does not print pairing credentials in the terminal.
- **“delete passes a WhatsApp message ID that only has $1”** — Protects deletion for WhatsApp message IDs represented by the library's `$1` field.
- **“a failed WhatsApp reconnect schedules another attempt”** — Checks that a failed reconnect returns to a disconnected state and schedules a later retry.
- **“delete for everyone refuses a message WhatsApp can only delete locally”** — Prevents reporting or attempting a global deletion when WhatsApp only permits local deletion.
- **“delete for everyone proceeds when WhatsApp permits revocation”** — Confirms the service requests deletion for everyone when the WhatsApp page allows it.
- **“concurrent history reads share one media download and reuse it”** — Ensures simultaneous requests for the same media share a download and later requests use the cached result.
- **“deleted media cannot be restored by an in-flight download”** — Prevents a download finishing late from repopulating media that was already forgotten.
- **“unavailable media can be retried, and the successful cache is bounded”** — Checks failed downloads can be retried and the media cache evicts entries at its size limit.
- **“view-once history is marked and never attempts a media download”** — Confirms view-once history is identified and its content is not downloaded.
- **“live view-once events preserve captions and carry the capability flag”** — Keeps a live view-once message's caption and view-once marker while omitting media data.
- **“view-once runtime flags are recognized on the message and raw data”** — Covers the supported locations where the WhatsApp library may expose view-once flags.
- **“initial startup failure leaves a retryable disconnected state”** — Confirms a failed first startup is reported as disconnected and leaves a reconnect retry scheduled.
- **“a disconnect during initialization still schedules the next reconnect”** — Protects retry scheduling when a disconnect happens as initialization is underway.
- **“stop during reconnect cleanup cannot start a new browser”** — Ensures stopping during reconnect cleanup prevents a late browser initialization.
- **“history bounds concurrent work, preserves captions/order and sends image data once”** — Limits concurrent history media work while preserving message order and captions and returning image data in the expected field.
- **“history sorts unordered WhatsApp results chronologically before selecting the latest window”** — Sorts unordered history before selecting the newest requested messages.
- **“history preserves fetched order for sent and received messages in the same second”** — Avoids reordering a sent message and its reply when timestamps have only one-second precision.
- **“recent chats are sorted newest first with deterministic ties”** — Shows the newest chats first and uses stable ordering for equal timestamps and chats without a message.
- **“fresh reaction lookup clears a reaction removed on another device”** — Prevents a cached reaction from reappearing after it was removed elsewhere.
- **“media download failures do not log exception messages, URLs, or tokens”** — Protects logs from sensitive exception text, media URLs, and token values.
- **“chat service failures retain fallback behavior without logging exception content”** — Preserves the empty-chat fallback after an error while keeping the error's potentially sensitive contents out of logs.

## `tests/connection.test.ts` — 7 tests

- **“a stale contact snapshot is rejected after a newer live event”** — Ensures an older contact-list response cannot overwrite newer event data.
- **“a ready-state refresh queues behind a failing initial contacts request”** — Checks that the ready event triggers another contact load even if the initial request fails.
- **“a failed bootstrap retries without reopening the plugin”** — Verifies connection setup retries after bootstrap failure without requiring the user to reopen the plugin.
- **“stopping during bootstrap prevents a late socket from opening”** — Ensures a connection stopped during bootstrap does not create a socket when bootstrap later completes.
- **“stopping an open socket ignores late events and closes it”** — Confirms shutdown closes the socket and ignores messages delivered afterward.
- **“a closed event socket retries and can reconnect”** — Checks that a closed WebSocket is replaced by a later connection attempt.
- **“fetch timeout aborts a stalled request”** — Ensures a request that exceeds its deadline is aborted.

## `tests/connection-state.test.ts` — 5 tests

- **“connection control is a simple local start or stop toggle”** — Checks the button labels for the enabled and disabled Deck-side connection states.
- **“suspend recovery runs only while the Deck-side connection is enabled”** — Prevents resume recovery from running when the user has stopped the Deck-side connection.
- **“resume stays gated until the current plugin session is explicitly started”** — Confirms a fresh plugin session starts disabled and only enables recovery after an explicit start.
- **“connection headline requires healthy HTTP, WebSocket, and WhatsApp readiness”** — Checks the status headline for healthy, disconnected, reconnecting, starting, authentication-required, and disabled states.
- **“connection warnings clear only when their own connection condition recovers”** — Ensures each warning corresponds to its failing layer and clears after recovery or stop.

## `tests/format.test.ts` — 2 tests

- **“contact timestamps use local time for today and Yesterday for the prior day”** — Checks the short timestamp labels for messages from today and yesterday.
- **“contact timestamps use a short locale date for older messages and omit invalid values”** — Checks older dates and ensures missing, invalid, or zero timestamps do not produce misleading labels.

## `tests/message-status.test.ts` — 1 test

- **“outgoing message acknowledgements map to the expected visible status”** — Maps WhatsApp acknowledgement values to Sending, Sent, Delivered, Read, Failed, and uncertain labels and presentation details.

## `tests/notification-id-cache.test.ts` — 3 tests

- **“notification ID cache detects recently seen IDs and evicts the oldest at its limit”** — Prevents duplicate notifications and checks that the oldest ID is removed when the cache is full.
- **“remembering a duplicate ID does not move it behind newer IDs”** — Ensures seeing the same notification again does not change which ID will be evicted next.
- **“notification ID cache requires a positive integer limit”** — Rejects zero, fractional, or otherwise invalid cache limits.

## `decky-plugin/src/history.test.ts` — 8 tests

- **“history expansion focuses the older neighbor of its previous oldest boundary”** — Checks that loading more history selects the older neighboring message and advances the requested batch size.
- **“history expansion stops when exhausted or at the bridge limit”** — Prevents further expansion when history is exhausted, the bridge limit is reached, or no focus target exists.
- **“a stale history snapshot keeps a sent message already received over the live socket”** — Keeps a newly sent live message when an older history response arrives afterward.
- **“history reconciliation avoids duplicates and ignores live messages from other chats”** — Merges only relevant live messages and avoids inserting a duplicate already in the snapshot.
- **“live ACK and reaction updates survive a stale history snapshot”** — Preserves delivery status and reaction changes received live while older history is loading.
- **“replacing the bridge session clears cached messages and invalidates old history requests”** — Prevents messages or responses from a previous bridge session leaking into the replacement session.
- **“adopting a session after live events preserves them and invalidates unknown-session history”** — Keeps valid live events received before the session status frame while rejecting requests tied to an unknown session.
- **“session refresh loading stays owned by the replacement request”** — Ensures an obsolete request cannot clear the loading indicator for its replacement.

## `decky-plugin/src/view-once.test.ts` — 2 tests

- **“view-once media gets a clear phone fallback without claiming it was viewed”** — Requires the unsupported-media notice to direct the user to their phone without saying the content was viewed.
- **“ordinary messages have no view-once notice”** — Ensures normal messages do not show the view-once fallback.

## `decky-plugin/src/message-actions.test.ts` — 4 tests

- **“Y has no action for images or unsupported media”** — Keeps ordinary images inline and confirms Y has no action for images, video, GIF, absent media, or empty media.
- **“Y keeps audio on the existing play/pause action”** — Preserves the existing audio control when Y is pressed on an audio message.
- **“one Y press routes to exactly one audio action”** — Prevents a single Y press from triggering audio twice.
- **“Y press is suppressed while text entry or reply input is active”** — Keeps the audio shortcut from interfering with typing or the reply field.

## `tests/windows-installer-host.test.ts` — 1 test

- **“Windows installer host prompt accepts, replaces, and falls back from a suggestion”** — On Windows with PowerShell 7, checks accepting a suggested Deck host, replacing it manually, and entering a host when no suggestion resolves. It also checks that the installer uses the tested helper. The test skips when its Windows prerequisites are absent.

## `tests/server.test.ts` — 6 tests

- **“an occupied port exits cleanly before starting WhatsApp”** — Confirms the bridge fails clearly on a busy port before initializing WhatsApp or opening a browser.
- **“health exposes a runtime session ID only after bridge authentication”** — Checks that health and initial WebSocket status expose the same runtime session ID only to an authenticated client, separate from its bearer token.
- **“request parser errors never expose or log private request text”** — Ensures malformed or unauthorized request bodies do not echo private text in responses or logs.
- **“shutdown requires the expected session ID and refuses a replacement session”** — Prevents an old Deck client from stopping a different bridge session, while allowing the current session to shut down.
- **“authenticated legacy shutdown without a body remains supported”** — Protects compatibility with authenticated clients that use the previous shutdown request format.
- **“a second bridge binding fails without replacing the first active session”** — Confirms a bridge started on an occupied port cannot displace the bridge that already owns it.

## `tests/tunnel.test.ts` — 21 tests

- **“Linux SSH log reader drains and captures diagnostics without writing to the terminal”** — Checks the Linux launcher's log reader captures SSH diagnostics while keeping them out of an unexpected terminal output path.
- **“Linux SSH FIFO keepalive remains open until the SSH writer has exited”** — Prevents premature closure of the Linux SSH log pipe while its writer is still active.
- **“the Linux launcher resolves installer-style symlinks before loading project helpers”** — Ensures the Linux launcher finds its project files when invoked through an installer-created symlink.
- **“the Windows launcher refuses a second local bridge without shutting down the active one”** — Protects an already running local bridge when another Windows launcher is started.
- **“the shared launcher port reader honors environment precedence and normalizes decimal values”** — Checks port selection precedence and normalization of valid decimal port values.
- **“confirmed bridge shutdown lets Linux and Windows foreground launchers close their owned tunnels”** — Ensures a launcher closes the SSH tunnel it owns after the bridge confirms shutdown, on both platforms.
- **“optional background controller isolates its child port and protects recorded process ownership”** — Checks that the optional background controller uses an isolated child port and does not act on a process it cannot verify as its own.
- **“Stop recovers an expected session ID for a healthy owned partial startup”** — Checks that Stop can identify and close a bridge it owns if startup completed only partway.
- **“normal supervisor exit on a closed bridge port does not wait for input”** — Ensures the supervisor exits without hanging for keyboard input when its bridge has already stopped.
- **“background supervisor closes its SSH child when the recorded bridge exits even if the port is reused”** — Protects against closing or mistaking a different service that later reuses the bridge port.
- **“SSH forwarding policy failures show the SSH diagnostic without claiming another bridge is active”** — Keeps forwarding-policy errors distinct from evidence that another DeckyWhatsapp bridge is running.
- **“an unidentified forwarding conflict gets one delayed, non-interactive retry while the same bridge owns the port”** — Limits recovery to one bounded retry and confirms it stays tied to the same local bridge process.
- **“the stale-port retry stops when BatchMode cannot authenticate instead of prompting or looping”** — Prevents an automated diagnostic retry from prompting for another password or looping when SSH cannot authenticate non-interactively.
- **“the stale-port retry stops after a transport failure without a third interactive attempt”** — Ensures a transport failure ends bounded retry behavior without starting another interactive SSH attempt.
- **“the stale-port retry stays supervised when SSH connects successfully”** — Checks that a successful retry remains under supervisor control for cleanup.
- **“a confirmed stale-port retry may reconnect normally after a later transport drop”** — Allows the normal reconnect behavior after a stale-port conflict has been resolved and a later connection drops.
- **“stale-port recovery does not retry after the original local bridge process is replaced”** — Prevents a retry from acting on a new process that replaced the original local bridge.
- **“stale-port wait exits promptly when the owned bridge stops”** — Ensures the recovery wait ends promptly when its own local bridge is stopped.
- **“forwarding conflicts identify HTTP owners, bound response reads, and clean up the probe”** — Checks safe classification of a remote service, bounded reads from oversized or streaming responses, and cleanup of diagnostic probe processes.
- **“simultaneous tunnel startups choose one winner and a reconnect cannot displace it”** — Exercises competing tunnel startups and confirms a reconnect cannot take ownership from the existing winner.
- **“two reconnecting supervisors race for an atomic remote-port reservation”** — Checks that reconnecting supervisors cannot both claim the same remote port reservation.

The tunnel suite uses local mock SSH commands and loopback services. Its Windows PowerShell cases are skipped on non-Windows platforms; it does not connect to a real Steam Deck.
