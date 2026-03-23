using System.Net;

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
