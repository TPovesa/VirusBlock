using System.Text.Json.Serialization;

namespace NeuralV.Windows.Services;

public static class InstallLayout
{
    public const string ProductName = "NeuralV";
    public static readonly string[] UriSchemes = { "shieldsecurity", "neuralv" };
    public const long LaunchArgsCopyDataSignature = 0x4E564C41;
    public const string LauncherBinaryName = "NeuralV.exe";
    public const string GuiBinaryName = "NeuralV.Gui.exe";
    public const string CliBinaryName = "neuralv.exe";
    public const string UpdaterBinaryName = "neuralv-updater.exe";
    public const string UpdaterHostBinaryName = "neuralv-updater-host.exe";
    public const string MetadataFileName = "install.json";
    public const string LogFileName = "log.txt";
    public const string BinDirectoryName = "bin";
    public const string LibsDirectoryName = "libs";
    public const string RegistryKeyPath = @"Software\NeuralV";
    public const string RegistryInstallRootValue = "InstallRoot";
    public const string RegistryVersionValue = "Version";
    public const string RegistryAutoStartValue = "AutoStartEnabled";
    public const string RegistryProtocolHandlerValue = "ProtocolHandlerPath";
    public const string RegistryProtocolSchemesValue = "ProtocolSchemes";
    public const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public const string RunValueName = "NeuralV";

    public static string DefaultInstallRoot()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localAppData))
        {
            localAppData = ResolveInstallRootFromExecutablePath(AppContext.BaseDirectory);
        }
        return Path.Combine(localAppData, "Programs", ProductName);
    }

    public static string NormalizeInstallRoot(string installRoot) =>
        ResolveInstallRootFromExecutablePath(string.IsNullOrWhiteSpace(installRoot) ? DefaultInstallRoot() : installRoot.Trim());

    public static string ResolveInstallRootFromExecutablePath(string? executablePath)
    {
        if (string.IsNullOrWhiteSpace(executablePath))
        {
            return Path.GetFullPath(DefaultInstallRoot());
        }

        var fullPath = Path.GetFullPath(executablePath);
        var directory = Directory.Exists(fullPath)
            ? fullPath
            : Path.GetDirectoryName(fullPath) ?? AppContext.BaseDirectory;
        var trimmedDirectory = directory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var leaf = Path.GetFileName(trimmedDirectory);

        if (string.Equals(leaf, BinDirectoryName, StringComparison.OrdinalIgnoreCase)
            || string.Equals(leaf, LibsDirectoryName, StringComparison.OrdinalIgnoreCase))
        {
            var parent = Path.GetDirectoryName(trimmedDirectory);
            if (!string.IsNullOrWhiteSpace(parent))
            {
                return Path.GetFullPath(parent);
            }
        }

        return Path.GetFullPath(trimmedDirectory);
    }

    public static string BinDirectory(string installRoot) => Path.Combine(NormalizeInstallRoot(installRoot), BinDirectoryName);
    public static string LibsDirectory(string installRoot) => Path.Combine(NormalizeInstallRoot(installRoot), LibsDirectoryName);
    public static string MetadataPath(string installRoot) => Path.Combine(LibsDirectory(installRoot), MetadataFileName);
    public static string LogPath(string installRoot) => Path.Combine(NormalizeInstallRoot(installRoot), LogFileName);
    public static string LauncherPath(string installRoot) => Path.Combine(NormalizeInstallRoot(installRoot), LauncherBinaryName);
    public static string GuiPath(string installRoot) => Path.Combine(LibsDirectory(installRoot), GuiBinaryName);
    public static string CliPath(string installRoot) => Path.Combine(BinDirectory(installRoot), CliBinaryName);
    public static string UpdaterPath(string installRoot) => Path.Combine(BinDirectory(installRoot), UpdaterBinaryName);
    public static string UpdaterHostPath(string installRoot) => Path.Combine(LibsDirectory(installRoot), UpdaterHostBinaryName);

    public static string StartMenuShortcutPath()
    {
        var programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        return Path.Combine(programs, ProductName + ".lnk");
    }

    public static string DesktopShortcutPath()
    {
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        return Path.Combine(desktop, ProductName + ".lnk");
    }

    public static string UriSchemeRegistryKeyPath(string scheme) => $@"Software\Classes\{scheme.Trim().ToLowerInvariant()}";
}

public sealed class InstallState
{
    [JsonPropertyName("installRoot")]
    public string InstallRoot { get; set; } = InstallLayout.DefaultInstallRoot();

    [JsonPropertyName("version")]
    public string Version { get; set; } = string.Empty;

    [JsonPropertyName("launcherBinary")]
    public string LauncherBinary { get; set; } = InstallLayout.LauncherBinaryName;

    [JsonPropertyName("guiExecutable")]
    public string GuiBinary { get; set; } = InstallLayout.GuiBinaryName;

    [JsonPropertyName("cliExecutable")]
    public string CliBinary { get; set; } = InstallLayout.CliBinaryName;

    [JsonPropertyName("updaterExecutable")]
    public string UpdaterBinary { get; set; } = InstallLayout.UpdaterBinaryName;

    [JsonPropertyName("updaterHostExecutable")]
    public string UpdaterHostBinary { get; set; } = InstallLayout.UpdaterHostBinaryName;

    [JsonPropertyName("protocolSchemes")]
    public string[] ProtocolSchemes { get; set; } = { "shieldsecurity", "neuralv" };

    [JsonPropertyName("protocolHandlerExecutable")]
    public string ProtocolHandlerBinary { get; set; } = InstallLayout.LauncherBinaryName;

    [JsonPropertyName("autoStartEnabled")]
    public bool AutoStartEnabled { get; set; } = true;

    [JsonPropertyName("updatedAt")]
    public long UpdatedAtUnixMs { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
