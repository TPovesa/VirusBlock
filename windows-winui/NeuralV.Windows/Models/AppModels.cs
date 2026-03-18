using System.Text.Json.Serialization;

namespace NeuralV.Windows.Models;

public enum AuthMode
{
    Login,
    Register
}

public enum AppScreen
{
    Splash,
    Welcome,
    Login,
    Register,
    Code,
    Home,
    Scan,
    History,
    Settings
}

public enum ThemeModePreference
{
    System,
    Light,
    Dark
}

public enum DesktopCoverageMode
{
    SmartCoverage,
    FullDisk
}

public enum WindowsScanRootKind
{
    UserProfile,
    Desktop,
    CommonDesktop,
    Downloads,
    Documents,
    LocalAppData,
    RoamingAppData,
    ProgramData,
    LocalAppPrograms,
    ProgramFiles,
    ProgramFilesX86,
    CommonFiles,
    CommonFilesX86,
    StartMenu,
    CommonStartMenu,
    Startup,
    CommonStartup,
    PackageInstallRoot,
    ShortcutTarget,
    AutorunTarget,
    ServiceTarget,
    ScheduledTaskTarget,
    TargetFile,
    TargetDirectory,
    RelatedBinaryRoot,
    ServicesMetadata,
    ScheduledTasksMetadata,
    DriveRoot,
    Temp,
    Custom
}

public enum WindowsScanSeedKind
{
    InstalledProgram,
    Shortcut,
    Autorun,
    Service,
    ScheduledTask
}

public enum TrayScanVisualState
{
    Idle,
    Preparing,
    Running,
    AwaitingUpload,
    Completed,
    Failed,
    Cancelled
}

public sealed class SessionUser
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("is_premium")]
    public bool IsPremium { get; set; }

    [JsonPropertyName("is_developer_mode")]
    public bool IsDeveloperMode { get; set; }
}

public sealed class SessionData
{
    [JsonPropertyName("token")]
    public string AccessToken { get; set; } = string.Empty;

    [JsonPropertyName("refresh_token")]
    public string RefreshToken { get; set; } = string.Empty;

    [JsonPropertyName("session_id")]
    public string SessionId { get; set; } = string.Empty;

    [JsonPropertyName("access_token_expires_at")]
    public long AccessTokenExpiresAt { get; set; }

    [JsonPropertyName("refresh_token_expires_at")]
    public long RefreshTokenExpiresAt { get; set; }

    public string DeviceId { get; set; } = string.Empty;
    public SessionUser User { get; set; } = new();

    public bool IsValid =>
        !string.IsNullOrWhiteSpace(AccessToken) &&
        !string.IsNullOrWhiteSpace(RefreshToken) &&
        !string.IsNullOrWhiteSpace(SessionId);
}

public sealed class ChallengeTicket
{
    public AuthMode Mode { get; init; }
    public string ChallengeId { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public long ExpiresAt { get; init; }
    public string Error { get; init; } = string.Empty;
    public bool Ok => string.IsNullOrWhiteSpace(Error) && !string.IsNullOrWhiteSpace(ChallengeId);
}

public sealed class UpdateInfo
{
    public bool Available { get; init; }
    public string LatestVersion { get; init; } = string.Empty;
    public string SetupUrl { get; init; } = string.Empty;
    public string PortableUrl { get; init; } = string.Empty;
    public string Error { get; init; } = string.Empty;
}

public sealed class ClientPreferences
{
    public ThemeModePreference ThemeMode { get; set; } = ThemeModePreference.System;
    public bool DynamicColorsEnabled { get; set; } = true;
    public bool DeveloperModeEnabled { get; set; }
    public bool AutoStartEnabled { get; set; } = true;
    public bool NetworkProtectionEnabled { get; set; }
    public bool AdBlockEnabled { get; set; }
    public bool UnsafeSitesEnabled { get; set; }
    public bool MinimizeToTrayOnClose { get; set; } = true;
    public int BlockedThreats { get; set; }
    public int BlockedAds { get; set; }

