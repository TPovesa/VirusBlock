using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.UI.Xaml;
using NeuralV.Windows.Models;
using WinRT.Interop;

namespace NeuralV.Windows.Services;

public sealed class WindowsWindowLifecycleService : IDisposable
{
    private const int GwlWndProc = -4;
    private const uint WmClose = 0x0010;
    private const uint WmCopyData = 0x004A;
    private const uint WmDestroy = 0x0002;
    private const uint WmGetMinMaxInfo = 0x0024;
    private const uint WmNull = 0x0000;
    private const uint WmContextMenu = 0x007B;
    private const uint WmApp = 0x8000;
    private const uint WmUser = 0x0400;
    private const uint TrayCallbackMessage = WmApp + 0x44;
    private const uint WmLButtonUp = 0x0202;
    private const uint WmLButtonDblClk = 0x0203;
    private const uint WmRButtonUp = 0x0205;
    private const uint NinSelect = WmUser;
    private const uint NinKeySelect = WmUser + 1;
    private const uint MfString = 0x00000000;
    private const uint TpmLeftAlign = 0x0000;
    private const uint TpmBottomAlign = 0x0020;
    private const uint TpmRightButton = 0x0002;
    private const uint TpmReturnCommand = 0x0100;
    private const uint TrayCommandOpen = 0x101;
    private const uint TrayCommandExit = 0x102;

    private const uint NimAdd = 0x00000000;
    private const uint NimModify = 0x00000001;
    private const uint NimDelete = 0x00000002;
    private const uint NimSetVersion = 0x00000004;

    private const uint NifMessage = 0x00000001;
    private const uint NifIcon = 0x00000002;
    private const uint NifTip = 0x00000004;

    private const uint NotifyIconVersion4 = 4;
    private const uint SwHide = 0;
    private const uint SwRestore = 9;
    private const uint SwShow = 5;

    private readonly uint _taskbarCreatedMessage;
    private readonly WndProcDelegate _wndProcDelegate;
    private readonly uint _trayIconId = 0x4E56;

    private Window? _window;
    private IntPtr _hwnd;
    private IntPtr _previousWndProc;
    private bool _attached;
    private bool _trayVisible;
    private bool _hiddenToTray;
    private bool _allowNextClose;
    private int _minimumWidth = 920;
    private int _minimumHeight = 640;
    private string _title = "NeuralV";
    private Func<bool>? _shouldMinimizeToTray;
    private Func<TrayProgressState>? _trayStateProvider;
    private TrayProgressState _trayState = WindowsTrayProgressService.CreateIdle();
    private Icon? _currentIcon;

    public event Action? RestoreRequested;
    public event Action? HiddenToTray;
    public event Action? ExitRequested;
    public event Action<IReadOnlyList<string>>? LaunchArgumentsReceived;

    public WindowsWindowLifecycleService()
    {
        _taskbarCreatedMessage = RegisterWindowMessage("TaskbarCreated");
        _wndProcDelegate = WindowProc;
    }

    public void Attach(Window window, WindowsWindowLifecycleOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(window);
        if (_attached)
        {
            return;
        }

        _window = window;
        _hwnd = WindowNative.GetWindowHandle(window);
        if (_hwnd == IntPtr.Zero)
        {
            throw new InvalidOperationException("WinUI окно ещё не получило HWND.");
        }

        options ??= new WindowsWindowLifecycleOptions();
        _title = string.IsNullOrWhiteSpace(options.Title) ? "NeuralV" : options.Title.Trim();
        _minimumWidth = Math.Max(640, options.MinimumWidth);
        _minimumHeight = Math.Max(520, options.MinimumHeight);
        _shouldMinimizeToTray = options.ShouldMinimizeToTray;
        _trayStateProvider = options.TrayStateProvider;
        _trayState = options.InitialTrayState ?? WindowsTrayProgressService.CreateIdle();

        SetLastError(0);
        _previousWndProc = SetWindowLongPtr(_hwnd, GwlWndProc, Marshal.GetFunctionPointerForDelegate(_wndProcDelegate));
        if (_previousWndProc == IntPtr.Zero && Marshal.GetLastWin32Error() != 0)
        {
            throw new InvalidOperationException("Не удалось повесить Win32 hook на окно NeuralV.");
        }
        _attached = true;
        WindowsLog.Info($"Window lifecycle service attached hwnd=0x{_hwnd.ToInt64():X}");
    }

