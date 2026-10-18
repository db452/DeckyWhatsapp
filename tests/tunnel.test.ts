// Exercise tunnel supervision with local mock SSH processes and sockets; no real Deck is contacted.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createConnection, createServer } from "node:net";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const tunnelScript = join(process.cwd(), "keep-ssh-tunnel.ps1");
const launcherScript = join(process.cwd(), "start-decky-whatsapp.bat");
const backgroundControllerScript = join(process.cwd(), "manage-decky-whatsapp.ps1");
const conflictMessage = "SSH could not establish remote forwarding on port";
// The Windows guest measured 3.5–4.5 seconds to start a trivial PowerShell child.
// Allow one startup budget plus output scheduling time, while keeping waits bounded.
const WINDOWS_PROCESS_STARTUP_BUDGET_MS = 5_000;
const WINDOWS_OUTPUT_WAIT_MS = WINDOWS_PROCESS_STARTUP_BUDGET_MS * 2 + 3_000;
const WINDOWS_NESTED_PROCESS_WAIT_MS = WINDOWS_PROCESS_STARTUP_BUDGET_MS * 3 + 3_000;
const WINDOWS_RECOVERY_STAGE_WAIT_MS = WINDOWS_PROCESS_STARTUP_BUDGET_MS * 4 + 3_000;
// The Windows guest's combined run exceeded 23 seconds here; the isolated test passes in 44.2 seconds overall.
// Allow up to 40 seconds for C to start and claim ownership, within the test's 90-second deadline.
const WINDOWS_SLOW_RECONNECT_STARTUP_WAIT_MS = 40_000;
const DEFAULT_FILE_WAIT_MS = WINDOWS_PROCESS_STARTUP_BUDGET_MS * 2;

function isChildRunning(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function acknowledgeChild(child: ChildProcessWithoutNullStreams): void {
  if (isChildRunning(child) && child.stdin.writable && !child.stdin.destroyed) child.stdin.write("\r\n");
}

async function stopOwnedChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (!isChildRunning(child)) return;
  const closed = once(child, "close").then(() => true);
  if (process.platform === "win32" && child.pid !== undefined) {
    // PID came directly from this test's spawn; /T is limited to its descendants.
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: WINDOWS_PROCESS_STARTUP_BUDGET_MS
    });
    if (result.error || result.status !== 0) child.kill();
  } else {
    child.kill();
  }
  const stopped = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), WINDOWS_PROCESS_STARTUP_BUDGET_MS);
    void closed.then(() => { clearTimeout(timer); resolve(true); });
  });
  if (!stopped && isChildRunning(child)) child.kill();
}

function watchOutput(child: ChildProcessWithoutNullStreams) {
  let output = "";
  const waiters: Array<{ text: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
  const failWaiters = (error: Error) => {
    for (const waiter of [...waiters]) {
      clearTimeout(waiter.timer);
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.reject(error);
    }
  };
  const append = (chunk: Buffer) => {
    output += chunk.toString();
    for (const waiter of [...waiters]) {
      if (!output.includes(waiter.text)) continue;
      clearTimeout(waiter.timer);
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.once("close", (code, signal) => {
    failWaiters(new Error(`Child exited before expected output (code ${code}, signal ${signal}):\n${output}`));
  });
  return {
    get output() { return output; },
    waitFor(text: string, timeoutMs = WINDOWS_OUTPUT_WAIT_MS) {
      if (output.includes(text)) return Promise.resolve();
      if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.reject(new Error(`Child exited before expected output (code ${child.exitCode}, signal ${child.signalCode}):\n${output}`));
      }
      return new Promise<void>((resolve, reject) => {
        const waiter = {
          text,
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            reject(new Error(`Timed out waiting for output: ${text}\n${output}`));
          }, timeoutMs)
        };
        waiters.push(waiter);
      });
    }
  };
}

async function waitForFile(path: string, timeoutMs = DEFAULT_FILE_WAIT_MS, child?: ChildProcessWithoutNullStreams): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { await access(path); return; }
    catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Child exited before creating ${path} (code ${child.exitCode}, signal ${child.signalCode})`);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForFileContent(path: string, expected: string, timeoutMs = DEFAULT_FILE_WAIT_MS, child?: ChildProcessWithoutNullStreams): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await readFile(path, "utf8")).trim() === expected) return;
    } catch { /* The owner file is created by the process that wins the atomic reservation. */ }
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Child exited before ${path} contained ${expected} (code ${child.exitCode}, signal ${child.signalCode})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${path} to contain ${expected}`);
}

async function assertAttemptMarkers(directory: string, expected: string[]): Promise<void> {
  const actual = (await readdir(directory)).filter((name) => /^[A-Z]-attempt-\d+\.started$/.test(name)).sort();
  assert.deepEqual(actual, [...expected].sort(), "only the expected per-session SSH attempts should run");
}

test("Linux SSH log reader drains and captures diagnostics without writing to the terminal", { timeout: 10_000 }, async (t) => {
  const shell = await readFile(join(process.cwd(), "keep-ssh-tunnel.sh"), "utf8");
  const commandStart = shell.indexOf("node --input-type=module -e '\n");
  assert.notEqual(commandStart, -1, "the Linux supervisor embeds its private SSH log reader");
  const sourceStart = commandStart + "node --input-type=module -e '\n".length;
  const sourceEnd = shell.indexOf("\n' \"${SSH_LOG_FILE}\"", sourceStart);
  assert.notEqual(sourceEnd, -1, "the embedded SSH log reader has a clear shell boundary");
  const readerSource = shell.slice(sourceStart, sourceEnd);
  assert.doesNotMatch(readerSource, /process\.stderr|process\.stdout|console\./,
    "the FIFO reader must not attempt potentially blocking terminal output");
  const directory = await mkdtemp(join(tmpdir(), "decky-linux-log-reader-test-"));
  const outputPath = join(directory, "ssh-output");
  t.after(() => rm(directory, { recursive: true, force: true }));

  // Any accidental terminal write fails immediately; the reader must still consume all input.
  const child = spawn(process.execPath, [
    "--input-type=module", "-e", `process.stderr.write = () => { throw new Error('terminal output attempted'); };\n${readerSource}`, outputPath
  ], { stdio: ["pipe", "ignore", "ignore"] });
  t.after(() => stopOwnedChild(child));
  child.stdin.end(Buffer.alloc(256 * 1024, 0x61));
  const [exitCode] = await once(child, "close");
  assert.equal(exitCode, 0, "the reader exits after consuming all input despite stderr backpressure");
  const retained = await readFile(outputPath);
  assert.equal(retained.length, 64 * 1024, "the diagnostic capture remains bounded to its configured tail");
  assert.ok(retained.every((byte) => byte === 0x61));
});

test("Linux SSH FIFO keepalive remains open until the SSH writer has exited", async () => {
  const shell = await readFile(join(process.cwd(), "keep-ssh-tunnel.sh"), "utf8");
  const launch = shell.indexOf('  ssh -N -T \\');
  const wait = shell.indexOf('  if wait "${SSH_PID}";', launch);
  const finish = shell.indexOf("  finish_ssh_log_reader || true", wait);
  assert.ok(launch >= 0 && wait > launch && finish > wait, "SSH is launched, waited, and then its reader is finalized");
  assert.equal(shell.slice(launch, wait).includes("close_ssh_log_keepalive"), false,
    "the parent's write-capable FIFO descriptor cannot close while SSH may still open or write the FIFO");
  assert.match(shell.slice(launch, wait), /<\/dev\/tty/, "SSH continues to read password and passphrase prompts directly from the terminal");
});

