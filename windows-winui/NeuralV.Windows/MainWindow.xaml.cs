using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Media.Imaging;
using NeuralV.Windows.Models;
using NeuralV.Windows.Services;
using Windows.Foundation;
using Windows.Storage.Pickers;
using UiColor = global::Windows.UI.Color;
using UiEllipse = Microsoft.UI.Xaml.Shapes.Ellipse;
using UiRectangle = Microsoft.UI.Xaml.Shapes.Rectangle;
using WinRT.Interop;

namespace NeuralV.Windows;

public sealed partial class MainWindow : Window
{
    private sealed class FloatingShape
    {
        public Border Element { get; init; } = default!;
        public int Variant { get; set; }
        public double Angle { get; set; }
        public double AngularVelocity { get; set; }
        public double VelocityX { get; set; }
        public double VelocityY { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
        public bool Positioned { get; set; }
    }

    private readonly NeuralVApiClient _apiClient = new();
    private readonly string _deviceId;
    private readonly string _currentVersion = VersionInfo.Current;
    private readonly Grid _windowRoot = new();
    private readonly ObservableCollection<string> _historyItems = new();
    private readonly ObservableCollection<string> _scanTimeline = new();
    private readonly List<StoredScanRecord> _historyRecords = new();
    private readonly List<FloatingShape> _floatingShapes = new();
    private readonly Stopwatch _shapeStopwatch = Stopwatch.StartNew();
    private readonly Random _random = new();

    private SessionData? _session;
    private ChallengeTicket? _challenge;
    private DesktopScanState? _activeScan;
    private NetworkProtectionState _networkState = new();
    private ClientPreferences _preferences = new();
    private CancellationTokenSource? _scanPollCts;
    private bool _initialized;
    private bool _drawerOpen;
    private bool _scanOverlayOpen;
    private bool _networkUiSync;
    private bool _preferenceUiSync;
    private bool _scanOverlayFallbackPreferred = true;
    private bool _layoutBuilt;
    private bool _shapeAnimationRunning;
    private AppScreen _screen = AppScreen.Splash;
    private IntPtr _windowHandle;
    private AppWindow? _appWindow;
    private Canvas? _welcomeShapeCanvas;
    private Point? _welcomePointer;
    private TimeSpan _lastShapeRenderTimestamp;

    private UiRectangle BackdropGradient = default!;
    private UiRectangle FabricLayerA = default!;
    private UiRectangle FabricLayerB = default!;
    private UiRectangle FabricLayerC = default!;
    private UiEllipse GlowA = default!;
    private UiEllipse GlowB = default!;
    private UiEllipse GlowC = default!;

    private Border DrawerScrim = default!;
    private Border DrawerPanel = default!;
    private Border BusyOverlay = default!;
    private Border StatusBanner = default!;
    private Grid ScreenHost = default!;
    private Grid ShellRoot = default!;
    private TextBlock FooterVersionText = default!;
    private Grid TopBar = default!;
    private Grid AuthBackdropLayer = default!;
    private Grid ScanOverlay = default!;
    private Grid HistoryDetailOverlay = default!;
    private TextBlock HeaderTitleText = default!;
    private TextBlock HeaderSubtitleText = default!;
    private TextBlock AccountChipText = default!;
    private TextBlock StatusBannerText = default!;
    private TextBlock BusyText = default!;
    private TextBlock DrawerUserNameText = default!;
    private TextBlock DrawerUserMetaText = default!;

    private FrameworkElement SplashView = default!;
    private FrameworkElement WelcomeView = default!;
    private FrameworkElement LoginView = default!;
    private FrameworkElement RegisterView = default!;
    private FrameworkElement CodeView = default!;
    private FrameworkElement HomeView = default!;
    private FrameworkElement HistoryView = default!;
    private FrameworkElement SettingsView = default!;

    private TextBox LoginEmailBox = default!;
    private PasswordBox LoginPasswordBox = default!;
    private TextBox RegisterNameBox = default!;
    private TextBox RegisterEmailBox = default!;
    private PasswordBox RegisterPasswordBox = default!;
    private PasswordBox RegisterPasswordRepeatBox = default!;
    private TextBox VerificationCodeBox = default!;
    private TextBlock CodeHintText = default!;

    private TextBlock HomeHeroTitleText = default!;
    private TextBlock HomeHeroSubtitleText = default!;
    private Border ActiveScanCard = default!;
    private TextBlock ActiveScanCardTitleText = default!;
    private TextBlock ActiveScanCardMetaText = default!;
    private FrameworkElement HomePrimaryContent = default!;
    private Border HomeNetworkCard = default!;
    private ToggleSwitch NetworkProtectionToggle = default!;
    private ToggleSwitch AdBlockToggle = default!;
    private ToggleSwitch UnsafeSitesToggle = default!;
    private TextBlock NetworkCountersText = default!;

    private TextBlock ScanModeText = default!;
    private TextBlock ScanStageText = default!;
    private TextBlock ScanProgressText = default!;
    private TextBlock ScanCountsText = default!;
    private TextBlock ScanTargetText = default!;
    private ProgressBar ScanProgressBar = default!;
    private StackPanel ScanTimelineHost = default!;

    private StackPanel HistoryItemsHost = default!;
    private TextBlock HistoryDetailTitleText = default!;
    private TextBlock HistoryDetailMetaText = default!;
    private StackPanel HistoryDetailContentHost = default!;
    private TextBlock SettingsAccountText = default!;
    private TextBlock SettingsDeveloperText = default!;
    private TextBlock SettingsVersionText = default!;
    private ComboBox ThemeModeCombo = default!;
    private ToggleSwitch DynamicColorsToggle = default!;
    private ToggleSwitch AutoStartToggle = default!;
    private ToggleSwitch SettingsNetworkToggle = default!;
    private ToggleSwitch SettingsAdToggle = default!;
    private ToggleSwitch SettingsUnsafeToggle = default!;
    private int _developerTapCount;

    public MainWindow()
    {
        try
        {
            _deviceId = EnsureDeviceIdSafe();
            Content = _windowRoot;
            Title = "NeuralV";
            _windowRoot.Loaded += OnRootLoaded;
            Closed += OnClosed;

            BuildBootstrapLayout();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("MainWindow ctor failed", ex);
            throw;
        }
    }

    public void RunSmokeValidation()
    {
        EnsureFullLayoutBuilt();
        TryConfigureWindowHandle();
        ApplyAmbientPalette();
        ShowScreen(AppScreen.Welcome);
        SetStatus("Smoke test completed.");
    }

    private static string EnsureDeviceIdSafe()
    {
        try
        {
            return SessionStore.EnsureDeviceId();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Device id bootstrap failed, using ephemeral id", ex);
            return Guid.NewGuid().ToString("D");
        }
    }

    private async void OnRootLoaded(object sender, RoutedEventArgs e)
    {
        if (_initialized)
        {
            return;
        }

        _initialized = true;
        WindowsLog.Info("Main window root loaded");
        try
        {
            _windowRoot.Background = new SolidColorBrush(UiColor.FromArgb(0xFF, 0x10, 0x12, 0x18));
            _windowRoot.PointerMoved += OnAuthBackdropPointerMoved;
            _windowRoot.PointerExited += OnAuthBackdropPointerExited;
            WindowsLog.Info("Building full layout after bootstrap");
            EnsureFullLayoutBuilt();
            WindowsLog.Info("Configuring window handle");
            TryConfigureWindowHandle();
            WindowsLog.Info("Applying ambient palette on load");
            ApplyAmbientPalette();
            WindowsLog.Info("Preparing interactive auth background");
            await InitializeAsync();
            WindowsLog.Info("Scheduling window lifecycle after initialization");
            if (!DispatcherQueue.TryEnqueue(() =>
                {
                    try
                    {
                        WindowsLog.Info("Ensuring window lifecycle on deferred UI tick");
                        App.EnsureWindowLifecycle(this);
                        HookWindowLifecycle();
                    }
                    catch (Exception lifecycleEx)
                    {
                        WindowsLog.Error("Deferred window lifecycle attach failed", lifecycleEx);
                    }
                }))
            {
                WindowsLog.Info("Dispatcher queue unavailable, attaching window lifecycle immediately");
                App.EnsureWindowLifecycle(this);
                HookWindowLifecycle();
            }
        }
        catch (Exception ex)
        {
            WindowsLog.Error("OnRootLoaded failed", ex);
            SetStatus("Не удалось завершить старт интерфейса. Подробности в log.txt.");
        }
    }

    private void BuildBootstrapLayout()
    {
        _windowRoot.Children.Clear();

        var boot = new Grid
        {
            Background = new SolidColorBrush(UiColor.FromArgb(0xFF, 0x10, 0x12, 0x18))
        };
        _windowRoot.Children.Add(boot);
        _layoutBuilt = false;
    }

    private void EnsureFullLayoutBuilt()
    {
        if (_layoutBuilt)
        {
            return;
        }

        BuildLayout();
        _layoutBuilt = true;
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        if (App.WindowLifecycle is not null)
        {
            App.WindowLifecycle.RestoreRequested -= OnRestoreRequested;
            App.WindowLifecycle.ExitRequested -= OnTrayExitRequested;
        }
        StopShapeAnimation();
        _scanPollCts?.Cancel();
        _apiClient.Dispose();
    }

    private void TryConfigureWindowHandle()
    {
        try
        {
            _windowHandle = WindowNative.GetWindowHandle(this);
            if (_windowHandle == IntPtr.Zero)
            {
                return;
            }

            var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(_windowHandle);
            _appWindow = AppWindow.GetFromWindowId(windowId);
            Title = "NeuralV";
            if (_appWindow is not null)
            {
                _appWindow.Title = "NeuralV";
                var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "NeuralV.ico");
                if (File.Exists(iconPath))
                {
                    _appWindow.SetIcon(iconPath);
                }
            }
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Window handle setup failed", ex);
        }
    }

