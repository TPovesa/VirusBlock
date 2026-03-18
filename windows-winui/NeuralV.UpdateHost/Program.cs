using System.Diagnostics;
using NeuralV.Windows.Services;

WindowsLog.StartSession("windows-updater-host");
WindowsLog.Info($"Updater host args: {string.Join(' ', args)}");

var forwardedArgs = args.Where(arg => !string.Equals(arg, "--check-and-launch", StringComparison.OrdinalIgnoreCase)).ToArray();

try
{
    var hintedInstallRoot = Environment.GetEnvironmentVariable("NEURALV_INSTALL_ROOT");
    var currentExecutable = Environment.ProcessPath ?? InstallLayout.UpdaterHostPath(AppContext.BaseDirectory);
    var currentDirectory = InstallLayout.ResolveInstallRootFromExecutablePath(string.IsNullOrWhiteSpace(hintedInstallRoot) ? currentExecutable : hintedInstallRoot);
    var installState = InstallStateStore.ResolveExistingInstall(currentExecutable)
        ?? InstallStateStore.CreateDefault(currentDirectory);

    installState.InstallRoot = InstallLayout.NormalizeInstallRoot(installState.InstallRoot);
    var installRoot = installState.InstallRoot;
    var guiPath = InstallLayout.GuiPath(installRoot);
    WindowsLog.Info($"Resolved install root: {installRoot}");
    WindowsLog.Info($"GUI path: {guiPath}");

    WindowsReleaseInfo? releaseInfo = null;
    try
    {
        releaseInfo = await WindowsReleaseManifestClient.FetchAsync();
        WindowsLog.Info($"Manifest version: {releaseInfo?.Version}");
    }
    catch (Exception manifestError)
    {
        WindowsLog.Error("Updater manifest fetch failed", manifestError);
    }

    var currentVersion = string.IsNullOrWhiteSpace(installState.Version)
        ? TryReadFileVersion(guiPath)
        : installState.Version;

    if (releaseInfo is not null && releaseInfo.IsNewerThan(currentVersion) && !string.IsNullOrWhiteSpace(releaseInfo.PortableUrl))
    {
        WindowsLog.Info($"Update available: {currentVersion} -> {releaseInfo.Version}");
        installState.Version = releaseInfo.Version;
        installState.CliBinary = releaseInfo.CliBinaryName;
        installState.GuiBinary = releaseInfo.GuiBinaryName;
        installState.LauncherBinary = releaseInfo.LauncherBinaryName;
        installState.UpdaterBinary = releaseInfo.UpdaterBinaryName;
        installState.CliHostBinary = releaseInfo.CliHostBinaryName;
        installState.UpdaterHostBinary = releaseInfo.UpdaterHostBinaryName;

        using var preparedBundle = await WindowsBundleInstaller.PrepareBundleAsync(
            releaseInfo.PortableUrl,
            installRoot,
            installState.Version,
            installState.AutoStartEnabled);

        var scriptPath = WindowsBundleInstaller.BuildApplyUpdateScript(preparedBundle, installState);
        WindowsLog.Info($"Prepared update script: {scriptPath}");
        Process.Start(new ProcessStartInfo("cmd.exe", $"/c \"{scriptPath}\"")
        {
            UseShellExecute = true,
            WorkingDirectory = installRoot,
            CreateNoWindow = true
        });
        return;
    }

    LaunchGui(guiPath, installRoot, forwardedArgs);
}
catch (Exception ex)
{
    WindowsLog.Error("Updater host failed, attempting direct GUI launch", ex);
    var installRoot = InstallStateStore.ResolveExistingInstall(Environment.ProcessPath)?.InstallRoot
        ?? InstallLayout.ResolveInstallRootFromExecutablePath(Environment.GetEnvironmentVariable("NEURALV_INSTALL_ROOT") ?? Environment.ProcessPath ?? AppContext.BaseDirectory);
    var guiPath = InstallLayout.GuiPath(installRoot);
    LaunchGui(guiPath, installRoot, forwardedArgs);
}

static void LaunchGui(string guiPath, string installRoot, IEnumerable<string> forwardedArgs)
{
    if (!File.Exists(guiPath))
    {
        WindowsLog.Error($"GUI binary missing: {guiPath}");
        return;
    }

    WindowsLog.Info($"Launching GUI core: {guiPath}");
    var startInfo = new ProcessStartInfo(guiPath)
    {
        UseShellExecute = false,
        WorkingDirectory = Path.GetDirectoryName(guiPath) ?? installRoot
    };
    startInfo.Environment["NEURALV_SKIP_UPDATER"] = "1";
    startInfo.Environment["NEURALV_INSTALL_ROOT"] = installRoot;
    startInfo.Environment["NEURALV_LOG_APPEND"] = "1";
    startInfo.ArgumentList.Add("--launched-by-updater");
    foreach (var arg in forwardedArgs)
    {
        startInfo.ArgumentList.Add(arg);
    }
    using var process = Process.Start(startInfo);
    if (process is null)
    {
        WindowsLog.Error("GUI process did not start");
        return;
    }
    WindowsLog.Info($"GUI process started pid={process.Id}");
    process.WaitForExit();
    WindowsLog.Info($"GUI exited with code {process.ExitCode}");
}

static string TryReadFileVersion(string guiPath)
{
    try
    {
        return File.Exists(guiPath)
            ? (FileVersionInfo.GetVersionInfo(guiPath).ProductVersion ?? string.Empty).Split('+', 2)[0]
            : string.Empty;
    }
    catch
    {
        return string.Empty;
    }
}