test("the Linux launcher resolves installer-style symlinks before loading project helpers", async () => {
  const launcher = await readFile(join(process.cwd(), "start-decky-whatsapp-linux.sh"), "utf8");
  const symlinkResolution = launcher.indexOf('while [[ -L "${source_path}" ]]; do');
  const helperSource = launcher.indexOf('source "${PROJECT_ROOT}/scripts/launcher-validation.sh"');
  const optionHandling = launcher.indexOf('while (($#)); do');
  assert.ok(symlinkResolution >= 0 && helperSource > symlinkResolution && optionHandling > helperSource,
    "an installer-created shortcut outside the checkout resolves to the project before sourcing its helper or handling options");
});

test("the Windows launcher refuses a second local bridge without shutting down the active one", async () => {
  const launcher = await readFile(launcherScript, "utf8");
  const tunnel = await readFile(tunnelScript, "utf8");
  assert.match(launcher, /BeginConnect\('127\.0\.0\.1', %BRIDGE_PORT%/);
  assert.match(launcher, /Close its window explicitly before starting another session/);
  assert.match(launcher, /node\.exe scripts\\read-bridge-port\.mjs/,
    "the Windows launcher resolves the same inherited environment and .env port as the bridge");
  const clearPort = launcher.indexOf('set "BRIDGE_PORT="');
  const readPort = launcher.indexOf("scripts\\read-bridge-port.mjs");
  const portGuard = launcher.indexOf("if not defined BRIDGE_PORT");
  const resolveHost = launcher.indexOf("echo Checking a small set of conventional Steam Deck hostnames");
  assert.ok(clearPort >= 0 && clearPort < readPort && readPort < portGuard && portGuard < resolveHost,
    "the batch launcher clears an inherited BRIDGE_PORT and aborts on reader failure before host discovery or startup");
  assert.match(launcher, /pushd "%PROJECT_DIR%"[^\r\n]*\r?\nfor \/f[\s\S]*?\r?\npopd/,
    "the launcher restores the caller's working directory immediately after reading .env");
  assert.match(launcher, /process\.versions\.node\.split\('\.'\)\[0\]\) >= 22/,
    "the Windows launcher rejects unsupported Node versions before starting either process");
  assert.match(launcher, /node\.exe scripts\\suggest-deck-host\.mjs/,
    "Deck hostname suggestions use the bounded OS resolver helper");
  assert.match(launcher, /if defined DECK_HOST exit \/b 0/,
    "an explicitly configured Deck host bypasses suggestions");
  assert.match(launcher, /Invalid or unresolvable Deck address/,
    "manual Deck input is checked before starting the bridge");
  assert.match(launcher, /set PORT=%BRIDGE_PORT%&& npm\.cmd start/,
    "the bridge and reverse tunnel receive the same normalized port");
  assert.doesNotMatch(launcher, /NoExit|\/shutdown|fuser|Stop-Process|Terminate/i);
  assert.match(tunnel, /Read-Host "Press Enter to close this window"/);
});

test("the shared launcher port reader honors environment precedence and normalizes decimal values", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "decky-port-config-test-"));
  const portReader = join(process.cwd(), "scripts", "read-bridge-port.mjs");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, ".env"), "PORT=09090\n");

  const inheritedEnvironment = { ...process.env, PORT: "08787" };
  assert.equal(execFileSync(process.execPath, [portReader], { cwd: directory, env: inheritedEnvironment, encoding: "utf8" }), "8787");
  const dotenvEnvironment = { ...process.env };
  delete dotenvEnvironment.PORT;
  assert.equal(execFileSync(process.execPath, [portReader], { cwd: directory, env: dotenvEnvironment, encoding: "utf8" }), "9090");
  assert.throws(() => execFileSync(process.execPath, [portReader], {
    cwd: directory,
    env: { ...process.env, PORT: "65536" },
    encoding: "utf8",
    stdio: "pipe"
  }));

  const inheritedBridgePort = spawnSync(process.execPath, [portReader], {
    cwd: directory,
    env: { ...process.env, PORT: "invalid", BRIDGE_PORT: "8787" },
    encoding: "utf8"
  });
  assert.notEqual(inheritedBridgePort.status, 0);
  assert.equal(inheritedBridgePort.stdout, "",
    "an invalid PORT yields no value that could be confused with an inherited batch BRIDGE_PORT");
});

