namespace NeuralV.Windows.Services;

public static class WindowsSmokeVerifier
{
    public static void Run()
    {
        WindowsLog.Info("Smoke verifier started");

        _ = SessionStore.EnsureDeviceId();
        _ = SessionStore.AppDirectory;
        _ = WindowsEnvironmentService.DetectScanRoots();
        _ = WindowsEnvironmentService.DetectInstallRoots();
        var installRoot = InstallLayout.ResolveInstallRootFromExecutablePath(Environment.ProcessPath ?? AppContext.BaseDirectory);
        InstallStateStore.Save(InstallStateStore.CreateDefault(installRoot, VersionInfo.Current));
        var processPath = Environment.ProcessPath ?? string.Empty;
        if (string.IsNullOrWhiteSpace(processPath) || !File.Exists(processPath))
        {
            throw new FileNotFoundException("Smoke verifier did not find process executable", processPath);
        }
        WindowsLog.Info($"Smoke verifier process ok: {processPath}");
        var installState = InstallStateStore.ResolveExistingInstall(processPath);
        WindowsLog.Info($"Smoke verifier updater path: {InstallLayout.UpdaterPath(installState?.InstallRoot ?? installRoot)}");

        var assetPath = Path.Combine(AppContext.BaseDirectory, "Assets", "NeuralV.png");
        if (File.Exists(assetPath))
        {
            WindowsLog.Info($"Smoke verifier asset ok: {assetPath}");
        }
        else
        {
            WindowsLog.Info($"Smoke verifier asset not present as loose file: {assetPath}");
        }
        using var client = new NeuralVApiClient();
        WindowsLog.Info("Smoke verifier API client constructed");
    }
}
