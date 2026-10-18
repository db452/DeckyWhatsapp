// Exercise bridge startup and API behavior with local processes and ports; no real Deck is contacted.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { test } from "node:test";
import { WebSocket } from "ws";

// Windows VM measurements show 3.5–4.5 seconds for PowerShell startup. Keep
// subprocess waits bounded while allowing that documented startup cost.
const CHILD_OUTPUT_TIMEOUT_MS = 10_000;

async function stopOwnedChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close").then(() => true);
  if (process.platform === "win32" && child.pid !== undefined) {
    // This PID was returned by our spawn; taskkill is scoped to that process tree.
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: CHILD_OUTPUT_TIMEOUT_MS
    });
    if (result.error || result.status !== 0) child.kill();
  } else {
    child.kill();
  }
  const stopped = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), CHILD_OUTPUT_TIMEOUT_MS);
    void closed.then(() => { clearTimeout(timer); resolve(true); });
  });
  if (!stopped && child.exitCode === null && child.signalCode === null) child.kill();
}

function waitForOutput(child: ChildProcessWithoutNullStreams, expected: string, getOutput: () => string): Promise<void> {
  if (getOutput().includes(expected)) return Promise.resolve();
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.reject(new Error(`Child exited before expected output (code ${child.exitCode}, signal ${child.signalCode}):\n${getOutput()}`));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for child output: ${expected}\n${getOutput()}`));
    }, CHILD_OUTPUT_TIMEOUT_MS);
    const onData = () => {
      if (!getOutput().includes(expected)) return;
      cleanup();
      resolve();
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`Child exited before expected output (code ${code}, signal ${signal}):\n${getOutput()}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("close", onClose);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("close", onClose);
  });
}

test("an occupied port exits cleanly before starting WhatsApp", { timeout: 20_000 }, async (t) => {
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
  t.after(() => stopOwnedChild(child));
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const [code] = await once(child, "close");
  assert.equal(code, 1);
  assert.match(output, /already in use/);
  assert.doesNotMatch(output, /UNEXPECTED_BROWSER_START|Unhandled/);
});

test("health exposes a runtime session ID only after bridge authentication", { timeout: 20_000 }, async (t) => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import { WhatsAppService } from './src/whatsapp.ts';
    WhatsAppService.prototype.start = async () => {};
    await import('./src/server.ts');
  `], { env: { ...process.env, PORT: String(address.port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => stopOwnedChild(child));
  let output = "";
  const append = (chunk: Buffer) => {
    output += chunk.toString();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  await waitForOutput(child, "bridge listening", () => output);

  const url = `http://127.0.0.1:${address.port}`;
  const bootstrap = await fetch(`${url}/bootstrap`, { headers: { Origin: "https://steamloopback.host" } });
  const { token } = await bootstrap.json() as { token: string };
  const unauthorized = await fetch(`${url}/health`);
  assert.equal(unauthorized.status, 401);
  const response = await fetch(`${url}/health`, { headers: { Authorization: `Bearer ${token}` } });
  const health = await response.json() as { ok: boolean; sessionId: string };
  assert.equal(health.ok, true);
  assert.match(health.sessionId, /^[0-9a-f-]{36}$/i);
  assert.notEqual(health.sessionId, token);

  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/events?token=${token}`);
  t.after(() => socket.terminate());
  await once(socket, "open");
  const [rawStatus] = await once(socket, "message");
  const initialStatus = JSON.parse(rawStatus.toString()) as { type: string; sessionId?: string };
  assert.equal(initialStatus.type, "status");
  assert.equal(initialStatus.sessionId, health.sessionId);
});

test("request parser errors never expose or log private request text", { timeout: 20_000 }, async (t) => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import { WhatsAppService } from './src/whatsapp.ts';
    WhatsAppService.prototype.start = async () => {};
    await import('./src/server.ts');
  `], { env: { ...process.env, PORT: String(address.port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => stopOwnedChild(child));
  let output = "";
  const append = (chunk: Buffer) => {
    output += chunk.toString();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  await waitForOutput(child, "bridge listening", () => output);

  const url = `http://127.0.0.1:${address.port}`;
  const bootstrap = await fetch(`${url}/bootstrap`, { headers: { Origin: "https://steamloopback.host" } });
  const { token } = await bootstrap.json() as { token: string };
  const privateText = "SYNTHETIC_PRIVATE_REQUEST_BODY_7f1cb";
  const headers = { Origin: "https://steamloopback.host", "Content-Type": "application/json" };
  const unauthorized = await fetch(`${url}/messages`, { method: "POST", headers, body: `{"body":"${privateText}"` });
  assert.equal(unauthorized.status, 401);
  assert.doesNotMatch(await unauthorized.text(), new RegExp(privateText));

  const malformed = await fetch(`${url}/messages`, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${token}` },
    body: `{"body":"${privateText}"`
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "Invalid request" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.doesNotMatch(output, new RegExp(privateText));
});

test("shutdown requires the expected session ID and refuses a replacement session", { timeout: 20_000 }, async (t) => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import { WhatsAppService } from './src/whatsapp.ts';
    WhatsAppService.prototype.start = async () => {};
    await import('./src/server.ts');
  `], { env: { ...process.env, PORT: String(address.port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => stopOwnedChild(child));
  let output = "";
  const append = (chunk: Buffer) => {
    output += chunk.toString();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  await waitForOutput(child, "bridge listening", () => output);

  const url = `http://127.0.0.1:${address.port}`;
  const bootstrap = await fetch(`${url}/bootstrap`, { headers: { Origin: "https://steamloopback.host" } });
  const { token } = await bootstrap.json() as { token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const health = await fetch(`${url}/health`, { headers });
  const { sessionId } = await health.json() as { sessionId: string };

  const staleStop = await fetch(`${url}/shutdown`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedSessionId: "replacement-session" })
  });
  assert.equal(staleStop.status, 409);
  assert.equal(child.exitCode, null);
  assert.equal((await fetch(`${url}/health`, { headers })).status, 200);

  const stop = await fetch(`${url}/shutdown`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedSessionId: sessionId })
  });
  assert.equal(stop.status, 200);
  const [exitCode] = await once(child, "close");
  assert.equal(exitCode, 0);
});