test("confirmed bridge shutdown lets Linux and Windows foreground launchers close their owned tunnels", async () => {
  const linux = await readFile(join(process.cwd(), "keep-ssh-tunnel.sh"), "utf8");
  const windows = await readFile(tunnelScript, "utf8");
  const launcher = await readFile(launcherScript, "utf8");

  assert.match(linux, /if ! child_is_running "\$\{BRIDGE_PID\}" "\$\{BRIDGE_START_TIME\}"; then[\s\S]*?stop_owned_child "\$\{SSH_PID\}" "\$\{SSH_START_TIME\}" "reverse SSH tunnel"[\s\S]*?exit 0/,
    "Linux observes its owned bridge exit, stops only its owned SSH process, and exits successfully");
  assert.match(linux, /trap cleanup EXIT/,
    "Linux runs ownership-checked cleanup before its foreground supervisor exits");

  assert.match(launcher, /cmd \/c "set PORT=%BRIDGE_PORT%&& npm\.cmd start"/,
    "the Windows bridge command window closes when npm start returns");
  assert.match(windows, /function Stop-OwnedTunnel[\s\S]*?\$Process\.Kill\(\)[\s\S]*?\$Process\.WaitForExit\(\)/,
    "the Windows supervisor waits for the SSH process it launched to exit");
  assert.match(windows, /if \(-not \(Test-BridgeListening\)\) \{[\s\S]*?Stop-OwnedTunnel \$sshProcess[\s\S]*?exit 0/,
    "the Windows tunnel window exits after its bridge stops");
  assert.doesNotMatch(launcher, /cmd \/k|NoExit/i,
    "the Windows foreground launcher does not keep the bridge window open after exit");
});

test("optional background controller isolates its child port and protects recorded process ownership", async () => {
  const controller = await readFile(backgroundControllerScript, "utf8");
  const tunnel = await readFile(tunnelScript, "utf8");
  assert.match(controller, /ValidateRange\(1, 65535\)/);
  assert.match(controller, /\$env:PORT = \[string\]\$BridgePort/);
  assert.match(controller, /if \(\$hadPort\) \{ \$env:PORT = \$previousPort \} else \{ Remove-Item Env:PORT/);
  assert.match(controller, /Get-BridgeHealthForOwnedProcess \$bridgeRecord \$BridgePort/);
  assert.match(controller, /\$health\.processId -ne \[int\]\$record\.Pid/);
  assert.match(controller, /ExpectedSessionId = \$expectedSessionId/);
  assert.match(controller, /Get-VerifiedProcess \$oldState\.Tunnel/);
  assert.match(controller, /-BridgeProcessId.*-BridgeStartTimeUtcTicks/);
  assert.match(controller, /Get-BridgeHealthForOwnedProcess \$state\.Bridge/);
  assert.match(controller, /\$ownedBridge\.Kill\(\)/);
  assert.match(tunnel, /StartTime\.ToUniversalTime\(\)\.Ticks -eq \$BridgeStartTimeUtcTicks/);
  assert.match(tunnel, /if \(-not \(Test-BridgeProcess\)\) \{ return \$false \}/);
});

test("Stop recovers an expected session ID for a healthy owned partial startup", { timeout: 18_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell background controller test");

  const runtimeDir = await mkdtemp(join(tmpdir(), "decky-partial-start-test-"));
  t.after(() => rm(runtimeDir, { recursive: true, force: true }));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const expectedSessionId = "a1b2c3d4-e5f6-4789-abcd-0123456789ab";
  const token = "f".repeat(64);
  const source = `
    const http = require('node:http');
    const processId = process.pid;
    const sessionId = ${JSON.stringify(expectedSessionId)};
    const token = ${JSON.stringify(token)};
    const server = http.createServer((request, response) => {
      if (request.url === '/bootstrap') return response.end(JSON.stringify({ token }));
      if (request.headers.authorization !== 'Bearer ' + token) { response.statusCode = 401; return response.end(); }
      if (request.url === '/health') return response.end(JSON.stringify({ ok: true, processId, sessionId }));
      if (request.url === '/shutdown') {
        let body = '';
        request.on('data', (chunk) => body += chunk);
        request.on('end', () => {
          const expected = JSON.parse(body).expectedSessionId;
          if (expected !== sessionId) { response.statusCode = 409; return response.end(); }
          response.end(JSON.stringify({ shuttingDown: true }));
          setTimeout(() => server.close(() => process.exit(0)), 50);
        });
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    server.listen(Number(process.env.PORT), '127.0.0.1');
  `;
  const bridge = spawn(process.execPath, ["-e", source, "src/server.ts"], {
    env: { ...process.env, PORT: String(address.port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => stopOwnedChild(bridge));
  assert.ok(bridge.pid);
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try { await fetch(`http://127.0.0.1:${address.port}/bootstrap`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  const startTicks = execFileSync(powershell, ["-NoProfile", "-Command", `(Get-Process -Id ${bridge.pid}).StartTime.ToUniversalTime().Ticks`], { encoding: "utf8" }).trim();
  const state = {
    Version: 1,
    StartedAt: new Date().toISOString(),
    DeckHost: "steamdeck.test",
    BridgePort: address.port,
    ExpectedSessionId: null,
    Bridge: {
      Pid: bridge.pid,
      StartTimeUtcTicks: startTicks,
      ExecutablePath: process.execPath,
      CommandLineMarker: "src/server.ts"
    },
    Tunnel: null,
    BridgeLog: join(runtimeDir, "bridge.out.log"),
    BridgeErrorLog: join(runtimeDir, "bridge.err.log"),
    TunnelLog: join(runtimeDir, "tunnel.out.log"),
    TunnelErrorLog: join(runtimeDir, "tunnel.err.log")
  };
  await writeFile(join(runtimeDir, "state.json"), JSON.stringify(state), "utf8");

  const statusOutput = execFileSync(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", backgroundControllerScript,
    "-Action", "Status", "-RuntimeDir", runtimeDir
  ], { encoding: "utf8" });
  assert.match(statusOutput, /Bridge: running/, statusOutput);

  const controller = spawn(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", backgroundControllerScript,
    "-Action", "Stop", "-RuntimeDir", runtimeDir
  ], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => stopOwnedChild(controller));
  const output = watchOutput(controller);
  const [exitCode] = await once(controller, "close");
  assert.equal(exitCode, 0, output.output);
  assert.match(output.output, /Background bridge and its supervised tunnel have stopped/);
  const bridgeExitCode = bridge.exitCode ?? await Promise.race([
    once(bridge, "close").then(([code]) => code as number),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
  ]);
  const remainingStatus = bridgeExitCode === null ? execFileSync(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", backgroundControllerScript,
    "-Action", "Status", "-RuntimeDir", runtimeDir
  ], { encoding: "utf8" }) : "";
  assert.notEqual(bridgeExitCode, null, `owned bridge was not shut down by the controller: ${output.output}\n${remainingStatus}`);
  assert.equal(bridgeExitCode, 0);
  const stateText = (await readFile(join(runtimeDir, "state.json"), "utf8")).replace(/^\uFEFF/, "");
  const updatedState = JSON.parse(stateText) as { ExpectedSessionId: string };
  assert.equal(updatedState.ExpectedSessionId, expectedSessionId);
});

test("normal supervisor exit on a closed bridge port does not wait for input", { timeout: 12_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const child = spawn(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
    "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port)
  ], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => stopOwnedChild(child));
  const output = watchOutput(child);
  const [code] = await once(child, "close");
  assert.equal(code, 0);
  assert.match(output.output, /No SSH tunnel was started/);
  assert.doesNotMatch(output.output, /Press Enter|Retrying/);
});

test("background supervisor closes its SSH child when the recorded bridge exits even if the port is reused", { timeout: 20_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const directory = await mkdtemp(join(tmpdir(), "decky-owned-bridge-test-"));
  const mockSshPath = join(directory, "mock-ssh.ps1");
  const mockSshPidPath = join(directory, "mock-ssh.pid");
  await writeFile(mockSshPath, "param($pidPath)\n[IO.File]::WriteAllText($pidPath, [string]$PID)\nStart-Sleep -Seconds 30\n", "utf8");

  const bridgeSource = `const net = require('node:net'); const server = net.createServer(); server.listen(${address.port}, '127.0.0.1', () => console.log('OWNED_BRIDGE_READY')); setInterval(() => {}, 1000);`;
  const bridge = spawn(process.execPath, ["-e", bridgeSource], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => stopOwnedChild(bridge));
  const bridgeOutput = watchOutput(bridge);
  await bridgeOutput.waitFor("OWNED_BRIDGE_READY");
  assert.ok(bridge.pid);
  const startTicks = execFileSync(powershell, ["-NoProfile", "-Command", `(Get-Process -Id ${bridge.pid}).StartTime.ToUniversalTime().Ticks`], { encoding: "utf8" }).trim();
  assert.match(startTicks, /^\d+$/);

  const override = Buffer.from(JSON.stringify(["-NoProfile", "-File", mockSshPath, mockSshPidPath])).toString("base64");
  const supervisor = spawn(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
    "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
    "-BridgeProcessId", String(bridge.pid), "-BridgeStartTimeUtcTicks", startTicks,
    "-SshExecutable", powershell, "-SshArgumentsOverrideBase64", override
  ], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => stopOwnedChild(supervisor));
  const supervisorOutput = watchOutput(supervisor);
  try { await waitForFile(mockSshPidPath, DEFAULT_FILE_WAIT_MS, supervisor); }
  catch (error) { throw new Error(`${error instanceof Error ? error.message : error}\n${supervisorOutput.output}`); }

  bridge.kill();
  await once(bridge, "close");
  const replacement = createServer();
  replacement.listen(address.port, "127.0.0.1");
  await once(replacement, "listening");
  t.after(() => new Promise<void>((resolve) => replacement.close(() => resolve())));

  const [supervisorExit] = await once(supervisor, "close");
  assert.equal(supervisorExit, 0);
  assert.match(supervisorOutput.output, /Closing this launcher's SSH tunnel/);
  const client = createConnection(address.port, "127.0.0.1");
  await once(client, "connect");
  client.destroy();
});

test("SSH forwarding policy failures show the SSH diagnostic without claiming another bridge is active", { timeout: 20_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const bridge = createServer();
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address !== "string");
  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-policy-test-"));
  const mockSshPath = join(directory, "mock-ssh.ps1");
  await writeFile(mockSshPath, "[Console]::Error.WriteLine('remote port forwarding failed: administratively prohibited')\nexit 255\n", "utf8");
  const overrides = Buffer.from(JSON.stringify(["-NoProfile", "-File", mockSshPath])).toString("base64");
  const child = spawn(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
    "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
    "-SshExecutable", powershell, "-SshArgumentsOverrideBase64", overrides
  ], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => {
    await new Promise<void>((resolve) => bridge.close(() => resolve()));
    acknowledgeChild(child);
    await stopOwnedChild(child);
    await rm(directory, { recursive: true, force: true });
  });

  const output = watchOutput(child);
  await output.waitFor("The SSH server reported that remote forwarding is restricted");
  assert.match(output.output, /administratively prohibited/);
  assert.match(output.output, /SSH could not establish remote forwarding on port/);
  assert.doesNotMatch(output.output, /Another DeckyWhatsapp session appears to be connected/);
  assert.doesNotMatch(output.output, /Retrying in 3 seconds/);
  assert.doesNotMatch(output.output, /Waiting up to .* seconds for the Deck SSH server/);
  child.stdin.write("\r\n");
  const [exitCode] = await once(child, "close");
  assert.equal(exitCode, 1);
});

test("an unidentified forwarding conflict gets one delayed, non-interactive retry while the same bridge owns the port", { timeout: 30_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const bridge = createServer();
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address !== "string");
  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-recovery-test-"));
  const failureScript = join(directory, "forward-failure.ps1");
  const callsPath = join(directory, "ssh-calls.txt");
  await writeFile(failureScript, `
param([string]$CallsPath)
[System.IO.File]::AppendAllText($CallsPath, "attempt$([Environment]::NewLine)")
[Console]::Error.WriteLine('Warning: remote port forwarding failed for listen port 8787')
exit 255
`, "utf8");
  const failureOverride = Buffer.from(JSON.stringify(["-NoProfile", "-File", failureScript, callsPath])).toString("base64");
  const unknownProbeOverride = Buffer.from(JSON.stringify(["-NoProfile", "-Command", "exit 255"])).toString("base64");
  const child = spawn(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
    "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
    "-RecoveryDelaySeconds", "1", "-SshExecutable", powershell,
    "-SshArgumentsOverrideBase64", failureOverride,
    "-DiagnosticProbeOverrideBase64", unknownProbeOverride
  ], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => {
    acknowledgeChild(child);
    await stopOwnedChild(child);
    await new Promise<void>((resolve) => bridge.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  const output = watchOutput(child);
  const startedAt = Date.now();
  await output.waitFor(
    "The launcher is stopping without prompting or retrying again",
    WINDOWS_PROCESS_STARTUP_BUDGET_MS * 4 + 3_000
  );
  assert.ok(Date.now() - startedAt >= 900, "the retry waits for the configured expiry interval");
  assert.match(output.output, /same local bridge process is still active; making one non-interactive SSH forwarding retry/);
  assert.match(output.output, /port may still be occupied/);
  child.stdin.write("\r\n");
  const [exitCode] = await once(child, "close");
  assert.equal(exitCode, 1);
  assert.equal((await readFile(callsPath, "utf8")).trim().split(/\r?\n/).length, 2, "only the initial attempt and one recovery retry run");
});

test("the stale-port retry stops when BatchMode cannot authenticate instead of prompting or looping", { timeout: 30_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const bridge = createServer();
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address !== "string");
  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-batchmode-test-"));
  const mockSshPath = join(directory, "mock-ssh.ps1");
  const callsPath = join(directory, "ssh-calls.txt");
  await writeFile(mockSshPath, `
param([string]$CallsPath)
$count = 0
if (Test-Path -LiteralPath $CallsPath) { $count = (Get-Content -LiteralPath $CallsPath).Count }
[System.IO.File]::AppendAllText($CallsPath, "attempt$([Environment]::NewLine)")
if ($count -eq 0) { [Console]::Error.WriteLine('Warning: remote port forwarding failed for listen port 8787') }
else { [Console]::Error.WriteLine('deck@steamdeck.test: Permission denied (publickey,password).') }
exit 255
`, "utf8");
  const sshOverride = Buffer.from(JSON.stringify(["-NoProfile", "-File", mockSshPath, callsPath])).toString("base64");
  const unknownProbeOverride = Buffer.from(JSON.stringify(["-NoProfile", "-Command", "exit 255"])).toString("base64");
  const child = spawn(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
    "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
    "-RecoveryDelaySeconds", "1", "-SshExecutable", powershell,
    "-SshArgumentsOverrideBase64", sshOverride,
    "-DiagnosticProbeOverrideBase64", unknownProbeOverride
  ], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => {
    acknowledgeChild(child);
    await stopOwnedChild(child);
    await new Promise<void>((resolve) => bridge.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  const output = watchOutput(child);
  await output.waitFor("could not authenticate without prompting", WINDOWS_RECOVERY_STAGE_WAIT_MS);
  const [exitCode] = await once(child, "close");
  assert.equal(exitCode, 1);
  assert.match(output.output, /Password-only SSH or a key that requires an unavailable passphrase cannot recover automatically/);
  assert.doesNotMatch(output.output, /Retrying in 3 seconds/);
  assert.equal((await readFile(callsPath, "utf8")).trim().split(/\r?\n/).length, 2);
});

test("the stale-port retry stops after a transport failure without a third interactive attempt", { timeout: 30_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const bridge = createServer();
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address !== "string");
  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-transport-test-"));
  const mockSshPath = join(directory, "mock-ssh.ps1");
  const callsPath = join(directory, "ssh-calls.txt");
  await writeFile(mockSshPath, `
param([string]$CallsPath)
$count = 0
if (Test-Path -LiteralPath $CallsPath) { $count = (Get-Content -LiteralPath $CallsPath).Count }
[System.IO.File]::AppendAllText($CallsPath, "attempt$([Environment]::NewLine)")
if ($count -eq 0) { [Console]::Error.WriteLine('Warning: remote port forwarding failed for listen port 8787') }
else { [Console]::Error.WriteLine('ssh: connect to host steamdeck.test port 22: Connection timed out') }
exit 255
`, "utf8");
  const sshOverride = Buffer.from(JSON.stringify(["-NoProfile", "-File", mockSshPath, callsPath])).toString("base64");
  const unknownProbeOverride = Buffer.from(JSON.stringify(["-NoProfile", "-Command", "exit 255"])).toString("base64");
  const child = spawn(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
    "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
    "-RecoveryDelaySeconds", "1", "-SshExecutable", powershell,
    "-SshArgumentsOverrideBase64", sshOverride,
    "-DiagnosticProbeOverrideBase64", unknownProbeOverride
  ], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => {
    acknowledgeChild(child);
    await stopOwnedChild(child);
    await new Promise<void>((resolve) => bridge.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  const output = watchOutput(child);
  await output.waitFor("The launcher is stopping without prompting or retrying again", WINDOWS_RECOVERY_STAGE_WAIT_MS);
  const [exitCode] = await once(child, "close");
  assert.equal(exitCode, 1);
  assert.match(output.output, /transport, host-key, or other connection error/);
  assert.doesNotMatch(output.output, /Retrying in 3 seconds|Press Enter to close this window/);
  assert.equal((await readFile(callsPath, "utf8")).trim().split(/\r?\n/).length, 2);
});

test("the stale-port retry stays supervised when SSH connects successfully", { timeout: 30_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const bridge = createServer();
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address !== "string");
  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-recovery-success-test-"));
  const mockSshPath = join(directory, "mock-ssh.ps1");
  const callsPath = join(directory, "ssh-calls.txt");
  const sshPidPath = join(directory, "ssh-pid.txt");
  let bridgeClosed = false;
  const closeBridge = async () => {
    if (bridgeClosed) return;
    bridgeClosed = true;
    await new Promise<void>((resolve) => bridge.close(() => resolve()));
  };
  await writeFile(mockSshPath, `
param([string]$CallsPath, [string]$PidPath)
$count = 0
if (Test-Path -LiteralPath $CallsPath) { $count = (Get-Content -LiteralPath $CallsPath).Count }
[System.IO.File]::AppendAllText($CallsPath, "attempt$([Environment]::NewLine)")
if ($count -eq 0) {
  [Console]::Error.WriteLine('Warning: remote port forwarding failed for listen port 8787')
  exit 255
}
[Console]::Error.WriteLine('debug1: Remote forward success for: listen ${address.port}, connect 127.0.0.1:${address.port}')
[System.IO.File]::WriteAllText($PidPath, [string]$PID)
while ($true) { Start-Sleep -Milliseconds 100 }
`, "utf8");
  const sshOverride = Buffer.from(JSON.stringify(["-NoProfile", "-File", mockSshPath, callsPath, sshPidPath])).toString("base64");
  const unknownProbeOverride = Buffer.from(JSON.stringify(["-NoProfile", "-Command", "exit 255"])).toString("base64");
  const supervisor = spawn(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
    "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
    "-RecoveryDelaySeconds", "1", "-SshExecutable", powershell,
    "-SshArgumentsOverrideBase64", sshOverride,
    "-DiagnosticProbeOverrideBase64", unknownProbeOverride
  ], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => {
    await closeBridge();
    if (isChildRunning(supervisor)) {
      const stopped = await Promise.race([
        once(supervisor, "close").then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000))
      ]);
      if (!stopped && isChildRunning(supervisor)) await stopOwnedChild(supervisor);
    }
    await rm(directory, { recursive: true, force: true });
  });

  const output = watchOutput(supervisor);
  await waitForFile(sshPidPath, WINDOWS_RECOVERY_STAGE_WAIT_MS, supervisor);
  assert.equal(supervisor.exitCode, null, "the retry process remains under supervision until the bridge stops");
  assert.match(output.output, /making one non-interactive SSH forwarding retry/);
  assert.equal((await readFile(callsPath, "utf8")).trim().split(/\r?\n/).length, 2);
  await closeBridge();
  const [exitCode] = supervisor.exitCode !== null ? [supervisor.exitCode] : await once(supervisor, "close");
  assert.equal(exitCode, 0);
  assert.match(output.output, /OpenSSH confirmed that the remote forward was established/);
  assert.match(output.output, /Closing this launcher.s SSH tunnel/);
});

