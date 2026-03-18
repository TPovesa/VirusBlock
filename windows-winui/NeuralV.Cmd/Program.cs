using System.Diagnostics;
using NeuralV.Windows.Services;

WindowsLog.StartSession("windows-cli-wrapper");
WindowsLog.Info($"CLI wrapper args: {string.Join(' ', args)}");

try
{
    var currentExecutable = Environment.ProcessPath ?? InstallLayout.CliPath(AppContext.BaseDirectory);
    var installRoot = InstallLayout.ResolveInstallRootFromExecutablePath(currentExecutable);
    var libsDirectory = InstallLayout.LibsDirectory(installRoot);
    var hostPath = InstallLayout.CliHostPath(installRoot);

    WindowsLog.Info($"Resolved install root: {installRoot}");
    WindowsLog.Info($"Resolved CLI host path: {hostPath}");

    if (!File.Exists(hostPath))
    {
        Console.Error.WriteLine("CLI host не найден. Почини установку NeuralV или переустанови приложение.");
        WindowsLog.Error($"CLI host missing: {hostPath}");
        Environment.ExitCode = 1;
        return;
    }

    var startInfo = new ProcessStartInfo(hostPath)
    {
        UseShellExecute = false,
        WorkingDirectory = libsDirectory
    };
    startInfo.Environment["DOTNET_ROOT"] = libsDirectory;
    startInfo.Environment["DOTNET_MULTILEVEL_LOOKUP"] = "0";
    startInfo.Environment["NEURALV_INSTALL_ROOT"] = installRoot;
    startInfo.Environment["NEURALV_LOG_APPEND"] = "1";
    foreach (var arg in args)
    {
        startInfo.ArgumentList.Add(arg);
    }

    using var process = Process.Start(startInfo);
    if (process is null)
    {
        Console.Error.WriteLine("Не удалось запустить CLI host NeuralV.");
        WindowsLog.Error("CLI host process start returned null");
        Environment.ExitCode = 1;
        return;
    }

    process.WaitForExit();
    WindowsLog.Info($"CLI host exited with code {process.ExitCode}");
    Environment.ExitCode = process.ExitCode;
}
catch (Exception ex)
{
    WindowsLog.Error("CLI wrapper failed", ex);
    Console.Error.WriteLine($"NeuralV CLI не смог запуститься: {ex.Message}");
    Environment.ExitCode = 1;
}
