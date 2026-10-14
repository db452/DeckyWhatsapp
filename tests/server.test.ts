import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { test } from "node:test";

test("an occupied port exits cleanly before starting WhatsApp", { timeout: 10_000 }, async (t) => {
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  t.after(() => occupied.close());
  const address = occupied.address();
  assert.ok(address && typeof address !== "string");
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import { WhatsAppService } from './src/whatsapp.ts';
    WhatsAppService.prototype.start = async () => { console.error('UNEXPECTED_BROWSER_START'); };
    await import('./src/server.ts');
  `], { env: { ...process.env, PORT: String(address.port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const [code] = await once(child, "close");
  assert.equal(code, 1);
  assert.match(output, /already in use/);
  assert.doesNotMatch(output, /UNEXPECTED_BROWSER_START|Unhandled/);
});