    public string NetworkProtectionSummary =>
        $"Заблокировано угроз: {BlockedThreats} · рекламы: {BlockedAds}";
}

public sealed class NetworkProtectionState
{
    public string Platform { get; init; } = string.Empty;
    public bool NetworkEnabled { get; init; }
    public bool AdBlockEnabled { get; init; }
    public bool UnsafeSitesEnabled { get; init; }
    public int BlockedAdsTotal { get; init; }
    public int BlockedThreatsTotal { get; init; }
    public int BlockedAdsPlatform { get; init; }
    public int BlockedThreatsPlatform { get; init; }
    public bool DeveloperMode { get; init; }
    public string Summary => $"Заблокировано угроз: {BlockedThreatsPlatform} · рекламы: {BlockedAdsPlatform}";
}

public sealed class WindowsScanRoot
{
    public WindowsScanRootKind Kind { get; init; } = WindowsScanRootKind.Custom;
    public string Path { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public bool Exists { get; init; }
    public bool IsMetadataOnly { get; init; }
}

public sealed class WindowsScanSeed
{
    public WindowsScanSeedKind Kind { get; init; } = WindowsScanSeedKind.InstalledProgram;
    public string Name { get; init; } = string.Empty;
    public string Path { get; init; } = string.Empty;
    public string RootPath { get; init; } = string.Empty;
    public string Source { get; init; } = string.Empty;
    public string SourcePath { get; init; } = string.Empty;
}

public sealed class WindowsScanPlan
{
    public string Mode { get; init; } = "quick";
    public string ArtifactKind { get; init; } = "filesystem";
    public string TargetName { get; init; } = string.Empty;
    public string TargetPath { get; init; } = string.Empty;
    public DesktopCoverageMode CoverageMode { get; init; } = DesktopCoverageMode.SmartCoverage;
    public IReadOnlyList<WindowsScanRoot> CoverageRoots { get; init; } = Array.Empty<WindowsScanRoot>();
    public IReadOnlyList<WindowsScanRoot> MetadataRoots { get; init; } = Array.Empty<WindowsScanRoot>();
    public IReadOnlyList<string> InstallRoots { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> RelatedBinaryRoots { get; init; } = Array.Empty<string>();

    [JsonIgnore]
    public IReadOnlyList<string> ScanRoots =>
        CoverageRoots
            .Where(root => !root.IsMetadataOnly && root.Exists && !string.IsNullOrWhiteSpace(root.Path))
            .Select(root => root.Path)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

    [JsonIgnore]
    public IReadOnlyList<string> AllBinaryRoots =>
        ScanRoots
            .Concat(RelatedBinaryRoots.Where(path => !string.IsNullOrWhiteSpace(path)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

    [JsonIgnore]
    public string CoverageModeValue => CoverageMode switch
    {
        DesktopCoverageMode.FullDisk => "full-disk",
        _ => "smart-coverage"
    };
}

public sealed class DesktopScanFinding
{
    public string Id { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Verdict { get; init; } = string.Empty;
    public string Summary { get; init; } = string.Empty;
    public IReadOnlyList<string> Engines { get; init; } = Array.Empty<string>();
}

public sealed class DesktopScanState
{
    public string Id { get; init; } = string.Empty;
    public string Platform { get; init; } = string.Empty;
    public string Mode { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public string Verdict { get; init; } = string.Empty;
    public string Message { get; init; } = string.Empty;
    public int RiskScore { get; init; }
    public int SurfacedFindings { get; init; }
    public int HiddenFindings { get; init; }
    public long StartedAt { get; init; }
    public long CompletedAt { get; init; }
    public IReadOnlyList<string> Timeline { get; init; } = Array.Empty<string>();
    public IReadOnlyList<DesktopScanFinding> Findings { get; init; } = Array.Empty<DesktopScanFinding>();
    public bool IsFinished => Status is "COMPLETED" or "FAILED" or "CANCELLED";
    public bool IsSuccessful => Status == "COMPLETED";
    public string PrimarySummary => string.IsNullOrWhiteSpace(Message) ? Verdict : Message;
}

public sealed class TrayProgressState
{
    public bool IsVisible { get; init; }
    public bool IsIndeterminate { get; init; }
    public string ScanId { get; init; } = string.Empty;
    public string Mode { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public int ProgressPercent { get; init; }
    public string Title { get; init; } = "NeuralV";
    public string Subtitle { get; init; } = string.Empty;
    public string Tooltip { get; init; } = "NeuralV";
    public TrayScanVisualState VisualState { get; init; } = TrayScanVisualState.Idle;
}

public sealed class StoredScanRecord
{
    public string Id { get; set; } = string.Empty;
    public string Mode { get; set; } = string.Empty;
    public string Verdict { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public DateTimeOffset SavedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<string> Timeline { get; set; } = new();
    public List<DesktopScanFindingRecord> Findings { get; set; } = new();
}

public sealed class DesktopScanFindingRecord
{
    public string Title { get; set; } = string.Empty;
    public string Verdict { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
}
