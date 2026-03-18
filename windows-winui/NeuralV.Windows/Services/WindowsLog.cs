using System.Diagnostics;
using System.Text;

namespace NeuralV.Windows.Services;

public static class WindowsLog
{
    private static readonly object Sync = new();
    private static string? _logFilePath;

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
            var append = string.Equals(Environment.GetEnvironmentVariable("NEURALV_LOG_APPEND"), "1", StringComparison.OrdinalIgnoreCase)
                && File.Exists(LogFilePath);
            var line = $"[{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss}] session-start {context} pid={Environment.ProcessId} exe={Environment.ProcessPath}{Environment.NewLine}";
            lock (Sync)
            {
                if (append)
                {
                    File.AppendAllText(LogFilePath, line, Encoding.UTF8);
                }
                else
                {
                    File.WriteAllText(LogFilePath, line, Encoding.UTF8);
                }
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
        foreach (var candidate in EnumerateCandidateLogPaths())
        {
            if (TryEnsureWritableFile(candidate))
            {
                return candidate;
            }
        }

        var tempDirectory = Path.Combine(Path.GetTempPath(), "NeuralV");
        Directory.CreateDirectory(tempDirectory);
        return Path.Combine(tempDirectory, InstallLayout.LogFileName);
    }

    private static IEnumerable<string> EnumerateCandidateLogPaths()
    {
        var hintedInstallRoot = Environment.GetEnvironmentVariable("NEURALV_INSTALL_ROOT");
        var installRoot = !string.IsNullOrWhiteSpace(hintedInstallRoot)
            ? InstallLayout.NormalizeInstallRoot(hintedInstallRoot)
            : InstallLayout.ResolveInstallRootFromExecutablePath(Environment.ProcessPath ?? AppContext.BaseDirectory);
        yield return InstallLayout.LogPath(installRoot);

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (!string.IsNullOrWhiteSpace(localAppData))
        {
            yield return Path.Combine(localAppData, InstallLayout.ProductName, InstallLayout.LogFileName);
        }

        var roamingAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (!string.IsNullOrWhiteSpace(roamingAppData))
        {
            yield return Path.Combine(roamingAppData, InstallLayout.ProductName, InstallLayout.LogFileName);
        }
    }

    private static bool TryEnsureWritableFile(string? filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            return false;
        }

        try
        {
            var directory = Path.GetDirectoryName(filePath);
            if (string.IsNullOrWhiteSpace(directory))
            {
                return false;
            }

            Directory.CreateDirectory(directory);
            var probe = Path.Combine(directory, $".neuralv-write-probe-{Process.GetCurrentProcess().Id}");
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
