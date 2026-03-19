using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using NeuralV.Windows.Models;

namespace NeuralV.Windows.Services;

public sealed class NeuralVApiClient : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly HttpClient _httpClient;

    public NeuralVApiClient()
    {
        _httpClient = new HttpClient
        {
            BaseAddress = new Uri("https://sosiskibot.ru/basedata/"),
            Timeout = TimeSpan.FromSeconds(120)
        };
        _httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    public void Dispose() => _httpClient.Dispose();

    public async Task<ChallengeTicket> StartLoginAsync(string email, string password, string deviceId, CancellationToken cancellationToken = default)
    {
        var document = await PostJsonAsync("api/auth/login/start", new
        {
            email,
            password,
            device_id = deviceId
        }, cancellationToken);

        if (document.error is not null)
        {
            return new ChallengeTicket { Mode = AuthMode.Login, Email = email, Error = document.error };
        }

        return new ChallengeTicket
        {
            Mode = AuthMode.Login,
            Email = email,
            ChallengeId = document.root.ReadString("challenge_id"),
            ExpiresAt = document.root.ReadInt64("expires_at")
        };
    }

    public async Task<ChallengeTicket> StartRegisterAsync(string name, string email, string password, string deviceId, CancellationToken cancellationToken = default)
    {
        var document = await PostJsonAsync("api/auth/register/start", new
        {
            name,
            email,
            password,
            device_id = deviceId
        }, cancellationToken);

        if (document.error is not null)
        {
            return new ChallengeTicket { Mode = AuthMode.Register, Email = email, Error = document.error };
        }

        return new ChallengeTicket
        {
            Mode = AuthMode.Register,
            Email = email,
            ChallengeId = document.root.ReadString("challenge_id"),
            ExpiresAt = document.root.ReadInt64("expires_at")
        };
    }

    public async Task<(SessionData? session, string? error)> VerifyChallengeAsync(
        AuthMode mode,
        string challengeId,
        string email,
        string code,
        string deviceId,
        CancellationToken cancellationToken = default)
    {
        var path = mode == AuthMode.Register ? "api/auth/register/verify" : "api/auth/login/verify";
        var response = await PostJsonAsync(path, new
        {
            challenge_id = challengeId,
            email,
            code,
            device_id = deviceId
        }, cancellationToken);

        return response.error is not null
            ? (null, response.error)
            : (ParseSession(response.root, deviceId), null);
    }

    public async Task<(SessionData? session, string? error)> RefreshSessionAsync(SessionData current, CancellationToken cancellationToken = default)
    {
        var response = await PostJsonAsync("api/auth/refresh", new
        {
            refresh_token = current.RefreshToken,
            session_id = current.SessionId,
            device_id = current.DeviceId
        }, cancellationToken);

        return response.error is not null
            ? (null, response.error)
            : (ParseSession(response.root, current.DeviceId), null);
    }

    public async Task<(bool ok, string? message, string? error)> RequestPasswordResetAsync(string email, CancellationToken cancellationToken = default)
    {
        var response = await PostJsonAsync("api/auth/password-reset/request", new
        {
            email
        }, cancellationToken);

        if (response.error is not null)
        {
            return (false, null, response.error);
        }

        return (true, response.root.ReadString("message"), null);
    }

    public async Task<bool> LogoutAsync(SessionData current, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/auth/logout")
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", current.AccessToken);
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        return response.IsSuccessStatusCode;
    }

    public async Task<(DesktopScanState? scan, string? error)> StartDesktopScanAsync(
        SessionData current,
        string mode,
        string artifactKind,
        string targetName,
        string targetPath,
        IReadOnlyList<string> scanRoots,
        IReadOnlyList<string> installRoots,
        CancellationToken cancellationToken = default)
    {
        var plan = new WindowsScanPlan
        {
            Mode = mode,
            ArtifactKind = artifactKind,
            TargetName = targetName,
            TargetPath = targetPath,
            CoverageMode = DesktopCoverageMode.SmartCoverage,
            CoverageRoots = scanRoots
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(path => new WindowsScanRoot
                {
                    Kind = WindowsScanRootKind.Custom,
                    Path = path,
                    Label = path,
                    Exists = true
                })
                .ToArray(),
            InstallRoots = installRoots
        };

        return await StartDesktopScanAsync(current, plan, cancellationToken);
    }

    public async Task<(DesktopScanState? scan, string? error)> StartDesktopScanAsync(
        SessionData current,
        WindowsScanPlan plan,
        CancellationToken cancellationToken = default)
    {
        var response = await PostJsonAsync("api/scans/desktop/start", new
        {
            platform = "windows",
            mode = plan.Mode,
            artifact_kind = plan.ArtifactKind,
            artifact_metadata = new
            {
                target_name = plan.TargetName,
                target_path = plan.TargetPath,
                coverage_mode = plan.CoverageModeValue,
                scan_roots = plan.ScanRoots,
                install_roots = plan.InstallRoots,
                related_binary_roots = plan.RelatedBinaryRoots,
                metadata_roots = plan.MetadataRoots.Select(item => new
                {
                    kind = item.Kind.ToString(),
                    path = item.Path,
                    label = item.Label
                }).ToArray(),
                coverage_roots = plan.CoverageRoots.Select(item => new
                {
                    kind = item.Kind.ToString(),
                    path = item.Path,
                    label = item.Label,
                    exists = item.Exists,
                    is_metadata_only = item.IsMetadataOnly
                }).ToArray()
            }
        }, cancellationToken, current.AccessToken);

        return response.error is not null
            ? (null, response.error)
            : (ParseScan(response.root.GetPropertyOrDefault("scan")), null);
    }

    public async Task<(DesktopScanState? scan, string? error)> GetDesktopScanAsync(SessionData current, string scanId, CancellationToken cancellationToken = default)
    {
        var response = await GetJsonAsync($"api/scans/desktop/{scanId}", cancellationToken, current.AccessToken);
        return response.error is not null
            ? (null, response.error)
            : (ParseScan(response.root.GetPropertyOrDefault("scan")), null);
    }

    public async Task<(bool success, string? error)> CancelDesktopScanAsync(SessionData current, CancellationToken cancellationToken = default)
    {
        var response = await PostJsonAsync("api/scans/desktop/cancel-active", new { }, cancellationToken, current.AccessToken);
        if (response.error is not null)
        {
            return (false, response.error);
        }

        return (response.root.ReadBoolean("success"), null);
    }

    public async Task<(NetworkProtectionState? state, string? error)> GetNetworkProtectionStateAsync(SessionData current, string platform = "windows", CancellationToken cancellationToken = default)
    {
        var response = await GetJsonAsync($"api/network-protection/state?platform={Uri.EscapeDataString(platform)}", cancellationToken, current.AccessToken);
        return response.error is not null
            ? (null, response.error)
            : (ParseNetworkProtectionState(response.root.GetPropertyOrDefault("state")), null);
    }

    public async Task<(NetworkProtectionState? state, string? error)> UpdateNetworkProtectionStateAsync(
        SessionData current,
        bool networkEnabled,
        bool adBlockEnabled,
        bool unsafeSitesEnabled,
        string platform = "windows",
        CancellationToken cancellationToken = default)
    {
        var response = await SendJsonAsync(HttpMethod.Put, "api/network-protection/state", new
        {
            platform,
            toggles = new
            {
                protection_enabled = networkEnabled
            }
        }, cancellationToken, current.AccessToken);

        return response.error is not null
            ? (null, response.error)
            : (ParseNetworkProtectionState(response.root.GetPropertyOrDefault("state")), null);
    }

    public async Task<UpdateInfo> CheckForUpdateAsync(string currentVersion, CancellationToken cancellationToken = default)
    {
        var response = await GetJsonAsync("api/releases/manifest?platform=windows", cancellationToken);
        if (response.error is not null)
        {
            return new UpdateInfo { Error = response.error };
        }

        var latest = response.root.ReadString("version");
        var metadata = response.root.GetPropertyOrDefault("metadata");
        var setupUrl = response.root.ReadString("setupUrl");
        if (string.IsNullOrWhiteSpace(setupUrl))
        {
            setupUrl = metadata.ReadString("setupUrl");
        }

        return new UpdateInfo
        {
            Available = !string.IsNullOrWhiteSpace(latest) && !string.Equals(latest, currentVersion, StringComparison.OrdinalIgnoreCase),
            LatestVersion = latest,
            SetupUrl = setupUrl,
            PortableUrl = response.root.ReadString("download_url")
        };
    }

    private static SessionData ParseSession(JsonElement? root, string deviceId)
    {
        if (root is null)
        {
            throw new InvalidOperationException("Сервер не вернул сессию");
        }

        var session = JsonSerializer.Deserialize<SessionData>(root.Value.GetRawText(), JsonOptions) ?? new SessionData();
        session.DeviceId = deviceId;
        session.User ??= new SessionUser();
        session.User.Id = root.ReadString("id", session.User.Id);
        session.User.Name = root.ReadString("name", session.User.Name);
        session.User.Email = root.ReadString("email", session.User.Email);
        session.User.IsPremium = root.ReadBoolean("is_premium", session.User.IsPremium);
        session.User.IsDeveloperMode = root.ReadBoolean("is_developer_mode", session.User.IsDeveloperMode);

        if (!session.IsValid)
        {
            throw new InvalidOperationException("Сервер вернул неполную сессию");
        }

        return session;
    }

    private static DesktopScanState ParseScan(JsonElement? root)
    {
        if (root is null)
        {
            throw new InvalidOperationException("Сервер не вернул desktop-задачу");
        }

        return new DesktopScanState
        {
            Id = root.ReadString("id"),
            Platform = root.ReadString("platform"),
            Mode = root.ReadString("mode"),
            Status = root.ReadString("status"),
            Verdict = root.ReadString("verdict"),
            Message = root.ReadString("message"),
            RiskScore = root.ReadInt32("risk_score"),
            SurfacedFindings = root.ReadInt32("surfaced_findings"),
            HiddenFindings = root.ReadInt32("hidden_findings"),
            StartedAt = root.ReadInt64("started_at"),
            CompletedAt = root.ReadInt64("completed_at"),
            Timeline = root.GetPropertyOrDefault("timeline").ToStringList(),
            Findings = root.GetPropertyOrDefault("findings").ToFindingList()
        };
    }

    private static NetworkProtectionState ParseNetworkProtectionState(JsonElement? root)
    {
        if (root is null)
        {
            throw new InvalidOperationException("Сервер не вернул состояние сетевой защиты");
        }

        var toggles = root.GetPropertyOrDefault("toggles");
        var totalCounters = root.GetPropertyOrDefault("counters").GetPropertyOrDefault("total");
        var platformCounters = root.GetPropertyOrDefault("counters").GetPropertyOrDefault("platform");
        var limits = root.GetPropertyOrDefault("limits");
        var status = root.GetPropertyOrDefault("status");
        var networkEnabled = toggles is not null
            ? toggles.ReadBoolean("protection_enabled")
            : (root.ReadBoolean("protection_enabled") || root.ReadBoolean("network_enabled"));

        var parsed = new NetworkProtectionState
        {
            Mode = status.ReadString("mode", root.ReadString("mode", "unified")),
            Platform = root.ReadString("platform", "windows"),
            NetworkEnabled = networkEnabled,
            AdBlockEnabled = networkEnabled,
            UnsafeSitesEnabled = networkEnabled,
            BlockedAdsTotal = totalCounters.ReadInt32("blocked_ads", root.ReadInt32("blocked_ads_total")),
            BlockedThreatsTotal = totalCounters.ReadInt32("blocked_threats", root.ReadInt32("blocked_threats_total")),
            BlockedAdsPlatform = platformCounters.ReadInt32("blocked_ads", root.ReadInt32("blocked_ads_platform")),
            BlockedThreatsPlatform = platformCounters.ReadInt32("blocked_threats", root.ReadInt32("blocked_threats_platform")),
            DeveloperMode = root.ReadBoolean("developer_mode") || limits.ReadBoolean("developer_mode"),
            LocalEnforcementAvailable = status.ReadBoolean("local_enforcement_available"),
            LocalEnforcementActive = status.ReadBoolean("local_enforcement_active"),
            EffectiveEnabled = status.ReadBoolean("effective_enabled"),
            StatusMessage = status.ReadString("message")
        };

        return WindowsNetworkProtectionStateService.Normalize(parsed);
    }

    private async Task<(JsonElement? root, string? error)> GetJsonAsync(string relativePath, CancellationToken cancellationToken, string? bearerToken = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, relativePath);
        if (!string.IsNullOrWhiteSpace(bearerToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        return await ParseResponseAsync(response, cancellationToken);
    }

    private async Task<(JsonElement? root, string? error)> PostJsonAsync(
        string relativePath,
        object payload,
        CancellationToken cancellationToken,
        string? bearerToken = null)
    {
        return await SendJsonAsync(HttpMethod.Post, relativePath, payload, cancellationToken, bearerToken);
    }

    private async Task<(JsonElement? root, string? error)> SendJsonAsync(
        HttpMethod method,
        string relativePath,
        object payload,
        CancellationToken cancellationToken,
        string? bearerToken = null)
    {
        using var request = new HttpRequestMessage(method, relativePath)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json")
        };
        if (!string.IsNullOrWhiteSpace(bearerToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        try
        {
            using var response = await _httpClient.SendAsync(request, cancellationToken);
            return await ParseResponseAsync(response, cancellationToken);
        }
        catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            throw new InvalidOperationException("Сервер слишком долго отвечает. Попробуй ещё раз.", ex);
        }
        catch (HttpRequestException ex)
        {
            throw new InvalidOperationException("Не удалось связаться с сервером NeuralV.", ex);
        }
    }

    private static async Task<(JsonElement? root, string? error)> ParseResponseAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        JsonDocument? document = null;
        try
        {
            if (!string.IsNullOrWhiteSpace(body))
            {
                document = JsonDocument.Parse(body);
            }
        }
        catch
        {
        }

        if (!response.IsSuccessStatusCode)
        {
            var errorText = document?.RootElement.GetPropertyOrDefault("error").ReadString();
            return (null, string.IsNullOrWhiteSpace(errorText) ? $"HTTP {(int)response.StatusCode}" : errorText);
        }

        return (document?.RootElement.Clone(), null);
    }
}