test("a confirmed stale-port retry may reconnect normally after a later transport drop", { timeout: 40_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const bridge = createServer();
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address !== "string");
  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-confirmed-reconnect-test-"));
  const mockSshPath = join(directory, "mock-ssh.ps1");
  const callsPath = join(directory, "ssh-calls.txt");
  const retryPidPath = join(directory, "retry-ssh-pid.txt");
  const reconnectPidPath = join(directory, "reconnect-ssh-pid.txt");
  await writeFile(mockSshPath, `
param([string]$CallsPath, [string]$RetryPidPath, [string]$ReconnectPidPath)
$count = 0
if (Test-Path -LiteralPath $CallsPath) { $count = (Get-Content -LiteralPath $CallsPath).Count }
[System.IO.File]::AppendAllText($CallsPath, "attempt$([Environment]::NewLine)")
if ($count -eq 0) {
  [Console]::Error.WriteLine('Warning: remote port forwarding failed for listen port 8787')
  exit 255
}
if ($count -eq 1) {
  [Console]::Error.WriteLine('debug1: Remote forward success for: listen ${address.port}, connect 127.0.0.1:${address.port}')
  [System.IO.File]::WriteAllText($RetryPidPath, [string]$PID)
  Start-Sleep -Seconds 1
  [Console]::Error.WriteLine('ssh: connect to host steamdeck.test port 22: Connection timed out')
  exit 255
}
[System.IO.File]::WriteAllText($ReconnectPidPath, [string]$PID)
while ($true) { Start-Sleep -Milliseconds 100 }
`, "utf8");
  const sshOverride = Buffer.from(JSON.stringify(["-NoProfile", "-File", mockSshPath, callsPath, retryPidPath, reconnectPidPath])).toString("base64");
  const unknownProbeOverride = Buffer.from(JSON.stringify(["-NoProfile", "-Command", "exit 255"])).toString("base64");
  const supervisor = spawn(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
    "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
    "-RecoveryDelaySeconds", "1", "-SshExecutable", powershell,
    "-SshArgumentsOverrideBase64", sshOverride,
    "-DiagnosticProbeOverrideBase64", unknownProbeOverride
  ], { stdio: ["pipe", "pipe", "pipe"] });
  let bridgeClosed = false;
  const closeBridge = async () => {
    if (bridgeClosed) return;
    bridgeClosed = true;
    await new Promise<void>((resolve) => bridge.close(() => resolve()));
  };
  t.after(async () => {
    await closeBridge();
    if (isChildRunning(supervisor)) {
      const stopped = await Promise.race([
        once(supervisor, "close").then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000))
      ]);
      if (!stopped && isChildRunning(supervisor)) await stopOwnedChild(supervisor);
    }
    await rm(directory, { recursive: true, force: true });
  });

  const output = watchOutput(supervisor);
  await waitForFile(retryPidPath, WINDOWS_RECOVERY_STAGE_WAIT_MS, supervisor);
  await output.waitFor("SSH tunnel disconnected. Retrying in 3 seconds", WINDOWS_RECOVERY_STAGE_WAIT_MS);
  assert.match(output.output, /remote forward was established/);
  await waitForFile(reconnectPidPath, WINDOWS_RECOVERY_STAGE_WAIT_MS, supervisor);
  assert.equal((await readFile(callsPath, "utf8")).trim().split(/\r?\n/).length, 3);
  assert.equal(supervisor.exitCode, null, "the normal reconnect remains supervised while the bridge is listening");
  assert.match(output.output, /SSH tunnel disconnected\. Retrying in 3 seconds/);
  const tunnelSource = await readFile(tunnelScript, "utf8");
  assert.match(tunnelSource, /if \(-not \$SshArgumentsOverrideBase64\) \{ \$currentSshArguments = @\("-v", "-o", "BatchMode=yes"\)/);
  assert.match(tunnelSource, /if \(\$NonInteractive\) \{ \$sshArguments = @\("-o", "BatchMode=yes"\)/);
  await closeBridge();
  const [exitCode] = supervisor.exitCode !== null ? [supervisor.exitCode] : await once(supervisor, "close");
  assert.equal(exitCode, 0);
});

