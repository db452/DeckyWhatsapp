// Exercise bridge startup and API behavior with local processes and ports; no real Deck is contacted.
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

test("health exposes a runtime session ID only after bridge authentication", { timeout: 10_000 }, async (t) => {
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
  t.after(() => child.kill());
  let output = "";
  let ready!: () => void;
  const listening = new Promise<void>((resolve) => { ready = resolve; });
  const append = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes("bridge listening")) ready();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  await listening;

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
});

test("request parser errors never expose or log private request text", { timeout: 10_000 }, async (t) => {
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
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = "";
  let ready!: () => void;
  const listening = new Promise<void>((resolve) => { ready = resolve; });
  const append = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes("bridge listening")) ready();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  await listening;

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

test("shutdown requires the expected session ID and refuses a replacement session", { timeout: 10_000 }, async (t) => {
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
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = "";
  let ready!: () => void;
  const listening = new Promise<void>((resolve) => { ready = resolve; });
  const append = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes("bridge listening")) ready();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  await listening;

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

test("authenticated legacy shutdown without a body remains supported", { timeout: 10_000 }, async (t) => {
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
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = "";
  let ready!: () => void;
  const listening = new Promise<void>((resolve) => { ready = resolve; });
  const append = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes("bridge listening")) ready();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  await listening;

  const url = `http://127.0.0.1:${address.port}`;
  const bootstrap = await fetch(`${url}/bootstrap`, { headers: { Origin: "https://steamloopback.host" } });
  const { token } = await bootstrap.json() as { token: string };
  const legacyStop = await fetch(`${url}/shutdown`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  assert.equal(legacyStop.status, 200);
  const [exitCode] = await once(child, "close");
  assert.equal(exitCode, 0);
});

test("a second bridge binding fails without replacing the first active session", { timeout: 10_000 }, async (t) => {
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
  t.after(() => first.kill());
  let firstOutput = "";
  let firstReady!: () => void;
  const firstListening = new Promise<void>((resolve) => { firstReady = resolve; });
  const appendFirst = (chunk: Buffer) => {
    firstOutput += chunk.toString();
    if (firstOutput.includes("bridge listening")) firstReady();
  };
  first.stdout.on("data", appendFirst);
  first.stderr.on("data", appendFirst);
  await firstListening;

  const url = `http://127.0.0.1:${address.port}`;
  const bootstrap = await fetch(`${url}/bootstrap`, { headers: { Origin: "https://steamloopback.host" } });
  const { token } = await bootstrap.json() as { token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const originalHealth = await fetch(`${url}/health`, { headers });
  const originalSession = (await originalHealth.json() as { sessionId: string }).sessionId;

  const second = startBridge();
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
