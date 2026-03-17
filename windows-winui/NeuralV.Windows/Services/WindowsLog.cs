using System.Text;

namespace NeuralV.Windows.Services;

public static class WindowsLog
{
    private static readonly object Sync = new();
    private static string? _logFilePath;
    private const string LogFileName = "log.txt";

    public static string LogFilePath
    {
        get
        {
            if (!string.IsNullOrWhiteSpace(_logFilePath))
            {
                return _logFilePath;
            }

            _logFilePath = ResolveLogFilePath();
            return _logFilePath;
        }
    }

    public static void StartSession(string context)
    {
        try
        {
            lock (Sync)
            {
                File.WriteAllText(
                    LogFilePath,
                    $"[{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss}] session-start {context}{Environment.NewLine}",
                    Encoding.UTF8);
            }
        }
        catch
        {
        }
    }

    public static void Info(string message) => Write("info", message, null);

    public static void Error(string message, Exception? exception = null) => Write("error", message, exception);

    private static void Write(string level, string message, Exception? exception)
    {
        try
        {
            var line = new StringBuilder()
                .Append('[')
                .Append(DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:ss"))
                .Append("] ")
                .Append(level)
                .Append(' ')
                .Append(message);

            if (exception is not null)
            {
                line.Append(" :: ").Append(exception);
            }

            lock (Sync)
            {
                File.AppendAllText(LogFilePath, line.AppendLine().ToString(), Encoding.UTF8);
            }
        }
        catch
        {
        }
    }

    private static string ResolveLogFilePath()
    {
        foreach (var candidate in EnumerateCandidateDirectories())
        {
            if (TryEnsureWritableDirectory(candidate))
            {
                return Path.Combine(candidate, LogFileName);
            }
        }

        return Path.Combine(Path.GetTempPath(), "NeuralV", LogFileName);
    }

    private static IEnumerable<string> EnumerateCandidateDirectories()
    {
        if (!string.IsNullOrWhiteSpace(Environment.ProcessPath))
        {
            var processDir = Path.GetDirectoryName(Environment.ProcessPath);
            if (!string.IsNullOrWhiteSpace(processDir))
            {
                yield return processDir;
            }
        }

        if (!string.IsNullOrWhiteSpace(AppContext.BaseDirectory))
        {
            yield return AppContext.BaseDirectory;
        }

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (!string.IsNullOrWhiteSpace(localAppData))
        {
            yield return Path.Combine(localAppData, "NeuralV");
        }

        var roamingAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (!string.IsNullOrWhiteSpace(roamingAppData))
        {
            yield return Path.Combine(roamingAppData, "NeuralV");
        }
    }

    private static bool TryEnsureWritableDirectory(string? directory)
    {
        if (string.IsNullOrWhiteSpace(directory))
        {
            return false;
        }

        try
        {
            Directory.CreateDirectory(directory);
            var probe = Path.Combine(directory, ".neuralv-write-probe");
            File.WriteAllText(probe, "probe", Encoding.UTF8);
            File.Delete(probe);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
