using System.Text;
using System.Text.Json;
using NeuralV.Windows.Models;

namespace NeuralV.Windows.Services;

public static class SessionStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private static readonly string[] LegacySessionFileNames =
    [
        "session.json",
        ".session"
    ];

    public static string AppDirectory
    {
        get
        {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "NeuralV");
            Directory.CreateDirectory(path);
            return path;
        }
    }

    public static string SessionDirectory
    {
        get
        {
            try
            {
                var installRoot = InstallLayout.ResolveInstallRootFromExecutablePath(Environment.ProcessPath ?? AppContext.BaseDirectory);
                var libsPath = InstallLayout.LibsDirectory(installRoot);
                Directory.CreateDirectory(libsPath);
                return libsPath;
            }
            catch
            {
                return AppDirectory;
            }
        }
    }

    public static string SessionFilePath => Path.Combine(SessionDirectory, ".session");
    public static string HistoryFilePath => Path.Combine(AppDirectory, "history.json");
    public static string DeviceIdFilePath => Path.Combine(AppDirectory, "device.id");

    public static string EnsureDeviceId()
    {
        if (File.Exists(DeviceIdFilePath))
        {
            var existing = File.ReadAllText(DeviceIdFilePath, Encoding.UTF8).Trim();
            if (!string.IsNullOrWhiteSpace(existing))
            {
                return existing;
            }
        }

        var deviceId = Guid.NewGuid().ToString("D");
        File.WriteAllText(DeviceIdFilePath, deviceId, Encoding.UTF8);
        return deviceId;
    }

    public static async Task SaveSessionAsync(SessionData session, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(SessionDirectory);
        var payload = JsonSerializer.Serialize(session, JsonOptions);
        var tempPath = SessionFilePath + ".tmp";
        await File.WriteAllTextAsync(tempPath, payload, Encoding.UTF8, cancellationToken);
        File.Move(tempPath, SessionFilePath, true);
        DeleteLegacySessionCopies();
    }

    public static async Task<SessionData?> LoadSessionAsync(CancellationToken cancellationToken = default)
    {
        foreach (var candidate in EnumerateSessionCandidates())
        {
            try
            {
                if (!File.Exists(candidate))
                {
                    continue;
                }

                var payload = await File.ReadAllTextAsync(candidate, cancellationToken);
                var session = JsonSerializer.Deserialize<SessionData>(payload, JsonOptions);
                if (session is not { IsValid: true })
                {
                    continue;
                }

                if (!string.Equals(candidate, SessionFilePath, StringComparison.OrdinalIgnoreCase))
                {
                    await SaveSessionAsync(session, cancellationToken);
                }

                return session;
            }
            catch
            {
            }
        }

        return null;
    }

    public static void ClearSession()
    {
        foreach (var candidate in EnumerateSessionCandidates())
        {
            if (File.Exists(candidate))
            {
                File.Delete(candidate);
            }
        }
    }

    private static IEnumerable<string> EnumerateSessionCandidates()
    {
        yield return SessionFilePath;

        foreach (var directory in EnumerateLegacySessionDirectories())
        {
            foreach (var fileName in LegacySessionFileNames)
            {
                var path = Path.Combine(directory, fileName);
                if (!string.Equals(path, SessionFilePath, StringComparison.OrdinalIgnoreCase))
                {
                    yield return path;
                }
            }
        }
    }

    private static IEnumerable<string> EnumerateLegacySessionDirectories()
    {
        yield return AppDirectory;

        try
        {
            var installRoot = InstallLayout.ResolveInstallRootFromExecutablePath(Environment.ProcessPath ?? AppContext.BaseDirectory);
            yield return InstallLayout.BinDirectory(installRoot);
        }
        catch
        {
        }
    }

    private static void DeleteLegacySessionCopies()
    {
        foreach (var directory in EnumerateLegacySessionDirectories())
        {
            foreach (var fileName in LegacySessionFileNames)
            {
                var path = Path.Combine(directory, fileName);
                if (!string.Equals(path, SessionFilePath, StringComparison.OrdinalIgnoreCase) && File.Exists(path))
                {
                    File.Delete(path);
                }
            }
        }
    }
}