internal static class JsonElementExtensions
{
    public static JsonElement? GetPropertyOrDefault(this JsonElement? element, string propertyName)
    {
        if (element is null)
        {
            return null;
        }

        return element.Value.TryGetProperty(propertyName, out var value) ? value : null;
    }

    public static JsonElement? GetPropertyOrDefault(this JsonElement element, string propertyName) =>
        ((JsonElement?)element).GetPropertyOrDefault(propertyName);

    public static string ReadString(this JsonElement? element, string propertyName = "", string fallback = "")
    {
        var target = string.IsNullOrEmpty(propertyName) ? element : element.GetPropertyOrDefault(propertyName);
        if (target is null)
        {
            return fallback;
        }

        return target.Value.ValueKind switch
        {
            JsonValueKind.String => target.Value.GetString() ?? fallback,
            JsonValueKind.Number => target.Value.ToString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => fallback
        };
    }

    public static string ReadString(this JsonElement element, string propertyName = "", string fallback = "") =>
        ((JsonElement?)element).ReadString(propertyName, fallback);

    public static bool ReadBoolean(this JsonElement? element, string propertyName = "", bool fallback = false)
    {
        var target = string.IsNullOrEmpty(propertyName) ? element : element.GetPropertyOrDefault(propertyName);
        if (target is null)
        {
            return fallback;
        }

        return target.Value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(target.Value.GetString(), out var parsed) => parsed,
            JsonValueKind.Number => target.Value.TryGetInt32(out var numeric) && numeric != 0,
            _ => fallback
        };
    }

    public static bool ReadBoolean(this JsonElement element, string propertyName = "", bool fallback = false) =>
        ((JsonElement?)element).ReadBoolean(propertyName, fallback);

    public static int ReadInt32(this JsonElement? element, string propertyName = "", int fallback = 0)
    {
        var target = string.IsNullOrEmpty(propertyName) ? element : element.GetPropertyOrDefault(propertyName);
        if (target is null)
        {
            return fallback;
        }

        return target.Value.ValueKind switch
        {
            JsonValueKind.Number when target.Value.TryGetInt32(out var parsed) => parsed,
            JsonValueKind.String when int.TryParse(target.Value.GetString(), out var parsed) => parsed,
            JsonValueKind.Null => fallback,
            _ => fallback
        };
    }

    public static int ReadInt32(this JsonElement element, string propertyName = "", int fallback = 0) =>
        ((JsonElement?)element).ReadInt32(propertyName, fallback);

    public static long ReadInt64(this JsonElement? element, string propertyName = "", long fallback = 0)
    {
        var target = string.IsNullOrEmpty(propertyName) ? element : element.GetPropertyOrDefault(propertyName);
        if (target is null)
        {
            return fallback;
        }

        return target.Value.ValueKind switch
        {
            JsonValueKind.Number when target.Value.TryGetInt64(out var parsed) => parsed,
            JsonValueKind.String when long.TryParse(target.Value.GetString(), out var parsed) => parsed,
            JsonValueKind.Null => fallback,
            _ => fallback
        };
    }

    public static long ReadInt64(this JsonElement element, string propertyName = "", long fallback = 0) =>
        ((JsonElement?)element).ReadInt64(propertyName, fallback);

    public static IReadOnlyList<string> ToStringList(this JsonElement? element)
    {
        if (element is null || element.Value.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        return element.Value.EnumerateArray()
            .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.ToString())
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Cast<string>()
            .ToArray();
    }

    public static IReadOnlyList<DesktopScanFinding> ToFindingList(this JsonElement? element)
    {
        if (element is null || element.Value.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DesktopScanFinding>();
        }

        var items = new List<DesktopScanFinding>();
        foreach (var item in element.Value.EnumerateArray())
        {
            items.Add(new DesktopScanFinding
            {
                Id = item.ReadString("id"),
                Title = item.ReadString("title"),
                Verdict = item.ReadString("verdict"),
                Summary = item.ReadString("summary"),
                Engines = item.GetPropertyOrDefault("engines").ToStringList()
            });
        }

        return items;
    }
}