test("stale-port recovery does not retry after the original local bridge process is replaced", { timeout: 25_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-bridge-replaced-test-"));
  const mockSshPath = join(directory, "mock-ssh.ps1");
  const callsPath = join(directory, "ssh-calls.txt");
  await writeFile(mockSshPath, `
param([string]$CallsPath)
[System.IO.File]::AppendAllText($CallsPath, "attempt$([Environment]::NewLine)")
[Console]::Error.WriteLine('Warning: remote port forwarding failed for listen port 8787')
exit 255
`, "utf8");
  const bridgeSource = `const n=require('node:net');const s=n.createServer();s.listen(${address.port},'127.0.0.1',()=>console.log('BRIDGE_READY'));setInterval(()=>{},1000);`;
  const launchBridge = () => spawn(process.execPath, ["-e", bridgeSource], { stdio: ["ignore", "pipe", "pipe"] });
  const bridge = launchBridge();
  t.after(() => stopOwnedChild(bridge));
  const bridgeOutput = watchOutput(bridge);
  await bridgeOutput.waitFor("BRIDGE_READY");

  const sshOverride = Buffer.from(JSON.stringify(["-NoProfile", "-File", mockSshPath, callsPath])).toString("base64");
  const unknownProbeOverride = Buffer.from(JSON.stringify(["-NoProfile", "-Command", "exit 255"])).toString("base64");
  const supervisor = spawn(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
    "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
    "-RecoveryDelaySeconds", "2", "-SshExecutable", powershell,
    "-SshArgumentsOverrideBase64", sshOverride,
    "-DiagnosticProbeOverrideBase64", unknownProbeOverride
  ], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => {
    await stopOwnedChild(supervisor);
    await rm(directory, { recursive: true, force: true });
  });

  const output = watchOutput(supervisor);
  try { await output.waitFor("Waiting up to 2 seconds for the Deck SSH server to expire"); }
  catch (error) { throw new Error(`${String(error)}\nSupervisor output:\n${output.output}`); }
  bridge.kill();
  await once(bridge, "close");
  const replacement = launchBridge();
  t.after(() => stopOwnedChild(replacement));
  const replacementOutput = watchOutput(replacement);
  try { await replacementOutput.waitFor("BRIDGE_READY"); }
  catch (error) { throw new Error(`${String(error)}\nReplacement bridge output:\n${replacementOutput.output}`); }

  const [exitCode] = supervisor.exitCode !== null ? [supervisor.exitCode] : await once(supervisor, "close");
  assert.equal(exitCode, 0);
  assert.match(output.output, /same local bridge process is no longer listening\. Stopping without retrying/);
  assert.equal((await readFile(callsPath, "utf8")).trim().split(/\r?\n/).length, 1);
});

