using System.Diagnostics;
using NeuralV.Windows.Services;

WindowsLog.StartSession("windows-launcher");
WindowsLog.Info("Launcher bootstrap started");

try
{
    var currentExecutable = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, InstallLayout.LauncherBinaryName);
    var installRoot = InstallLayout.ResolveInstallRootFromExecutablePath(currentExecutable);
    var updaterPath = InstallLayout.UpdaterPath(installRoot);
    var guiPath = InstallLayout.GuiPath(installRoot);

    WindowsLog.Info($"Resolved install root: {installRoot}");
    WindowsLog.Info($"Public updater path: {updaterPath}");
    WindowsLog.Info($"GUI core path: {guiPath}");

    if (File.Exists(updaterPath))
    {
        WindowsLog.Info("Delegating launch to updater shim");
        var updaterStart = new ProcessStartInfo(updaterPath)
        {
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(updaterPath) ?? installRoot,
            CreateNoWindow = true
        };
        updaterStart.Environment["NEURALV_LOG_APPEND"] = "1";
        updaterStart.Environment["NEURALV_INSTALL_ROOT"] = installRoot;
        updaterStart.ArgumentList.Add("--check-and-launch");
        foreach (var arg in args)
        {
            updaterStart.ArgumentList.Add(arg);
        }
        using var updaterProcess = Process.Start(updaterStart);
        if (updaterProcess is null)
        {
            WindowsLog.Error("Updater shim did not start");
            Environment.ExitCode = 1;
            return;
        }
        WindowsLog.Info($"Updater shim started pid={updaterProcess.Id}");
        return;
    }

    if (File.Exists(guiPath))
    {
        WindowsLog.Info("Updater shim missing, launching GUI directly");
        var guiStart = new ProcessStartInfo(guiPath)
        {
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(guiPath) ?? installRoot
        };
        guiStart.Environment["NEURALV_SKIP_UPDATER"] = "1";
        guiStart.Environment["NEURALV_INSTALL_ROOT"] = installRoot;
        guiStart.Environment["NEURALV_LOG_APPEND"] = "1";
        foreach (var arg in args)
        {
            guiStart.ArgumentList.Add(arg);
        }
        using var guiProcess = Process.Start(guiStart);
        if (guiProcess is null)
        {
            WindowsLog.Error("GUI process did not start");
            Environment.ExitCode = 1;
            return;
        }
        WindowsLog.Info($"GUI process started pid={guiProcess.Id}");
        return;
    }

    WindowsLog.Error($"Launcher failed: GUI bundle missing in {installRoot}");
    Environment.ExitCode = 1;
}
catch (Exception ex)
{
    WindowsLog.Error("Launcher failed", ex);
    Environment.ExitCode = 1;
}
