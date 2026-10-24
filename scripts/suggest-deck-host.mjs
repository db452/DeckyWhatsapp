#!/usr/bin/env node

// Resolve only a small, fixed set of conventional Steam Deck hostnames.
// Keeping the hostname (rather than the resolved IP) lets SSH re-resolve it
// after the Deck moves to another network.
import { lookup } from "node:dns/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DECK_HOST_CANDIDATES = Object.freeze([
  "steamdeck.local",
  "steamdeck.lan",
  "steamdeck",
]);

export const DECK_HOST_LOOKUP_TIMEOUT_MS = 20_000;

export async function suggestDeckHost(
  resolve = lookup,
  timeoutMs = DECK_HOST_LOOKUP_TIMEOUT_MS,
) {
  const resultsByCandidate = Array(DECK_HOST_CANDIDATES.length);
  const lookups = DECK_HOST_CANDIDATES.map(async (candidate, index) => {
    try {
      const results = await resolve(candidate, { all: true });
      resultsByCandidate[index] = Array.isArray(results) && results.length > 0;
    } catch {
      // A missing candidate is expected; check the remaining names too.
      resultsByCandidate[index] = false;
    }
  });

  let timeout;
  await Promise.race([
    Promise.all(lookups),
    new Promise((resolveDeadline) => {
      timeout = setTimeout(resolveDeadline, timeoutMs);
    }),
  ]);
  clearTimeout(timeout);

  // Evaluate in preference order even though every lookup ran concurrently.
  const resolvedIndex = resultsByCandidate.findIndex((resolved) => resolved === true);
  return resolvedIndex === -1 ? null : DECK_HOST_CANDIDATES[resolvedIndex];
}

export async function runSuggestionCli({
  resolve = lookup,
  timeoutMs = DECK_HOST_LOOKUP_TIMEOUT_MS,
  stdout = process.stdout,
  exit = (code) => process.exit(code),
} = {}) {
  const suggestion = await suggestDeckHost(resolve, timeoutMs);
  if (suggestion) {
    // Flush the hostname before exiting; outstanding DNS requests cannot be cancelled.
    stdout.write(`${suggestion}\n`, () => exit(0));
    return;
  }
  // A timed-out dns.lookup can leave a libuv request keeping the CLI alive.
  exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runSuggestionCli();
}
