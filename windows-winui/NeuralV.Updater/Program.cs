using System.Diagnostics;
using NeuralV.Windows.Services;

WindowsLog.StartSession("windows-updater-shim");
WindowsLog.Info($"Updater shim args: {string.Join(' ', args)}");

try
{
    var currentExecutable = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, InstallLayout.UpdaterBinaryName);
    var installRoot = InstallLayout.ResolveInstallRootFromExecutablePath(currentExecutable);
    var updaterHostPath = InstallLayout.UpdaterHostPath(installRoot);

    WindowsLog.Info($"Resolved install root: {installRoot}");
    WindowsLog.Info($"Updater host path: {updaterHostPath}");

    if (!File.Exists(updaterHostPath))
    {
        WindowsLog.Error($"Updater host missing: {updaterHostPath}");
        Environment.ExitCode = 1;
        return;
    }

    var startInfo = new ProcessStartInfo(updaterHostPath)
    {
        UseShellExecute = false,
        WorkingDirectory = Path.GetDirectoryName(updaterHostPath) ?? installRoot,
        CreateNoWindow = true
    };
    startInfo.Environment["NEURALV_INSTALL_ROOT"] = installRoot;
    startInfo.Environment["NEURALV_LOG_APPEND"] = "1";
    startInfo.Environment["DOTNET_ROOT"] = InstallLayout.LibsDirectory(installRoot);
    startInfo.Environment["DOTNET_MULTILEVEL_LOOKUP"] = "0";
    foreach (var arg in args)
    {
        startInfo.ArgumentList.Add(arg);
    }

    using var process = Process.Start(startInfo);
    if (process is null)
    {
        WindowsLog.Error("Updater host did not start");
        Environment.ExitCode = 1;
        return;
    }

    process.WaitForExit();
    WindowsLog.Info($"Updater host exited with code {process.ExitCode}");
    Environment.ExitCode = process.ExitCode;
}
catch (Exception ex)
{
    WindowsLog.Error("Updater shim failed", ex);
    Environment.ExitCode = 1;
}
