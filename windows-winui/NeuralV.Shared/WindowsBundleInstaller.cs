using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using Microsoft.Win32;

namespace NeuralV.Windows.Services;

public sealed class PreparedWindowsBundle : IDisposable
{
    public string WorkingDirectory { get; init; } = string.Empty;
    public string StageRoot { get; init; } = string.Empty;
    public string PayloadRoot { get; init; } = string.Empty;

    public void Dispose()
    {
        TryDelete(WorkingDirectory);
    }

    private static void TryDelete(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, true);
            }
        }
        catch
        {
        }
    }
}

public static class WindowsBundleInstaller
{
    public static async Task<PreparedWindowsBundle> PrepareBundleAsync(string portableUrl, string installRoot, string version, bool autoStartEnabled, CancellationToken cancellationToken = default)
    {
        var normalizedInstallRoot = InstallLayout.NormalizeInstallRoot(installRoot);
        var parentDir = Path.GetDirectoryName(normalizedInstallRoot) ?? AppContext.BaseDirectory;
        Directory.CreateDirectory(parentDir);

        var workingDirectory = Path.Combine(Path.GetTempPath(), $"neuralv-bundle-{Guid.NewGuid():N}");
        Directory.CreateDirectory(workingDirectory);

        var archivePath = Path.Combine(workingDirectory, "neuralv-windows.zip");
        var extractRoot = Path.Combine(workingDirectory, "extract");
        var stageRoot = Path.Combine(parentDir, $".NeuralV.stage-{Guid.NewGuid():N}");

        await DownloadFileAsync(portableUrl, archivePath, cancellationToken);
        ZipFile.ExtractToDirectory(archivePath, extractRoot, overwriteFiles: true);
        var payloadRoot = FindPayloadRoot(extractRoot);
        CopyDirectory(payloadRoot, stageRoot);

        var installState = InstallStateStore.CreateDefault(normalizedInstallRoot, version);
        installState.AutoStartEnabled = autoStartEnabled;
        WriteMetadataInto(stageRoot, installState);

        return new PreparedWindowsBundle
        {
            WorkingDirectory = workingDirectory,
            StageRoot = stageRoot,
            PayloadRoot = payloadRoot
        };
    }

    public static async Task InstallPreparedBundleAsync(PreparedWindowsBundle preparedBundle, InstallState installState, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var normalizedInstallRoot = InstallLayout.NormalizeInstallRoot(installState.InstallRoot);
        var backupRoot = normalizedInstallRoot + ".backup";

        if (Directory.Exists(backupRoot))
        {
            Directory.Delete(backupRoot, true);
        }

        if (Directory.Exists(normalizedInstallRoot))
        {
            Directory.Move(normalizedInstallRoot, backupRoot);
        }

        try
        {
            Directory.Move(preparedBundle.StageRoot, normalizedInstallRoot);
            TryRestoreLogFile(backupRoot, normalizedInstallRoot);
            InstallStateStore.Save(installState);
            EnsureShortcuts(installState);
            EnsureUserPath(normalizedInstallRoot);
            EnsureAutoStart(installState);
            TryDelete(backupRoot);
        }
        catch
        {
            if (!Directory.Exists(normalizedInstallRoot) && Directory.Exists(backupRoot))
            {
                Directory.Move(backupRoot, normalizedInstallRoot);
            }
            throw;
        }
    }

    public static async Task InstallFromReleaseAsync(WindowsReleaseInfo releaseInfo, InstallState installState, CancellationToken cancellationToken = default)
    {
        using var preparedBundle = await PrepareBundleAsync(releaseInfo.PortableUrl, installState.InstallRoot, releaseInfo.Version, installState.AutoStartEnabled, cancellationToken);
        installState.Version = releaseInfo.Version;
        installState.CliBinary = releaseInfo.CliBinaryName;
        installState.GuiBinary = releaseInfo.GuiBinaryName;
        installState.LauncherBinary = releaseInfo.LauncherBinaryName;
        installState.UpdaterBinary = releaseInfo.UpdaterBinaryName;
        installState.UpdaterHostBinary = releaseInfo.UpdaterHostBinaryName;
        await InstallPreparedBundleAsync(preparedBundle, installState, cancellationToken);
    }