    public bool IsHiddenToTray => _hiddenToTray;

    public void SetMinimumSize(int width, int height)
    {
        _minimumWidth = Math.Max(640, width);
        _minimumHeight = Math.Max(520, height);
    }

    public void SetShouldMinimizeToTray(Func<bool>? predicate)
    {
        _shouldMinimizeToTray = predicate;
    }

    public void SetTrayStateProvider(Func<TrayProgressState>? provider)
    {
        _trayStateProvider = provider;
        RefreshTrayState();
    }

    public void UpdateTray(TrayProgressState state)
    {
        _trayState = state ?? WindowsTrayProgressService.CreateIdle();
        ApplyTrayState();
    }

    public void RefreshTrayState()
    {
        if (_trayStateProvider is not null)
        {
            try
            {
                _trayState = _trayStateProvider.Invoke() ?? WindowsTrayProgressService.CreateIdle();
            }
            catch (Exception ex)
            {
                WindowsLog.Error("Tray state provider failed", ex);
                _trayState = WindowsTrayProgressService.CreateIdle();
            }
        }

        ApplyTrayState();
    }

    public void HideToTray()
    {
        if (_hwnd == IntPtr.Zero)
        {
            return;
        }

        _hiddenToTray = true;
        ShowWindow(_hwnd, SwHide);
        ApplyTrayState();
        HiddenToTray?.Invoke();
        WindowsLog.Info("Window hidden to tray");
    }

    public void RestoreFromTray()
    {
        if (_hwnd == IntPtr.Zero)
        {
            return;
        }

        _hiddenToTray = false;
        ShowWindow(_hwnd, SwRestore);
        ShowWindow(_hwnd, SwShow);
        _window?.Activate();
        SetForegroundWindow(_hwnd);
        ApplyTrayState();
        RestoreRequested?.Invoke();
        WindowsLog.Info("Window restored from tray");
    }

    public void RequestRealClose()
    {
        if (_hwnd == IntPtr.Zero)
        {
            return;
        }

        _allowNextClose = true;
        PostMessage(_hwnd, WmClose, IntPtr.Zero, IntPtr.Zero);
    }

    public void Dispose()
    {
        if (!_attached)
        {
            return;
        }

        try
        {
            RemoveTrayIcon();
            if (_hwnd != IntPtr.Zero && _previousWndProc != IntPtr.Zero)
            {
                SetWindowLongPtr(_hwnd, GwlWndProc, _previousWndProc);
            }
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Window lifecycle dispose failed", ex);
        }
        finally
        {
            _attached = false;
            _previousWndProc = IntPtr.Zero;
            _hwnd = IntPtr.Zero;
            _window = null;
            _currentIcon?.Dispose();
            _currentIcon = null;
        }
    }

    private void ApplyTrayState()
    {
        if (_hwnd == IntPtr.Zero)
        {
            return;
        }

        var shouldShowIcon = _hiddenToTray || _trayState.IsVisible;
        if (!shouldShowIcon)
        {
            RemoveTrayIcon();
            return;
        }

        _currentIcon?.Dispose();
        _currentIcon = WindowsTrayIconRenderer.Create(_trayState);

        var data = CreateNotifyIconData();
        data.uFlags = NifMessage | NifIcon | NifTip;
        data.hIcon = _currentIcon.Handle;
        data.szTip = BuildTooltip(_trayState);

        var command = _trayVisible ? NimModify : NimAdd;
        if (!ShellNotifyIcon(command, ref data))
        {
            WindowsLog.Info($"Tray icon command failed: {command}");
            return;
        }

        if (!_trayVisible)
        {
            _trayVisible = true;
            var versionData = CreateNotifyIconData();
            ShellNotifyIcon(NimSetVersion, ref versionData);
        }
    }

    private void RemoveTrayIcon()
    {
        if (!_trayVisible || _hwnd == IntPtr.Zero)
        {
            return;
        }

        var data = CreateNotifyIconData();
        ShellNotifyIcon(NimDelete, ref data);
        _trayVisible = false;
    }

