using Microsoft.Win32;

namespace NeuralV.Windows.Services;

public static class WindowsProtocolRegistration
{
    public static void EnsureHandlers(InstallState installState)
    {
        if (installState is null)
        {
            throw new ArgumentNullException(nameof(installState));
        }

        var installRoot = InstallLayout.NormalizeInstallRoot(installState.InstallRoot);
        var handlerBinary = string.IsNullOrWhiteSpace(installState.ProtocolHandlerBinary)
            ? installState.LauncherBinary
            : installState.ProtocolHandlerBinary;
        if (string.IsNullOrWhiteSpace(handlerBinary))
        {
            handlerBinary = InstallLayout.LauncherBinaryName;
        }

        var handlerPath = Path.Combine(installRoot, handlerBinary);
        if (!File.Exists(handlerPath))
        {
            throw new FileNotFoundException("Launcher binary missing for protocol handler registration.", handlerPath);
        }

        var schemes = NormalizeSchemes(installState.ProtocolSchemes);
        var commandValue = BuildCommandValue(handlerPath);

        foreach (var scheme in schemes)
        {
            using var root = Registry.CurrentUser.CreateSubKey(InstallLayout.UriSchemeRegistryKeyPath(scheme));
            root?.SetValue(string.Empty, $"URL:{InstallLayout.ProductName} Protocol", RegistryValueKind.String);
            root?.SetValue("URL Protocol", string.Empty, RegistryValueKind.String);
            root?.SetValue("FriendlyTypeName", $"{InstallLayout.ProductName} Link", RegistryValueKind.String);

            using var defaultIcon = root?.CreateSubKey("DefaultIcon");
            defaultIcon?.SetValue(string.Empty, $"{handlerPath},0", RegistryValueKind.String);

            using var command = root?.CreateSubKey(@"shell\open\command");
            command?.SetValue(string.Empty, commandValue, RegistryValueKind.String);
        }
    }

    public static void RemoveHandlers()
    {
        foreach (var scheme in InstallLayout.UriSchemes)
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(InstallLayout.UriSchemeRegistryKeyPath(scheme), false);
            }
            catch
            {
            }
        }
    }

    public static string BuildCommandValue(string launcherPath)
    {
        return $"\"{launcherPath}\" \"%1\"";
    }

    public static string SerializeSchemes(IEnumerable<string>? schemes)
    {
        return string.Join(",", NormalizeSchemes(schemes));
    }

    public static string[] NormalizeSchemes(IEnumerable<string>? schemes)
    {
        var normalized = (schemes ?? InstallLayout.UriSchemes)
            .Select(static scheme => scheme?.Trim().ToLowerInvariant() ?? string.Empty)
            .Where(static scheme => !string.IsNullOrWhiteSpace(scheme))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        return normalized.Length == 0 ? InstallLayout.UriSchemes.ToArray() : normalized;
    }
}
