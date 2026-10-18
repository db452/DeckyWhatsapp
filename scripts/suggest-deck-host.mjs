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

export const DECK_HOST_LOOKUP_TIMEOUT_MS = 1500;

export async function suggestDeckHost(
  resolve = lookup,
  timeoutMs = DECK_HOST_LOOKUP_TIMEOUT_MS,
) {
  for (const candidate of DECK_HOST_CANDIDATES) {
    let timeout;
    try {
      const results = await Promise.race([
        resolve(candidate, { all: true }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("DNS lookup timed out")), timeoutMs);
        }),
      ]);
      if (Array.isArray(results) && results.length > 0) return candidate;
    } catch {
      // A missing candidate is expected; try the next bounded name.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
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