    private string BuildTooltip(TrayProgressState state)
    {
        var tooltip = _hiddenToTray && string.IsNullOrWhiteSpace(state.Tooltip)
            ? $"{_title} · работает в фоне"
            : string.IsNullOrWhiteSpace(state.Tooltip)
                ? _title
                : state.Tooltip;
        return tooltip.Length > 120 ? tooltip[..120] : tooltip;
    }

    private NOTIFYICONDATA CreateNotifyIconData() =>
        new()
        {
            cbSize = (uint)Marshal.SizeOf<NOTIFYICONDATA>(),
            hWnd = _hwnd,
            uID = _trayIconId,
            uCallbackMessage = TrayCallbackMessage,
            szTip = string.Empty,
            szInfo = string.Empty,
            szInfoTitle = string.Empty,
            Anonymous = new NotifyIconDataUnion
            {
                uVersion = NotifyIconVersion4
            }
        };

    private IntPtr WindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (message == WmGetMinMaxInfo)
            {
                ApplyMinTrackSize(lParam);
                return IntPtr.Zero;
            }

            if (message == WmClose)
            {
                if (_allowNextClose)
                {
                    _allowNextClose = false;
                }
                else if (ShouldMinimizeToTray())
                {
                    HideToTray();
                    return IntPtr.Zero;
                }
            }

            if (message == WmCopyData)
            {
                HandleLaunchArguments(lParam);
                return IntPtr.Zero;
            }

            if (message == TrayCallbackMessage)
            {
                var callback = GetTrayCallbackEvent(lParam);
                if (callback is WmLButtonUp or WmLButtonDblClk or NinSelect or NinKeySelect)
                {
                    RestoreFromTray();
                    return IntPtr.Zero;
                }
                if (callback is WmRButtonUp or WmContextMenu)
                {
                    ShowTrayContextMenu(wParam, callback == WmContextMenu);
                    return IntPtr.Zero;
                }
            }

            if (message == _taskbarCreatedMessage)
            {
                _trayVisible = false;
                ApplyTrayState();
                return IntPtr.Zero;
            }

