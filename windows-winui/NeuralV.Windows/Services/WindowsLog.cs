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

            var root = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "NeuralV");
            Directory.CreateDirectory(root);
            _logFilePath = Path.Combine(root, "log.txt");
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
}