test("authenticated legacy shutdown without a body remains supported", { timeout: 20_000 }, async (t) => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import { WhatsAppService } from './src/whatsapp.ts';
    WhatsAppService.prototype.start = async () => {};
    await import('./src/server.ts');
  `], { env: { ...process.env, PORT: String(address.port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => stopOwnedChild(child));
  let output = "";
  const append = (chunk: Buffer) => {
    output += chunk.toString();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  await waitForOutput(child, "bridge listening", () => output);

  const url = `http://127.0.0.1:${address.port}`;
  const bootstrap = await fetch(`${url}/bootstrap`, { headers: { Origin: "https://steamloopback.host" } });
  const { token } = await bootstrap.json() as { token: string };
  const legacyStop = await fetch(`${url}/shutdown`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  assert.equal(legacyStop.status, 200);
  const [exitCode] = await once(child, "close");
  assert.equal(exitCode, 0);
});

test("a second bridge binding fails without replacing the first active session", { timeout: 20_000 }, async (t) => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const source = `
    import { WhatsAppService } from './src/whatsapp.ts';
    WhatsAppService.prototype.start = async () => {};
    await import('./src/server.ts');
  `;
  const startBridge = () => spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
    env: { ...process.env, PORT: String(address.port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const first = startBridge();
  t.after(() => stopOwnedChild(first));
  let firstOutput = "";
  const appendFirst = (chunk: Buffer) => {
    firstOutput += chunk.toString();
  };
  first.stdout.on("data", appendFirst);
  first.stderr.on("data", appendFirst);
  await waitForOutput(first, "bridge listening", () => firstOutput);

  const url = `http://127.0.0.1:${address.port}`;
  const bootstrap = await fetch(`${url}/bootstrap`, { headers: { Origin: "https://steamloopback.host" } });
  const { token } = await bootstrap.json() as { token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const originalHealth = await fetch(`${url}/health`, { headers });
  const originalSession = (await originalHealth.json() as { sessionId: string }).sessionId;

  const second = startBridge();
  t.after(() => stopOwnedChild(second));
  let secondOutput = "";
  second.stdout.on("data", (chunk) => { secondOutput += chunk.toString(); });
  second.stderr.on("data", (chunk) => { secondOutput += chunk.toString(); });
  const [secondExitCode] = await once(second, "close");
  assert.equal(secondExitCode, 1);
  assert.match(secondOutput, /already in use/);

  const survivingHealth = await fetch(`${url}/health`, { headers });
  const survivingSession = (await survivingHealth.json() as { sessionId: string }).sessionId;
  assert.equal(survivingSession, originalSession);
  assert.equal(first.exitCode, null);
});
