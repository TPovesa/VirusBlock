using System.Diagnostics;
using System.Text;
using Microsoft.Win32;

namespace NeuralV.Windows.Services;

public static class InstallStateStore
{

    public static InstallState CreateDefault(string? installRoot = null, string? version = null)
    {
        return new InstallState
        {
            InstallRoot = InstallLayout.NormalizeInstallRoot(installRoot ?? InstallLayout.DefaultInstallRoot()),
            Version = string.IsNullOrWhiteSpace(version) ? string.Empty : version.Trim(),
            UpdatedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
    }

    public static InstallState? ResolveExistingInstall(string? executablePath = null)
    {
        foreach (var candidate in EnumerateCandidateInstallRoots(executablePath))
        {
            var state = LoadFromRoot(candidate);
            if (state is not null)
            {
                return state;
            }
        }
        return null;
    }

    public static IEnumerable<string> EnumerateCandidateInstallRoots(string? executablePath = null)
    {
        var candidates = new List<string>();
        AddCandidate(candidates, ReadRegistryInstallRoot());

        if (!string.IsNullOrWhiteSpace(executablePath))
        {
            AddCandidate(candidates, InstallLayout.ResolveInstallRootFromExecutablePath(executablePath));
        }

        if (!string.IsNullOrWhiteSpace(Environment.ProcessPath))
        {
            AddCandidate(candidates, InstallLayout.ResolveInstallRootFromExecutablePath(Environment.ProcessPath));
        }

        if (!string.IsNullOrWhiteSpace(AppContext.BaseDirectory))
        {
            AddCandidate(candidates, InstallLayout.ResolveInstallRootFromExecutablePath(AppContext.BaseDirectory));
        }

        AddCandidate(candidates, ResolveInstallRootFromShortcuts());
        AddCandidate(candidates, InstallLayout.DefaultInstallRoot());
        return candidates;
    }

    public static InstallState? LoadFromRoot(string? installRoot)
    {
        if (string.IsNullOrWhiteSpace(installRoot))
        {
            return null;
        }

        var normalizedRoot = InstallLayout.NormalizeInstallRoot(installRoot);
        var metadataPath = InstallLayout.MetadataPath(normalizedRoot);
        if (!File.Exists(metadataPath))
        {
            if (!BundleLooksInstalled(normalizedRoot))
            {
                return null;
            }
            return CreateDefault(normalizedRoot, ReadRegistryVersion());
        }

        try
        {
            var payload = File.ReadAllText(metadataPath, Encoding.UTF8);
            var state = InstallStateJsonContext.Deserialize(payload);
            if (state is null)
            {
                return null;
            }
            state.InstallRoot = normalizedRoot;
            if (string.IsNullOrWhiteSpace(state.LauncherBinary)) state.LauncherBinary = InstallLayout.LauncherBinaryName;
            if (string.IsNullOrWhiteSpace(state.GuiBinary)) state.GuiBinary = InstallLayout.GuiBinaryName;
            if (string.IsNullOrWhiteSpace(state.CliBinary)) state.CliBinary = InstallLayout.CliBinaryName;
            if (string.IsNullOrWhiteSpace(state.UpdaterBinary)) state.UpdaterBinary = InstallLayout.UpdaterBinaryName;
            if (string.IsNullOrWhiteSpace(state.UpdaterHostBinary)) state.UpdaterHostBinary = InstallLayout.UpdaterHostBinaryName;
            if (state.ProtocolSchemes is null || state.ProtocolSchemes.Length == 0) state.ProtocolSchemes = InstallLayout.UriSchemes.ToArray();
            if (string.IsNullOrWhiteSpace(state.ProtocolHandlerBinary)) state.ProtocolHandlerBinary = InstallLayout.LauncherBinaryName;
            return state;
        }
        catch (Exception ex)
        {
            WindowsLog.Error($"Install metadata read failed: {metadataPath}", ex);
            return null;
        }
    }

    public static void Save(InstallState state)
    {
        state.InstallRoot = InstallLayout.NormalizeInstallRoot(state.InstallRoot);
        state.ProtocolSchemes = state.ProtocolSchemes is { Length: > 0 } ? WindowsProtocolRegistration.NormalizeSchemes(state.ProtocolSchemes) : InstallLayout.UriSchemes.ToArray();
        if (string.IsNullOrWhiteSpace(state.ProtocolHandlerBinary))
        {
            state.ProtocolHandlerBinary = string.IsNullOrWhiteSpace(state.LauncherBinary)
                ? InstallLayout.LauncherBinaryName
                : state.LauncherBinary;
        }
        state.UpdatedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        Directory.CreateDirectory(InstallLayout.LibsDirectory(state.InstallRoot));
        var metadataPath = InstallLayout.MetadataPath(state.InstallRoot);
        var payload = InstallStateJsonContext.Serialize(state);
        File.WriteAllText(metadataPath, payload, Encoding.UTF8);

        using var key = Registry.CurrentUser.CreateSubKey(InstallLayout.RegistryKeyPath);
        key?.SetValue(InstallLayout.RegistryInstallRootValue, state.InstallRoot, RegistryValueKind.String);
        key?.SetValue(InstallLayout.RegistryVersionValue, state.Version ?? string.Empty, RegistryValueKind.String);
        key?.SetValue(InstallLayout.RegistryAutoStartValue, state.AutoStartEnabled ? 1 : 0, RegistryValueKind.DWord);
        key?.SetValue(InstallLayout.RegistryProtocolHandlerValue, Path.Combine(state.InstallRoot, state.ProtocolHandlerBinary), RegistryValueKind.String);
        key?.SetValue(InstallLayout.RegistryProtocolSchemesValue, WindowsProtocolRegistration.SerializeSchemes(state.ProtocolSchemes), RegistryValueKind.String);
    }

    public static void UpdateAutoStartPreference(bool enabled, string? executablePath = null)
    {
        var state = ResolveExistingInstall(executablePath) ?? CreateDefault();
        state.AutoStartEnabled = enabled;
        Save(state);
    }

    public static void ClearRegistry()
    {
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree(InstallLayout.RegistryKeyPath, false);
        }
        catch
        {
        }
    }

