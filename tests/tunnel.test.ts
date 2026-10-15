// Exercise tunnel supervision with local mock SSH processes and sockets; no real Deck is contacted.
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const tunnelScript = join(process.cwd(), "keep-ssh-tunnel.ps1");
const launcherScript = join(process.cwd(), "start-decky-whatsapp.bat");
const conflictMessage = "SSH could not establish remote forwarding on port";

function watchOutput(child: ChildProcessWithoutNullStreams) {
  let output = "";
  const waiters: Array<{ text: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
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
  return {
    get output() { return output; },
    waitFor(text: string, timeoutMs = 8000) {
      if (output.includes(text)) return Promise.resolve();
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

async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { await access(path); return; }
    catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForFileContent(path: string, expected: string, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await readFile(path, "utf8")).trim() === expected) return;
    } catch { /* The owner file is created by the process that wins the atomic reservation. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${path} to contain ${expected}`);
}

test("the Windows launcher refuses a second local bridge without shutting down the active one", async () => {
  const launcher = await readFile(launcherScript, "utf8");
  const tunnel = await readFile(tunnelScript, "utf8");
  assert.match(launcher, /BeginConnect\('127\.0\.0\.1', %BRIDGE_PORT%/);
  assert.match(launcher, /Close its window explicitly before starting another session/);
  assert.doesNotMatch(launcher, /NoExit|\/shutdown|fuser|Stop-Process|Terminate/i);
  assert.match(tunnel, /Read-Host "Press Enter to close this window"/);
});

test("normal supervisor exit on a closed bridge port does not wait for input", { timeout: 5000 }, async (t) => {
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
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const output = watchOutput(child);
  const [code] = await once(child, "close");
  assert.equal(code, 0);
  assert.match(output.output, /No SSH tunnel was started/);
  assert.doesNotMatch(output.output, /Press Enter|Retrying/);
});

test("SSH forwarding policy failures show the SSH diagnostic without claiming another bridge is active", { timeout: 10_000 }, async (t) => {
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
    if (child.exitCode === null) child.stdin.write("\r\n");
    if (child.exitCode === null) await once(child, "close");
    await rm(directory, { recursive: true, force: true });
  });

  const output = watchOutput(child);
  await output.waitFor("The SSH server reported that remote forwarding is restricted");
  assert.match(output.output, /administratively prohibited/);
  assert.match(output.output, /SSH could not establish remote forwarding on port/);
  assert.doesNotMatch(output.output, /Another DeckyWhatsapp session appears to be connected/);
  assert.doesNotMatch(output.output, /Retrying in 3 seconds/);
  child.stdin.write("\r\n");
  const [exitCode] = await once(child, "close");
  assert.equal(exitCode, 1);
});

test("forwarding conflicts identify HTTP owners, bound response reads, and clean up the probe", { timeout: 30_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const bridge = createServer();
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address !== "string");
  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-owner-test-"));
  const failureScript = join(directory, "forward-failure.ps1");
  const probeScript = join(directory, "probe-service.ps1");
  await writeFile(failureScript, "[Console]::Error.WriteLine('Warning: remote port forwarding failed for listen port 8787')\nexit 255\n", "utf8");
  await writeFile(probeScript, `
param([string]$Mode, [int]$Port, [string]$PidPath, [string]$OwnerPath, [string]$ErrorPath)
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Set-Content -LiteralPath $PidPath -Value $PID
Set-Content -LiteralPath $OwnerPath -Value 'existing-Deck-service'
while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $client.ReceiveTimeout = 1000
    $request = New-Object System.IO.MemoryStream
    $buffer = New-Object byte[] 1024
    while ($request.Length -lt 8192) {
      $read = $stream.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) { break }
      $request.Write($buffer, 0, $read)
      $requestText = [System.Text.Encoding]::ASCII.GetString($request.ToArray())
      if ($requestText.Contains([string][char]13 + [char]10 + [char]13 + [char]10)) { break }
    }
    if ($request.Length -eq 0) { continue }
    $body = if ($Mode -eq 'other') { '<html>another service</html>' } else { '{"error":"Bridge authorization required"}' }
    if ($Mode -eq 'oversized') { $body = 'x' * 256 }
    $status = if ($Mode -eq 'other') { '200 OK' } else { '401 Unauthorized' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $newline = [string][char]13 + [char]10
    $contentLength = if ($Mode -eq 'streaming') { 100 } else { $bytes.Length }
    $headerText = 'HTTP/1.1 ' + $status + $newline + 'Content-Type: application/json' + $newline + 'Content-Length: ' + $contentLength + $newline + 'Connection: close' + $newline + $newline
    $header = [System.Text.Encoding]::ASCII.GetBytes($headerText)
    $stream.Write($header, 0, $header.Length)
    if ($Mode -eq 'streaming') {
      foreach ($byte in $bytes) {
        $stream.WriteByte($byte)
        $stream.Flush()
        Start-Sleep -Milliseconds 200
      }
      continue
    }
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } catch { Set-Content -LiteralPath $ErrorPath -Value $_.Exception.ToString() }
  finally { $client.Close() }
}
`, "utf8");

  const failureOverride = Buffer.from(JSON.stringify(["-NoProfile", "-File", failureScript])).toString("base64");
  const makeProbeOverride = (mode: string, pidPath: string, ownerPath: string, errorPath: string) => Buffer.from(JSON.stringify([
    "-NoProfile", "-File", probeScript, mode, "{PORT}", pidPath, ownerPath, errorPath
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
      const startedAt = Date.now();
      const child = spawn(powershell, [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
        "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
        "-SshExecutable", powershell, "-SshArgumentsOverrideBase64", failureOverride,
        "-DiagnosticProbeOverrideBase64", probeOverride
      ], { stdio: ["pipe", "pipe", "pipe"] });
      supervisors.push(child);
      const output = watchOutput(child);
      try { await output.waitFor(scenario.expected); }
      catch (error) { throw new Error(`${String(error)}\nMock probe error: ${await readFile(errorPath, "utf8").catch(() => "none")}`); }
      if (scenario.mode === "oversized" || scenario.mode === "streaming") {
        assert.ok(Date.now() - startedAt < 7000, `${scenario.mode} HTTP bodies must not delay the conflict diagnostic`);
      }
      assert.doesNotMatch(output.output, new RegExp(scenario.notExpected));
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
    }
  } finally {
    for (const child of supervisors) if (child.exitCode === null) child.stdin.write("\r\n");
    await Promise.all(supervisors.map(async (child) => {
      if (child.exitCode !== null) return;
      const exited = Promise.race([
        once(child, "close").then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500))
      ]);
      if (!(await exited) && child.exitCode === null) child.kill();
    }));
    await new Promise<void>((resolve) => bridge.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("simultaneous tunnel startups choose one winner and a reconnect cannot displace it", { timeout: 20_000 }, async (t) => {
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
  const callsPath = join(spacedDirectory, "ssh calls.txt");
  const dropSignal = join(spacedDirectory, "drop-first-connection");
  const mockSshPath = join(spacedDirectory, "mock ssh.ps1");
  await writeFile(mockSshPath, `
param([string]$Session, [string]$LockPath, [string]$OwnerPath, [string]$CallsPath, [string]$DropSignal)
[System.IO.File]::AppendAllText($CallsPath, ("$Session|$PID" + [Environment]::NewLine))
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
  exit 255
}
while ($true) { Start-Sleep -Milliseconds 100 }
`, "utf8");

  const children: Array<{ child: ChildProcessWithoutNullStreams; output: ReturnType<typeof watchOutput> }> = [];
  const closeBridge = () => new Promise<void>((resolve) => bridge.close(() => resolve()));
  t.after(async () => {
    await closeBridge();
    for (const { child } of children) if (child.exitCode === null) child.stdin.write("\r\n");
    await Promise.all(children.map(({ child }) => child.exitCode !== null ? Promise.resolve() : once(child, "close").then(() => undefined)));
    await rm(directory, { recursive: true, force: true });
  });

  const overridesFor = (session: string) => Buffer.from(JSON.stringify([
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", mockSshPath, session, lockPath, ownerPath, callsPath, dropSignal
  ])).toString("base64");
  const launchSupervisor = (session: string) => {
    const child = spawn(powershell, [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
      "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
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
  const c = launchSupervisor("C");
  await waitForFile(lockPath);
  await waitForFileContent(ownerPath, "C");
  assert.equal((await readFile(ownerPath, "utf8")).trim(), "C");

  await conflictWinner.winner.output.waitFor(conflictMessage, 7000);
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
  assert.equal((await readFile(callsPath, "utf8")).trim().split(/\r?\n/).length, 4);
});

test("two reconnecting supervisors race for an atomic remote-port reservation", { timeout: 20_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell tunnel supervisor test");

  const bridge = createServer();
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address !== "string");

  const directory = await mkdtemp(join(tmpdir(), "decky-tunnel-reconnect-race-"));
  const lockPath = join(directory, "remote-port.lock");
  const ownerPath = join(directory, "remote-port-owner.txt");
  const callsPath = join(directory, "ssh-calls.txt");
  const availabilityPath = join(directory, "remote-available");
  const mockSshPath = join(directory, "mock-ssh.ps1");
  await writeFile(mockSshPath, `
param([string]$Session, [string]$LockPath, [string]$OwnerPath, [string]$CallsPath, [string]$AvailabilityPath, [string]$Directory)
[System.IO.File]::AppendAllText($CallsPath, ("$Session|$PID" + [Environment]::NewLine))
if (-not (Test-Path -LiteralPath $AvailabilityPath)) {
  Set-Content -LiteralPath (Join-Path $Directory "$Session-transient") -Value 'transient'
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
    for (const { child } of children) if (child.exitCode === null) child.stdin.write("\r\n");
    await Promise.all(children.map(({ child }) => child.exitCode !== null ? Promise.resolve() : once(child, "close").then(() => undefined)));
    await rm(directory, { recursive: true, force: true });
  });

  const overridesFor = (session: string) => Buffer.from(JSON.stringify([
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", mockSshPath,
    session, lockPath, ownerPath, callsPath, availabilityPath, directory
  ])).toString("base64");
  const launchSupervisor = (session: string) => {
    const child = spawn(powershell, [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tunnelScript,
      "-DeckUser", "deck", "-DeckHost", "steamdeck.test", "-BridgePort", String(address.port),
      "-SshExecutable", powershell, "-SshArgumentsOverrideBase64", overridesFor(session)
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const output = watchOutput(child);
    const entry = { child, output };
    children.push(entry);
    return entry;
  };

  const a = launchSupervisor("A");
  const b = launchSupervisor("B");
  await Promise.all([waitForFile(join(directory, "A-transient")), waitForFile(join(directory, "B-transient"))]);
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

  const calls = (await readFile(callsPath, "utf8")).trim().split(/\r?\n/);
  assert.ok(calls.filter((call) => call.startsWith(`${winningSession}|`)).length >= 2, "winner retried after a transient failure");
  assert.ok(calls.filter((call) => call.startsWith(`${losingSession}|`)).length >= 2, "loser retried after a transient failure");
  conflictLoser.child.stdin.write("\r\n");
  const [loserExitCode] = await once(conflictLoser.child, "close");
  assert.equal(loserExitCode, 1);
  assert.equal(winner.child.exitCode, null, "the losing reconnect did not displace or stop the winner");
  assert.equal((await readFile(ownerPath, "utf8")).trim(), winningSession);
});