test("stale-port wait exits promptly when the owned bridge stops", { timeout: 20_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-stop-during-wait-test-"));
  const mockSshPath = join(directory, "mock-ssh.ps1");
  const callsPath = join(directory, "ssh-calls.txt");
  await writeFile(mockSshPath, `
param([string]$CallsPath)
[System.IO.File]::AppendAllText($CallsPath, "attempt$([Environment]::NewLine)")
[Console]::Error.WriteLine('Warning: remote port forwarding failed for listen port 8787')
exit 255
`, "utf8");
  const bridgeSource = `const n=require('node:net');const s=n.createServer();s.listen(${address.port},'127.0.0.1',()=>console.log('BRIDGE_READY'));setInterval(()=>{},1000);`;
  const bridge = spawn(process.execPath, ["-e", bridgeSource], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => stopOwnedChild(bridge));
  await watchOutput(bridge).waitFor("BRIDGE_READY");

  const sshOverride = Buffer.from(JSON.stringify(["-NoProfile", "-File", mockSshPath, callsPath])).toString("base64");
  const unknownProbeOverride = Buffer.from(JSON.stringify(["-NoProfile", "-Command", "exit 255"])).toString("base64");
  const supervisor = spawn(powershell, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
    "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
    "-RecoveryDelaySeconds", "30", "-SshExecutable", powershell,
    "-SshArgumentsOverrideBase64", sshOverride,
    "-DiagnosticProbeOverrideBase64", unknownProbeOverride
  ], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => {
    await stopOwnedChild(supervisor);
    await rm(directory, { recursive: true, force: true });
  });

  const output = watchOutput(supervisor);
  await output.waitFor("Waiting up to 30 seconds for the Deck SSH server to expire");
  const startedAt = Date.now();
  bridge.kill();
  await once(bridge, "close");
  const [exitCode] = await once(supervisor, "close");
  assert.equal(exitCode, 0);
  assert.ok(Date.now() - startedAt < 10_000, "the bridge stop interrupts the 30-second recovery wait");
  assert.match(output.output, /same local bridge process is no longer listening\. Stopping without retrying/);
  assert.equal((await readFile(callsPath, "utf8")).trim().split(/\r?\n/).length, 1);
});

