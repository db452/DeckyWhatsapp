function ConvertTo-WindowsCommandLineArgument([string] $Argument) {
    if ($null -eq $Argument) { $Argument = '' }

    $builder = New-Object System.Text.StringBuilder
    [void] $builder.Append('"')
    $slashes = 0
    foreach ($character in $Argument.ToCharArray()) {
        if ($character -eq '\') {
            $slashes++
            continue
        }
        if ($character -eq '"') {
            [void] $builder.Append(('\' * (($slashes * 2) + 1)))
            [void] $builder.Append('"')
            $slashes = 0
            continue
        }
        if ($slashes -gt 0) {
            [void] $builder.Append(('\' * $slashes))
            $slashes = 0
        }
        [void] $builder.Append($character)
    }
    if ($slashes -gt 0) { [void] $builder.Append(('\' * ($slashes * 2))) }
    [void] $builder.Append('"')
    return $builder.ToString()
}

if (-not ('DeckyWhatsapp.BoundedProcessRunner' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Threading;

namespace DeckyWhatsapp {
    public sealed class BoundedProcessResult {
        public int ExitCode { get; set; }
        public string[] StdOut { get; set; }
    }

    public sealed class BoundedProcessRunner {
        public static BoundedProcessResult Run(string file, string arguments, int timeoutSeconds, string description, string partialPath, bool inheritOutput) {
            var startInfo = new ProcessStartInfo {
                FileName = file,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = !inheritOutput,
                RedirectStandardOutput = !inheritOutput,
                RedirectStandardError = !inheritOutput
            };
            var output = new List<string>();
            var outputLock = new object();
            using (var outputClosed = new ManualResetEvent(false))
            using (var errorClosed = new ManualResetEvent(false))
            using (var process = new Process { StartInfo = startInfo }) {
                if (!inheritOutput) {
                    process.OutputDataReceived += (sender, eventArgs) => {
                        if (eventArgs.Data == null) {
                            outputClosed.Set();
                            return;
                        }
                        lock (outputLock) output.Add(eventArgs.Data);
                        Console.Out.WriteLine(eventArgs.Data);
                    };
                    process.ErrorDataReceived += (sender, eventArgs) => {
                        if (eventArgs.Data == null) errorClosed.Set();
                        else Console.Error.WriteLine(eventArgs.Data);
                    };
                }
                if (!process.Start()) throw new InvalidOperationException(description + " could not start " + file + ".");
                if (!inheritOutput) {
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                }
                if (!process.WaitForExit(timeoutSeconds * 1000)) {
                    int ownedPid = process.Id;
                    Console.Out.WriteLine(description + " exceeded its " + timeoutSeconds + "-second wall-clock limit; stopping its owned SSH/SCP client (PID " + ownedPid + ").");
                    try { process.Kill(); }
                    catch {
                        if (!process.HasExited) throw new TimeoutException(description + " timed out and its owned client PID " + ownedPid + " could not be terminated.");
                    }
                    // A child SSH process may inherit the redirected pipes. Cancel
                    // asynchronous reads and keep this cleanup bounded after killing
                    // the owned client instead of waiting indefinitely for pipe EOF.
                    if (!inheritOutput) {
                        try { process.CancelOutputRead(); }
                        catch { }
                        try { process.CancelErrorRead(); }
                        catch { }
                    }
                    bool clientStopped = false;
                    try { clientStopped = process.WaitForExit(5000); }
                    catch { }
                    string suffix = String.IsNullOrEmpty(partialPath) ? String.Empty : " The remote staging path may be partial: " + partialPath + ". Stop before retrying or deploying.";
                    string cleanup = clientStopped
                        ? "The client was stopped (PID " + ownedPid + ")."
                        : "Termination was requested for the client (PID " + ownedPid + "), but exit was not confirmed.";
                    throw new TimeoutException(description + " timed out after " + timeoutSeconds + " seconds. " + cleanup + suffix);
                }
                // WaitForExit(timeout) confirms the client exited but does not wait
                // for redirected output callbacks. Bound that drain too: an SSH
                // child can keep inherited pipes open after SCP has exited.
                if (!inheritOutput) {
                    var drainTimer = Stopwatch.StartNew();
                    bool outputDrained = outputClosed.WaitOne(5000);
                    int remainingDrainMilliseconds = Math.Max(0, 5000 - (int)drainTimer.ElapsedMilliseconds);
                    bool errorDrained = outputDrained && errorClosed.WaitOne(remainingDrainMilliseconds);
                    if (!outputDrained || !errorDrained) {
                        try { process.CancelOutputRead(); }
                        catch { }
                        try { process.CancelErrorRead(); }
                        catch { }
                        Console.Out.WriteLine(description + " exited, but a redirected output pipe stayed open after 5 seconds; continuing with captured output. Later hash checks must still pass before installation.");
                    }
                }
                if (process.ExitCode != 0) throw new InvalidOperationException(description + " failed with exit code " + process.ExitCode + ".");
                lock (outputLock) return new BoundedProcessResult { ExitCode = process.ExitCode, StdOut = output.ToArray() };
            }
        }
    }
}
'@
}

function Invoke-BoundedProcess(
    [string] $File,
    [string[]] $Arguments,
    [string] $Description,
    [int] $TimeoutSeconds,
    [string] $PossiblePartialPath,
    [bool] $InheritOutput = $false
) {
    if ($TimeoutSeconds -lt 1) { throw 'Process timeout must be at least one second.' }
    Write-Host "$Description..."

    $commandLine = (($Arguments | ForEach-Object { ConvertTo-WindowsCommandLineArgument $_ }) -join ' ')
    $result = [DeckyWhatsapp.BoundedProcessRunner]::Run($File, $commandLine, $TimeoutSeconds, $Description, $PossiblePartialPath, $InheritOutput)
    Write-Host "$Description complete."
    return $result
}
