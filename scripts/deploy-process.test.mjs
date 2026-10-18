import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const powershell = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  : null;
const helper = fileURLToPath(new URL("./invoke-bounded-process.ps1", import.meta.url));

function runPowerShell(scriptPath, timeout = 20_000) {
  return spawnSync(
    powershell,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { encoding: "utf8", timeout, windowsHide: true },
  );
}

function withFixture(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), "decky-bounded-process-"));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeHarness(root, childBody, timeoutSeconds = 5) {
  const child = path.join(root, "child process with spaces.ps1");
  const harness = path.join(root, "invoke helper.ps1");
  writeFileSync(child, childBody, "utf8");
  writeFileSync(
    harness,
    [
      `. '${helper.replaceAll("'", "''")}'`,
      "$ErrorActionPreference = 'Stop'",
      "try {",
      `  $result = Invoke-BoundedProcess '${powershell.replaceAll("'", "''")}' @('-NoProfile', '-NonInteractive', '-File', '${child.replaceAll("'", "''")}') 'Stub operation' ${timeoutSeconds} 'remote-stage-fixture'`,
      "  Write-Output ('RESULT_EXIT=' + $result.ExitCode)",
      "  Write-Output ('RESULT_STDOUT=' + ($result.StdOut -join '|'))",
      "} catch {",
      "  [Console]::Error.WriteLine($_.Exception.Message)",
      "  exit 9",
      "}",
    ].join("\r\n"),
    "utf8",
  );
  return harness;
}

test("bounded command returns captured output and success exit code", { skip: !powershell }, () => {
  withFixture((root) => {
    const harness = writeHarness(root, "Write-Output 'child output with spaces'\nexit 0");
    const result = runPowerShell(harness);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /child output with spaces/);
    assert.match(result.stdout, /RESULT_EXIT=0/);
    assert.match(result.stdout, /RESULT_STDOUT=child output with spaces/);
  });
});

test("bounded command reports a nonzero child exit code", { skip: !powershell }, () => {
  withFixture((root) => {
    const harness = writeHarness(root, "Write-Output 'before failure'\nexit 7");
    const result = runPowerShell(harness);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 9);
    assert.match(`${result.stdout}\n${result.stderr}`, /failed with exit code 7/);
    assert.match(result.stdout, /before failure/);
  });
});

test("timeout kills only the owned child and reports the possible staging path", { skip: !powershell }, () => {
  withFixture((root) => {
    const pidFile = path.join(root, "child pid.txt");
    const escapedPidFile = pidFile.replaceAll("'", "''");
    const child = `[IO.File]::WriteAllText('${escapedPidFile}', [string]$PID)\nStart-Sleep -Seconds 30`;
    const harness = writeHarness(root, child, 1);
    const result = runPowerShell(harness, 20_000);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 9, `${result.stdout}\n${result.stderr}`);
    const pid = Number(readFileSync(pidFile, "utf8"));
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(`PID ${pid}`));
    assert.match(`${result.stdout}\n${result.stderr}`, /remote-stage-fixture/);

    const pidCheck = spawnSync(
      powershell,
      ["-NoProfile", "-NonInteractive", "-Command", `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }`],
      { encoding: "utf8", timeout: 10_000, windowsHide: true },
    );
    assert.equal(pidCheck.error, undefined, pidCheck.error?.message);
    assert.equal(pidCheck.status, 0, `owned child PID ${pid} remained alive`);
  });
});