// Five scenarios can each start the supervisor, mock SSH, and diagnostic probe;
// reserve 3 × 5s startup plus a bounded response/cleanup window per scenario.
test("forwarding conflicts identify HTTP owners, bound response reads, and clean up the probe", { timeout: 140_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const bridge = createServer();
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address !== "string");
  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-owner-test-"));
  const failureScript = join(directory, "forward-failure.mjs");
  const probeScript = join(directory, "probe-service.mjs");
  await writeFile(failureScript,
    "process.stderr.write('Warning: remote port forwarding failed for listen port 8787\\n'); process.exitCode = 255;\n", "utf8");
  await writeFile(probeScript, `
import fs from 'node:fs';
import http from 'node:http';
const [mode, portText, pidPath, ownerPath, errorPath] = process.argv.slice(2);
const server = http.createServer((_request, response) => {
  const body = mode === 'other' ? '<html>another service</html>' :
    mode === 'oversized' ? 'x'.repeat(256) :
    mode === 'streaming' ? 'x'.repeat(100) : '{"error":"Bridge authorization required"}';
  const statusCode = mode === 'other' ? 200 : 401;
  response.writeHead(statusCode, { 'Content-Length': mode === 'streaming' ? 100 : Buffer.byteLength(body), 'Connection': 'close' });
  if (mode === 'streaming') {
    let sent = 0;
    const interval = setInterval(() => { response.write('x'); sent += 1; }, 200);
    const deadline = setTimeout(() => response.destroy(), 10_000);
    response.on('close', () => { clearInterval(interval); clearTimeout(deadline); });
    return;
  }
  response.end(body);
});
server.on('error', (error) => {
  fs.writeFileSync(errorPath, error.stack || String(error));
  process.exitCode = 1;
});
server.listen(Number(portText), '127.0.0.1', () => {
  fs.writeFileSync(pidPath, String(process.pid));
  fs.writeFileSync(ownerPath, 'existing-Deck-service');
});
`, "utf8");

  const failureOverride = Buffer.from(JSON.stringify([failureScript])).toString("base64");
  const makeProbeOverride = (mode: string, pidPath: string, ownerPath: string, errorPath: string) => Buffer.from(JSON.stringify([
    probeScript, mode, "{PORT}", pidPath, ownerPath, errorPath
  ])).toString("base64");
  const scenarios = [
    { mode: "decky", expected: "A DeckyWhatsapp bridge is responding on remote port", notExpected: "could not be identified safely" },
    { mode: "other", expected: "An HTTP service that does not identify as DeckyWhatsapp is responding", notExpected: "Another DeckyWhatsapp session appears" },
    { mode: "oversized", expected: "The port may be held by an unresponsive or stale tunnel", notExpected: "Another DeckyWhatsapp session appears" },
    { mode: "streaming", expected: "The port may be held by an unresponsive or stale tunnel", notExpected: "Another DeckyWhatsapp session appears" },
    { mode: "unknown", expected: "The port may be held by an unresponsive or stale tunnel", notExpected: "Another DeckyWhatsapp session appears" }
  ];
  const waitForProcessGone = async (pid: number) => {
    const started = Date.now();
    while (Date.now() - started < 4000) {
      try { process.kill(pid, 0); } catch { return; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`diagnostic probe process ${pid} did not exit`);
  };
  const supervisors: ChildProcessWithoutNullStreams[] = [];

  try {
    for (const scenario of scenarios) {
      const pidPath = join(directory, `${scenario.mode}-probe.pid`);
      const ownerPath = join(directory, `${scenario.mode}-owner.txt`);
      const errorPath = join(directory, `${scenario.mode}-probe-error.txt`);
      const probeOverride = scenario.mode === "unknown" ? Buffer.from(JSON.stringify(["-NoProfile", "-Command", "exit 255"])).toString("base64") : makeProbeOverride(scenario.mode, pidPath, ownerPath, errorPath);
      const child = spawn(powershell, [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
        "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
        "-RecoveryDelaySeconds", "1",
        "-SshExecutable", process.execPath, "-SshArgumentsOverrideBase64", failureOverride,
        "-DiagnosticProbeOverrideBase64", probeOverride
      ], { stdio: ["pipe", "pipe", "pipe"] });
      supervisors.push(child);
      const output = watchOutput(child);
      if (scenario.mode === "oversized" || scenario.mode === "streaming") {
        await waitForFile(pidPath, WINDOWS_NESTED_PROCESS_WAIT_MS, child);
        await waitForFileContent(ownerPath, "existing-Deck-service", WINDOWS_NESTED_PROCESS_WAIT_MS, child);
      }
      const startedAt = Date.now();
      try {
        await output.waitFor(scenario.expected, WINDOWS_NESTED_PROCESS_WAIT_MS);
      }
      catch (error) { throw new Error(`${String(error)}\nMock probe error: ${await readFile(errorPath, "utf8").catch(() => "none")}`); }
      if (scenario.mode === "oversized" || scenario.mode === "streaming") {
        assert.ok(Date.now() - startedAt < 7000,
          `${scenario.mode} response read should finish within its bounded request/read timeout plus scheduling slack`);
      }
      assert.doesNotMatch(output.output, new RegExp(scenario.notExpected));
      if (scenario.mode === "decky" || scenario.mode === "other") {
        assert.doesNotMatch(output.output, /Waiting up to .* seconds for the Deck SSH server/);
      }
      if (scenario.mode !== "unknown") {
        const pid = Number((await readFile(pidPath, "utf8")).trim());
        assert.ok(Number.isInteger(pid) && pid > 0);
        await waitForProcessGone(pid);
        assert.equal((await readFile(ownerPath, "utf8")).trim(), "existing-Deck-service", "the probe did not remove or alter the responding service marker");
      }
      child.stdin.write("\r\n");
      const [exitCode] = await once(child, "close");
      assert.equal(exitCode, 1);
      if (scenario.mode === "decky") assert.match(output.output, /Close the existing connection before starting another/);
      if (scenario.mode === "unknown") assert.match(output.output, /making one non-interactive SSH forwarding retry/);
    }
  } finally {
    for (const child of supervisors) acknowledgeChild(child);
    await Promise.all(supervisors.map(async (child) => {
      if (!isChildRunning(child)) return;
      const exited = Promise.race([
        once(child, "close").then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500))
      ]);
      if (!(await exited) && isChildRunning(child)) await stopOwnedChild(child);
    }));
    await new Promise<void>((resolve) => bridge.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("simultaneous tunnel startups choose one winner and a reconnect cannot displace it", { timeout: 90_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const bridge = createServer();
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address !== "string");

  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-test-"));
  const spacedDirectory = join(directory, "remote port lock with spaces");
  await mkdir(spacedDirectory);
  const lockPath = join(spacedDirectory, "remote-port.lock");
  const ownerPath = join(spacedDirectory, "remote-port-owner.txt");
  const reconnectGate = join(spacedDirectory, "allow-original-reconnect");
  const dropSignal = join(spacedDirectory, "drop-first-connection");
  const mockSshPath = join(spacedDirectory, "mock ssh.ps1");
  await writeFile(mockSshPath, `
param([string]$Session, [string]$LockPath, [string]$OwnerPath, [string]$MarkerDirectory, [string]$DropSignal, [string]$ReconnectGate)
$attempt = 1
while (Test-Path -LiteralPath (Join-Path $MarkerDirectory "$Session-attempt-$attempt.started")) { $attempt++ }
Set-Content -LiteralPath (Join-Path $MarkerDirectory "$Session-attempt-$attempt.started") -Value 'started'
if ($Session -ne 'C' -and (Test-Path -LiteralPath "$ReconnectGate.pending")) {
  while (-not (Test-Path -LiteralPath $ReconnectGate)) { Start-Sleep -Milliseconds 50 }
}
try {
  $reservation = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch [System.IO.IOException] {
  [Console]::Error.WriteLine('Warning: remote port forwarding failed for listen port 8787')
  exit 255
}
$owner = [System.Text.Encoding]::UTF8.GetBytes("$Session|$PID")
$reservation.Write($owner, 0, $owner.Length)
$reservation.Flush()
Set-Content -LiteralPath $OwnerPath -Value $Session
if ($Session -ne 'C') {
  while (-not (Test-Path -LiteralPath $DropSignal)) { Start-Sleep -Milliseconds 50 }
  $reservation.Dispose()
  Remove-Item -LiteralPath $LockPath -Force
  Set-Content -LiteralPath "$ReconnectGate.pending" -Value $Session
  exit 255
}
while ($true) { Start-Sleep -Milliseconds 100 }
`, "utf8");

  const children: Array<{ child: ChildProcessWithoutNullStreams; output: ReturnType<typeof watchOutput> }> = [];
  const closeBridge = () => new Promise<void>((resolve) => bridge.close(() => resolve()));
  t.after(async () => {
    await writeFile(reconnectGate, "release").catch(() => {});
    await closeBridge();
    for (const { child } of children) acknowledgeChild(child);
    await Promise.all(children.map(({ child }) => stopOwnedChild(child)));
    await rm(directory, { recursive: true, force: true });
  });

  const overridesFor = (session: string) => Buffer.from(JSON.stringify([
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", mockSshPath,
    session, lockPath, ownerPath, spacedDirectory, dropSignal, reconnectGate
  ])).toString("base64");
  const launchSupervisor = (session: string) => {
    const child = spawn(powershell, [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
      "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
      "-RecoveryDelaySeconds", "1",
      "-SshExecutable", powershell, "-SshArgumentsOverrideBase64", overridesFor(session)
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const output = watchOutput(child);
    const entry = { child, output };
    children.push(entry);
    return entry;
  };

  const a = launchSupervisor("A");
  const b = launchSupervisor("B");
  const conflictWinner = await Promise.race([
    a.output.waitFor(conflictMessage).then(() => ({ loser: a, winner: b })),
    b.output.waitFor(conflictMessage).then(() => ({ loser: b, winner: a }))
  ]);
  assert.equal(conflictWinner.loser.child.exitCode, null, "conflict waits for visible acknowledgement");
  conflictWinner.loser.child.stdin.write("\r\n");
  const [loserExitCode] = await once(conflictWinner.loser.child, "close");
  assert.equal(loserExitCode, 1);
  assert.doesNotMatch(conflictWinner.loser.output.output, /Retrying in 3 seconds/);
  assert.equal(conflictWinner.winner.child.exitCode, null, "the simultaneous-startup winner remains connected");
  assert.equal((await readFile(ownerPath, "utf8")).trim(), conflictWinner.winner === a ? "A" : "B");

  await writeFile(dropSignal, "drop");
  await conflictWinner.winner.output.waitFor("SSH tunnel disconnected. Retrying in 3 seconds...");
  const originalSession = conflictWinner.winner === a ? "A" : "B";
  await waitForFile(join(spacedDirectory, `${originalSession}-attempt-2.started`), DEFAULT_FILE_WAIT_MS, conflictWinner.winner.child);
  const c = launchSupervisor("C");
  await waitForFile(join(spacedDirectory, "C-attempt-1.started"), WINDOWS_SLOW_RECONNECT_STARTUP_WAIT_MS, c.child);
  try {
    await waitForFileContent(ownerPath, "C", WINDOWS_SLOW_RECONNECT_STARTUP_WAIT_MS, c.child);
  } catch (error) {
    throw new Error(`${String(error)}\nNew session output:\n${c.output.output}\nOriginal session output:\n${conflictWinner.winner.output.output}`);
  }
  assert.equal((await readFile(ownerPath, "utf8")).trim(), "C");
  await writeFile(reconnectGate, "release");

  await conflictWinner.winner.output.waitFor(conflictMessage);
  assert.equal(conflictWinner.winner.child.exitCode, null, "the conflict remains visible until acknowledged");
  assert.equal(c.child.exitCode, null, "the reconnecting original did not displace the new winner");
  conflictWinner.winner.child.stdin.write("\r\n");
  const [reconnectExitCode] = await once(conflictWinner.winner.child, "close");
  assert.equal(reconnectExitCode, 1);
  assert.equal((await readFile(ownerPath, "utf8")).trim(), "C");

  await closeBridge();
  const [newWinnerExitCode] = await once(c.child, "close");
  assert.equal(newWinnerExitCode, 0);
  assert.match(c.output.output, /Closing this launcher.s SSH tunnel/);
  const originalLoser = conflictWinner.loser === a ? "A" : "B";
  await assertAttemptMarkers(spacedDirectory, [
    `${originalSession}-attempt-1.started`,
    `${originalSession}-attempt-2.started`,
    `${originalSession}-attempt-3.started`,
    `${originalLoser}-attempt-1.started`,
    `${originalLoser}-attempt-2.started`,
    "C-attempt-1.started"
  ]);
});

test("two reconnecting supervisors race for an atomic remote-port reservation", { timeout: 60_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const bridge = createServer();
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address !== "string");

  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-reconnect-race-"));
  const lockPath = join(directory, "remote-port.lock");
  const ownerPath = join(directory, "remote-port-owner.txt");
  const availabilityPath = join(directory, "remote-available");
  const mockSshPath = join(directory, "mock-ssh.ps1");
  await writeFile(mockSshPath, `
param([string]$Session, [string]$LockPath, [string]$OwnerPath, [string]$AvailabilityPath, [string]$MarkerDirectory)
$attempt = 1
while (Test-Path -LiteralPath (Join-Path $MarkerDirectory "$Session-attempt-$attempt.started")) { $attempt++ }
Set-Content -LiteralPath (Join-Path $MarkerDirectory "$Session-attempt-$attempt.started") -Value 'started'
if (-not (Test-Path -LiteralPath $AvailabilityPath)) {
  Set-Content -LiteralPath (Join-Path $MarkerDirectory "$Session-transient") -Value 'transient'
  [Console]::Error.WriteLine('ssh: connect to host steamdeck.test port 22: Connection timed out')
  exit 255
}
try {
  $reservation = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch [System.IO.IOException] {
  [Console]::Error.WriteLine('Warning: remote port forwarding failed for listen port 8787')
  exit 255
}
$owner = [System.Text.Encoding]::UTF8.GetBytes("$Session|$PID")
$reservation.Write($owner, 0, $owner.Length)
$reservation.Flush()
Set-Content -LiteralPath $OwnerPath -Value $Session
while ($true) { Start-Sleep -Milliseconds 100 }
`, "utf8");

  const children: Array<{ child: ChildProcessWithoutNullStreams; output: ReturnType<typeof watchOutput> }> = [];
  const closeBridge = () => new Promise<void>((resolve) => bridge.close(() => resolve()));
  t.after(async () => {
    await closeBridge();
    for (const { child } of children) acknowledgeChild(child);
    await Promise.all(children.map(({ child }) => stopOwnedChild(child)));
    await rm(directory, { recursive: true, force: true });
  });

  const overridesFor = (session: string) => Buffer.from(JSON.stringify([
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", mockSshPath,
    session, lockPath, ownerPath, availabilityPath, directory
  ])).toString("base64");
  const launchSupervisor = (session: string) => {
    const child = spawn(powershell, [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
      "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
      "-RecoveryDelaySeconds", "1",
      "-SshExecutable", powershell, "-SshArgumentsOverrideBase64", overridesFor(session)
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const output = watchOutput(child);
    const entry = { child, output };
    children.push(entry);
    return entry;
  };

  const a = launchSupervisor("A");
  const b = launchSupervisor("B");
  await Promise.all([
    waitForFile(join(directory, "A-transient"), WINDOWS_NESTED_PROCESS_WAIT_MS, a.child),
    waitForFile(join(directory, "B-transient"), WINDOWS_NESTED_PROCESS_WAIT_MS, b.child)
  ]);
  await writeFile(availabilityPath, "available");

  const conflictLoser = await Promise.race([
    a.output.waitFor(conflictMessage).then(() => a),
    b.output.waitFor(conflictMessage).then(() => b)
  ]);
  const winner = conflictLoser === a ? b : a;
  assert.equal(conflictLoser.child.exitCode, null, "the conflict remains visible until acknowledged");
  assert.match(conflictLoser.output.output, /SSH could not establish remote forwarding on port/);
  assert.equal(winner.child.exitCode, null, "the winning reconnect remains connected");
  const winningSession = winner === a ? "A" : "B";
  const losingSession = conflictLoser === a ? "A" : "B";
  assert.equal((await readFile(ownerPath, "utf8")).trim(), winningSession);

  await Promise.all([
    waitForFile(join(directory, `${winningSession}-attempt-2.started`), DEFAULT_FILE_WAIT_MS, winner.child),
    waitForFile(join(directory, `${losingSession}-attempt-2.started`), DEFAULT_FILE_WAIT_MS, conflictLoser.child)
  ]);
  await waitForFile(join(directory, `${losingSession}-attempt-3.started`), WINDOWS_RECOVERY_STAGE_WAIT_MS, conflictLoser.child);
  conflictLoser.child.stdin.write("\r\n");
  const [loserExitCode] = await once(conflictLoser.child, "close");
  assert.equal(loserExitCode, 1);
  assert.equal(winner.child.exitCode, null, "the losing reconnect did not displace or stop the winner");
  assert.equal((await readFile(ownerPath, "utf8")).trim(), winningSession);
  await closeBridge();
  const [winnerExitCode] = await once(winner.child, "close");
  assert.equal(winnerExitCode, 0);
  assert.equal((await readFile(ownerPath, "utf8")).trim(), winningSession);
  await assertAttemptMarkers(directory, [
    `${winningSession}-attempt-1.started`,
    `${winningSession}-attempt-2.started`,
    `${losingSession}-attempt-1.started`,
    `${losingSession}-attempt-2.started`,
    `${losingSession}-attempt-3.started`
  ]);
});
