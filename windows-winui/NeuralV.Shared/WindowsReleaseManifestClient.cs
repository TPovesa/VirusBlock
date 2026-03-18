using System.Net.Http.Headers;
using System.Text.Json;

namespace NeuralV.Windows.Services;

public sealed class WindowsReleaseInfo
{
    public string Version { get; init; } = string.Empty;
    public string PortableUrl { get; init; } = string.Empty;
    public string SetupUrl { get; init; } = string.Empty;
    public string CliBinaryName { get; init; } = InstallLayout.CliBinaryName;
    public string GuiBinaryName { get; init; } = InstallLayout.GuiBinaryName;
    public string LauncherBinaryName { get; init; } = InstallLayout.LauncherBinaryName;
    public string UpdaterBinaryName { get; init; } = InstallLayout.UpdaterBinaryName;
    public string UpdaterHostBinaryName { get; init; } = InstallLayout.UpdaterHostBinaryName;

    public bool IsNewerThan(string currentVersion)
    {
        if (!System.Version.TryParse(NormalizeSemVer(Version), out var latest))
        {
            return false;
        }
        if (!System.Version.TryParse(NormalizeSemVer(currentVersion), out var current))
        {
            return true;
        }
        return latest > current;
    }

    private static string NormalizeSemVer(string value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.Count(ch => ch == '.') == 1 ? trimmed + ".0" : trimmed;
    }
}

public static class WindowsReleaseManifestClient
{
    private static readonly HttpClient HttpClient = BuildClient();

    public static async Task<WindowsReleaseInfo?> FetchAsync(CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "api/releases/manifest?platform=windows");
        using var response = await HttpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"manifest http {(int)response.StatusCode}");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var metadata = root.TryGetProperty("metadata", out var metaNode) && metaNode.ValueKind == JsonValueKind.Object
            ? metaNode
            : default;

        return new WindowsReleaseInfo
        {
            Version = ReadString(root, "version"),
            PortableUrl = ReadString(root, "portableUrl") is { Length: > 0 } p ? p : ReadString(root, "download_url"),
            SetupUrl = ReadString(root, "setupUrl") is { Length: > 0 } s ? s : ReadString(metadata, "setupUrl"),
            CliBinaryName = ReadString(metadata, "cliBinaryName") is { Length: > 0 } cli ? cli : InstallLayout.CliBinaryName,
            GuiBinaryName = ReadString(metadata, "guiBinaryName") is { Length: > 0 } gui ? gui : InstallLayout.GuiBinaryName,
            LauncherBinaryName = ReadString(metadata, "launcherBinaryName") is { Length: > 0 } launcher ? launcher : InstallLayout.LauncherBinaryName,
            UpdaterBinaryName = ReadString(metadata, "updaterBinaryName") is { Length: > 0 } updater ? updater : InstallLayout.UpdaterBinaryName,
            UpdaterHostBinaryName = ReadString(metadata, "updaterHostBinaryName") is { Length: > 0 } updaterHost ? updaterHost : InstallLayout.UpdaterHostBinaryName
        };
    }

    private static HttpClient BuildClient()
    {
        var client = new HttpClient
        {
            BaseAddress = new Uri("https://sosiskibot.ru/basedata/"),
            Timeout = TimeSpan.FromSeconds(45)
        };
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return client;
    }

    private static string ReadString(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(propertyName, out var node))
        {
            return string.Empty;
        }
        return node.ValueKind == JsonValueKind.String ? node.GetString()?.Trim() ?? string.Empty : string.Empty;
    }
}
