using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
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
        public double Velocity { get; set; }
    }

    private readonly NeuralVApiClient _apiClient = new();
    private readonly string _deviceId;
    private readonly string _currentVersion = VersionInfo.Current;
    private readonly Grid _windowRoot = new();
    private readonly ObservableCollection<string> _historyItems = new();
    private readonly ObservableCollection<string> _scanTimeline = new();
    private readonly List<FloatingShape> _floatingShapes = new();
    private readonly DispatcherTimer _shapeTimer = new();
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
    private AppScreen _screen = AppScreen.Splash;
    private IntPtr _windowHandle;
    private AppWindow? _appWindow;

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
    private Grid ScanOverlay = default!;
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
    private ToggleSwitch NetworkProtectionToggle = default!;
    private ToggleSwitch AdBlockToggle = default!;
    private ToggleSwitch UnsafeSitesToggle = default!;
    private TextBlock NetworkCountersText = default!;

    private TextBlock ScanModeText = default!;
    private TextBlock ScanStageText = default!;
    private TextBlock ScanProgressText = default!;
    private TextBlock ScanCountsText = default!;
    private ProgressBar ScanProgressBar = default!;
    private ProgressRing ScanProgressRing = default!;
    private ListView ScanTimelineList = default!;

    private ListView HistoryList = default!;
    private TextBlock SettingsAccountText = default!;
    private TextBlock SettingsDeveloperText = default!;
    private ComboBox ThemeModeCombo = default!;
    private ToggleSwitch DynamicColorsToggle = default!;
    private ToggleSwitch SettingsNetworkToggle = default!;
    private ToggleSwitch SettingsAdToggle = default!;
    private ToggleSwitch SettingsUnsafeToggle = default!;

    public MainWindow()
    {
        try
        {
            _deviceId = EnsureDeviceIdSafe();
            Content = _windowRoot;
            _windowRoot.Background = ThemeBrush("AppBackgroundBrush");
            _windowRoot.Loaded += OnRootLoaded;
            Closed += OnClosed;

            _shapeTimer.Interval = TimeSpan.FromMilliseconds(900);
            _shapeTimer.Tick += OnShapeTick;

            BuildLayout();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("MainWindow ctor failed", ex);
            throw;
        }
    }

    public void RunSmokeValidation()
    {
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
        TryConfigureWindowHandle();
        ApplyAmbientPalette();
        _shapeTimer.Start();
        await InitializeAsync();
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        _shapeTimer.Stop();
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
        var history = await HistoryStore.LoadAsync(cancellationToken);
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
        return new NetworkProtectionState
        {
            Platform = "windows",
            NetworkEnabled = _preferences.NetworkProtectionEnabled,
            AdBlockEnabled = _preferences.AdBlockEnabled,
            UnsafeSitesEnabled = _preferences.UnsafeSitesEnabled,
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
        _windowRoot.Children.Clear();
        _floatingShapes.Clear();

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

        var shell = new Grid
        {
            Padding = new Thickness(22)
        };
        shell.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        shell.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        shell.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        _windowRoot.Children.Add(shell);

        var topBar = BuildTopBar();
        shell.Children.Add(topBar);

        StatusBanner = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 18, new Thickness(14, 10, 14, 10));
        StatusBanner.Visibility = Visibility.Collapsed;
        StatusBanner.Margin = new Thickness(0, 0, 0, 14);
        Grid.SetRow(StatusBanner, 1);
        StatusBannerText = CreateBodyText("AppTextBrush");
        StatusBanner.Child = StatusBannerText;
        shell.Children.Add(StatusBanner);

        ScreenHost = new Grid();
        Grid.SetRow(ScreenHost, 2);
        shell.Children.Add(ScreenHost);

        SplashView = BuildSplashView();
        WelcomeView = BuildWelcomeView();
        LoginView = BuildLoginView();
        RegisterView = BuildRegisterView();
        CodeView = BuildCodeView();
        HomeView = BuildHomeView();
        HistoryView = BuildHistoryView();
        SettingsView = BuildSettingsView();

        ScreenHost.Children.Add(SplashView);
        ScreenHost.Children.Add(WelcomeView);
        ScreenHost.Children.Add(LoginView);
        ScreenHost.Children.Add(RegisterView);
        ScreenHost.Children.Add(CodeView);
        ScreenHost.Children.Add(HomeView);
        ScreenHost.Children.Add(HistoryView);
        ScreenHost.Children.Add(SettingsView);

        ScanOverlay = BuildScanOverlay();
        Canvas.SetZIndex(ScanOverlay, 40);
        ScreenHost.Children.Add(ScanOverlay);

        DrawerScrim = new Border
        {
            Background = ThemeBrush("AppOverlayScrimBrush"),
            Visibility = Visibility.Collapsed
        };
        DrawerScrim.Tapped += (_, _) => SetDrawerState(false);
        Canvas.SetZIndex(DrawerScrim, 60);
        _windowRoot.Children.Add(DrawerScrim);

        DrawerPanel = BuildDrawerPanel();
        DrawerPanel.Visibility = Visibility.Collapsed;
        Canvas.SetZIndex(DrawerPanel, 61);
        _windowRoot.Children.Add(DrawerPanel);

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

        ApplyAmbientPalette();
    }

    private Grid BuildTopBar()
    {
        var topBar = new Grid { Margin = new Thickness(0, 0, 0, 14) };
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var drawerButton = CreateIconButton("☰", OnToggleDrawerClick);
        topBar.Children.Add(drawerButton);

        var titleStack = new StackPanel
        {
            Margin = new Thickness(16, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(titleStack, 1);
        HeaderTitleText = new TextBlock
        {
            Text = "NeuralV",
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = 28,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold
        };
        HeaderSubtitleText = CreateBodyText("AppMutedTextBrush");
        titleStack.Children.Add(HeaderTitleText);
        titleStack.Children.Add(HeaderSubtitleText);
        topBar.Children.Add(titleStack);

        var accountChip = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 18, new Thickness(14, 10, 14, 10));
        accountChip.HorizontalAlignment = HorizontalAlignment.Right;
        AccountChipText = new TextBlock { Foreground = ThemeBrush("AppTextBrush") };
        accountChip.Child = AccountChipText;
        Grid.SetColumn(accountChip, 2);
        topBar.Children.Add(accountChip);

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
        stack.Children.Add(CreateDrawerButton("Закрыть меню", (_, _) => SetDrawerState(false), false));
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
        stack.Children.Add(CreateSubtitleText("Поднимаем палитру, сессию и Windows-интерфейс."));
        return host;
    }

    private FrameworkElement BuildWelcomeView()
    {
        var host = new Grid();
        host.Children.Add(BuildWelcomeShapeLayer());

        var card = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineStrongBrush", 32, new Thickness(28));
        card.MaxWidth = 620;
        card.HorizontalAlignment = HorizontalAlignment.Center;
        card.VerticalAlignment = VerticalAlignment.Center;

        var stack = new StackPanel { Spacing = 14 };
        var logoShell = new Border
        {
            Width = 112,
            Height = 112,
            Background = ThemeBrush("AppAccentSoftBrush"),
            CornerRadius = new CornerRadius(56),
            HorizontalAlignment = HorizontalAlignment.Center,
            Padding = new Thickness(14)
        };
        logoShell.Child = CreateLogoElement();
        stack.Children.Add(logoShell);
        stack.Children.Add(CreateTitleText("NeuralV", 40, TextAlignment.Center));
        stack.Children.Add(CreateSubtitleText("Войди в аккаунт или создай новый, чтобы управлять защитой Windows, историей и серверными проверками.", TextAlignment.Center));

        var actions = new Grid { Margin = new Thickness(0, 8, 0, 0) };
        actions.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        actions.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
        actions.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var loginButton = CreateFilledButton("Войти", OnShowLoginClick);
        loginButton.HorizontalAlignment = HorizontalAlignment.Stretch;
        Grid.SetColumn(loginButton, 0);
        actions.Children.Add(loginButton);

        var registerButton = CreateTonalButton("Зарегистрироваться", OnShowRegisterClick);
        registerButton.HorizontalAlignment = HorizontalAlignment.Stretch;
        Grid.SetColumn(registerButton, 2);
        actions.Children.Add(registerButton);
        stack.Children.Add(actions);

        card.Child = stack;
        host.Children.Add(card);
        return host;
    }

    private Grid BuildWelcomeShapeLayer()
    {
        var host = new Grid();
        host.Children.Add(CreateFloatingShape(0, HorizontalAlignment.Left, VerticalAlignment.Top, new Thickness(90, 90, 0, 0), 168, 92));
        host.Children.Add(CreateFloatingShape(1, HorizontalAlignment.Right, VerticalAlignment.Top, new Thickness(0, 120, 140, 0), 118, 118));
        host.Children.Add(CreateFloatingShape(2, HorizontalAlignment.Left, VerticalAlignment.Bottom, new Thickness(150, 0, 0, 140), 106, 146));
        host.Children.Add(CreateFloatingShape(3, HorizontalAlignment.Right, VerticalAlignment.Bottom, new Thickness(0, 0, 110, 110), 168, 96));
        host.Children.Add(CreateFloatingShape(4, HorizontalAlignment.Center, VerticalAlignment.Top, new Thickness(0, 90, 0, 0), 120, 120));
        host.Children.Add(CreateFloatingShape(5, HorizontalAlignment.Center, VerticalAlignment.Bottom, new Thickness(0, 0, 0, 110), 150, 84));
        return host;
    }

    private Border CreateFloatingShape(int variant, HorizontalAlignment horizontal, VerticalAlignment vertical, Thickness margin, double width, double height)
    {
        var shape = new Border
        {
            Width = width,
            Height = height,
            HorizontalAlignment = horizontal,
            VerticalAlignment = vertical,
            Margin = margin,
            Background = BuildWeaveBrush(App.Palette.Accent, App.Palette.AccentSecondary, 0.08, 0.28),
            BorderBrush = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.Text, 0.08)),
            BorderThickness = new Thickness(1),
            Opacity = 0.82,
            RenderTransformOrigin = new Point(0.5, 0.5),
            RenderTransform = new RotateTransform { Angle = variant * 8 }
        };
        ApplyShapeVariant(shape, variant);
        shape.Tapped += OnWelcomeShapeTapped;
        _floatingShapes.Add(new FloatingShape
        {
            Element = shape,
            Variant = variant,
            Angle = variant * 8,
            Velocity = 1.2 + _random.NextDouble() * 1.4
        });
        return shape;
    }

    private FrameworkElement BuildLoginView()
    {
        var cardStack = new StackPanel { Spacing = 12 };
        cardStack.Children.Add(CreateTitleText("Вход", 34));
        cardStack.Children.Add(CreateSubtitleText("Введи почту и пароль. После этого придёт код подтверждения."));
        cardStack.Children.Add(CreateFieldLabel("E-mail"));
        LoginEmailBox = CreateTextBox("name@example.com");
        cardStack.Children.Add(LoginEmailBox);
        cardStack.Children.Add(CreateFieldLabel("Пароль"));
        LoginPasswordBox = CreatePasswordBox();
        cardStack.Children.Add(LoginPasswordBox);
        cardStack.Children.Add(CreateActionRow(
            CreateTonalButton("Назад", OnBackToWelcomeClick),
            CreateFilledButton("Продолжить", OnStartLoginClick)));
        return BuildCenteredStage(cardStack);
    }

    private FrameworkElement BuildRegisterView()
    {
        var cardStack = new StackPanel { Spacing = 12 };
        cardStack.Children.Add(CreateTitleText("Регистрация", 34));
        cardStack.Children.Add(CreateSubtitleText("Создай аккаунт и подтверди почту кодом."));
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
        var card = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineStrongBrush", 30, new Thickness(26));
        card.MaxWidth = 620;
        card.HorizontalAlignment = HorizontalAlignment.Center;
        card.VerticalAlignment = VerticalAlignment.Center;
        card.Child = content;
        host.Children.Add(card);
        return host;
    }

    private FrameworkElement BuildHomeView()
    {
        var scroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        };

        var stack = new StackPanel
        {
            Spacing = 18,
            MaxWidth = 1160
        };

        var hero = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineStrongBrush", 30, new Thickness(24));
        var heroStack = new StackPanel { Spacing = 8 };
        HomeHeroTitleText = CreateTitleText("Главное меню", 36);
        HomeHeroSubtitleText = CreateSubtitleText("Запускай нужный режим проверки или включай защиту в сети.");
        heroStack.Children.Add(HomeHeroTitleText);
        heroStack.Children.Add(HomeHeroSubtitleText);
        hero.Child = heroStack;
        stack.Children.Add(hero);

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
        stack.Children.Add(ActiveScanCard);

        var modes = new Grid();
        modes.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        modes.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
        modes.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        modes.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        modes.RowDefinitions.Add(new RowDefinition { Height = new GridLength(18) });
        modes.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var quickCard = CreateModeCard("⚡", "Быстрая", "Локальный быстрый проход по частым зонам риска.", OnQuickScanClick, true);
        Grid.SetColumn(quickCard, 0);
        Grid.SetRow(quickCard, 0);
        modes.Children.Add(quickCard);

        var fullCard = CreateModeCard("◎", "Глубокая", "Серверный проход по системе, программам и связанным корням.", OnDeepScanClick, false);
        Grid.SetColumn(fullCard, 2);
        Grid.SetRow(fullCard, 0);
        modes.Children.Add(fullCard);

        var selectiveCard = CreateModeCard("◌", "Выборочная", "Таргетированный проход по ключевым путям и компонентам.", OnSelectiveScanClick, false);
        Grid.SetColumn(selectiveCard, 0);
        Grid.SetRow(selectiveCard, 2);
        modes.Children.Add(selectiveCard);

        var artifactCard = CreateModeCard("▣", "Проверить программу", "Выбери корневую папку программы для отдельного анализа.", OnProgramScanClick, false);
        Grid.SetColumn(artifactCard, 2);
        Grid.SetRow(artifactCard, 2);
        modes.Children.Add(artifactCard);
        stack.Children.Add(modes);

        var networkCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 26, new Thickness(20));
        var networkStack = new StackPanel { Spacing = 10 };
        networkStack.Children.Add(CreateSectionTitle("Защита в сети", 24));
        networkStack.Children.Add(CreateSubtitleText("Включи сетевую защиту, блокировку рекламы и опасных сайтов."));
        NetworkProtectionToggle = new ToggleSwitch { Header = "Включить защиту в сети" };
        NetworkProtectionToggle.Toggled += OnNetworkProtectionToggled;
        AdBlockToggle = new ToggleSwitch { Header = "Блокировать рекламу" };
        AdBlockToggle.Toggled += OnAdBlockToggled;
        UnsafeSitesToggle = new ToggleSwitch { Header = "Блокировать опасные сайты" };
        UnsafeSitesToggle.Toggled += OnUnsafeSitesToggled;
        NetworkCountersText = CreateBodyText("AppMutedTextBrush");
        networkStack.Children.Add(NetworkProtectionToggle);
        networkStack.Children.Add(AdBlockToggle);
        networkStack.Children.Add(UnsafeSitesToggle);
        networkStack.Children.Add(NetworkCountersText);
        networkCard.Child = networkStack;
        stack.Children.Add(networkCard);

        scroll.Content = stack;
        return scroll;
    }

    private FrameworkElement BuildHistoryView()
    {
        var scroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        };

        var stack = new StackPanel
        {
            Spacing = 16,
            MaxWidth = 1000
        };
        stack.Children.Add(CreateTitleText("История", 36));
        stack.Children.Add(CreateSubtitleText("Старые завершённые проверки и их краткие результаты."));
        var card = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 26, new Thickness(18));
        HistoryList = CreateListView();
        HistoryList.ItemsSource = _historyItems;
        card.Child = HistoryList;
        stack.Children.Add(card);
        scroll.Content = stack;
        return scroll;
    }

    private FrameworkElement BuildSettingsView()
    {
        var scroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        };

        var stack = new StackPanel
        {
            Spacing = 16,
            MaxWidth = 860
        };
        stack.Children.Add(CreateTitleText("Настройки", 36));

        var accountCard = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineStrongBrush", 26, new Thickness(20));
        var accountStack = new StackPanel { Spacing = 8 };
        accountStack.Children.Add(CreateSectionTitle("Аккаунт", 24));
        SettingsAccountText = CreateBodyText("AppMutedTextBrush");
        accountStack.Children.Add(SettingsAccountText);
        var logoutButton = CreateTonalButton("Выйти", OnLogoutClick);
        accountStack.Children.Add(logoutButton);
        accountCard.Child = accountStack;
        stack.Children.Add(accountCard);

        var lookCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 26, new Thickness(20));
        var lookStack = new StackPanel { Spacing = 10 };
        lookStack.Children.Add(CreateSectionTitle("Оформление", 24));
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
        lookCard.Child = lookStack;
        stack.Children.Add(lookCard);

        var protectionCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 26, new Thickness(20));
        var protectionStack = new StackPanel { Spacing = 10 };
        protectionStack.Children.Add(CreateSectionTitle("Защита", 24));
        SettingsDeveloperText = CreateBodyText("AppMutedTextBrush");
        SettingsNetworkToggle = new ToggleSwitch { Header = "Защита в сети" };
        SettingsNetworkToggle.Toggled += OnSettingsNetworkToggled;
        SettingsAdToggle = new ToggleSwitch { Header = "Блокировать рекламу" };
        SettingsAdToggle.Toggled += OnSettingsAdToggled;
        SettingsUnsafeToggle = new ToggleSwitch { Header = "Блокировать опасные сайты" };
        SettingsUnsafeToggle.Toggled += OnSettingsUnsafeToggled;
        protectionStack.Children.Add(SettingsDeveloperText);
        protectionStack.Children.Add(SettingsNetworkToggle);
        protectionStack.Children.Add(SettingsAdToggle);
        protectionStack.Children.Add(SettingsUnsafeToggle);
        protectionCard.Child = protectionStack;
        stack.Children.Add(protectionCard);

        scroll.Content = stack;
        return scroll;
    }

    private Grid BuildScanOverlay()
    {
        var overlay = new Grid
        {
            Background = ThemeBrush("AppOverlayScrimBrush"),
            Visibility = Visibility.Collapsed
        };

        var frame = CreateCardBorder("AppSurfaceStrongBrush", "AppOutlineStrongBrush", 30, new Thickness(22));
        frame.MaxWidth = 1220;
        frame.MaxHeight = 760;
        frame.HorizontalAlignment = HorizontalAlignment.Center;
        frame.VerticalAlignment = VerticalAlignment.Center;
        overlay.Children.Add(frame);

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(360) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        frame.Child = grid;

        var leftCard = CreateCardBorder("AppSurfaceStrongGradientBrush", "AppOutlineStrongBrush", 26, new Thickness(20));
        Grid.SetColumn(leftCard, 0);
        var leftStack = new StackPanel { Spacing = 12 };
        leftStack.Children.Add(CreateSectionTitle("Проверка", 24));
        ScanModeText = CreateTitleText("NeuralV", 28);
        ScanStageText = CreateBodyText("AppMutedTextBrush");
        leftStack.Children.Add(ScanModeText);
        leftStack.Children.Add(ScanStageText);

        var ringShell = new Grid
        {
            Width = 220,
            Height = 220,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 10, 0, 6)
        };
        ScanProgressRing = new ProgressRing
        {
            IsActive = true,
            Width = 190,
            Height = 190,
            Foreground = ThemeBrush("AppAccentBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        ScanProgressText = new TextBlock
        {
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = 34,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        ringShell.Children.Add(ScanProgressRing);
        ringShell.Children.Add(ScanProgressText);
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
        leftStack.Children.Add(CreateActionRow(
            CreateFilledButton("Отменить проверку", OnCancelScanClick),
            CreateTonalButton("Скрыть панель", OnHideScanOverlayClick)));
        leftCard.Child = leftStack;
        grid.Children.Add(leftCard);

        var rightCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 26, new Thickness(18));
        Grid.SetColumn(rightCard, 2);
        var rightStack = new StackPanel { Spacing = 10 };
        rightStack.Children.Add(CreateSectionTitle("Что происходит сейчас", 22));
        ScanTimelineList = CreateListView();
        ScanTimelineList.ItemsSource = _scanTimeline;
        ScanTimelineList.MinHeight = 520;
        rightStack.Children.Add(ScanTimelineList);
        rightCard.Child = rightStack;
        grid.Children.Add(rightCard);

        return overlay;
    }

    private void ApplyAmbientPalette()
    {
        BackdropGradient.Fill = new LinearGradientBrush
        {
            StartPoint = new Point(0, 0),
            EndPoint = new Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = ThemePalette.Blend(App.Palette.Background, App.Palette.Accent, 0.08), Offset = 0.0 },
                new GradientStop { Color = App.Palette.BackgroundAlt, Offset = 0.34 },
                new GradientStop { Color = ThemePalette.Blend(App.Palette.Background, App.Palette.AccentSecondary, 0.12), Offset = 1.0 }
            }
        };

        FabricLayerA.Fill = BuildWeaveBrush(App.Palette.Accent, App.Palette.AccentSecondary, 0.08, 0.30);
        FabricLayerB.Fill = BuildWeaveBrush(App.Palette.AccentTertiary, App.Palette.Accent, 0.05, 0.22);
        FabricLayerC.Fill = BuildSheenBrush(App.Palette.AccentSecondary, App.Palette.AccentTertiary);
        GlowA.Fill = BuildGlowBrush(App.Palette.Accent, 0.92);
        GlowB.Fill = BuildGlowBrush(ThemePalette.Blend(App.Palette.AccentSecondary, App.Palette.Text, 0.36), 0.42);
        GlowC.Fill = BuildGlowBrush(ThemePalette.Blend(App.Palette.AccentTertiary, App.Palette.BackgroundAlt, 0.30), 0.28);
    }

    private static Brush BuildGlowBrush(UiColor color, double opacity)
    {
        return new RadialGradientBrush
        {
            GradientStops =
            {
                new GradientStop { Color = ThemePalette.WithAlpha(color, opacity), Offset = 0.0 },
                new GradientStop { Color = ThemePalette.WithAlpha(color, 0.0), Offset = 1.0 }
            }
        };
    }

    private static Brush BuildWeaveBrush(UiColor baseColor, UiColor accentColor, double lowOpacity, double highOpacity)
    {
        return new LinearGradientBrush
        {
            StartPoint = new Point(0, 0),
            EndPoint = new Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, lowOpacity), Offset = 0.00 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, 0.02), Offset = 0.08 },
                new GradientStop { Color = ThemePalette.WithAlpha(accentColor, highOpacity), Offset = 0.14 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, 0.02), Offset = 0.24 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, lowOpacity), Offset = 0.34 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, 0.02), Offset = 0.48 },
                new GradientStop { Color = ThemePalette.WithAlpha(accentColor, highOpacity * 0.72), Offset = 0.62 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, 0.02), Offset = 0.76 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, lowOpacity), Offset = 1.00 }
            }
        };
    }

    private static Brush BuildSheenBrush(UiColor first, UiColor second)
    {
        return new LinearGradientBrush
        {
            StartPoint = new Point(0, 0),
            EndPoint = new Point(1, 0),
            GradientStops =
            {
                new GradientStop { Color = ThemePalette.WithAlpha(first, 0.0), Offset = 0.00 },
                new GradientStop { Color = ThemePalette.WithAlpha(first, 0.14), Offset = 0.24 },
                new GradientStop { Color = ThemePalette.WithAlpha(second, 0.24), Offset = 0.50 },
                new GradientStop { Color = ThemePalette.WithAlpha(first, 0.12), Offset = 0.74 },
                new GradientStop { Color = ThemePalette.WithAlpha(first, 0.0), Offset = 1.00 }
            }
        };
    }

    private void ShowScreen(AppScreen screen)
    {
        _screen = screen;
        SplashView.Visibility = screen == AppScreen.Splash ? Visibility.Visible : Visibility.Collapsed;
        WelcomeView.Visibility = screen == AppScreen.Welcome ? Visibility.Visible : Visibility.Collapsed;
        LoginView.Visibility = screen == AppScreen.Login ? Visibility.Visible : Visibility.Collapsed;
        RegisterView.Visibility = screen == AppScreen.Register ? Visibility.Visible : Visibility.Collapsed;
        CodeView.Visibility = screen == AppScreen.Code ? Visibility.Visible : Visibility.Collapsed;
        HomeView.Visibility = screen == AppScreen.Home ? Visibility.Visible : Visibility.Collapsed;
        HistoryView.Visibility = screen == AppScreen.History ? Visibility.Visible : Visibility.Collapsed;
        SettingsView.Visibility = screen == AppScreen.Settings ? Visibility.Visible : Visibility.Collapsed;

        SetDrawerState(false);
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
            AppScreen.Login => "Вход",
            AppScreen.Register => "Регистрация",
            AppScreen.Code => "Подтверждение",
            AppScreen.Home => "NeuralV",
            AppScreen.History => "История",
            AppScreen.Settings => "Настройки",
            _ => "NeuralV"
        };

        HeaderSubtitleText.Text = _screen switch
        {
            AppScreen.Home when _activeScan is not null && !_activeScan.IsFinished => "Проверка продолжается. Можно вернуться к ней в один клик.",
            AppScreen.Home => "Защита Windows, история и сетевые переключатели в одном окне.",
            AppScreen.History => "Последние завершённые проверки.",
            AppScreen.Settings => "Аккаунт, оформление и параметры защиты.",
            AppScreen.Login => "Вход по почте, паролю и коду подтверждения.",
            AppScreen.Register => "Создание аккаунта NeuralV.",
            AppScreen.Code => "Подтверди вход кодом из письма.",
            _ => ""
        };
    }

    private void ApplySessionState()
    {
        var hasSession = _session is not null;
        var displayName = hasSession
            ? (!string.IsNullOrWhiteSpace(_session!.User.Name) ? _session.User.Name : _session.User.Email)
            : "Гостевой режим";

        AccountChipText.Text = hasSession ? _session!.User.Email : "Вход не выполнен";
        DrawerUserNameText.Text = displayName;
        DrawerUserMetaText.Text = hasSession
            ? _session!.User.Email
            : "Войди, чтобы запускать серверные проверки и хранить историю.";
        SettingsAccountText.Text = hasSession
            ? $"Пользователь: {displayName}. Почта: {_session!.User.Email}."
            : "Активной сессии нет.";
        SettingsDeveloperText.Text = hasSession && _session!.User.IsDeveloperMode
            ? "Режим разработчика активен. Серверные лимиты отключены."
            : "Режим разработчика не активен.";
    }

    private void UpdateHomeState()
    {
        HomeHeroTitleText.Text = _activeScan is not null && !_activeScan.IsFinished
            ? "Проверка уже идёт"
            : "Главное меню";
        HomeHeroSubtitleText.Text = _activeScan is not null && !_activeScan.IsFinished
            ? (_activeScan.Message ?? "Можно вернуться к текущей проверке или запустить сеть.")
            : (_session is null
                ? "Войди в аккаунт для серверных режимов или запусти локальную быструю проверку."
                : "Выбери режим проверки или включи защиту в сети.");

        var running = _activeScan is not null && !_activeScan.IsFinished;
        ActiveScanCard.Visibility = running ? Visibility.Visible : Visibility.Collapsed;
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

        UpdateNetworkUi();
    }

    private void UpdateHistoryState()
    {
        if (HistoryList is not null)
        {
            HistoryList.ItemsSource = _historyItems;
        }
    }

    private void UpdateSettingsState()
    {
        _preferenceUiSync = true;
        ThemeModeCombo.SelectedIndex = ThemeModeToIndex(_preferences.ThemeMode);
        DynamicColorsToggle.IsOn = _preferences.DynamicColorsEnabled;
        _preferenceUiSync = false;
        UpdateNetworkUi();
    }

    private void UpdateNetworkUi()
    {
        _networkUiSync = true;

        if (NetworkProtectionToggle is not null)
        {
            NetworkProtectionToggle.IsOn = _networkState.NetworkEnabled;
        }
        if (AdBlockToggle is not null)
        {
            AdBlockToggle.IsOn = _networkState.AdBlockEnabled;
            AdBlockToggle.IsEnabled = _networkState.NetworkEnabled;
        }
        if (UnsafeSitesToggle is not null)
        {
            UnsafeSitesToggle.IsOn = _networkState.UnsafeSitesEnabled;
            UnsafeSitesToggle.IsEnabled = _networkState.NetworkEnabled;
        }
        if (SettingsNetworkToggle is not null)
        {
            SettingsNetworkToggle.IsOn = _networkState.NetworkEnabled;
        }
        if (SettingsAdToggle is not null)
        {
            SettingsAdToggle.IsOn = _networkState.AdBlockEnabled;
            SettingsAdToggle.IsEnabled = _networkState.NetworkEnabled;
        }
        if (SettingsUnsafeToggle is not null)
        {
            SettingsUnsafeToggle.IsOn = _networkState.UnsafeSitesEnabled;
            SettingsUnsafeToggle.IsEnabled = _networkState.NetworkEnabled;
        }
        if (NetworkCountersText is not null)
        {
            NetworkCountersText.Text = $"Заблокировано угроз в сети: {_networkState.BlockedThreatsPlatform} · рекламы: {_networkState.BlockedAdsPlatform}";
        }

        _networkUiSync = false;
    }

    private void SetDrawerState(bool isOpen)
    {
        _drawerOpen = isOpen;
        DrawerScrim.Visibility = isOpen ? Visibility.Visible : Visibility.Collapsed;
        DrawerPanel.Visibility = isOpen ? Visibility.Visible : Visibility.Collapsed;
    }

    private void SetScanOverlayState(bool isOpen)
    {
        _scanOverlayOpen = isOpen;
        ScanOverlay.Visibility = isOpen ? Visibility.Visible : Visibility.Collapsed;
        if (isOpen)
        {
            SetDrawerState(false);
        }
        UpdateHomeState();
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
        BuildLayout();
        ApplySessionState();
        ShowScreen(screen);
        if (_activeScan is not null)
        {
            RenderScan(_activeScan);
        }
        SetScanOverlayState(overlayOpen && _activeScan is not null);
        SetStatus(null);
    }

    private void OnShapeTick(object? sender, object e)
    {
        foreach (var shape in _floatingShapes)
        {
            shape.Angle += shape.Velocity;
            if (shape.Element.RenderTransform is RotateTransform rotate)
            {
                rotate.Angle = shape.Angle;
            }
        }
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
        shape.Angle += 16;
        ApplyShapeVariant(shape.Element, shape.Variant);
        if (shape.Element.RenderTransform is RotateTransform rotate)
        {
            rotate.Angle = shape.Angle;
        }
    }

    private void ApplyShapeVariant(Border shape, int variant)
    {
        switch (variant % 6)
        {
            case 0:
                shape.Width = 122;
                shape.Height = 122;
                shape.CornerRadius = new CornerRadius(61);
                shape.Background = BuildWeaveBrush(App.Palette.Accent, App.Palette.AccentSecondary, 0.08, 0.32);
                break;
            case 1:
                shape.Width = 170;
                shape.Height = 92;
                shape.CornerRadius = new CornerRadius(40);
                shape.Background = BuildWeaveBrush(App.Palette.AccentSecondary, App.Palette.AccentTertiary, 0.08, 0.26);
                break;
            case 2:
                shape.Width = 108;
                shape.Height = 144;
                shape.CornerRadius = new CornerRadius(36);
                shape.Background = BuildWeaveBrush(App.Palette.AccentTertiary, App.Palette.Accent, 0.08, 0.28);
                break;
            case 3:
                shape.Width = 138;
                shape.Height = 138;
                shape.CornerRadius = new CornerRadius(28);
                shape.Background = BuildWeaveBrush(App.Palette.Accent, App.Palette.AccentTertiary, 0.08, 0.24);
                break;
            case 4:
                shape.Width = 180;
                shape.Height = 84;
                shape.CornerRadius = new CornerRadius(22);
                shape.Background = BuildWeaveBrush(App.Palette.AccentSecondary, App.Palette.Accent, 0.08, 0.30);
                break;
            default:
                shape.Width = 96;
                shape.Height = 160;
                shape.CornerRadius = new CornerRadius(42);
                shape.Background = BuildWeaveBrush(App.Palette.AccentTertiary, App.Palette.AccentSecondary, 0.08, 0.26);
                break;
        }
    }

    private void ResetAuthInputs()
    {
        LoginEmailBox.Text = string.Empty;
        LoginPasswordBox.Password = string.Empty;
        RegisterNameBox.Text = string.Empty;
        RegisterEmailBox.Text = string.Empty;
        RegisterPasswordBox.Password = string.Empty;
        RegisterPasswordRepeatBox.Password = string.Empty;
        VerificationCodeBox.Text = string.Empty;
        CodeHintText.Text = string.Empty;
        _challenge = null;
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

            _challenge = ticket;
            CodeHintText.Text = $"Код подтверждения отправлен на {ticket.Email}.";
            SetStatus(null);
            ShowScreen(AppScreen.Code);
        }
        catch (Exception ex)
        {
            WindowsLog.Error("OnStartLoginClick failed", ex);
            SetStatus(ex.Message);
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

            _challenge = ticket;
            CodeHintText.Text = $"Код подтверждения отправлен на {ticket.Email}.";
            SetStatus(null);
            ShowScreen(AppScreen.Code);
        }
        catch (Exception ex)
        {
            WindowsLog.Error("OnStartRegisterClick failed", ex);
            SetStatus(ex.Message);
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
            SetStatus("Вход выполнен.");
        }
        catch (Exception ex)
        {
            WindowsLog.Error("OnVerifyCodeClick failed", ex);
            SetStatus(ex.Message);
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
            RenderScan(initial);
            SetScanOverlayState(true);
            ShowScreen(AppScreen.Home);

            var result = await Task.Run(ExecuteLocalQuickScan);
            _activeScan = result;
            RenderScan(result);
            await HistoryStore.AppendAsync(result);
            await LoadHistoryAsync();
            SetStatus(result.PrimarySummary);
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
        var startedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var timeline = new List<string> { "Запускаем локальный быстрый проход." };
        var findings = new List<DesktopScanFinding>();
        var riskyExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".exe", ".dll", ".msi", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jar", ".scr", ".hta", ".com"
        };

        var roots = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"),
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.Startup),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonStartup),
            Path.GetTempPath(),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        }
        .Where(path => !string.IsNullOrWhiteSpace(path) && (Directory.Exists(path) || File.Exists(path)))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

        var scanned = 0;
        foreach (var root in roots)
        {
            var recentMatches = EnumerateQuickCandidates(root, riskyExtensions, 32).ToList();
            scanned += recentMatches.Count;
            timeline.Add($"{root}: найдено {recentMatches.Count} подходящих объектов для локальной оценки.");
            foreach (var file in recentMatches.Take(2))
            {
                findings.Add(new DesktopScanFinding
                {
                    Id = file,
                    Title = Path.GetFileName(file),
                    Verdict = "review",
                    Summary = $"Локальная проверка советует отдельно прогнать: {file}",
                    Engines = Array.Empty<string>()
                });
            }
        }

        var completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var surfaced = findings.Count;
        var message = surfaced > 0
            ? $"Локально нашли {surfaced} объекта для отдельной проверки."
            : "Локальных подозрительных совпадений не найдено.";

        return new DesktopScanState
        {
            Id = Guid.NewGuid().ToString("N"),
            Platform = "windows",
            Mode = "QUICK",
            Status = "COMPLETED",
            Verdict = surfaced > 0 ? "Требуется дополнительная проверка" : "Совпадений не найдено",
            Message = message,
            RiskScore = surfaced > 0 ? Math.Min(60, surfaced * 10) : 0,
            SurfacedFindings = surfaced,
            HiddenFindings = 0,
            StartedAt = startedAt,
            CompletedAt = completedAt,
            Timeline = timeline,
            Findings = findings
        };
    }

    private static IEnumerable<string> EnumerateQuickCandidates(string root, HashSet<string> riskyExtensions, int limit)
    {
        var results = new List<(string Path, DateTime Timestamp)>();
        try
        {
            var searchOption = Path.GetFileName(root).Equals("Local", StringComparison.OrdinalIgnoreCase)
                ? SearchOption.TopDirectoryOnly
                : SearchOption.AllDirectories;

            foreach (var file in Directory.EnumerateFiles(root, "*", searchOption))
            {
                var extension = Path.GetExtension(file);
                if (!riskyExtensions.Contains(extension))
                {
                    continue;
                }

                DateTime timestamp;
                try
                {
                    timestamp = File.GetLastWriteTimeUtc(file);
                }
                catch
                {
                    continue;
                }

                if (timestamp < DateTime.UtcNow.AddDays(-30))
                {
                    continue;
                }

                results.Add((file, timestamp));
                if (results.Count >= limit)
                {
                    break;
                }
            }
        }
        catch
        {
        }

        return results
            .OrderByDescending(item => item.Timestamp)
            .Select(item => item.Path);
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
            RenderScan(result.scan);
            SetScanOverlayState(true);
            ShowScreen(AppScreen.Home);
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
                    SetStatus(result.scan.PrimarySummary);
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
        ScanProgressText.Text = $"{progress}%";
        ScanCountsText.Text = $"Этапов в ленте: {scan.Timeline.Count} · находок: {scan.SurfacedFindings}";
        ScanProgressBar.Value = progress;
        ScanProgressRing.IsActive = !scan.IsFinished;

        _scanTimeline.Clear();
        foreach (var item in scan.Timeline.DefaultIfEmpty(string.IsNullOrWhiteSpace(scan.Message) ? "Сервер обрабатывает проверку." : scan.Message))
        {
            _scanTimeline.Add(item);
        }
        foreach (var finding in scan.Findings)
        {
            _scanTimeline.Add($"{finding.Title}: {finding.Summary}");
        }

        UpdateHomeState();
        if (_scanOverlayOpen)
        {
            SetScanOverlayState(true);
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
            SetStatus(message);
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
        if (_activeScan is null)
        {
            return;
        }

        SetScanOverlayState(true);
        ShowScreen(AppScreen.Home);
    }

    private void OnHomeClick(object sender, RoutedEventArgs e)
    {
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

        ShowScreen(AppScreen.History);
    }

    private void OnSettingsClick(object sender, RoutedEventArgs e)
    {
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
            AdBlockEnabled = AdBlockToggle.IsOn,
            UnsafeSitesEnabled = UnsafeSitesToggle.IsOn,
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
        if (_networkUiSync)
        {
            return;
        }

        _networkState = new NetworkProtectionState
        {
            Platform = "windows",
            NetworkEnabled = NetworkProtectionToggle.IsOn,
            AdBlockEnabled = AdBlockToggle.IsOn,
            UnsafeSitesEnabled = UnsafeSitesToggle.IsOn,
            BlockedAdsPlatform = _networkState.BlockedAdsPlatform,
            BlockedThreatsPlatform = _networkState.BlockedThreatsPlatform,
            BlockedAdsTotal = _networkState.BlockedAdsTotal,
            BlockedThreatsTotal = _networkState.BlockedThreatsTotal,
            DeveloperMode = _networkState.DeveloperMode
        };
        await PushNetworkStateAsync();
    }

    private async void OnUnsafeSitesToggled(object sender, RoutedEventArgs e)
    {
        if (_networkUiSync)
        {
            return;
        }

        _networkState = new NetworkProtectionState
        {
            Platform = "windows",
            NetworkEnabled = NetworkProtectionToggle.IsOn,
            AdBlockEnabled = AdBlockToggle.IsOn,
            UnsafeSitesEnabled = UnsafeSitesToggle.IsOn,
            BlockedAdsPlatform = _networkState.BlockedAdsPlatform,
            BlockedThreatsPlatform = _networkState.BlockedThreatsPlatform,
            BlockedAdsTotal = _networkState.BlockedAdsTotal,
            BlockedThreatsTotal = _networkState.BlockedThreatsTotal,
            DeveloperMode = _networkState.DeveloperMode
        };
        await PushNetworkStateAsync();
    }

    private async void OnSettingsNetworkToggled(object sender, RoutedEventArgs e)
    {
        if (_networkUiSync)
        {
            return;
        }

        _networkUiSync = true;
        NetworkProtectionToggle.IsOn = SettingsNetworkToggle.IsOn;
        _networkUiSync = false;
        await PushNetworkStateAsync();
    }

    private async void OnSettingsAdToggled(object sender, RoutedEventArgs e)
    {
        if (_networkUiSync)
        {
            return;
        }

        _networkUiSync = true;
        AdBlockToggle.IsOn = SettingsAdToggle.IsOn;
        _networkUiSync = false;
        await PushNetworkStateAsync();
    }

    private async void OnSettingsUnsafeToggled(object sender, RoutedEventArgs e)
    {
        if (_networkUiSync)
        {
            return;
        }

        _networkUiSync = true;
        UnsafeSitesToggle.IsOn = SettingsUnsafeToggle.IsOn;
        _networkUiSync = false;
        await PushNetworkStateAsync();
    }

    private async Task PushNetworkStateAsync()
    {
        _preferences = await ClientPreferencesStateService.UpdateAsync(state =>
        {
            state.NetworkProtectionEnabled = NetworkProtectionToggle.IsOn;
            state.AdBlockEnabled = AdBlockToggle.IsOn;
            state.UnsafeSitesEnabled = UnsafeSitesToggle.IsOn;
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
            var result = await _apiClient.UpdateNetworkProtectionStateAsync(_session, NetworkProtectionToggle.IsOn, AdBlockToggle.IsOn, UnsafeSitesToggle.IsOn, "windows");
            if (result.state is not null)
            {
                _networkState = result.state;
                _preferences = await ClientPreferencesStateService.ApplyRemoteNetworkStateAsync(result.state);
                SetStatus("Параметры сетевой защиты обновлены.");
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
        _session = null;
        _activeScan = null;
        SessionStore.ClearSession();
        ResetAuthInputs();
        _networkState = BuildLocalNetworkFallback();
        ApplySessionState();
        SetScanOverlayState(false);
        ShowScreen(AppScreen.Welcome);
        SetStatus(null);
    }

    private Button CreateDrawerButton(string text, RoutedEventHandler handler, bool filled = true)
    {
        var button = filled ? CreateFilledButton(text, handler) : CreateTonalButton(text, handler);
        button.HorizontalAlignment = HorizontalAlignment.Stretch;
        return button;
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
            HorizontalAlignment = HorizontalAlignment.Left
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
            HorizontalAlignment = HorizontalAlignment.Left
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
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold
        };
        button.Click += handler;
        return button;
    }

    private static Border CreateCardBorder(string backgroundKey, string borderKey, double radius, Thickness padding)
    {
        return new Border
        {
            Background = ThemeBrush(backgroundKey),
            BorderBrush = ThemeBrush(borderKey),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(radius),
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
            Padding = new Thickness(16, 14, 16, 14),
            MinHeight = 56,
            CornerRadius = new CornerRadius(18)
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
            Padding = new Thickness(16, 14, 16, 14),
            MinHeight = 56,
            CornerRadius = new CornerRadius(18)
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

    private static UIElement CreateLogoElement()
    {
        try
        {
            return new Image
            {
                Source = new BitmapImage(new Uri("ms-appx:///Assets/NeuralV.png")),
                Stretch = Stretch.Uniform
            };
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
