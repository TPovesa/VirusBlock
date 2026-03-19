using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
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

    if (TryActivateExistingInstance(guiPath, args))
    {
        WindowsLog.Info("Existing GUI instance detected, activated, and launch skipped");
        return;
    }

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

static bool TryActivateExistingInstance(string guiPath, string[] launchArguments)
{
    try
    {
        var processName = Path.GetFileNameWithoutExtension(guiPath);
        if (string.IsNullOrWhiteSpace(processName))
        {
            return false;
        }

        foreach (var process in Process.GetProcessesByName(processName))
        {
            if (process.Id == Environment.ProcessId)
            {
                continue;
            }

            try
            {
                var existingPath = process.MainModule?.FileName;
                if (!string.IsNullOrWhiteSpace(existingPath)
                    && !string.Equals(Path.GetFullPath(existingPath), Path.GetFullPath(guiPath), StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
            }
            catch
            {
            }

            var hwnd = process.MainWindowHandle;
            if (hwnd == IntPtr.Zero)
            {
                continue;
            }

            TryForwardLaunchArguments(hwnd, launchArguments);
            LauncherNativeMethods.ShowWindow(hwnd, LauncherNativeMethods.SwRestore);
            LauncherNativeMethods.ShowWindow(hwnd, LauncherNativeMethods.SwShow);
            LauncherNativeMethods.SetForegroundWindow(hwnd);
            return true;
        }
    }
    catch (Exception ex)
    {
        WindowsLog.Error("TryActivateExistingInstance failed", ex);
    }

    return false;
}

static void TryForwardLaunchArguments(IntPtr hwnd, IReadOnlyList<string> launchArguments)
{
    if (hwnd == IntPtr.Zero || launchArguments.Count == 0)
    {
        return;
    }

    var payload = JsonSerializer.Serialize(launchArguments);
    var bytes = Encoding.Unicode.GetBytes(payload + "\0");
    var buffer = Marshal.AllocHGlobal(bytes.Length);

    try
    {
        Marshal.Copy(bytes, 0, buffer, bytes.Length);
        var copyData = new LauncherNativeMethods.CopyDataStruct
        {
            dwData = new IntPtr(InstallLayout.LaunchArgsCopyDataSignature),
            cbData = bytes.Length,
            lpData = buffer
        };

        var result = LauncherNativeMethods.SendMessageTimeout(
            hwnd,
            LauncherNativeMethods.WmCopyData,
            IntPtr.Zero,
            ref copyData,
            LauncherNativeMethods.SmtoAbortIfHung,
            2000,
            out _);

        WindowsLog.Info(result == IntPtr.Zero
            ? "Launch argument handoff skipped: existing window did not accept payload"
            : $"Forwarded launch arguments to existing GUI instance: count={launchArguments.Count}");
    }
    catch (Exception ex)
    {
        WindowsLog.Error("Launch argument handoff failed", ex);
    }
    finally
    {
        Marshal.FreeHGlobal(buffer);
    }
}

internal static class LauncherNativeMethods
{
    public const uint SwRestore = 9;
    public const uint SwShow = 5;
    public const uint WmCopyData = 0x004A;
    public const uint SmtoAbortIfHung = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    public struct CopyDataStruct
    {
        public IntPtr dwData;
        public int cbData;
        public IntPtr lpData;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    public static extern bool ShowWindow(IntPtr hwnd, uint command);

    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetForegroundWindow(IntPtr hwnd);

    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(
        IntPtr hwnd,
        uint message,
        IntPtr wParam,
        ref CopyDataStruct lParam,
        uint flags,
        uint timeoutMilliseconds,
        out IntPtr result);
}
