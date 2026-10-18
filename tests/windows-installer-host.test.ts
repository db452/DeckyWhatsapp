import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("Windows installer host prompt accepts, replaces, and falls back from a suggestion", async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell prompt helper test");

  let powershell: string;
  try {
    powershell = execFileSync("where.exe", ["pwsh.exe"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  } catch {
    return t.skip("PowerShell 7 is required to run the isolated prompt helper test");
  }
  const helper = join(process.cwd(), "scripts", "deck-host-prompt.ps1");
  const installer = await readFile(join(process.cwd(), "install-decky-whatsapp-windows.ps1"), "utf8");
  assert.match(installer, /scripts\\suggest-deck-host\.mjs/,
    "the key-install path obtains its optional hostname suggestion from the bounded resolver");
  assert.match(installer, /Get-DeckHostPromptResult -SuggestedHost \$suggestedHost/,
    "the installer routes the resolved suggestion through the tested prompt behavior");
  const script = [
    '. "$env:DECK_HOST_PROMPT_HELPER"',
    "$accepted = Get-DeckHostPromptResult -SuggestedHost 'steamdeck.lan' -ReadInput { param($prompt) '' }",
    "if ($accepted -ne 'steamdeck.lan') { throw 'Blank input did not accept the suggestion.' }",
    "$replaced = Get-DeckHostPromptResult -SuggestedHost 'steamdeck.lan' -ReadInput { param($prompt) '192.0.2.55' }",
    "if ($replaced -ne '192.0.2.55') { throw 'Manual replacement was not preserved.' }",
    "$script:manualPrompt = ''",
    "$manual = Get-DeckHostPromptResult -ReadInput { param($prompt) $script:manualPrompt = $prompt; 'deck.example.test' }",
    "if ($manual -ne 'deck.example.test') { throw 'Manual entry was not returned without a suggestion.' }",
    "if ($script:manualPrompt -notmatch 'No known Steam Deck hostname resolved') { throw 'No-result prompt did not ask for manual entry.' }",
  ].join("; ");

  const output = execFileSync(powershell, ["-NoProfile", "-Command", script], {
    env: { ...process.env, DECK_HOST_PROMPT_HELPER: helper },
    encoding: "utf8",
  });
  assert.equal(output.trim(), "");
});
