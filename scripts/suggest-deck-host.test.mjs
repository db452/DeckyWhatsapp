import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  DECK_HOST_CANDIDATES,
  runSuggestionCli,
  suggestDeckHost,
} from "./suggest-deck-host.mjs";

test("suggests the first candidate that resolves and preserves its hostname", async () => {
  const calls = [];
  const suggestion = await suggestDeckHost(async (host) => {
    calls.push(host);
    if (host === "steamdeck.lan") return [{ address: "192.0.2.44", family: 4 }];
    throw new Error("not found");
  });

  assert.equal(suggestion, "steamdeck.lan");
  assert.deepEqual(calls, ["steamdeck.local", "steamdeck.lan"]);
});

test("returns no suggestion when every bounded candidate fails to resolve", async () => {
  const calls = [];
  const suggestion = await suggestDeckHost(async (host) => {
    calls.push(host);
    throw new Error("not found");
  });

  assert.equal(suggestion, null);
  assert.deepEqual(calls, DECK_HOST_CANDIDATES);
});

test("does not accept an empty lookup result as a resolved host", async () => {
  const calls = [];
  const suggestion = await suggestDeckHost(async (host) => {
    calls.push(host);
    return [];
  });

  assert.equal(suggestion, null);
  assert.deepEqual(calls, DECK_HOST_CANDIDATES);
});

test("continues to the next candidate when a lookup never resolves", async () => {
  const calls = [];
  const suggestion = await suggestDeckHost(async (host) => {
    calls.push(host);
    if (host === "steamdeck.lan") return [{ address: "192.0.2.44", family: 4 }];
    return new Promise(() => {});
  }, 5);

  assert.equal(suggestion, "steamdeck.lan");
  assert.deepEqual(calls, DECK_HOST_CANDIDATES.slice(0, 2));
});

test("returns no suggestion after timed-out and failed candidates", async () => {
  const calls = [];
  const suggestion = await suggestDeckHost(async (host) => {
    calls.push(host);
    if (host === "steamdeck.local") return new Promise(() => {});
    throw new Error("not found");
  }, 5);

  assert.equal(suggestion, null);
  assert.deepEqual(calls, DECK_HOST_CANDIDATES);
});

test("CLI exits after timed-out lookup despite a lingering event-loop handle", () => {
  const moduleUrl = new URL("./suggest-deck-host.mjs", import.meta.url).href;
  const source = `
    import { runSuggestionCli } from ${JSON.stringify(moduleUrl)};
    setInterval(() => {}, 60_000);
    await runSuggestionCli({ resolve: () => new Promise(() => {}), timeoutMs: 5 });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 2_000,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
});

test("CLI flushes a resolved hostname before exiting despite a lingering handle", () => {
  const moduleUrl = new URL("./suggest-deck-host.mjs", import.meta.url).href;
  const source = `
    import { runSuggestionCli } from ${JSON.stringify(moduleUrl)};
    setInterval(() => {}, 60_000);
    await runSuggestionCli({ resolve: async () => [{ address: "192.0.2.44", family: 4 }] });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 2_000,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "steamdeck.local\n");
});