            if (message == WmDestroy)
            {
                RemoveTrayIcon();
            }
        }
        catch (Exception ex)
        {
            WindowsLog.Error($"Window lifecycle hook failed for message 0x{message:X}", ex);
        }

        return CallWindowProc(_previousWndProc, hwnd, message, wParam, lParam);
    }

    private void HandleLaunchArguments(IntPtr lParam)
    {
        if (lParam == IntPtr.Zero)
        {
            return;
        }

        var copyData = Marshal.PtrToStructure<COPYDATASTRUCT>(lParam);
        if (copyData.dwData != new IntPtr(InstallLayout.LaunchArgsCopyDataSignature)
            || copyData.cbData <= 0
            || copyData.lpData == IntPtr.Zero)
        {
            return;
        }

        var charCount = Math.Max(0, (copyData.cbData / 2) - 1);
        var payload = Marshal.PtrToStringUni(copyData.lpData, charCount)?.Trim();
        if (string.IsNullOrWhiteSpace(payload))
        {
            return;
        }

        string[]? launchArguments = null;
        try
        {
            launchArguments = JsonSerializer.Deserialize<string[]>(payload);
        }
        catch (JsonException)
        {
        }

        if (launchArguments is null || launchArguments.Length == 0)
        {
            launchArguments = [payload];
        }

        WindowsLog.Info($"Forwarded launch arguments received: count={launchArguments.Length}");
        LaunchArgumentsReceived?.Invoke(launchArguments);
    }

    private void ApplyMinTrackSize(IntPtr lParam)
    {
        if (lParam == IntPtr.Zero)
        {
            return;
        }

        var info = Marshal.PtrToStructure<MINMAXINFO>(lParam);
        var dpi = GetDpiForWindow(_hwnd);
        var scale = dpi <= 0 ? 1.0 : dpi / 96.0;
        info.ptMinTrackSize.x = Math.Max(info.ptMinTrackSize.x, (int)Math.Ceiling(_minimumWidth * scale));
        info.ptMinTrackSize.y = Math.Max(info.ptMinTrackSize.y, (int)Math.Ceiling(_minimumHeight * scale));
        Marshal.StructureToPtr(info, lParam, false);
    }

    private bool ShouldMinimizeToTray()
    {
        try
        {
            return _shouldMinimizeToTray?.Invoke() ?? false;
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Tray close predicate failed", ex);
            return false;
        }
    }

    private void ShowTrayContextMenu(IntPtr wParam, bool useAnchorCoordinates)
    {
        if (_hwnd == IntPtr.Zero)
        {
            return;
        }

        IntPtr menu = IntPtr.Zero;
        try
        {
            menu = CreatePopupMenu();
            if (menu == IntPtr.Zero)
            {
                return;
            }

            AppendMenu(menu, MfString, TrayCommandOpen, "Открыть");
            AppendMenu(menu, MfString, TrayCommandExit, "Выйти");
            SetForegroundWindow(_hwnd);
            var point = ResolveContextMenuPoint(wParam, useAnchorCoordinates);
            var command = TrackPopupMenuEx(
                menu,
                TpmLeftAlign | TpmBottomAlign | TpmRightButton | TpmReturnCommand,
                point.x,
                point.y,
                _hwnd,
                IntPtr.Zero);
            PostMessage(_hwnd, WmNull, IntPtr.Zero, IntPtr.Zero);

            if (command == TrayCommandOpen)
            {
                RestoreFromTray();
            }
            else if (command == TrayCommandExit)
            {
                ExitRequested?.Invoke();
            }
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Tray context menu failed", ex);
        }
        finally
        {
            if (menu != IntPtr.Zero)
            {
                DestroyMenu(menu);
            }
        }
    }

    private static uint GetTrayCallbackEvent(IntPtr lParam)
    {
        var value = unchecked((ulong)lParam.ToInt64());
        return (uint)(value & 0xFFFF);
    }

    private POINT ResolveContextMenuPoint(IntPtr wParam, bool useAnchorCoordinates)
    {
        if (useAnchorCoordinates)
        {
            return new POINT
            {
                x = GetSignedLowWord(wParam),
                y = GetSignedHighWord(wParam)
            };
        }

        GetCursorPos(out var point);
        return point;
    }

    private static int GetSignedLowWord(IntPtr value) => unchecked((short)value.ToInt64());

    private static int GetSignedHighWord(IntPtr value) => unchecked((short)(value.ToInt64() >> 16));

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct COPYDATASTRUCT
    {
        public IntPtr dwData;
        public int cbData;
        public IntPtr lpData;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATA
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;
        public NotifyIconDataUnion Anonymous;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct NotifyIconDataUnion
    {
        [FieldOffset(0)]
        public uint uTimeout;

        [FieldOffset(0)]
        public uint uVersion;
    }

    private delegate IntPtr WndProcDelegate(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIcon(uint message, ref NOTIFYICONDATA data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string text);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool AppendMenu(IntPtr menu, uint flags, uint itemId, string text);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint TrackPopupMenuEx(IntPtr menu, uint flags, int x, int y, IntPtr hwnd, IntPtr rect);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyMenu(IntPtr menu);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr newProc);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CallWindowProc(IntPtr previousProc, IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool ShowWindow(IntPtr hwnd, uint command);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);

    [DllImport("kernel32.dll")]
    private static extern void SetLastError(uint errorCode);

    private static bool ShellNotifyIcon(uint message, ref NOTIFYICONDATA data)
    {
        try
        {
            return Shell_NotifyIcon(message, ref data);
        }
        catch (Exception ex)
        {
            WindowsLog.Error($"Shell_NotifyIcon failed for command {message}", ex);
            return false;
        }
    }
}

public sealed class WindowsWindowLifecycleOptions
{
    public int MinimumWidth { get; init; } = 920;
    public int MinimumHeight { get; init; } = 640;
    public string Title { get; init; } = "NeuralV";
    public Func<bool>? ShouldMinimizeToTray { get; init; }
    public Func<TrayProgressState>? TrayStateProvider { get; init; }
    public TrayProgressState? InitialTrayState { get; init; }
}