    public static void Uninstall(InstallState installState)
    {
        TryDelete(installState.InstallRoot);
        RemoveShortcut(InstallLayout.StartMenuShortcutPath());
        RemoveShortcut(InstallLayout.DesktopShortcutPath());
        RemoveFromUserPath(installState.InstallRoot);
        DisableAutoStart();
        InstallStateStore.ClearRegistry();
    }

    public static void EnsureAutoStart(InstallState installState)
    {
        if (installState.AutoStartEnabled)
        {
            using var key = Registry.CurrentUser.CreateSubKey(InstallLayout.RunKeyPath);
            key?.SetValue(InstallLayout.RunValueName, Quote(InstallLayout.LauncherPath(installState.InstallRoot)), RegistryValueKind.String);
        }
        else
        {
            DisableAutoStart();
        }
    }

    public static void DisableAutoStart()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(InstallLayout.RunKeyPath, writable: true);
            key?.DeleteValue(InstallLayout.RunValueName, false);
        }
        catch
        {
        }
    }

    public static void EnsureShortcuts(InstallState installState)
    {
        var launcherPath = InstallLayout.LauncherPath(installState.InstallRoot);
        var workingDir = installState.InstallRoot;
        CreateShortcut(InstallLayout.StartMenuShortcutPath(), launcherPath, workingDir);
        CreateShortcut(InstallLayout.DesktopShortcutPath(), launcherPath, workingDir);
    }

    public static void EnsureUserPath(string installRoot)
    {
        var pathEntry = InstallLayout.BinDirectory(installRoot);
        var userPath = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? string.Empty;
        var parts = userPath
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();
        if (!parts.Contains(pathEntry, StringComparer.OrdinalIgnoreCase))
        {
            parts.Insert(0, pathEntry);
            Environment.SetEnvironmentVariable("Path", string.Join(Path.PathSeparator, parts), EnvironmentVariableTarget.User);
        }
    }

    public static void RemoveFromUserPath(string installRoot)
    {
        var pathEntry = InstallLayout.BinDirectory(installRoot);
        var userPath = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? string.Empty;
        var parts = userPath
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(item => !string.Equals(Path.GetFullPath(item), Path.GetFullPath(pathEntry), StringComparison.OrdinalIgnoreCase))
            .ToArray();
        Environment.SetEnvironmentVariable("Path", string.Join(Path.PathSeparator, parts), EnvironmentVariableTarget.User);
    }

    public static string BuildApplyUpdateScript(PreparedWindowsBundle preparedBundle, InstallState installState)
    {
        var installRoot = installState.InstallRoot;
        var backupRoot = installRoot + ".backup";
        var launcherPath = InstallLayout.LauncherPath(installRoot);
        var scriptPath = Path.Combine(preparedBundle.WorkingDirectory, "apply-update.cmd");
        var content = string.Join("\r\n", new[]
        {
            "@echo off",
            "setlocal",
            $"set \"INSTALL_ROOT={installRoot}\"",
            $"set \"STAGE_ROOT={preparedBundle.StageRoot}\"",
            $"set \"BACKUP_ROOT={backupRoot}\"",
            ":retry",
            "if exist \"%BACKUP_ROOT%\" rmdir /S /Q \"%BACKUP_ROOT%\" >nul 2>&1",
            "if exist \"%INSTALL_ROOT%\" move /Y \"%INSTALL_ROOT%\" \"%BACKUP_ROOT%\" >nul 2>&1",
            "move /Y \"%STAGE_ROOT%\" \"%INSTALL_ROOT%\" >nul 2>&1",
            "if errorlevel 1 (",
            "  timeout /t 1 /nobreak >nul",
            "  goto retry",
            ")",
            "if exist \"%BACKUP_ROOT%\\log.txt\" if not exist \"%INSTALL_ROOT%\\log.txt\" copy /Y \"%BACKUP_ROOT%\\log.txt\" \"%INSTALL_ROOT%\\log.txt\" >nul 2>&1",
            "if exist \"%BACKUP_ROOT%\" rmdir /S /Q \"%BACKUP_ROOT%\" >nul 2>&1",
            $"start \"\" \"{launcherPath}\"",
            "del /F /Q \"%~f0\" >nul 2>&1"
        });
        File.WriteAllText(scriptPath, content, Encoding.UTF8);
        return scriptPath;
    }

    private static async Task DownloadFileAsync(string url, string targetPath, CancellationToken cancellationToken)
    {
        using var httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        using var response = await httpClient.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var output = File.Create(targetPath);
        await input.CopyToAsync(output, cancellationToken);
    }

    private static string FindPayloadRoot(string extractRoot)
    {
        foreach (var directory in Directory.EnumerateDirectories(extractRoot, "*", SearchOption.AllDirectories).Prepend(extractRoot))
        {
            if (File.Exists(InstallLayout.GuiPath(directory)) || File.Exists(InstallLayout.LauncherPath(directory)) || File.Exists(InstallLayout.CliPath(directory)))
            {
                return directory;
            }
        }
        throw new InvalidOperationException("Не удалось найти корень Windows bundle после распаковки.");
    }

    private static void CopyDirectory(string sourceRoot, string targetRoot)
    {
        Directory.CreateDirectory(targetRoot);
        foreach (var directory in Directory.EnumerateDirectories(sourceRoot, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceRoot, directory);
            Directory.CreateDirectory(Path.Combine(targetRoot, relative));
        }
        foreach (var file in Directory.EnumerateFiles(sourceRoot, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceRoot, file);
            var target = Path.Combine(targetRoot, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, overwrite: true);
        }
    }

    private static void WriteMetadataInto(string stageRoot, InstallState installState)
    {
        var clone = new InstallState
        {
            InstallRoot = InstallLayout.NormalizeInstallRoot(installState.InstallRoot),
            Version = installState.Version,
            LauncherBinary = installState.LauncherBinary,
            GuiBinary = installState.GuiBinary,
            CliBinary = installState.CliBinary,
            UpdaterBinary = installState.UpdaterBinary,
            UpdaterHostBinary = installState.UpdaterHostBinary,
            AutoStartEnabled = installState.AutoStartEnabled,
            UpdatedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        Directory.CreateDirectory(InstallLayout.LibsDirectory(stageRoot));
        var payload = InstallStateJsonContext.Serialize(clone);
        File.WriteAllText(InstallLayout.MetadataPath(stageRoot), payload, Encoding.UTF8);
    }

    private static void TryRestoreLogFile(string backupRoot, string installRoot)
    {
        try
        {
            var previousLog = InstallLayout.LogPath(backupRoot);
            var currentLog = InstallLayout.LogPath(installRoot);
            if (File.Exists(previousLog) && !File.Exists(currentLog))
            {
                File.Copy(previousLog, currentLog, overwrite: false);
            }
        }
        catch
        {
        }
    }

    private static void CreateShortcut(string shortcutPath, string targetPath, string workingDirectory)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(shortcutPath)!);
        var script = string.Join(Environment.NewLine, new[]
        {
            "$shell = New-Object -ComObject WScript.Shell",
            $"$shortcut = $shell.CreateShortcut('{EscapePowerShell(shortcutPath)}')",
            $"$shortcut.TargetPath = '{EscapePowerShell(targetPath)}'",
            $"$shortcut.WorkingDirectory = '{EscapePowerShell(workingDirectory)}'",
            $"$shortcut.IconLocation = '{EscapePowerShell(targetPath)},0'",
            "$shortcut.Save()"
        });
        RunPowerShell(script);
    }

    private static void RemoveShortcut(string shortcutPath)
    {
        try
        {
            if (File.Exists(shortcutPath))
            {
                File.Delete(shortcutPath);
            }
        }
        catch
        {
        }
    }

    private static void RunPowerShell(string script)
    {
        var startInfo = new ProcessStartInfo("powershell", $"-NoProfile -ExecutionPolicy Bypass -Command \"{script.Replace("\"", "\\\"")}\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        using var process = Process.Start(startInfo);
        process?.WaitForExit(15000);
    }

    private static string EscapePowerShell(string value) => value.Replace("'", "''");
    private static string Quote(string value) => string.Concat('"', value, '"');

    private static void TryDelete(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, true);
            }
        }
        catch
        {
        }
    }
}
