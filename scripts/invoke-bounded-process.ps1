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
        public static BoundedProcessResult Run(string file, string arguments, int timeoutSeconds, string description, string partialPath) {
            var startInfo = new ProcessStartInfo {
                FileName = file,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            var output = new List<string>();
            var outputLock = new object();
            using (var process = new Process { StartInfo = startInfo }) {
                process.OutputDataReceived += (sender, eventArgs) => {
                    if (eventArgs.Data == null) return;
                    lock (outputLock) output.Add(eventArgs.Data);
                    Console.Out.WriteLine(eventArgs.Data);
                };
                process.ErrorDataReceived += (sender, eventArgs) => {
                    if (eventArgs.Data != null) Console.Error.WriteLine(eventArgs.Data);
                };
                if (!process.Start()) throw new InvalidOperationException(description + " could not start " + file + ".");
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(timeoutSeconds * 1000)) {
                    int ownedPid = process.Id;
                    Console.Out.WriteLine(description + " exceeded its " + timeoutSeconds + "-second wall-clock limit; terminating only its SSH/SCP client process (PID " + ownedPid + ").");
                    try { process.Kill(); }
                    catch {
                        if (!process.HasExited) throw new TimeoutException(description + " timed out and its owned client PID " + ownedPid + " could not be terminated.");
                    }
                    process.WaitForExit();
                    string suffix = String.IsNullOrEmpty(partialPath) ? String.Empty : " The remote staging path may be partial: " + partialPath + ". Stop before retrying or deploying.";
                    throw new TimeoutException(description + " timed out after " + timeoutSeconds + " seconds. The client was stopped (PID " + ownedPid + ")." + suffix);
                }
                process.WaitForExit();
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
    [string] $PossiblePartialPath
) {
    if ($TimeoutSeconds -lt 1) { throw 'Process timeout must be at least one second.' }
    Write-Host "$Description..."

    $commandLine = (($Arguments | ForEach-Object { ConvertTo-WindowsCommandLineArgument $_ }) -join ' ')
    $result = [DeckyWhatsapp.BoundedProcessRunner]::Run($File, $commandLine, $TimeoutSeconds, $Description, $PossiblePartialPath)
    Write-Host "$Description complete."
    return $result
}