    private async Task InitializeAsync()
    {
        SetBusy(true, "Поднимаем Windows-клиент");
        WindowsLog.Info("InitializeAsync started");

        try
        {
            _preferences = ClientPreferencesStore.Load();
            _networkState = BuildLocalNetworkFallback();
            _session = await SessionStore.LoadSessionAsync();

            if (_session is { IsValid: true })
            {
                var refresh = await _apiClient.RefreshSessionAsync(_session);
                if (refresh.session is { IsValid: true } refreshed)
                {
                    _session = refreshed;
                    await SessionStore.SaveSessionAsync(refreshed);
                }
                else
                {
                    var refreshError = refresh.error ?? "unknown";
                    WindowsLog.Info($"Session refresh soft-failed: {refreshError}");
                    if (ShouldInvalidateSession(refreshError))
                    {
                        WindowsLog.Info("Session marked invalid after refresh failure, clearing local session");
                        _session = null;
                        SessionStore.ClearSession();
                    }
                }
            }
            else
            {
                _session = null;
            }

            await LoadHistoryAsync();
            await LoadNetworkProtectionStateAsync();
            ApplySessionState();
            HookWindowLifecycle();
            ShowScreen(_session is null ? AppScreen.Welcome : AppScreen.Home);
        }
        catch (Exception ex)
        {
            WindowsLog.Error("InitializeAsync failed", ex);
            ShowScreen(AppScreen.Welcome);
            SetStatus("Не удалось подготовить интерфейс. Подробности в log.txt.");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task LoadHistoryAsync(CancellationToken cancellationToken = default)
    {
        _historyItems.Clear();
        _historyRecords.Clear();
        var history = await HistoryStore.LoadAsync(cancellationToken);
        _historyRecords.AddRange(history);
        foreach (var item in history)
        {
            _historyItems.Add($"{item.SavedAt.LocalDateTime:dd.MM HH:mm} · {item.Mode} · {item.Verdict}");
        }

        if (_historyItems.Count == 0)
        {
            _historyItems.Add("История появится после первой завершённой проверки.");
        }
    }

    private NetworkProtectionState BuildLocalNetworkFallback()
    {
        var enabled = _preferences.NetworkProtectionEnabled;
        return new NetworkProtectionState
        {
            Platform = "windows",
            NetworkEnabled = enabled,
            AdBlockEnabled = enabled,
            UnsafeSitesEnabled = enabled,
            BlockedAdsPlatform = _preferences.BlockedAds,
            BlockedThreatsPlatform = _preferences.BlockedThreats,
            BlockedAdsTotal = _preferences.BlockedAds,
            BlockedThreatsTotal = _preferences.BlockedThreats,
            DeveloperMode = _preferences.DeveloperModeEnabled
        };
    }

    private async Task LoadNetworkProtectionStateAsync(CancellationToken cancellationToken = default)
    {
        if (_session is null)
        {
            _networkState = BuildLocalNetworkFallback();
            UpdateNetworkUi();
            return;
        }

        try
        {
            var result = await _apiClient.GetNetworkProtectionStateAsync(_session, "windows", cancellationToken);
            if (result.state is not null)
            {
                _networkState = result.state;
                _preferences = await ClientPreferencesStateService.ApplyRemoteNetworkStateAsync(result.state, cancellationToken);
            }
            else if (!string.IsNullOrWhiteSpace(result.error))
            {
                WindowsLog.Error($"Network protection state error: {result.error}");
            }
        }
        catch (Exception ex)
        {
            WindowsLog.Error("LoadNetworkProtectionStateAsync failed", ex);
        }

        UpdateNetworkUi();
    }

    private static bool ShouldInvalidateSession(string? error)
    {
        var normalizedError = (error ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedError))
        {
            return false;
        }

        return normalizedError.Contains("invalid")
            || normalizedError.Contains("expired")
            || normalizedError.Contains("revoked")
            || normalizedError.Contains("session not found")
            || normalizedError.Contains("device mismatch")
            || normalizedError.Contains("not authorized")
            || normalizedError.Contains("unauthorized")
            || normalizedError.Contains("forbidden");
    }

    private void BuildLayout()
    {
        WindowsLog.Info("BuildLayout: reset root");
        _windowRoot.Children.Clear();
        _floatingShapes.Clear();
        _welcomePointer = null;
        _welcomeShapeCanvas = null;
        _layoutBuilt = true;
        _windowRoot.MinWidth = 920;
        _windowRoot.MinHeight = 640;

        WindowsLog.Info("BuildLayout: ambient layer");
        var ambientLayer = new Grid();
        BackdropGradient = new UiRectangle();
        FabricLayerA = new UiRectangle
        {
            Width = 1800,
            Height = 920,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(-280, -180, 0, 0),
            Opacity = 0.18
        };
        FabricLayerB = new UiRectangle
        {
            Width = 1700,
            Height = 960,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, -120, -220, 0),
            Opacity = 0.14
        };
        FabricLayerC = new UiRectangle
        {
            Width = 1650,
            Height = 940,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 0, -260),
            Opacity = 0.10
        };
        GlowA = new UiEllipse
        {
            Width = 560,
            Height = 560,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(-120, -80, 0, 0),
            Opacity = 0.28
        };
        GlowB = new UiEllipse
        {
            Width = 700,
            Height = 700,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, -180, -180),
            Opacity = 0.22
        };
        GlowC = new UiEllipse
        {
            Width = 460,
            Height = 460,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 0, -150),
            Opacity = 0.16
        };

        ambientLayer.Children.Add(BackdropGradient);
        ambientLayer.Children.Add(FabricLayerA);
        ambientLayer.Children.Add(FabricLayerB);
        ambientLayer.Children.Add(FabricLayerC);
        ambientLayer.Children.Add(GlowA);
        ambientLayer.Children.Add(GlowB);
        ambientLayer.Children.Add(GlowC);
        _windowRoot.Children.Add(ambientLayer);

        WindowsLog.Info("BuildLayout: shell");
        ShellRoot = new Grid
        {
            Padding = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch
        };
        ShellRoot.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        ShellRoot.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        ShellRoot.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Canvas.SetZIndex(ShellRoot, 20);
        _windowRoot.Children.Add(ShellRoot);

        WindowsLog.Info("BuildLayout: top bar");
        TopBar = BuildTopBar();
        ShellRoot.Children.Add(TopBar);

        WindowsLog.Info("BuildLayout: status banner");
        StatusBanner = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 18, new Thickness(14, 10, 14, 10));
        StatusBanner.Visibility = Visibility.Collapsed;
        StatusBanner.Margin = new Thickness(0, 0, 0, 14);
        Grid.SetRow(StatusBanner, 1);
        StatusBannerText = CreateBodyText("AppTextBrush");
        StatusBanner.Child = StatusBannerText;
        ShellRoot.Children.Add(StatusBanner);

        WindowsLog.Info("BuildLayout: screen host");
        ScreenHost = new Grid();
        Grid.SetRow(ScreenHost, 2);
        ShellRoot.Children.Add(ScreenHost);

        WindowsLog.Info("BuildLayout: splash");
        SplashView = BuildSplashViewSafe();
        WelcomeView = null!;
        LoginView = null!;
        RegisterView = null!;
        CodeView = null!;
        HomeView = null!;
        HistoryView = null!;
        SettingsView = null!;

        ScreenHost.Children.Add(SplashView);

        WindowsLog.Info("BuildLayout: defer heavy overlays");
        AuthBackdropLayer = null!;
        ScanOverlay = null!;
        HistoryDetailOverlay = null!;

        WindowsLog.Info("BuildLayout: drawer scrim");
        DrawerScrim = new Border
        {
            Background = ThemeBrush("AppOverlayScrimBrush"),
            Visibility = Visibility.Collapsed,
            Opacity = 0
        };
        DrawerScrim.Tapped += (_, _) => SetDrawerState(false);
        Canvas.SetZIndex(DrawerScrim, 60);
        _windowRoot.Children.Add(DrawerScrim);

        WindowsLog.Info("BuildLayout: drawer deferred");
        DrawerPanel = null!;

        WindowsLog.Info("BuildLayout: busy overlay");
        BusyOverlay = new Border
        {
            Background = ThemeBrush("AppOverlayScrimBrush"),
            Visibility = Visibility.Collapsed
        };
        Canvas.SetZIndex(BusyOverlay, 80);
        var busyCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineStrongBrush", 22, new Thickness(22));
        busyCard.Width = 320;
        busyCard.HorizontalAlignment = HorizontalAlignment.Center;
        busyCard.VerticalAlignment = VerticalAlignment.Center;
        BusyText = new TextBlock
        {
            Foreground = ThemeBrush("AppTextBrush"),
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            FontSize = 18,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Text = "Загрузка"
        };
        busyCard.Child = BusyText;
        BusyOverlay.Child = busyCard;
        _windowRoot.Children.Add(BusyOverlay);

        WindowsLog.Info("BuildLayout: version badge");
        var versionBadge = BuildVersionBadge();
        Canvas.SetZIndex(versionBadge, 30);
        _windowRoot.Children.Add(versionBadge);
        UpdateVersionBadge();

        WindowsLog.Info("BuildLayout: ambient palette");
        ApplyAmbientPalette();
        WindowsLog.Info("BuildLayout: complete");
    }

    private Grid BuildTopBar()
    {
        var topBar = new Grid
        {
            Margin = new Thickness(0, 0, 0, 14),
            HorizontalAlignment = HorizontalAlignment.Stretch
        };
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(56) });
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(56) });

        var drawerButton = CreateIconButton("☰", OnToggleDrawerClick);
        drawerButton.HorizontalAlignment = HorizontalAlignment.Center;
        drawerButton.VerticalAlignment = VerticalAlignment.Center;
        topBar.Children.Add(drawerButton);

        var titleStack = new Grid
        {
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center
        };
        Grid.SetColumn(titleStack, 1);
        HeaderTitleText = new TextBlock
        {
            Text = "NeuralV",
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = 30,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            TextAlignment = TextAlignment.Center
        };
        titleStack.Children.Add(HeaderTitleText);
        HeaderSubtitleText = new TextBlock { Visibility = Visibility.Collapsed };
        AccountChipText = new TextBlock { Visibility = Visibility.Collapsed };
        topBar.Children.Add(titleStack);

        var rightSpacer = new Border
        {
            Width = 56,
            Height = 56,
            Opacity = 0
        };
        Grid.SetColumn(rightSpacer, 2);
        topBar.Children.Add(rightSpacer);

        return topBar;
    }

    private Border BuildDrawerPanel()
    {
        var panel = CreateCardBorder("AppSurfaceBrush", "AppOutlineStrongBrush", 28, new Thickness(18));
        panel.Width = 300;
        panel.HorizontalAlignment = HorizontalAlignment.Left;
        panel.VerticalAlignment = VerticalAlignment.Stretch;
        panel.Margin = new Thickness(22);
        panel.Child = BuildDrawerContent();
        return panel;
    }

    private UIElement BuildDrawerContent()
    {
        var stack = new StackPanel { Spacing = 16 };

        var userCard = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineBrush", 22, new Thickness(16));
        var userStack = new StackPanel { Spacing = 6 };
        DrawerUserNameText = new TextBlock
        {
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = 20,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold
        };
        DrawerUserMetaText = CreateBodyText("AppMutedTextBrush");
        userStack.Children.Add(DrawerUserNameText);
        userStack.Children.Add(DrawerUserMetaText);
        userCard.Child = userStack;
        stack.Children.Add(userCard);

        stack.Children.Add(CreateDrawerButton("Главная", OnHomeClick));
        stack.Children.Add(CreateDrawerButton("История", OnHistoryClick));
        stack.Children.Add(CreateDrawerButton("Настройки", OnSettingsClick));
        return stack;
    }

    private FrameworkElement BuildSplashView()
    {
        var host = new Grid();
        var stack = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 14,
            MaxWidth = 520
        };
        host.Children.Add(stack);

        var logoCard = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineStrongBrush", 32, new Thickness(18));
        logoCard.Width = 132;
        logoCard.Height = 132;
        logoCard.HorizontalAlignment = HorizontalAlignment.Center;
        logoCard.Child = CreateLogoElement();
        stack.Children.Add(logoCard);
        stack.Children.Add(CreateTitleText("Запускаем NeuralV", 36));
        return host;
    }

    private FrameworkElement BuildSplashViewSafe()
    {
        try
        {
            return BuildSplashView();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("BuildSplashView failed, using minimal splash", ex);
            var host = new Grid();
            host.Children.Add(new TextBlock
            {
                Text = "NeuralV",
                Foreground = ThemeBrush("AppTextBrush"),
                FontSize = 28,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                TextAlignment = TextAlignment.Center
            });
            return host;
        }
    }

    private FrameworkElement BuildWelcomeView()
    {
        var host = new Grid();

        var centerStack = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 18,
            MaxWidth = 420
        };
        host.Children.Add(centerStack);

        var actions = new StackPanel
        {
            MaxWidth = 360,
            Width = 360,
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center
        };
        var loginButton = CreateFilledButton("Войти", OnShowLoginClick);
        loginButton.HorizontalAlignment = HorizontalAlignment.Stretch;
        actions.Children.Add(loginButton);

        var registerButton = CreateTonalButton("Зарегистрироваться", OnShowRegisterClick);
        registerButton.HorizontalAlignment = HorizontalAlignment.Stretch;
        actions.Children.Add(registerButton);
        centerStack.Children.Add(actions);
        return host;
    }

    private Grid BuildAuthBackdropLayer()
    {
        var host = new Grid
        {
            IsHitTestVisible = false,
            Background = new SolidColorBrush(UiColor.FromArgb(1, 0, 0, 0))
        };
        host.SizeChanged += OnAuthBackdropSizeChanged;

        _welcomeShapeCanvas = new Canvas
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch
        };
        host.Children.Add(_welcomeShapeCanvas);

        EnsureFloatingShapes();
        return host;
    }

    private void EnsureAuthBackdropLayerReady()
    {
        if (AuthBackdropLayer is not null)
        {
            return;
        }

        WindowsLog.Info("Creating deferred auth backdrop layer");
        AuthBackdropLayer = BuildAuthBackdropLayer();
        AuthBackdropLayer.Visibility = Visibility.Collapsed;
        Canvas.SetZIndex(AuthBackdropLayer, 4);
        _windowRoot.Children.Add(AuthBackdropLayer);
        WindowsLog.Info("Deferred auth backdrop layer attached");
    }

    private void EnsureFloatingShapes()
    {
        if (_welcomeShapeCanvas is null || _floatingShapes.Count > 0)
        {
            return;
        }

        for (var index = 0; index < 12; index++)
        {
            var shape = CreateFloatingShape(index % 6);
            _floatingShapes.Add(shape);
            _welcomeShapeCanvas.Children.Add(shape.Element);
        }
    }

    private FloatingShape CreateFloatingShape(int variant)
    {
        var shape = new Border
        {
            Background = BuildWeaveBrush(App.Palette.Accent, App.Palette.AccentSecondary, 0.42, 0.72),
            BorderBrush = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.Text, 0.16)),
            BorderThickness = new Thickness(1),
            Opacity = 1,
            RenderTransformOrigin = new Point(0.5, 0.5),
            RenderTransform = new RotateTransform { Angle = variant * 12 }
        };

        var model = new FloatingShape
        {
            Element = shape,
            Variant = variant,
            Angle = variant * 12,
            AngularVelocity = (_random.NextDouble() - 0.5) * 2.8,
            VelocityX = (_random.NextDouble() - 0.5) * 7.4,
            VelocityY = (_random.NextDouble() - 0.5) * 7.4
        };

        ApplyShapeVariant(model, variant);
        return model;
    }

    private FrameworkElement BuildLoginView()
    {
        var cardStack = new StackPanel { Spacing = 12 };
        cardStack.Children.Add(CreateTitleText("Вход", 34));
        cardStack.Children.Add(CreateFieldLabel("E-mail"));
        LoginEmailBox = CreateTextBox("name@example.com");
        cardStack.Children.Add(LoginEmailBox);
        cardStack.Children.Add(CreateFieldLabel("Пароль"));
        LoginPasswordBox = CreatePasswordBox();
        cardStack.Children.Add(LoginPasswordBox);
        var resetButton = CreateTonalButton("Сбросить пароль", OnRequestPasswordResetClick);
        resetButton.HorizontalAlignment = HorizontalAlignment.Left;
        cardStack.Children.Add(resetButton);
        cardStack.Children.Add(CreateActionRow(
            CreateTonalButton("Назад", OnBackToWelcomeClick),
            CreateFilledButton("Продолжить", OnStartLoginClick)));
        return BuildCenteredStage(cardStack);
    }

    private FrameworkElement BuildRegisterView()
    {
        var cardStack = new StackPanel { Spacing = 12 };
        cardStack.Children.Add(CreateTitleText("Регистрация", 34));
        cardStack.Children.Add(CreateFieldLabel("Имя"));
        RegisterNameBox = CreateTextBox();
        cardStack.Children.Add(RegisterNameBox);
        cardStack.Children.Add(CreateFieldLabel("E-mail"));
        RegisterEmailBox = CreateTextBox("name@example.com");
        cardStack.Children.Add(RegisterEmailBox);
        cardStack.Children.Add(CreateFieldLabel("Пароль"));
        RegisterPasswordBox = CreatePasswordBox();
        cardStack.Children.Add(RegisterPasswordBox);
        cardStack.Children.Add(CreateFieldLabel("Повтори пароль"));
        RegisterPasswordRepeatBox = CreatePasswordBox();
        cardStack.Children.Add(RegisterPasswordRepeatBox);
        cardStack.Children.Add(CreateActionRow(
            CreateTonalButton("Назад", OnBackToWelcomeClick),
            CreateFilledButton("Создать аккаунт", OnStartRegisterClick)));
        return BuildCenteredStage(cardStack);
    }

    private FrameworkElement BuildCodeView()
    {
        var cardStack = new StackPanel { Spacing = 12 };
        cardStack.Children.Add(CreateTitleText("Подтверждение", 34));
        CodeHintText = CreateSubtitleText(string.Empty);
        cardStack.Children.Add(CodeHintText);
        cardStack.Children.Add(CreateFieldLabel("Код"));
        VerificationCodeBox = CreateTextBox("123456");
        cardStack.Children.Add(VerificationCodeBox);
        cardStack.Children.Add(CreateActionRow(
            CreateTonalButton("Назад", OnBackFromCodeClick),
            CreateFilledButton("Войти", OnVerifyCodeClick)));
        return BuildCenteredStage(cardStack);
    }

    private FrameworkElement BuildCenteredStage(UIElement content)
    {
        var host = new Grid();
        var card = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineStrongBrush", new CornerRadius(30, 30, 24, 24), new Thickness(26));
        card.MaxWidth = 620;
        card.HorizontalAlignment = HorizontalAlignment.Center;
        card.VerticalAlignment = VerticalAlignment.Center;
        card.Child = content;
        host.Children.Add(card);
        return host;
    }

    private FrameworkElement BuildHomeView()
    {
        var host = new Grid
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 4, 0, 0)
        };
        var centeredHost = new Grid
        {
            MaxWidth = 1120,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Top
        };
        centeredHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        centeredHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        host.Children.Add(centeredHost);

        var stack = new StackPanel
        {
            Spacing = 18,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top
        };
        Grid.SetRow(stack, 1);
        centeredHost.Children.Add(stack);

        ActiveScanCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineStrongBrush", 24, new Thickness(18));
        ActiveScanCard.Visibility = Visibility.Collapsed;
        var activeGrid = new Grid();
        activeGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        activeGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var activeText = new StackPanel { Spacing = 4 };
        ActiveScanCardTitleText = CreateSectionTitle("Проверка продолжается", 22);
        ActiveScanCardMetaText = CreateBodyText("AppMutedTextBrush");
        activeText.Children.Add(ActiveScanCardTitleText);
        activeText.Children.Add(ActiveScanCardMetaText);
        activeGrid.Children.Add(activeText);
        var openScanButton = CreateFilledButton("Вернуться", OnOpenScanOverlayClick);
        Grid.SetColumn(openScanButton, 1);
        activeGrid.Children.Add(openScanButton);
        ActiveScanCard.Child = activeGrid;
        Grid.SetRow(ActiveScanCard, 0);
        centeredHost.Children.Add(ActiveScanCard);

        var content = new Grid();
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        HomePrimaryContent = content;
        stack.Children.Add(content);

        var modes = new Grid
        {
            HorizontalAlignment = HorizontalAlignment.Stretch
        };
        modes.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        modes.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
        modes.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        modes.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        modes.RowDefinitions.Add(new RowDefinition { Height = new GridLength(18) });
        modes.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var deepCard = CreateWideModePanel("Глубокая", "◈", OnDeepScanClick);
        Grid.SetColumnSpan(deepCard, 3);
        Grid.SetRow(deepCard, 0);
        modes.Children.Add(deepCard);

        var quickCard = CreateGridModePanel("Быстрая", "⚡", OnQuickScanClick, true);
        Grid.SetColumn(quickCard, 0);
        Grid.SetRow(quickCard, 2);
        modes.Children.Add(quickCard);

        var selectiveCard = CreateGridModePanel("Выборочная", "◎", OnSelectiveScanClick, false);
        Grid.SetColumn(selectiveCard, 2);
        Grid.SetRow(selectiveCard, 2);
        modes.Children.Add(selectiveCard);
        Grid.SetRow(modes, 0);
        content.Children.Add(modes);

        var artifactCard = CreateSlimModePanel("Проверить программу", "▣", OnProgramScanClick);
        artifactCard.Margin = new Thickness(0, 18, 0, 0);
        Grid.SetRow(artifactCard, 1);
        content.Children.Add(artifactCard);

        HomeNetworkCard = CreateCardBorder("AppAccentSoftGradientBrush", "AppOutlineStrongBrush", 26, new Thickness(20));
        HomeNetworkCard.MaxWidth = 720;
        HomeNetworkCard.HorizontalAlignment = HorizontalAlignment.Stretch;
        var networkGrid = new Grid();
        networkGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        networkGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var networkText = new StackPanel { Spacing = 8 };
        networkText.Children.Add(CreateSectionTitle("Защита в сети", 24));
        NetworkCountersText = CreateBodyText("AppMutedTextBrush");
        NetworkCountersText.TextWrapping = TextWrapping.Wrap;
        NetworkCountersText.MaxWidth = 460;
        networkText.Children.Add(NetworkCountersText);
        networkGrid.Children.Add(networkText);
        NetworkProtectionToggle = new ToggleSwitch
        {
            Header = string.Empty,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center
        };
        NetworkProtectionToggle.Toggled += OnNetworkProtectionToggled;
        Grid.SetColumn(NetworkProtectionToggle, 1);
        networkGrid.Children.Add(NetworkProtectionToggle);
        HomeNetworkCard.Child = networkGrid;
        HomeNetworkCard.Margin = new Thickness(0, 18, 0, 0);
        var networkHost = new Grid
        {
            MaxWidth = 720,
            HorizontalAlignment = HorizontalAlignment.Center
        };
        networkHost.Children.Add(HomeNetworkCard);
        Grid.SetRow(networkHost, 2);
        content.Children.Add(networkHost);

        return host;
    }

    private FrameworkElement BuildHistoryView()
    {
        var stack = new StackPanel
        {
            Spacing = 14
        };
        var card = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 26, new Thickness(18));
        HistoryItemsHost = new StackPanel { Spacing = 12 };
        card.Child = HistoryItemsHost;
        stack.Children.Add(card);
        return CreateCenteredScrollHost(stack, 980);
    }

    private FrameworkElement BuildSettingsView()
    {
        var stack = new StackPanel
        {
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Stretch
        };

        var accountCard = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineStrongBrush", 26, new Thickness(20));
        var accountStack = new StackPanel { Spacing = 12 };
        SettingsAccountText = CreateBodyText("AppMutedTextBrush");
        accountStack.Children.Add(SettingsAccountText);
        SettingsVersionText = null!;
        SettingsDeveloperText = CreateBodyText("AppMutedTextBrush");
        accountStack.Children.Add(SettingsDeveloperText);
        accountCard.Child = accountStack;
        stack.Children.Add(accountCard);

        var lookCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 26, new Thickness(20));
        var lookStack = new StackPanel { Spacing = 10 };
        ThemeModeCombo = new ComboBox
        {
            ItemsSource = new[] { "Как в системе", "Светлая", "Тёмная" },
            SelectedIndex = ThemeModeToIndex(_preferences.ThemeMode),
            MinWidth = 220
        };
        ThemeModeCombo.SelectionChanged += OnThemeModeSelectionChanged;
        DynamicColorsToggle = new ToggleSwitch { Header = "Динамические цвета", IsOn = _preferences.DynamicColorsEnabled };
        DynamicColorsToggle.Toggled += OnDynamicColorsToggled;
        lookStack.Children.Add(CreateFieldLabel("Тема"));
        lookStack.Children.Add(ThemeModeCombo);
        lookStack.Children.Add(DynamicColorsToggle);
        AutoStartToggle = new ToggleSwitch { Header = "Автозапуск", IsOn = _preferences.AutoStartEnabled };
        AutoStartToggle.Toggled += OnAutoStartToggled;
        lookStack.Children.Add(AutoStartToggle);
        lookCard.Child = lookStack;
        stack.Children.Add(lookCard);

        var logoutButton = CreateTonalButton("Выйти", OnLogoutClick);
        logoutButton.HorizontalAlignment = HorizontalAlignment.Stretch;
        stack.Children.Add(logoutButton);

        return CreateCenteredScrollHost(stack, 860);
    }

    private Grid BuildScanOverlay()
    {
        var overlay = new Grid
        {
            Background = ThemeBrush("AppOverlayScrimBrush"),
            Visibility = Visibility.Collapsed
        };

        var frame = CreateCardBorder("AppSurfaceStrongBrush", "AppOutlineStrongBrush", 32, new Thickness(22));
        frame.MaxWidth = 1180;
        frame.MaxHeight = 780;
        frame.HorizontalAlignment = HorizontalAlignment.Center;
        frame.VerticalAlignment = VerticalAlignment.Center;
        overlay.Children.Add(frame);

        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        frame.Child = root;

        var header = new Grid { Margin = new Thickness(0, 0, 0, 16) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.Children.Add(CreateSectionTitle("Проверка", 24));
        var hideButton = CreateIconButton("×", OnHideScanOverlayClick);
        Grid.SetColumn(hideButton, 1);
        header.Children.Add(hideButton);
        root.Children.Add(header);

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(350) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(grid, 1);
        root.Children.Add(grid);

        var leftCard = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineStrongBrush", 28, new Thickness(20));
        Grid.SetColumn(leftCard, 0);
        var leftStack = new StackPanel { Spacing = 12 };
        ScanModeText = CreateTitleText("Проверка", 28);
        ScanStageText = CreateBodyText("AppMutedTextBrush");
        ScanTargetText = CreateBodyText("AppMutedTextBrush");
        leftStack.Children.Add(ScanModeText);
        leftStack.Children.Add(ScanStageText);
        leftStack.Children.Add(ScanTargetText);

        var ringShell = new Border
        {
            Width = 220,
            Height = 220,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 10, 0, 6),
            CornerRadius = new CornerRadius(110),
            BorderBrush = ThemeBrush("AppOutlineStrongBrush"),
            BorderThickness = new Thickness(3),
            Background = ThemeBrush("AppAccentSoftGradientBrush")
        };
        ScanProgressText = new TextBlock
        {
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = 42,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        ringShell.Child = ScanProgressText;
        leftStack.Children.Add(ringShell);

        ScanCountsText = CreateBodyText("AppMutedTextBrush");
        leftStack.Children.Add(ScanCountsText);

        ScanProgressBar = new ProgressBar
        {
            Minimum = 0,
            Maximum = 100,
            Height = 10,
            Margin = new Thickness(0, 4, 0, 8)
        };
        leftStack.Children.Add(ScanProgressBar);
        var cancelButton = CreateFilledButton("Остановить", OnCancelScanClick);
        cancelButton.HorizontalAlignment = HorizontalAlignment.Stretch;
        leftStack.Children.Add(cancelButton);
        leftCard.Child = leftStack;
        grid.Children.Add(leftCard);

        var rightCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 28, new Thickness(18));
        Grid.SetColumn(rightCard, 2);
        var rightStack = new StackPanel { Spacing = 12 };
        rightStack.Children.Add(CreateSectionTitle("Что происходит", 22));
        var timelineScroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        };
        ScanTimelineHost = new StackPanel { Spacing = 10 };
        timelineScroll.Content = ScanTimelineHost;
        rightStack.Children.Add(timelineScroll);
        rightCard.Child = rightStack;
        grid.Children.Add(rightCard);

        return overlay;
    }

    private Grid BuildHistoryDetailOverlay()
    {
        var overlay = new Grid
        {
            Background = ThemeBrush("AppOverlayScrimBrush"),
            Visibility = Visibility.Collapsed
        };
        overlay.Tapped += (_, _) => SetHistoryDetailState(false);

        var frame = CreateCardBorder("AppSurfaceStrongBrush", "AppOutlineStrongBrush", 30, new Thickness(22));
        frame.MaxWidth = 960;
        frame.MaxHeight = 760;
        frame.HorizontalAlignment = HorizontalAlignment.Center;
        frame.VerticalAlignment = VerticalAlignment.Center;
        frame.Tapped += (_, args) => args.Handled = true;
        overlay.Children.Add(frame);

        var stack = new StackPanel { Spacing = 14 };
        HistoryDetailTitleText = CreateTitleText("Проверка", 26);
        HistoryDetailMetaText = CreateBodyText("AppMutedTextBrush");
        stack.Children.Add(HistoryDetailTitleText);
        stack.Children.Add(HistoryDetailMetaText);

        var scroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            MaxHeight = 520
        };
        HistoryDetailContentHost = new StackPanel { Spacing = 10 };
        scroll.Content = HistoryDetailContentHost;
        stack.Children.Add(scroll);

        var closeButton = CreateTonalButton("Закрыть", (_, _) => SetHistoryDetailState(false));
        closeButton.HorizontalAlignment = HorizontalAlignment.Stretch;
        stack.Children.Add(closeButton);
        frame.Child = stack;

        return overlay;
    }

    private FrameworkElement CreateCenteredScrollHost(UIElement content, double maxWidth)
    {
        var root = new Grid
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch
        };

        var scroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Margin = new Thickness(0, 4, 0, 0)
        };

        var presenter = new Grid
        {
            MaxWidth = maxWidth,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 0, 12, 0)
        };
        presenter.Children.Add(content);
        scroll.Content = presenter;
        root.Children.Add(scroll);
        return root;
    }

    private void ApplyAmbientPalette()
    {
        BackdropGradient.Fill = new SolidColorBrush(ThemePalette.Blend(App.Palette.BackgroundAlt, App.Palette.Accent, 0.06));
        FabricLayerA.Fill = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.Accent, 0.06));
        FabricLayerB.Fill = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.AccentSecondary, 0.05));
        FabricLayerC.Fill = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.AccentTertiary, 0.04));
        GlowA.Fill = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.Accent, 0.10));
        GlowB.Fill = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.AccentSecondary, 0.08));
        GlowC.Fill = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.AccentTertiary, 0.06));
    }

    private static Brush BuildGlowBrush(UiColor color, double opacity)
    {
        return new SolidColorBrush(ThemePalette.WithAlpha(color, opacity));
    }

    private static Brush BuildWeaveBrush(UiColor baseColor, UiColor accentColor, double lowOpacity, double highOpacity)
    {
        return new SolidColorBrush(ThemePalette.WithAlpha(ThemePalette.Blend(baseColor, accentColor, 0.38), Math.Max(lowOpacity, highOpacity * 0.68)));
    }

    private static Brush BuildSheenBrush(UiColor first, UiColor second)
    {
        return new SolidColorBrush(ThemePalette.WithAlpha(ThemePalette.Blend(first, second, 0.5), 0.12));
    }

    private void EnsureScreenReady(AppScreen screen)
    {
        switch (screen)
        {
            case AppScreen.Welcome:
                EnsureViewAdded(ref WelcomeView, "WelcomeView", BuildWelcomeView);
                break;
            case AppScreen.Login:
                EnsureViewAdded(ref LoginView, "LoginView", BuildLoginView);
                break;
            case AppScreen.Register:
                EnsureViewAdded(ref RegisterView, "RegisterView", BuildRegisterView);
                break;
            case AppScreen.Code:
                EnsureViewAdded(ref CodeView, "CodeView", BuildCodeView);
                break;
            case AppScreen.Home:
                EnsureViewAdded(ref HomeView, "HomeView", BuildHomeView);
                break;
            case AppScreen.History:
                EnsureViewAdded(ref HistoryView, "HistoryView", BuildHistoryView);
                break;
            case AppScreen.Settings:
                EnsureViewAdded(ref SettingsView, "SettingsView", BuildSettingsView);
                break;
        }
    }

    private void EnsureViewAdded(ref FrameworkElement view, string label, Func<FrameworkElement> factory)
    {
        if (view is null)
        {
            WindowsLog.Info($"Creating deferred screen: {label}");
            view = factory();
            WindowsLog.Info($"Deferred screen created: {label}");
        }

        if (!ScreenHost.Children.Contains(view))
        {
            WindowsLog.Info($"Attaching deferred screen: {label}");
            ScreenHost.Children.Add(view);
            WindowsLog.Info($"Deferred screen attached: {label}");
        }
    }

    private void EnsureScanOverlayReady()
    {
        if (ScanOverlay is null)
        {
            WindowsLog.Info("Creating deferred scan overlay");
            ScanOverlay = BuildFallbackScanOverlay();
            Canvas.SetZIndex(ScanOverlay, 40);
            _windowRoot.Children.Add(ScanOverlay);
            WindowsLog.Info("Deferred scan overlay attached");
        }
    }

    private Grid BuildScanOverlaySafe()
    {
        if (_scanOverlayFallbackPreferred)
        {
            WindowsLog.Info("Using safe fallback scan overlay");
            return BuildFallbackScanOverlay();
        }

        try
        {
            return BuildScanOverlay();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("BuildScanOverlay failed, switching to fallback overlay", ex);
            return BuildFallbackScanOverlay();
        }
    }

    private void RebuildScanOverlayAsFallback(Exception? ex = null)
    {
        if (ex is not null)
        {
            WindowsLog.Error("Rebuilding scan overlay as fallback", ex);
        }

        _scanOverlayFallbackPreferred = true;
        if (ScanOverlay is not null && _windowRoot.Children.Contains(ScanOverlay))
        {
            _windowRoot.Children.Remove(ScanOverlay);
        }
        ScanOverlay = null!;
        EnsureScanOverlayReady();
    }

    private Grid BuildFallbackScanOverlay()
    {
        var overlay = new Grid
        {
            Background = ThemeBrush("AppOverlayScrimBrush"),
            Visibility = Visibility.Collapsed
        };

        var frame = CreateCardBorder("AppSurfaceStrongBrush", "AppOutlineStrongBrush", 24, new Thickness(20));
        frame.MaxWidth = 720;
        frame.HorizontalAlignment = HorizontalAlignment.Center;
        frame.VerticalAlignment = VerticalAlignment.Center;
        overlay.Children.Add(frame);

        var stack = new StackPanel { Spacing = 14 };
        ScanModeText = CreateTitleText("Проверка", 24);
        ScanStageText = CreateBodyText("AppMutedTextBrush");
        ScanTargetText = CreateBodyText("AppMutedTextBrush");
        ScanProgressText = CreateTitleText("0%", 34);
        ScanCountsText = CreateBodyText("AppMutedTextBrush");
        ScanProgressBar = new ProgressBar
        {
            Minimum = 0,
            Maximum = 100,
            Height = 10
        };
        ScanTimelineHost = new StackPanel { Spacing = 10 };

        var timelineScroll = new ScrollViewer
        {
            MaxHeight = 320,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = ScanTimelineHost
        };

        stack.Children.Add(ScanModeText);
        stack.Children.Add(ScanStageText);
        stack.Children.Add(ScanTargetText);
        stack.Children.Add(ScanProgressText);
        stack.Children.Add(ScanCountsText);
        stack.Children.Add(ScanProgressBar);
        stack.Children.Add(timelineScroll);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12
        };
        var cancelButton = CreateFilledButton("Остановить", OnCancelScanClick);
        var hideButton = CreateTonalButton("Скрыть", OnHideScanOverlayClick);
        actions.Children.Add(cancelButton);
        actions.Children.Add(hideButton);
        stack.Children.Add(actions);

        frame.Child = stack;
        return overlay;
    }

    private void EnsureHistoryDetailOverlayReady()
    {
        if (HistoryDetailOverlay is null)
        {
            WindowsLog.Info("Creating deferred history detail overlay");
            HistoryDetailOverlay = BuildHistoryDetailOverlay();
            Canvas.SetZIndex(HistoryDetailOverlay, 50);
            _windowRoot.Children.Add(HistoryDetailOverlay);
            WindowsLog.Info("Deferred history detail overlay attached");
        }
    }

    private void EnsureDrawerReady()
    {
        if (DrawerPanel is not null && _windowRoot.Children.Contains(DrawerPanel))
        {
            return;
        }

        WindowsLog.Info("Creating deferred drawer panel");
        DrawerPanel = BuildDrawerPanel();
        DrawerPanel.Visibility = Visibility.Collapsed;
        DrawerPanel.Opacity = 0;
        DrawerPanel.RenderTransform = new TranslateTransform { X = -36 };
        Canvas.SetZIndex(DrawerPanel, 61);
        _windowRoot.Children.Add(DrawerPanel);
        WindowsLog.Info("Deferred drawer panel attached");
    }

    private void ShowScreen(AppScreen screen)
    {
        if (screen != AppScreen.Splash)
        {
            EnsureScreenReady(screen);
        }

        _screen = screen;
        SplashView.Visibility = screen == AppScreen.Splash ? Visibility.Visible : Visibility.Collapsed;
        if (WelcomeView is not null) WelcomeView.Visibility = screen == AppScreen.Welcome ? Visibility.Visible : Visibility.Collapsed;
        if (LoginView is not null) LoginView.Visibility = screen == AppScreen.Login ? Visibility.Visible : Visibility.Collapsed;
        if (RegisterView is not null) RegisterView.Visibility = screen == AppScreen.Register ? Visibility.Visible : Visibility.Collapsed;
        if (CodeView is not null) CodeView.Visibility = screen == AppScreen.Code ? Visibility.Visible : Visibility.Collapsed;
        if (HomeView is not null) HomeView.Visibility = screen == AppScreen.Home ? Visibility.Visible : Visibility.Collapsed;
        if (HistoryView is not null) HistoryView.Visibility = screen == AppScreen.History ? Visibility.Visible : Visibility.Collapsed;
        if (SettingsView is not null) SettingsView.Visibility = screen == AppScreen.Settings ? Visibility.Visible : Visibility.Collapsed;

        var chromeVisible = screen is AppScreen.Home or AppScreen.History or AppScreen.Settings;
        var authBackdropVisible = screen is AppScreen.Welcome or AppScreen.Login or AppScreen.Register or AppScreen.Code;
        TopBar.Visibility = chromeVisible ? Visibility.Visible : Visibility.Collapsed;
        if (authBackdropVisible)
        {
            EnsureAuthBackdropLayerReady();
        }
        if (AuthBackdropLayer is not null)
        {
            AuthBackdropLayer.Visibility = authBackdropVisible ? Visibility.Visible : Visibility.Collapsed;
        }
        if (ShellRoot is not null)
        {
            ShellRoot.Padding = chromeVisible
                ? new Thickness(28, 18, 28, 22)
                : new Thickness(0);
        }
        if (screen is AppScreen.Welcome or AppScreen.Login or AppScreen.Register or AppScreen.Code)
        {
            StartShapeAnimation();
        }
        else
        {
            StopShapeAnimation();
        }

        SetDrawerState(false);
        if (screen != AppScreen.History)
        {
            SetHistoryDetailState(false);
        }
        UpdateHeader();
        ApplySessionState();
        UpdateHomeState();
        UpdateHistoryState();
        UpdateSettingsState();
    }

    private void UpdateHeader()
    {
        HeaderTitleText.Text = _screen switch
        {
            AppScreen.Home => "NeuralV",
            AppScreen.History => "История",
            AppScreen.Settings => "Настройки",
            _ => "NeuralV"
        };
    }

    private void ApplySessionState()
    {
        var hasSession = _session is not null;
        var displayName = hasSession
            ? (!string.IsNullOrWhiteSpace(_session!.User.Name) ? _session.User.Name : _session.User.Email)
            : "Гостевой режим";

        UpdateVersionBadge();

        if (AccountChipText is not null)
        {
            AccountChipText.Text = hasSession ? _session!.User.Email : string.Empty;
        }
        if (DrawerUserNameText is not null)
        {
            DrawerUserNameText.Text = displayName;
        }
        if (DrawerUserMetaText is not null)
        {
            DrawerUserMetaText.Text = hasSession
                ? _session!.User.Email
                : "Вход не выполнен";
        }
        if (SettingsAccountText is not null)
        {
            SettingsAccountText.Text = hasSession
                ? $"{displayName}\n{_session!.User.Email}"
                : "Активной сессии нет.";
        }
        if (SettingsVersionText is not null)
        {
            SettingsVersionText.Text = $"Версия {_currentVersion}";
        }
        if (SettingsDeveloperText is not null)
        {
            SettingsDeveloperText.Text = (_preferences.DeveloperModeEnabled || (hasSession && _session!.User.IsDeveloperMode))
                ? "Режим разработчика включён"
                : string.Empty;
            SettingsDeveloperText.Visibility = string.IsNullOrWhiteSpace(SettingsDeveloperText.Text) ? Visibility.Collapsed : Visibility.Visible;
        }
    }

    private void UpdateHomeState()
    {
        if (ActiveScanCard is null || ActiveScanCardTitleText is null || ActiveScanCardMetaText is null)
        {
            UpdateNetworkUi();
            return;
        }

        var running = _activeScan is not null && !_activeScan.IsFinished;
        ActiveScanCard.Visibility = running ? Visibility.Visible : Visibility.Collapsed;
        if (HomePrimaryContent is not null)
        {
            HomePrimaryContent.Visibility = running ? Visibility.Collapsed : Visibility.Visible;
        }
        if (running && _activeScan is not null)
        {
            var progress = WindowsTrayProgressService.EstimateProgressPercent(_activeScan);
            ActiveScanCardTitleText.Text = _activeScan.Mode switch
            {
                "FULL" => "Глубокая проверка продолжается",
                "SELECTIVE" => "Выборочная проверка продолжается",
                "ARTIFACT" => "Проверка программы продолжается",
                _ => "Проверка продолжается"
            };
            ActiveScanCardMetaText.Text = $"{progress}% · {(_activeScan.Message ?? _activeScan.Status)}";
        }

        App.WindowLifecycle?.SetShouldMinimizeToTray(() => _preferences.MinimizeToTrayOnClose);
        App.WindowLifecycle?.RefreshTrayState();
        UpdateNetworkUi();
    }

    private void UpdateHistoryState()
    {
        if (HistoryItemsHost is null)
        {
            return;
        }

        HistoryItemsHost.Children.Clear();
        if (_historyRecords.Count == 0)
        {
            var empty = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineBrush", 22, new Thickness(16));
            empty.Child = CreateBodyText("AppMutedTextBrush");
            ((TextBlock)empty.Child).Text = "История появится после первой завершённой проверки.";
            HistoryItemsHost.Children.Add(empty);
            return;
        }

        foreach (var item in _historyRecords)
        {
            HistoryItemsHost.Children.Add(CreateHistoryRecordCard(item));
        }
    }

    private void UpdateSettingsState()
    {
        if (ThemeModeCombo is null || DynamicColorsToggle is null || AutoStartToggle is null)
        {
            UpdateNetworkUi();
            return;
        }

        _preferenceUiSync = true;
        ThemeModeCombo.SelectedIndex = ThemeModeToIndex(_preferences.ThemeMode);
        DynamicColorsToggle.IsOn = _preferences.DynamicColorsEnabled;
        AutoStartToggle.IsOn = _preferences.AutoStartEnabled;
        _preferenceUiSync = false;
        if (SettingsDeveloperText is not null)
        {
            var enabled = _preferences.DeveloperModeEnabled || (_session?.User.IsDeveloperMode ?? false);
            SettingsDeveloperText.Text = enabled ? "Режим разработчика включён" : string.Empty;
            SettingsDeveloperText.Visibility = enabled ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    private void UpdateNetworkUi()
    {
        _networkUiSync = true;

        if (NetworkProtectionToggle is not null)
        {
            NetworkProtectionToggle.IsOn = _networkState.NetworkEnabled;
        }
        if (HomeNetworkCard is not null)
        {
            HomeNetworkCard.Background = _networkState.NetworkEnabled
                ? ThemeBrush("AppSurfaceStrongGradientBrush")
                : ThemeBrush("AppSurfaceBrush");
            HomeNetworkCard.BorderBrush = _networkState.NetworkEnabled
                ? ThemeBrush("AppOutlineStrongBrush")
                : ThemeBrush("AppOutlineBrush");
        }
        if (NetworkCountersText is not null)
        {
            NetworkCountersText.Text =
                $"{(_networkState.NetworkEnabled ? "Защита в сети включена" : "Защита в сети отключена")}\n" +
                $"Заблокировано угроз: {WindowsNetworkProtectionStateService.FormatCounter(_networkState.BlockedThreatsPlatform)}\n" +
                $"Заблокировано рекламы: {WindowsNetworkProtectionStateService.FormatCounter(_networkState.BlockedAdsPlatform)}";
        }

        _networkUiSync = false;
    }

    private void SetDrawerState(bool isOpen)
    {
        _drawerOpen = isOpen;
        if (DrawerScrim is null)
        {
            return;
        }
        if (isOpen)
        {
            EnsureDrawerReady();
            if (DrawerPanel is null)
            {
                return;
            }

            DrawerScrim.Visibility = Visibility.Visible;
            DrawerPanel.Visibility = Visibility.Visible;
        }

        AnimateElement(DrawerScrim, "Opacity", isOpen ? 1 : 0, 220, new SineEase { EasingMode = EasingMode.EaseOut }, () =>
        {
            if (!isOpen)
            {
                DrawerScrim.Visibility = Visibility.Collapsed;
            }
        });
        if (DrawerPanel is null)
        {
            return;
        }
        AnimateElement(DrawerPanel, "Opacity", isOpen ? 1 : 0, 220, new SineEase { EasingMode = EasingMode.EaseOut }, () =>
        {
            if (!isOpen)
            {
                DrawerPanel.Visibility = Visibility.Collapsed;
            }
        });

        if (DrawerPanel.RenderTransform is TranslateTransform translate)
        {
            AnimateElement(translate, "X", isOpen ? 0 : -36, 240, new CubicEase { EasingMode = EasingMode.EaseOut });
        }
    }

    private void SetHistoryDetailState(bool isOpen)
    {
        if (isOpen)
        {
            EnsureHistoryDetailOverlayReady();
        }
        if (HistoryDetailOverlay is null)
        {
            return;
        }

        HistoryDetailOverlay.Visibility = isOpen ? Visibility.Visible : Visibility.Collapsed;
    }

    private void SetScanOverlayState(bool isOpen)
    {
        try
        {
            if (isOpen)
            {
                EnsureScanOverlayReady();
            }
            if (ScanOverlay is null)
            {
                return;
            }

            _scanOverlayOpen = isOpen;
            ScanOverlay.Visibility = isOpen ? Visibility.Visible : Visibility.Collapsed;
            if (isOpen)
            {
                SetDrawerState(false);
                SetHistoryDetailState(false);
            }
            else
            {
                App.WindowLifecycle?.RefreshTrayState();
            }
            UpdateHomeState();
        }
        catch (Exception ex)
        {
            RebuildScanOverlayAsFallback(ex);
            if (ScanOverlay is null)
            {
                return;
            }

            _scanOverlayOpen = isOpen;
            ScanOverlay.Visibility = isOpen ? Visibility.Visible : Visibility.Collapsed;
            UpdateHomeState();
        }
    }

    private void ShowActiveScanOverlay()
    {
        if (_activeScan is null)
        {
            return;
        }

        try
        {
            ShowScreen(AppScreen.Home);
            RenderScan(_activeScan);
            SetScanOverlayState(true);
        }
        catch (Exception ex)
        {
            RebuildScanOverlayAsFallback(ex);
            SetStatus("Окно проверки переведено в безопасный режим.");
            if (_activeScan is not null)
            {
                RenderScan(_activeScan);
                SetScanOverlayState(true);
            }
        }
    }

    private void SetBusy(bool isBusy, string? message = null)
    {
        BusyOverlay.Visibility = isBusy ? Visibility.Visible : Visibility.Collapsed;
        BusyText.Text = string.IsNullOrWhiteSpace(message) ? "Загрузка" : message;
    }

    private void SetStatus(string? message)
    {
        var visible = !string.IsNullOrWhiteSpace(message);
        StatusBanner.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        StatusBannerText.Text = visible ? message! : string.Empty;
    }

    private static int ThemeModeToIndex(ThemeModePreference mode)
    {
        return mode switch
        {
            ThemeModePreference.Light => 1,
            ThemeModePreference.Dark => 2,
            _ => 0
        };
    }

    private static ThemeModePreference IndexToThemeMode(int index)
    {
        return index switch
        {
            1 => ThemeModePreference.Light,
            2 => ThemeModePreference.Dark,
            _ => ThemeModePreference.System
        };
    }

    private async Task SavePreferencesAsync(Action<ClientPreferences> mutate, bool rebuildVisualTree)
    {
        mutate(_preferences);
        _preferences = await ClientPreferencesStateService.SaveAsync(_preferences);
        App.ApplyClientPreferences(_preferences);

        if (rebuildVisualTree)
        {
            RebuildVisualTree();
        }
    }

    private void RebuildVisualTree()
    {
        var screen = _screen;
        var overlayOpen = _scanOverlayOpen;
        _layoutBuilt = false;
        BuildLayout();
        HookWindowLifecycle();
        ApplySessionState();
        ShowScreen(screen);
        if (_activeScan is not null)
        {
            RenderScan(_activeScan);
        }
        SetScanOverlayState(overlayOpen && _activeScan is not null);
        SetStatus(null);
    }

    private void StartShapeAnimation()
    {
        if (_shapeAnimationRunning)
        {
            return;
        }

        _lastShapeRenderTimestamp = TimeSpan.Zero;
        CompositionTarget.Rendering += OnShapeRendering;
        _shapeAnimationRunning = true;
    }

    private void StopShapeAnimation()
    {
        if (!_shapeAnimationRunning)
        {
            return;
        }

        CompositionTarget.Rendering -= OnShapeRendering;
        _shapeAnimationRunning = false;
        _lastShapeRenderTimestamp = TimeSpan.Zero;
    }

    private void OnShapeRendering(object? sender, object e)
    {
        var now = _shapeStopwatch.Elapsed;
        if (_lastShapeRenderTimestamp == TimeSpan.Zero)
        {
            _lastShapeRenderTimestamp = now;
            AdvanceFloatingShapes(1d);
            return;
        }

        var deltaMs = (now - _lastShapeRenderTimestamp).TotalMilliseconds;
        _lastShapeRenderTimestamp = now;
        if (deltaMs <= 0)
        {
            return;
        }

        var frameScale = Math.Clamp(deltaMs / 16.666d, 0.85d, 2.4d);
        AdvanceFloatingShapes(frameScale);
    }

    private void OnShapeTick(object? sender, object e)
    {
        AdvanceFloatingShapes(1d);
    }

    private void AdvanceFloatingShapes(double frameScale)
    {
        if (_welcomeShapeCanvas is null)
        {
            return;
        }

        var boundsWidth = _welcomeShapeCanvas.ActualWidth;
        var boundsHeight = _welcomeShapeCanvas.ActualHeight;
        if (boundsWidth < 200 || boundsHeight < 200)
        {
            return;
        }

        EnsureFloatingShapePositions(boundsWidth, boundsHeight);

        foreach (var shape in _floatingShapes)
        {
            ApplyPointerRepulsion(shape, boundsWidth, boundsHeight);

            shape.Angle += shape.AngularVelocity;
            if (shape.Element.RenderTransform is RotateTransform rotate)
            {
                rotate.Angle = shape.Angle;
            }

            var left = Canvas.GetLeft(shape.Element) + (shape.VelocityX * frameScale);
            var top = Canvas.GetTop(shape.Element) + (shape.VelocityY * frameScale);

            if (left <= 0 || left + shape.Width >= boundsWidth)
            {
                shape.VelocityX *= -1;
                left = Math.Clamp(left, 0, Math.Max(0, boundsWidth - shape.Width));
            }
            if (top <= 0 || top + shape.Height >= boundsHeight)
            {
                shape.VelocityY *= -1;
                top = Math.Clamp(top, 0, Math.Max(0, boundsHeight - shape.Height));
            }

            var damping = Math.Pow(0.9992, frameScale);
            shape.VelocityX = Math.Clamp(shape.VelocityX * damping, -9.6, 9.6);
            shape.VelocityY = Math.Clamp(shape.VelocityY * damping, -9.6, 9.6);

            Canvas.SetLeft(shape.Element, left);
            Canvas.SetTop(shape.Element, top);
        }

        ResolveFloatingShapeCollisions(boundsWidth, boundsHeight);
    }

    private void OnWelcomeShapeTapped(object sender, TappedRoutedEventArgs e)
    {
        if (sender is not Border border)
        {
            return;
        }

        var shape = _floatingShapes.FirstOrDefault(item => ReferenceEquals(item.Element, border));
        if (shape is null)
        {
            return;
        }

        shape.Variant = (shape.Variant + 1) % 6;
        shape.Angle += 18;
        shape.VelocityX += (_random.NextDouble() - 0.5) * 3.2;
        shape.VelocityY += (_random.NextDouble() - 0.5) * 3.2;
        shape.AngularVelocity += (_random.NextDouble() - 0.5) * 1.6;
        ApplyShapeVariant(shape, shape.Variant);
        if (shape.Element.RenderTransform is RotateTransform rotate)
        {
            rotate.Angle = shape.Angle;
        }
    }

    private void ApplyShapeVariant(FloatingShape model, int variant)
    {
        var shape = model.Element;
        switch (variant % 6)
        {
            case 0:
                model.Width = 122;
                model.Height = 122;
                shape.CornerRadius = new CornerRadius(61);
                shape.Background = BuildWeaveBrush(App.Palette.Accent, App.Palette.AccentSecondary, 0.44, 0.76);
                break;
            case 1:
                model.Width = 170;
                model.Height = 92;
                shape.CornerRadius = new CornerRadius(40);
                shape.Background = BuildWeaveBrush(App.Palette.AccentSecondary, App.Palette.AccentTertiary, 0.46, 0.78);
                break;
            case 2:
                model.Width = 108;
                model.Height = 144;
                shape.CornerRadius = new CornerRadius(36);
                shape.Background = BuildWeaveBrush(App.Palette.AccentTertiary, App.Palette.Accent, 0.44, 0.74);
                break;
            case 3:
                model.Width = 138;
                model.Height = 138;
                shape.CornerRadius = new CornerRadius(28);
                shape.Background = BuildWeaveBrush(App.Palette.Accent, App.Palette.AccentTertiary, 0.42, 0.72);
                break;
            case 4:
                model.Width = 180;
                model.Height = 84;
                shape.CornerRadius = new CornerRadius(22);
                shape.Background = BuildWeaveBrush(App.Palette.AccentSecondary, App.Palette.Accent, 0.46, 0.76);
                break;
            default:
                model.Width = 96;
                model.Height = 160;
                shape.CornerRadius = new CornerRadius(42);
                shape.Background = BuildWeaveBrush(App.Palette.AccentTertiary, App.Palette.AccentSecondary, 0.44, 0.74);
                break;
        }

        shape.Width = model.Width;
        shape.Height = model.Height;
    }

    private void OnAuthBackdropPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (_welcomeShapeCanvas is null)
        {
            return;
        }

        _welcomePointer = e.GetCurrentPoint(_welcomeShapeCanvas).Position;
    }

    private void OnAuthBackdropPointerExited(object sender, PointerRoutedEventArgs e)
    {
        _welcomePointer = null;
    }

    private void OnAuthBackdropSizeChanged(object sender, SizeChangedEventArgs e)
    {
        EnsureFloatingShapePositions(e.NewSize.Width, e.NewSize.Height, repositionAll: false);
    }

    private void EnsureFloatingShapePositions(double boundsWidth, double boundsHeight, bool repositionAll = false)
    {
        foreach (var shape in _floatingShapes)
        {
            if (!shape.Positioned || repositionAll)
            {
                PositionFloatingShape(shape, boundsWidth, boundsHeight, repositionAll);
            }
        }
    }

    private void PositionFloatingShape(FloatingShape shape, double boundsWidth, double boundsHeight, bool keepVelocity)
    {
        var left = _random.NextDouble() * Math.Max(12, boundsWidth - shape.Width - 12);
        var top = _random.NextDouble() * Math.Max(12, boundsHeight - shape.Height - 12);
        Canvas.SetLeft(shape.Element, left);
        Canvas.SetTop(shape.Element, top);
        shape.Positioned = true;
        if (!keepVelocity)
        {
            shape.VelocityX = (_random.NextDouble() - 0.5) * 8.2;
            shape.VelocityY = (_random.NextDouble() - 0.5) * 8.2;
        }
    }

    private void ApplyPointerRepulsion(FloatingShape shape, double boundsWidth, double boundsHeight)
    {
        if (_welcomePointer is null)
        {
            return;
        }

        var pointer = _welcomePointer.Value;
        var centerX = Canvas.GetLeft(shape.Element) + (shape.Width / 2d);
        var centerY = Canvas.GetTop(shape.Element) + (shape.Height / 2d);
        var deltaX = centerX - pointer.X;
        var deltaY = centerY - pointer.Y;
        var distance = Math.Sqrt((deltaX * deltaX) + (deltaY * deltaY));
        if (distance < 0.001 || distance > 320)
        {
            return;
        }

        var force = (320 - distance) / 320d;
        shape.VelocityX += (deltaX / distance) * force * 1.9;
        shape.VelocityY += (deltaY / distance) * force * 1.9;
    }

    private void ResolveFloatingShapeCollisions(double boundsWidth, double boundsHeight)
    {
        for (var index = 0; index < _floatingShapes.Count; index++)
        {
            var current = _floatingShapes[index];
            for (var nextIndex = index + 1; nextIndex < _floatingShapes.Count; nextIndex++)
            {
                var other = _floatingShapes[nextIndex];
                var currentCenterX = Canvas.GetLeft(current.Element) + (current.Width / 2d);
                var currentCenterY = Canvas.GetTop(current.Element) + (current.Height / 2d);
                var otherCenterX = Canvas.GetLeft(other.Element) + (other.Width / 2d);
                var otherCenterY = Canvas.GetTop(other.Element) + (other.Height / 2d);
                var deltaX = otherCenterX - currentCenterX;
                var deltaY = otherCenterY - currentCenterY;
                var distance = Math.Sqrt((deltaX * deltaX) + (deltaY * deltaY));
                var minDistance = (Math.Max(current.Width, current.Height) + Math.Max(other.Width, other.Height)) * 0.36;
                if (distance <= 0.001 || distance >= minDistance)
                {
                    continue;
                }

                var normalX = deltaX / distance;
                var normalY = deltaY / distance;
                var overlap = minDistance - distance;
                var currentLeft = Canvas.GetLeft(current.Element) - (normalX * overlap * 0.5);
                var currentTop = Canvas.GetTop(current.Element) - (normalY * overlap * 0.5);
                var otherLeft = Canvas.GetLeft(other.Element) + (normalX * overlap * 0.5);
                var otherTop = Canvas.GetTop(other.Element) + (normalY * overlap * 0.5);

                Canvas.SetLeft(current.Element, Math.Clamp(currentLeft, 0, Math.Max(0, boundsWidth - current.Width)));
                Canvas.SetTop(current.Element, Math.Clamp(currentTop, 0, Math.Max(0, boundsHeight - current.Height)));
                Canvas.SetLeft(other.Element, Math.Clamp(otherLeft, 0, Math.Max(0, boundsWidth - other.Width)));
                Canvas.SetTop(other.Element, Math.Clamp(otherTop, 0, Math.Max(0, boundsHeight - other.Height)));

                current.VelocityX -= normalX * 0.96;
                current.VelocityY -= normalY * 0.96;
                other.VelocityX += normalX * 0.96;
                other.VelocityY += normalY * 0.96;
            }
        }
    }

    private void ResetAuthInputs()
    {
        SafeClearTextBox(LoginEmailBox);
        SafeClearPasswordBox(LoginPasswordBox);
        SafeClearTextBox(RegisterNameBox);
        SafeClearTextBox(RegisterEmailBox);
        SafeClearPasswordBox(RegisterPasswordBox);
        SafeClearPasswordBox(RegisterPasswordRepeatBox);
        SafeClearTextBox(VerificationCodeBox);
        SafeSetText(CodeHintText, string.Empty);
        _challenge = null;
    }

    private static void SafeClearTextBox(TextBox? textBox)
    {
        if (textBox is null)
        {
            return;
        }

        try
        {
            textBox.Text = string.Empty;
        }
        catch
        {
        }
    }

    private static void SafeClearPasswordBox(PasswordBox? passwordBox)
    {
        if (passwordBox is null)
        {
            return;
        }

        try
        {
            passwordBox.Password = string.Empty;
        }
        catch
        {
        }
    }

    private static void SafeSetText(TextBlock? textBlock, string text)
    {
        if (textBlock is null)
        {
            return;
        }

        try
        {
            textBlock.Text = text;
        }
        catch
        {
        }
    }

    private void OnShowLoginClick(object sender, RoutedEventArgs e)
    {
        ResetAuthInputs();
        SetStatus(null);
        ShowScreen(AppScreen.Login);
    }

    private void OnShowRegisterClick(object sender, RoutedEventArgs e)
    {
        ResetAuthInputs();
        SetStatus(null);
        ShowScreen(AppScreen.Register);
    }

    private void OnBackToWelcomeClick(object sender, RoutedEventArgs e)
    {
        ResetAuthInputs();
        SetStatus(null);
        ShowScreen(AppScreen.Welcome);
    }

    private void OnBackFromCodeClick(object sender, RoutedEventArgs e)
    {
        ShowScreen(_challenge?.Mode == AuthMode.Register ? AppScreen.Register : AppScreen.Login);
    }

    private async void OnStartLoginClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(LoginEmailBox.Text) || string.IsNullOrWhiteSpace(LoginPasswordBox.Password))
        {
            SetStatus("Заполни почту и пароль.");
            return;
        }

        SetBusy(true, "Отправляем запрос на вход");
        try
        {
            var ticket = await _apiClient.StartLoginAsync(LoginEmailBox.Text.Trim(), LoginPasswordBox.Password, _deviceId);
            if (!ticket.Ok)
            {
                SetStatus(ticket.Error);
                return;
            }

            OpenCodeChallenge(ticket, $"Код подтверждения отправлен на {ticket.Email}.");
        }
        catch (Exception ex)
        {
            WindowsLog.Error("OnStartLoginClick failed", ex);
            SetStatus(HumanizeAuthActionError(ex, "Не удалось начать вход."));
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void OnStartRegisterClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(RegisterNameBox.Text) || string.IsNullOrWhiteSpace(RegisterEmailBox.Text) || string.IsNullOrWhiteSpace(RegisterPasswordBox.Password))
        {
            SetStatus("Заполни все поля регистрации.");
            return;
        }
        if (!string.Equals(RegisterPasswordBox.Password, RegisterPasswordRepeatBox.Password, StringComparison.Ordinal))
        {
            SetStatus("Пароли не совпадают.");
            return;
        }

        SetBusy(true, "Создаём регистрацию");
        try
        {
            var ticket = await _apiClient.StartRegisterAsync(RegisterNameBox.Text.Trim(), RegisterEmailBox.Text.Trim(), RegisterPasswordBox.Password, _deviceId);
            if (!ticket.Ok)
            {
                SetStatus(ticket.Error);
                return;
            }

            OpenCodeChallenge(ticket, $"Код подтверждения отправлен на {ticket.Email}.");
        }
        catch (Exception ex)
        {
            WindowsLog.Error("OnStartRegisterClick failed", ex);
            SetStatus(HumanizeAuthActionError(ex, "Не удалось начать регистрацию."));
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void OpenCodeChallenge(ChallengeTicket ticket, string hint)
    {
        _challenge = ticket;
        EnsureScreenReady(AppScreen.Code);
        SafeSetText(CodeHintText, hint);
        SetStatus(null);
        ShowScreen(AppScreen.Code);
    }

    private static string HumanizeAuthActionError(Exception ex, string fallbackMessage)
    {
        if (ex is TaskCanceledException or TimeoutException)
        {
            return "Сервер отвечает слишком долго. Код может уже прийти на почту, но лучше попробуй ещё раз через пару секунд.";
        }

        if (ex is HttpRequestException)
        {
            return "Не удалось связаться с сервером. Проверь подключение и попробуй ещё раз.";
        }

        return string.IsNullOrWhiteSpace(ex.Message) ? fallbackMessage : ex.Message;
    }

    private async void OnRequestPasswordResetClick(object sender, RoutedEventArgs e)
    {
        var email = LoginEmailBox?.Text?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(email))
        {
            SetStatus("Сначала введи e-mail для сброса пароля.");
            return;
        }

        SetBusy(true, "Отправляем письмо для сброса");
        try
        {
            var result = await _apiClient.RequestPasswordResetAsync(email);
            SetStatus(result.error ?? result.message ?? "Проверь почту: письмо для сброса уже отправлено.");
        }
        catch (Exception ex)
        {
            WindowsLog.Error("OnRequestPasswordResetClick failed", ex);
            SetStatus(HumanizeAuthActionError(ex, "Не удалось отправить письмо для сброса."));
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void OnVerifyCodeClick(object sender, RoutedEventArgs e)
    {
        if (_challenge is null)
        {
            SetStatus("Сначала начни вход или регистрацию.");
            return;
        }
        if (string.IsNullOrWhiteSpace(VerificationCodeBox.Text))
        {
            SetStatus("Введи код подтверждения.");
            return;
        }

        SetBusy(true, "Подтверждаем вход");
        try
        {
            var result = await _apiClient.VerifyChallengeAsync(_challenge.Mode, _challenge.ChallengeId, _challenge.Email, VerificationCodeBox.Text.Trim(), _deviceId);
            if (result.session is null)
            {
                SetStatus(result.error ?? "Не удалось завершить вход.");
                return;
            }

            _session = result.session;
            await SessionStore.SaveSessionAsync(_session);
            await LoadNetworkProtectionStateAsync();
            ResetAuthInputs();
            ApplySessionState();
            ShowScreen(AppScreen.Home);
            SetStatus(null);
        }
        catch (Exception ex)
        {
            WindowsLog.Error("OnVerifyCodeClick failed", ex);
            SetStatus(HumanizeAuthActionError(ex, "Не удалось подтвердить код."));
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void OnQuickScanClick(object sender, RoutedEventArgs e)
    {
        await RunLocalQuickScanAsync();
    }

    private async Task RunLocalQuickScanAsync()
    {
        SetBusy(true, "Готовим быструю локальную проверку");
        try
        {
            var initial = new DesktopScanState
            {
                Id = Guid.NewGuid().ToString("N"),
                Platform = "windows",
                Mode = "QUICK",
                Status = "RUNNING",
                Verdict = "Локальная быстрая проверка",
                Message = "Проверяем загрузки, рабочий стол, temp и автозапуск.",
                StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Timeline = new[]
                {
                    "Собираем локальные зоны риска.",
                    "Ищем недавние исполняемые файлы, скрипты и установщики."
                }
            };
            _activeScan = initial;
            ShowActiveScanOverlay();

            var result = await Task.Run(ExecuteLocalQuickScan);
            _activeScan = result;
            RenderScan(result);
            await HistoryStore.AppendAsync(result);
            await LoadHistoryAsync();
            SetStatus(null);
        }
        catch (Exception ex)
        {
            WindowsLog.Error("RunLocalQuickScanAsync failed", ex);
            SetStatus(ex.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private DesktopScanState ExecuteLocalQuickScan()
    {
        return WindowsLocalQuickScanService.Run();
    }

    private async void OnDeepScanClick(object sender, RoutedEventArgs e)
    {
        await StartServerScanAsync("FULL", "FILESYSTEM", Environment.MachineName, Environment.SystemDirectory);
    }

    private async void OnSelectiveScanClick(object sender, RoutedEventArgs e)
    {
        await StartServerScanAsync("SELECTIVE", "FILESYSTEM", Environment.MachineName, Environment.SystemDirectory);
    }

    private async void OnProgramScanClick(object sender, RoutedEventArgs e)
    {
        var target = await PickProgramTargetAsync();
        if (target is null)
        {
            return;
        }

        await StartServerScanAsync("ARTIFACT", "ARTIFACT", target.Value.TargetName, target.Value.TargetPath);
    }

    private async Task<(string TargetName, string TargetPath)?> PickProgramTargetAsync()
    {
        try
        {
            var picker = new FolderPicker();
            InitializeWithWindow.Initialize(picker, _windowHandle);
            picker.FileTypeFilter.Add("*");
            var folder = await picker.PickSingleFolderAsync();
            if (folder is null)
            {
                return null;
            }

            return (folder.Name, folder.Path);
        }
        catch (Exception ex)
        {
            WindowsLog.Error("PickProgramTargetAsync failed", ex);
            SetStatus(ex.Message);
            return null;
        }
    }

    private async Task StartServerScanAsync(string mode, string artifactKind, string targetName, string targetPath)
    {
        if (_session is null)
        {
            SetStatus("Войди в аккаунт, чтобы запустить серверную проверку.");
            ShowScreen(AppScreen.Welcome);
            return;
        }

        SetBusy(true, "Создаём серверную проверку");
        WindowsLog.Info($"Start scan requested: {mode} / {artifactKind} / {targetPath}");
        try
        {
            var plan = artifactKind == "ARTIFACT"
                ? WindowsScanPlanService.BuildProgramOrFilePlan(mode, artifactKind, targetPath, targetName, DesktopCoverageMode.SmartCoverage)
                : WindowsScanPlanService.BuildSmartCoveragePlan(mode, artifactKind, targetName, targetPath);
            var result = await _apiClient.StartDesktopScanAsync(_session, plan);
            if (result.scan is null)
            {
                WindowsLog.Error($"Desktop scan creation failed: {result.error}");
                SetStatus(result.error ?? "Не удалось создать desktop-задачу.");
                return;
            }

            _scanPollCts?.Cancel();
            _scanPollCts = new CancellationTokenSource();
            _activeScan = result.scan;
            ShowActiveScanOverlay();
            _ = PollScanAsync(result.scan.Id, _scanPollCts.Token);
        }
        catch (Exception ex)
        {
            WindowsLog.Error("StartServerScanAsync failed", ex);
            SetStatus(ex.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task PollScanAsync(string scanId, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && _session is not null)
        {
            try
            {
                var result = await _apiClient.GetDesktopScanAsync(_session, scanId, cancellationToken);
                if (result.scan is null)
                {
                    WindowsLog.Error($"Desktop scan poll returned null: {result.error}");
                    SetStatus(result.error ?? "Не удалось прочитать статус проверки.");
                    await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken);
                    continue;
                }

                _activeScan = result.scan;
                RenderScan(result.scan);
                if (result.scan.IsFinished)
                {
                    if (result.scan.IsSuccessful)
                    {
                        await HistoryStore.AppendAsync(result.scan, cancellationToken);
                        await LoadHistoryAsync(cancellationToken);
                    }
                    SetStatus(null);
                    WindowsLog.Info($"Desktop scan finished: {result.scan.Status} / {result.scan.Verdict}");
                    return;
                }
            }
            catch (OperationCanceledException)
            {
                WindowsLog.Info("Desktop scan polling cancelled");
                return;
            }
            catch (Exception ex)
            {
                WindowsLog.Error("PollScanAsync failed", ex);
                SetStatus(ex.Message);
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                WindowsLog.Info("Desktop scan polling delay cancelled");
                return;
            }
        }
    }

    private void RenderScan(DesktopScanState scan)
    {
        try
        {
            EnsureScanOverlayReady();
            var progress = WindowsTrayProgressService.EstimateProgressPercent(scan);
            ScanModeText.Text = scan.Mode switch
            {
                "FULL" => "Глубокая проверка",
                "SELECTIVE" => "Выборочная проверка",
                "ARTIFACT" => "Проверка программы",
                "QUICK" => "Быстрая локальная проверка",
                _ => "Проверка"
            };
            ScanStageText.Text = string.IsNullOrWhiteSpace(scan.Message) ? $"Статус: {scan.Status}" : scan.Message;
            if (ScanTargetText is not null)
            {
                ScanTargetText.Text = scan.Platform.Equals("windows", StringComparison.OrdinalIgnoreCase)
                    ? $"Статус: {WindowsTrayProgressService.ResolveStatusLabel(scan.Status)}"
                    : scan.Platform;
            }
            ScanProgressText.Text = $"{progress}%";
            ScanCountsText.Text = $"Этапов в ленте: {scan.Timeline.Count} · находок: {scan.SurfacedFindings}";
            ScanProgressBar.Value = progress;

            _scanTimeline.Clear();
            foreach (var item in scan.Timeline.DefaultIfEmpty(string.IsNullOrWhiteSpace(scan.Message) ? "Сервер обрабатывает проверку." : scan.Message))
            {
                _scanTimeline.Add(item);
            }
            foreach (var finding in scan.Findings)
            {
                _scanTimeline.Add($"{finding.Title}: {finding.Summary}");
            }

            if (ScanTimelineHost is not null)
            {
                ScanTimelineHost.Children.Clear();
                foreach (var line in _scanTimeline)
                {
                    var card = CreateCardBorder("AppSurfaceRaisedBrush", "AppOutlineBrush", 18, new Thickness(14, 12, 14, 12));
                    card.Child = CreateBodyText("AppTextBrush");
                    ((TextBlock)card.Child).Text = line;
                    ScanTimelineHost.Children.Add(card);
                }
            }

            UpdateHomeState();
            App.WindowLifecycle?.UpdateTray(WindowsTrayProgressService.FromScan(scan));
            if (_scanOverlayOpen)
            {
                SetScanOverlayState(true);
            }
        }
        catch (Exception ex)
        {
            RebuildScanOverlayAsFallback(ex);
            SetStatus("Окно проверки переведено в безопасный режим.");
        }
    }

    private async void OnCancelScanClick(object sender, RoutedEventArgs e)
    {
        if (_session is null)
        {
            return;
        }

        SetBusy(true, "Отменяем проверку");
        try
        {
            _scanPollCts?.Cancel();
            var result = await _apiClient.CancelDesktopScanAsync(_session);
            var message = result.success ? "Проверка остановлена." : result.error ?? "Не удалось отменить проверку.";
            WindowsLog.Info($"Cancel scan result: {message}");
            SetStatus(result.success ? null : message);
            if (_activeScan is not null)
            {
                _activeScan = new DesktopScanState
                {
                    Id = _activeScan.Id,
                    Platform = _activeScan.Platform,
                    Mode = _activeScan.Mode,
                    Status = "CANCELLED",
                    Verdict = _activeScan.Verdict,
                    Message = message,
                    RiskScore = _activeScan.RiskScore,
                    SurfacedFindings = _activeScan.SurfacedFindings,
                    HiddenFindings = _activeScan.HiddenFindings,
                    StartedAt = _activeScan.StartedAt,
                    CompletedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    Timeline = _activeScan.Timeline.Append(message).ToArray(),
                    Findings = _activeScan.Findings
                };
                RenderScan(_activeScan);
            }
        }
        catch (Exception ex)
        {
            WindowsLog.Error("OnCancelScanClick failed", ex);
            SetStatus(ex.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void OnHideScanOverlayClick(object sender, RoutedEventArgs e)
    {
        SetScanOverlayState(false);
        ShowScreen(AppScreen.Home);
    }

    private void OnOpenScanOverlayClick(object sender, RoutedEventArgs e)
    {
        ShowActiveScanOverlay();
    }

    private void OnHomeClick(object sender, RoutedEventArgs e)
    {
        SetHistoryDetailState(false);
        ShowScreen(AppScreen.Home);
    }

    private void OnHistoryClick(object sender, RoutedEventArgs e)
    {
        if (_session is null)
        {
            SetStatus("Войди в аккаунт, чтобы открыть историю.");
            ShowScreen(AppScreen.Welcome);
            return;
        }

        SetScanOverlayState(false);
        ShowScreen(AppScreen.History);
    }

    private void OnSettingsClick(object sender, RoutedEventArgs e)
    {
        SetScanOverlayState(false);
        SetHistoryDetailState(false);
        ShowScreen(AppScreen.Settings);
    }

    private void OnToggleDrawerClick(object sender, RoutedEventArgs e)
    {
        SetDrawerState(!_drawerOpen);
    }

    private async void OnThemeModeSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_preferenceUiSync)
        {
            return;
        }

        await SavePreferencesAsync(prefs =>
        {
            prefs.ThemeMode = IndexToThemeMode(ThemeModeCombo.SelectedIndex);
        }, rebuildVisualTree: true);
    }

    private async void OnDynamicColorsToggled(object sender, RoutedEventArgs e)
    {
        if (_preferenceUiSync)
        {
            return;
        }

        await SavePreferencesAsync(prefs =>
        {
            prefs.DynamicColorsEnabled = DynamicColorsToggle.IsOn;
        }, rebuildVisualTree: true);
    }

    private async void OnAutoStartToggled(object sender, RoutedEventArgs e)
    {
        if (_preferenceUiSync)
        {
            return;
        }

        await SavePreferencesAsync(prefs =>
        {
            prefs.AutoStartEnabled = AutoStartToggle.IsOn;
        }, rebuildVisualTree: false);

        var installState = InstallStateStore.ResolveExistingInstall(Environment.ProcessPath)
            ?? InstallStateStore.CreateDefault(
                InstallLayout.ResolveInstallRootFromExecutablePath(Environment.ProcessPath ?? AppContext.BaseDirectory),
                VersionInfo.Current);
        installState.Version = VersionInfo.Current;
        installState.AutoStartEnabled = AutoStartToggle.IsOn;
        InstallStateStore.Save(installState);
        WindowsBundleInstaller.EnsureAutoStart(installState);
    }

    private async void OnNetworkProtectionToggled(object sender, RoutedEventArgs e)
    {
        if (_networkUiSync)
        {
            return;
        }

        _networkState = new NetworkProtectionState
        {
            Platform = "windows",
            NetworkEnabled = NetworkProtectionToggle.IsOn,
            AdBlockEnabled = NetworkProtectionToggle.IsOn,
            UnsafeSitesEnabled = NetworkProtectionToggle.IsOn,
            BlockedAdsPlatform = _networkState.BlockedAdsPlatform,
            BlockedThreatsPlatform = _networkState.BlockedThreatsPlatform,
            BlockedAdsTotal = _networkState.BlockedAdsTotal,
            BlockedThreatsTotal = _networkState.BlockedThreatsTotal,
            DeveloperMode = _networkState.DeveloperMode
        };
        await PushNetworkStateAsync();
    }

    private async void OnAdBlockToggled(object sender, RoutedEventArgs e)
    {
        await OnNetworkProtectionFallbackAsync();
    }

    private async void OnUnsafeSitesToggled(object sender, RoutedEventArgs e)
    {
        await OnNetworkProtectionFallbackAsync();
    }

    private async void OnSettingsNetworkToggled(object sender, RoutedEventArgs e)
    {
        await OnNetworkProtectionFallbackAsync();
    }

    private async void OnSettingsAdToggled(object sender, RoutedEventArgs e)
    {
        await OnNetworkProtectionFallbackAsync();
    }

    private async void OnSettingsUnsafeToggled(object sender, RoutedEventArgs e)
    {
        await OnNetworkProtectionFallbackAsync();
    }

    private async Task OnNetworkProtectionFallbackAsync()
    {
        if (_networkUiSync || NetworkProtectionToggle is null)
        {
            return;
        }

        await PushNetworkStateAsync();
    }

    private async Task PushNetworkStateAsync()
    {
        var enabled = NetworkProtectionToggle?.IsOn == true;
        _preferences = await ClientPreferencesStateService.UpdateAsync(state =>
        {
            state.NetworkProtectionEnabled = enabled;
            state.AdBlockEnabled = enabled;
            state.UnsafeSitesEnabled = enabled;
            return state;
        });

        if (_session is null)
        {
            _networkState = BuildLocalNetworkFallback();
            UpdateNetworkUi();
            return;
        }

        try
        {
            var result = await _apiClient.UpdateNetworkProtectionStateAsync(_session, enabled, enabled, enabled, "windows");
            if (result.state is not null)
            {
                _networkState = result.state;
                _preferences = await ClientPreferencesStateService.ApplyRemoteNetworkStateAsync(result.state);
                SetStatus(null);
            }
            else
            {
                SetStatus(result.error ?? "Не удалось обновить параметры сетевой защиты.");
            }
        }
        catch (Exception ex)
        {
            WindowsLog.Error("PushNetworkStateAsync failed", ex);
            SetStatus(ex.Message);
        }

        UpdateNetworkUi();
    }

    private async void OnLogoutClick(object sender, RoutedEventArgs e)
    {
        if (_session is not null)
        {
            try
            {
                await _apiClient.LogoutAsync(_session);
            }
            catch
            {
            }
        }

        WindowsLog.Info("Logout requested");
        _scanPollCts?.Cancel();
        try
        {
            SetDrawerState(false);
            SetScanOverlayState(false);
            SetHistoryDetailState(false);
            _session = null;
            _activeScan = null;
            SessionStore.ClearSession();
            ResetAuthInputs();
            _networkState = BuildLocalNetworkFallback();
            App.WindowLifecycle?.SetShouldMinimizeToTray(() => _preferences.MinimizeToTrayOnClose);
            ApplySessionState();
            App.WindowLifecycle?.UpdateTray(WindowsTrayProgressService.CreateIdle());
            ShowScreen(AppScreen.Welcome);
            SetStatus(null);
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Logout UI reset failed, rebuilding visual tree", ex);
            _session = null;
            _activeScan = null;
            _networkState = BuildLocalNetworkFallback();
            RebuildVisualTree();
            ShowScreen(AppScreen.Welcome);
            SetStatus(null);
        }
    }

    private void HookWindowLifecycle()
    {
        if (App.WindowLifecycle is null)
        {
            return;
        }

        WindowsLog.Info("Configuring window lifecycle bindings");
        App.WindowLifecycle.RestoreRequested -= OnRestoreRequested;
        App.WindowLifecycle.RestoreRequested += OnRestoreRequested;
        App.WindowLifecycle.ExitRequested -= OnTrayExitRequested;
        App.WindowLifecycle.ExitRequested += OnTrayExitRequested;
        App.WindowLifecycle.SetMinimumSize(920, 640);
        App.WindowLifecycle.SetShouldMinimizeToTray(() => _preferences.MinimizeToTrayOnClose);
        App.WindowLifecycle.SetTrayStateProvider(() => _activeScan is not null
            ? WindowsTrayProgressService.FromScan(_activeScan)
            : WindowsTrayProgressService.CreateIdle());
        App.WindowLifecycle.RefreshTrayState();
        WindowsLog.Info("Window lifecycle bindings ready");
    }

    private void OnTrayExitRequested()
    {
        try
        {
            DispatcherQueue.TryEnqueue(() => App.WindowLifecycle?.RequestRealClose());
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Tray exit request failed", ex);
        }
    }

    private void OnRestoreRequested()
    {
        try
        {
            DispatcherQueue.TryEnqueue(() =>
            {
                if (_activeScan is not null && _scanOverlayOpen)
                {
                    ShowActiveScanOverlay();
                    return;
                }

                if (_screen == AppScreen.Splash)
                {
                    ShowScreen(_session is null ? AppScreen.Welcome : AppScreen.Home);
                }
            });
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Tray restore hook failed", ex);
        }
    }

    private async void OnVersionTapClick(object sender, RoutedEventArgs e)
    {
        _developerTapCount++;
        if (_developerTapCount < 7)
        {
            return;
        }

        _developerTapCount = 0;
        await SavePreferencesAsync(prefs =>
        {
            prefs.DeveloperModeEnabled = true;
        }, rebuildVisualTree: false);

        if (_session is not null)
        {
            _session.User.IsDeveloperMode = true;
        }

        ApplySessionState();
        SetStatus(null);
    }

    private Button CreateDrawerButton(string text, RoutedEventHandler handler, bool filled = true)
    {
        var button = filled ? CreateFilledButton(text, handler) : CreateTonalButton(text, handler);
        button.HorizontalAlignment = HorizontalAlignment.Stretch;
        return button;
    }

    private Border CreateWideModePanel(string title, string glyph, RoutedEventHandler handler)
    {
        var card = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineStrongBrush", new CornerRadius(38, 38, 26, 26), new Thickness(20));
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var glyphShell = CreateGlyphShell(glyph, 68, true);
        grid.Children.Add(glyphShell);

        var textStack = new StackPanel
        {
            Margin = new Thickness(16, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 2
        };
        textStack.Children.Add(CreateSectionTitle(title, 26));
        Grid.SetColumn(textStack, 1);
        grid.Children.Add(textStack);

        var action = CreateRoundActionButton("▶", handler, true);
        Grid.SetColumn(action, 2);
        grid.Children.Add(action);
        card.Child = grid;
        return card;
    }

    private Border CreateGridModePanel(string title, string glyph, RoutedEventHandler handler, bool emphasized)
    {
        var card = CreateCardBorder(
            emphasized ? "AppAccentSoftGradientBrush" : "AppSurfaceBrush",
            emphasized ? "AppOutlineStrongBrush" : "AppOutlineBrush",
            emphasized ? new CornerRadius(40, 24, 36, 24) : new CornerRadius(24, 40, 24, 36),
            new Thickness(18));
        card.MinHeight = emphasized ? 212 : 190;
        if (emphasized)
        {
            var stack = new StackPanel
            {
                Spacing = 12,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            stack.Children.Add(CreateGlyphShell(glyph, 62, true));
            stack.Children.Add(CreateTitleText(title, 24, TextAlignment.Center));
            stack.Children.Add(CreateRoundActionButton("▶", handler, true));
            card.Child = stack;
            return card;
        }

        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var icon = CreateGlyphShell(glyph, 54, false);
        icon.HorizontalAlignment = HorizontalAlignment.Left;
        grid.Children.Add(icon);
        var titleText = CreateTitleText(title, 22);
        titleText.Margin = new Thickness(0, 14, 0, 0);
        titleText.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetRow(titleText, 1);
        grid.Children.Add(titleText);
        var action = CreateRoundActionButton("▶", handler, false);
        action.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetRow(action, 2);
        grid.Children.Add(action);
        card.Child = grid;
        return card;
    }

    private Border CreateSlimModePanel(string title, string glyph, RoutedEventHandler handler)
    {
        var card = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", new CornerRadius(22, 34, 22, 34), new Thickness(18));
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var icon = CreateGlyphShell(glyph, 52, false);
        grid.Children.Add(icon);
        var titleBlock = CreateSectionTitle(title, 22);
        titleBlock.VerticalAlignment = VerticalAlignment.Center;
        titleBlock.Margin = new Thickness(14, 0, 0, 0);
        Grid.SetColumn(titleBlock, 1);
        grid.Children.Add(titleBlock);
        var button = CreateRoundActionButton("▶", handler, false);
        Grid.SetColumn(button, 2);
        grid.Children.Add(button);
        card.Child = grid;
        return card;
    }

    private Border CreateGlyphShell(string glyph, double size, bool emphasized)
    {
        var shell = new Border
        {
            Width = size,
            Height = size,
            CornerRadius = new CornerRadius(size / 2),
            Background = emphasized ? ThemeBrush("AppAccentSoftGradientBrush") : ThemeBrush("AppAccentSoftBrush"),
            BorderBrush = emphasized ? ThemeBrush("AppOutlineStrongBrush") : ThemeBrush("AppOutlineBrush"),
            BorderThickness = new Thickness(1),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        shell.Child = new TextBlock
        {
            Text = glyph,
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = size * 0.45,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Center
        };
        return shell;
    }

    private Button CreateRoundActionButton(string glyph, RoutedEventHandler handler, bool emphasized)
    {
        var button = new Button
        {
            Content = glyph,
            Width = emphasized ? 62 : 56,
            Height = emphasized ? 62 : 56,
            Background = emphasized ? ThemeBrush("AppPrimaryContainerBrush") : ThemeBrush("AppSurfaceStrongBrush"),
            Foreground = emphasized ? ThemeBrush("AppOnAccentBrush") : ThemeBrush("AppTextBrush"),
            BorderBrush = ThemeBrush("AppOutlineStrongBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(31),
            FontSize = 24,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center
        };
        button.Click += handler;
        return button;
    }

    private Border CreateHistoryRecordCard(StoredScanRecord item)
    {
        var card = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineBrush", 22, new Thickness(16));
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { Spacing = 6 };
        left.Children.Add(CreateSectionTitle(WindowsTrayProgressService.ResolveModeLabel(item.Mode), 22));
        var meta = CreateBodyText("AppMutedTextBrush");
        meta.Text = $"{item.SavedAt.LocalDateTime:dd.MM.yyyy HH:mm} · находок: {item.Findings.Count}";
        left.Children.Add(meta);
        grid.Children.Add(left);

        var right = new StackPanel
        {
            Spacing = 10,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center
        };
        var verdict = CreateCardBorder("AppSurfaceBrush", "AppOutlineStrongBrush", 18, new Thickness(12, 8, 12, 8));
        verdict.Child = CreateBodyText("AppTextBrush");
        ((TextBlock)verdict.Child).Text = item.Verdict;
        right.Children.Add(verdict);
        right.Children.Add(CreateRoundActionButton("→", (_, _) => OpenHistoryRecord(item), false));
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);

        card.Child = grid;
        card.Tapped += (_, _) => OpenHistoryRecord(item);
        return card;
    }

    private void OpenHistoryRecord(StoredScanRecord item)
    {
        EnsureHistoryDetailOverlayReady();
        if (HistoryDetailTitleText is null || HistoryDetailMetaText is null || HistoryDetailContentHost is null)
        {
            return;
        }

        HistoryDetailTitleText.Text = WindowsTrayProgressService.ResolveModeLabel(item.Mode);
        HistoryDetailMetaText.Text = $"{item.SavedAt.LocalDateTime:dd.MM.yyyy HH:mm} · {item.Verdict}";
        HistoryDetailContentHost.Children.Clear();
        if (!string.IsNullOrWhiteSpace(item.Message))
        {
            var summary = CreateCardBorder("AppSurfaceRaisedBrush", "AppOutlineBrush", 18, new Thickness(14));
            summary.Child = CreateBodyText("AppTextBrush");
            ((TextBlock)summary.Child).Text = item.Message;
            HistoryDetailContentHost.Children.Add(summary);
        }
        foreach (var finding in item.Findings)
        {
            var findingCard = CreateCardBorder("AppSurfaceRaisedBrush", "AppOutlineBrush", 18, new Thickness(14));
            var stack = new StackPanel { Spacing = 6 };
            stack.Children.Add(CreateSectionTitle(finding.Title, 18));
            var verdict = CreateBodyText("AppMutedTextBrush");
            verdict.Text = finding.Verdict;
            stack.Children.Add(verdict);
            var summary = CreateBodyText("AppTextBrush");
            summary.Text = finding.Summary;
            stack.Children.Add(summary);
            findingCard.Child = stack;
            HistoryDetailContentHost.Children.Add(findingCard);
        }
        foreach (var line in item.Timeline)
        {
            var lineCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 16, new Thickness(12));
            lineCard.Child = CreateBodyText("AppTextBrush");
            ((TextBlock)lineCard.Child).Text = line;
            HistoryDetailContentHost.Children.Add(lineCard);
        }
        SetHistoryDetailState(true);
    }

    private void AnimateElement(DependencyObject target, string propertyPath, double to, int durationMs, EasingFunctionBase? easing = null, Action? completed = null)
    {
        var storyboard = new Storyboard();
        var animation = new DoubleAnimation
        {
            To = to,
            Duration = TimeSpan.FromMilliseconds(durationMs),
            EnableDependentAnimation = true,
            EasingFunction = easing
        };
        Storyboard.SetTarget(animation, target);
        Storyboard.SetTargetProperty(animation, propertyPath);
        storyboard.Children.Add(animation);
        if (completed is not null)
        {
            storyboard.Completed += (_, _) => completed();
        }
        storyboard.Begin();
    }

    private Grid CreateActionRow(Button left, Button right)
    {
        var row = new Grid { Margin = new Thickness(0, 8, 0, 0) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        left.HorizontalAlignment = HorizontalAlignment.Stretch;
        right.HorizontalAlignment = HorizontalAlignment.Stretch;
        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 2);
        row.Children.Add(left);
        row.Children.Add(right);
        return row;
    }

    private Button CreateModeCard(string glyph, string title, string description, RoutedEventHandler handler, bool emphasized)
    {
        var button = emphasized ? CreateFilledButton(string.Empty, handler) : CreateTonalButton(string.Empty, handler);
        button.HorizontalAlignment = HorizontalAlignment.Stretch;
        button.VerticalAlignment = VerticalAlignment.Stretch;
        button.MinHeight = 194;
        button.Padding = new Thickness(22);
        button.Background = emphasized ? ThemeBrush("AppAccentGradientBrush") : ThemeBrush("AppSurfaceGradientBrush");
        button.BorderBrush = emphasized ? ThemeBrush("AppPrimaryContainerBrush") : ThemeBrush("AppOutlineBrush");

        var stack = new StackPanel
        {
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center
        };
        stack.Children.Add(new TextBlock
        {
            Text = glyph,
            FontSize = 34,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            Foreground = emphasized ? ThemeBrush("AppOnAccentBrush") : ThemeBrush("AppTextBrush")
        });
        stack.Children.Add(new TextBlock
        {
            Text = title,
            FontSize = 22,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            Foreground = emphasized ? ThemeBrush("AppOnAccentBrush") : ThemeBrush("AppTextBrush")
        });
        stack.Children.Add(new TextBlock
        {
            Text = description,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            Foreground = emphasized
                ? new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.OnAccent, 0.82))
                : ThemeBrush("AppMutedTextBrush")
        });
        button.Content = stack;
        return button;
    }

    private Button CreateFilledButton(string text, RoutedEventHandler handler)
    {
        var button = new Button
        {
            Content = text,
            Background = ThemeBrush("AppPrimaryContainerBrush"),
            Foreground = ThemeBrush("AppOnAccentBrush"),
            BorderBrush = ThemeBrush("AppPrimaryContainerBrush"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(18, 12, 18, 12),
            MinHeight = 52,
            MinWidth = 148,
            CornerRadius = new CornerRadius(22),
            HorizontalAlignment = HorizontalAlignment.Left,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center
        };
        button.Click += handler;
        return button;
    }

    private Button CreateTonalButton(string text, RoutedEventHandler handler)
    {
        var button = new Button
        {
            Content = text,
            Background = ThemeBrush("AppSurfaceBrush"),
            Foreground = ThemeBrush("AppTextBrush"),
            BorderBrush = ThemeBrush("AppOutlineBrush"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(18, 12, 18, 12),
            MinHeight = 52,
            MinWidth = 148,
            CornerRadius = new CornerRadius(22),
            HorizontalAlignment = HorizontalAlignment.Left,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center
        };
        button.Click += handler;
        return button;
    }

    private Button CreateIconButton(string glyph, RoutedEventHandler handler)
    {
        var button = new Button
        {
            Content = glyph,
            Width = 52,
            Height = 52,
            Background = ThemeBrush("AppSurfaceBrush"),
            Foreground = ThemeBrush("AppTextBrush"),
            BorderBrush = ThemeBrush("AppOutlineBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(18),
            FontSize = 20,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center
        };
        button.Click += handler;
        return button;
    }

    private static Border CreateCardBorder(string backgroundKey, string borderKey, double radius, Thickness padding)
    {
        return CreateCardBorder(backgroundKey, borderKey, new CornerRadius(radius), padding);
    }

    private static Border CreateCardBorder(string backgroundKey, string borderKey, CornerRadius radius, Thickness padding)
    {
        return new Border
        {
            Background = ThemeBrush(backgroundKey),
            BorderBrush = ThemeBrush(borderKey),
            BorderThickness = new Thickness(1),
            CornerRadius = radius,
            Padding = padding
        };
    }

    private static TextBlock CreateTitleText(string text, double size, TextAlignment alignment = TextAlignment.Left)
    {
        return new TextBlock
        {
            Text = text,
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = size,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            TextAlignment = alignment,
            TextWrapping = TextWrapping.Wrap
        };
    }

    private static TextBlock CreateSubtitleText(string text, TextAlignment alignment = TextAlignment.Left)
    {
        return new TextBlock
        {
            Text = text,
            Foreground = ThemeBrush("AppMutedTextBrush"),
            TextAlignment = alignment,
            TextWrapping = TextWrapping.Wrap
        };
    }

    private static TextBlock CreateSectionTitle(string text, double size)
    {
        return new TextBlock
        {
            Text = text,
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = size,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            TextWrapping = TextWrapping.Wrap
        };
    }

    private static TextBlock CreateBodyText(string brushKey)
    {
        return new TextBlock
        {
            Foreground = ThemeBrush(brushKey),
            TextWrapping = TextWrapping.Wrap
        };
    }

    private static TextBlock CreateFieldLabel(string text)
    {
        return new TextBlock
        {
            Text = text,
            Foreground = ThemeBrush("AppMutedTextBrush")
        };
    }

    private static TextBox CreateTextBox(string? placeholderText = null)
    {
        return new TextBox
        {
            PlaceholderText = placeholderText ?? string.Empty,
            Background = ThemeBrush("AppFieldGradientBrush"),
            Foreground = ThemeBrush("AppTextBrush"),
            BorderBrush = ThemeBrush("AppOutlineBrush"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(16),
            MinHeight = 56,
            CornerRadius = new CornerRadius(18),
            VerticalContentAlignment = VerticalAlignment.Center
        };
    }

    private static PasswordBox CreatePasswordBox()
    {
        return new PasswordBox
        {
            Background = ThemeBrush("AppFieldGradientBrush"),
            Foreground = ThemeBrush("AppTextBrush"),
            BorderBrush = ThemeBrush("AppOutlineBrush"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(16),
            MinHeight = 56,
            CornerRadius = new CornerRadius(18),
            PasswordRevealMode = PasswordRevealMode.Peek,
            VerticalContentAlignment = VerticalAlignment.Center
        };
    }

    private static ListView CreateListView()
    {
        return new ListView
        {
            SelectionMode = ListViewSelectionMode.None,
            BorderThickness = new Thickness(0),
            Background = new SolidColorBrush(UiColor.FromArgb(0, 0, 0, 0)),
            Foreground = ThemeBrush("AppTextBrush")
        };
    }

    private static Brush ThemeBrush(string key)
    {
        if (App.Current.Resources.TryGetValue(key, out var value) && value is Brush brush)
        {
            return brush;
        }

        return new SolidColorBrush(UiColor.FromArgb(255, 255, 255, 255));
    }

    private FrameworkElement BuildVersionBadge()
    {
        var button = new Button
        {
            Background = new SolidColorBrush(UiColor.FromArgb(1, 0, 0, 0)),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(12, 8, 12, 8),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(14, 0, 0, 10)
        };
        button.Click += OnVersionTapClick;
        FooterVersionText = new TextBlock
        {
            Foreground = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.Text, 0.42)),
            FontSize = 12,
            TextWrapping = TextWrapping.NoWrap
        };
        button.Content = FooterVersionText;
        return button;
    }

    private void UpdateVersionBadge()
    {
        if (FooterVersionText is null)
        {
            return;
        }

        FooterVersionText.Text = $"v{_currentVersion}{ResolveInstallEditionSuffix()}";
    }

    private string ResolveInstallEditionSuffix()
    {
        try
        {
            var installRoot = InstallLayout.ResolveInstallRootFromExecutablePath(Environment.ProcessPath ?? AppContext.BaseDirectory);
            var nvMetadataPath = Path.Combine(installRoot, "nv-package.json");
            if (!File.Exists(nvMetadataPath))
            {
                return string.Empty;
            }

            using var stream = File.OpenRead(nvMetadataPath);
            using var doc = JsonDocument.Parse(stream);
            if (doc.RootElement.TryGetProperty("install_source", out var source)
                && string.Equals(source.GetString(), "nv", StringComparison.OrdinalIgnoreCase))
            {
                return " · NV edition";
            }
        }
        catch (Exception ex)
        {
            WindowsLog.Error("ResolveInstallEditionSuffix failed", ex);
        }

        return string.Empty;
    }

    private static UIElement CreateLogoElement()
    {
        var image = new Image
        {
            Width = 88,
            Height = 88,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Stretch = Stretch.Uniform
        };

        try
        {
            image.Source = new BitmapImage(new Uri("ms-appx:///Assets/NeuralV.png"));
            return image;
        }
        catch
        {
            return new TextBlock
            {
                Text = "NV",
                Foreground = ThemeBrush("AppTextBrush"),
                FontSize = 24,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
        }
    }
}