    public static bool BundleLooksInstalled(string? installRoot)
    {
        if (string.IsNullOrWhiteSpace(installRoot))
        {
            return false;
        }

        var hasPublicEntry = File.Exists(InstallLayout.LauncherPath(installRoot))
            || File.Exists(InstallLayout.CliPath(installRoot))
            || File.Exists(InstallLayout.UpdaterPath(installRoot));
        var hasPayload = File.Exists(InstallLayout.GuiPath(installRoot))
            || File.Exists(InstallLayout.UpdaterHostPath(installRoot));
        return hasPublicEntry && hasPayload;
    }

    public static string NormalizeInstallRoot(string installRoot) => InstallLayout.NormalizeInstallRoot(installRoot);

    private static void AddCandidate(ICollection<string> items, string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return;
        }
        var normalized = InstallLayout.NormalizeInstallRoot(candidate);
        if (items.Contains(normalized, StringComparer.OrdinalIgnoreCase))
        {
            return;
        }
        items.Add(normalized);
    }

    private static string? ReadRegistryInstallRoot()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(InstallLayout.RegistryKeyPath);
            return key?.GetValue(InstallLayout.RegistryInstallRootValue) as string;
        }
        catch
        {
            return null;
        }
    }

    private static string ReadRegistryVersion()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(InstallLayout.RegistryKeyPath);
            return (key?.GetValue(InstallLayout.RegistryVersionValue) as string ?? string.Empty).Trim();
        }
        catch
        {
            return string.Empty;
        }
    }

    private static string? ResolveInstallRootFromShortcuts()
    {
        foreach (var shortcutPath in new[] { InstallLayout.StartMenuShortcutPath(), InstallLayout.DesktopShortcutPath() })
        {
            var target = ResolveShortcutTarget(shortcutPath);
            if (string.IsNullOrWhiteSpace(target) || !File.Exists(target))
            {
                continue;
            }
            return InstallLayout.ResolveInstallRootFromExecutablePath(target);
        }
        return null;
    }

    private static string? ResolveShortcutTarget(string shortcutPath)
    {
        if (!File.Exists(shortcutPath))
        {
            return null;
        }

        try
        {
            var script = string.Join(Environment.NewLine, new[]
            {
                "$shell = New-Object -ComObject WScript.Shell",
                $"$shortcut = $shell.CreateShortcut('{EscapePowerShell(shortcutPath)}')",
                "if ($shortcut.TargetPath) { Write-Output $shortcut.TargetPath }"
            });
            var startInfo = new ProcessStartInfo("powershell", $"-NoProfile -ExecutionPolicy Bypass -Command \"{script.Replace("\"", "\\\"")}\"")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var process = Process.Start(startInfo);
            if (process is null)
            {
                return null;
            }
            var output = process.StandardOutput.ReadToEnd().Trim();
            process.WaitForExit(5000);
            return string.IsNullOrWhiteSpace(output) ? null : output;
        }
        catch
        {
            return null;
        }
    }

    private static string EscapePowerShell(string value) => value.Replace("'", "''");
}
