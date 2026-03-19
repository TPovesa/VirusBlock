using System.Net;
using System.Text.Json;

namespace NeuralV.Windows.Services;

public sealed class ResetPasswordDeepLink
{
    public string RawUri { get; init; } = string.Empty;
    public string Scheme { get; init; } = string.Empty;
    public string Token { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public DateTimeOffset ReceivedAt { get; init; } = DateTimeOffset.UtcNow;
}

public static class WindowsDeepLinkActivationService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private static readonly object SyncRoot = new();

    static WindowsDeepLinkActivationService()
    {
        PendingResetPasswordDeepLink = LoadPendingResetPasswordDeepLink();
    }

    public static event Action<ResetPasswordDeepLink>? ResetPasswordDeepLinkReceived;

    public static string PendingResetPasswordPath => Path.Combine(SessionStore.AppDirectory, "pending-reset-password.json");

    public static ResetPasswordDeepLink? PendingResetPasswordDeepLink { get; private set; }

    public static ResetPasswordDeepLink? CaptureStartupArguments(IEnumerable<string> launchArguments) =>
        CaptureArguments(launchArguments, "startup");

    public static ResetPasswordDeepLink? CaptureForwardedArguments(IEnumerable<string> launchArguments) =>
        CaptureArguments(launchArguments, "forwarded");

    public static ResetPasswordDeepLink? PeekPendingResetPasswordDeepLink()
    {
        lock (SyncRoot)
        {
            PendingResetPasswordDeepLink ??= LoadPendingResetPasswordDeepLink();
            return PendingResetPasswordDeepLink;
        }
    }

    public static ResetPasswordDeepLink? ConsumePendingResetPasswordDeepLink()
    {
        lock (SyncRoot)
        {
            PendingResetPasswordDeepLink ??= LoadPendingResetPasswordDeepLink();
            var current = PendingResetPasswordDeepLink;
            PendingResetPasswordDeepLink = null;

            try
            {
                if (File.Exists(PendingResetPasswordPath))
                {
                    File.Delete(PendingResetPasswordPath);
                }
            }
            catch (Exception ex)
            {
                WindowsLog.Error("Delete pending reset-password deeplink failed", ex);
            }

            return current;
        }
    }

    public static ResetPasswordDeepLink? TryParseResetPasswordDeepLink(string rawUri)
    {
        var trimmed = (rawUri ?? string.Empty).Trim().Trim('"');
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return null;
        }

        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri))
        {
            return null;
        }

        var scheme = uri.Scheme?.Trim().ToLowerInvariant() ?? string.Empty;
        if (!InstallLayout.UriSchemes.Contains(scheme, StringComparer.OrdinalIgnoreCase))
        {
            return null;
        }

        var host = uri.Host?.Trim().ToLowerInvariant() ?? string.Empty;
        var path = uri.AbsolutePath.Trim('/');
        if (!string.Equals(host, "auth", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(path, "reset-password", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var parameters = ParseQuery(uri.Query);
        var token = parameters.TryGetValue("token", out var tokenValue) ? tokenValue : string.Empty;
        var email = parameters.TryGetValue("email", out var emailValue) ? emailValue : string.Empty;
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(email))
        {
            return null;
        }

        return new ResetPasswordDeepLink
        {
            RawUri = trimmed,
            Scheme = scheme,
            Token = token,
            Email = email,
            ReceivedAt = DateTimeOffset.UtcNow
        };
    }

    private static ResetPasswordDeepLink? CaptureArguments(IEnumerable<string> launchArguments, string source)
    {
        foreach (var argument in launchArguments ?? Array.Empty<string>())
        {
            var deepLink = TryParseResetPasswordDeepLink(argument);
            if (deepLink is null)
            {
                continue;
            }

            PersistPendingResetPasswordDeepLink(deepLink);
            WindowsLog.Info($"Reset-password deeplink captured via {source} ({deepLink.Scheme}://auth/reset-password)");
            ResetPasswordDeepLinkReceived?.Invoke(deepLink);
            return deepLink;
        }

        return null;
    }

    private static void PersistPendingResetPasswordDeepLink(ResetPasswordDeepLink deepLink)
    {
        lock (SyncRoot)
        {
            PendingResetPasswordDeepLink = deepLink;
            try
            {
                Directory.CreateDirectory(SessionStore.AppDirectory);
                var payload = JsonSerializer.Serialize(deepLink, JsonOptions);
                File.WriteAllText(PendingResetPasswordPath, payload);
            }
            catch (Exception ex)
            {
                WindowsLog.Error("Persist pending reset-password deeplink failed", ex);
            }
        }
    }

    private static ResetPasswordDeepLink? LoadPendingResetPasswordDeepLink()
    {
        try
        {
            if (!File.Exists(PendingResetPasswordPath))
            {
                return null;
            }

            var payload = File.ReadAllText(PendingResetPasswordPath);
            return JsonSerializer.Deserialize<ResetPasswordDeepLink>(payload, JsonOptions);
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Load pending reset-password deeplink failed", ex);
            return null;
        }
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(query))
        {
            return values;
        }

        foreach (var chunk in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = chunk.Split('=', 2);
            var key = WebUtility.UrlDecode(parts[0])?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(key))
            {
                continue;
            }

            values[key] = parts.Length > 1 ? WebUtility.UrlDecode(parts[1])?.Trim() ?? string.Empty : string.Empty;
        }

        return values;
    }
}
