using System.Collections.ObjectModel;
using System.Diagnostics;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using NeuralV.Windows.Models;
using NeuralV.Windows.Services;
using Windows.Foundation;
using UiColor = global::Windows.UI.Color;
using WinRT.Interop;

namespace NeuralV.Windows;

public sealed partial class MainWindow : Window
{
    private readonly NeuralVApiClient _apiClient = new();
    private readonly string _deviceId = SessionStore.EnsureDeviceId();
    private readonly ObservableCollection<string> _homeTimeline = new();
    private readonly ObservableCollection<string> _scanTimeline = new();
    private readonly ObservableCollection<string> _historyItems = new();

    private SessionData? _session;
    private ChallengeTicket? _challenge;
    private AppScreen _screen = AppScreen.Splash;
    private DesktopScanState? _activeScan;
    private CancellationTokenSource? _scanPollCts;
    private UpdateInfo? _updateInfo;
    private bool _initialized;
    private readonly string _currentVersion = VersionInfo.Current;

    public MainWindow()
    {
        try
        {
            InitializeComponent();

            HomeTimelineList.ItemsSource = _homeTimeline;
            ScanTimelineList.ItemsSource = _scanTimeline;
            HistoryList.ItemsSource = _historyItems;

            ExtendsContentIntoTitleBar = false;
            Title = "NeuralV";

            Closed += (_, _) =>
            {
                _scanPollCts?.Cancel();
                _apiClient.Dispose();
            };
        }
        catch (Exception ex)
        {
            WindowsLog.Error("MainWindow ctor failed", ex);
            throw;
        }
    }

    private async void OnRootLoaded(object sender, RoutedEventArgs e)
    {
        if (_initialized)
        {
            return;
        }

        _initialized = true;
        WindowsLog.Info("Window root loaded");

        try
        {
            TryConfigureWindowFrame();
            TryInitializeChrome();
            UpdateStatusText.Text = "Проверяем актуальную сборку...";

            if (WindowRoot.Resources["AmbientMotionStoryboard"] is Storyboard ambientStoryboard)
            {
                ambientStoryboard.Begin();
            }
            if (WindowRoot.Resources["DotLoadingStoryboard"] is Storyboard dotStoryboard)
            {
                dotStoryboard.Begin();
            }
            if (WindowRoot.Resources["ScanDotLoadingStoryboard"] is Storyboard scanLoaderStoryboard)
            {
                scanLoaderStoryboard.Begin();
            }
            if (WindowRoot.Resources["BusyDotLoadingStoryboard"] is Storyboard busyLoaderStoryboard)
            {
                busyLoaderStoryboard.Begin();
            }
            if (WindowRoot.Resources["SplashOrbitStoryboard"] is Storyboard orbitStoryboard)
            {
                orbitStoryboard.Begin();
            }

            await InitializeAsync();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("OnRootLoaded failed", ex);
            SetBusy(false);
            SetStatus("Не удалось подготовить интерфейс. Подробности в log.txt.");
            ShowScreen(AppScreen.Welcome);
        }
    }

    public void RunSmokeValidation()
    {
        WindowsLog.Info("Running WinUI smoke validation");
        TryConfigureWindowFrame();
        TryInitializeChrome();
        UpdateStatusHomeFallback();
        ApplyUpdateState();
    }

    private void TryConfigureWindowFrame()
    {
        try
        {
            var hwnd = WindowNative.GetWindowHandle(this);
            if (hwnd == IntPtr.Zero)
            {
                return;
            }

            var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
            _ = AppWindow.GetFromWindowId(windowId);
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Window frame configuration failed", ex);
        }
    }

    private void TryInitializeChrome()
    {
        try
        {
            ApplyAmbientPalette();
            ApplyChromeCopy();
            ApplySessionState();
            UpdateNavigationState(AppScreen.Splash);
            UpdateScreenContext(AppScreen.Splash);
            UpdateStatusHomeFallback();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Window chrome initialization failed", ex);
        }
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

        SplashHalo.Background = BuildGlowBrush(App.Palette.Accent, 0.24);
        SplashOrbitRing.Stroke = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.AccentSecondary, 0.78));

        PaletteSwatchPrimary.Background = new SolidColorBrush(App.Palette.Accent);
        PaletteSwatchPrimary.BorderBrush = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.Text, 0.10));
        PaletteSwatchPrimary.BorderThickness = new Thickness(1);

        PaletteSwatchSecondary.Background = new SolidColorBrush(App.Palette.AccentSecondary);
        PaletteSwatchSecondary.BorderBrush = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.Text, 0.10));
        PaletteSwatchSecondary.BorderThickness = new Thickness(1);

        PaletteSwatchTertiary.Background = new SolidColorBrush(App.Palette.AccentTertiary);
        PaletteSwatchTertiary.BorderBrush = new SolidColorBrush(ThemePalette.WithAlpha(App.Palette.Text, 0.10));
        PaletteSwatchTertiary.BorderThickness = new Thickness(1);
    }

    private void ApplyChromeCopy()
    {
        ThemeModeLabel.Text = App.Palette.IsDark ? "Тёмный режим" : "Светлый режим";
        PaletteModeHeaderLabel.Text = App.Palette.SourceLabel;
        VersionLabel.Text = $"Windows {_currentVersion}";

        PaletteSourceLabel.Text = App.Palette.Source switch
        {
            PaletteSource.Wallpaper => "Цвета взяты из обоев.",
            PaletteSource.WindowsAccent => "Цвета взяты из системного акцента Windows.",
            _ => "Активна безопасная резервная палитра."
        };
        PaletteSeedLabel.Text = $"Акцент {App.Palette.AccentHex}";
        SettingsPaletteText.Text = $"Палитра: {App.Palette.SourceLabel}. Акцент: {App.Palette.AccentHex}.";
        SettingsVersionText.Text = $"Версия клиента: {_currentVersion}. Режим: {(App.Palette.IsDark ? "тёмный" : "светлый")}.";
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
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, 0.02), Offset = 0.05 },
                new GradientStop { Color = ThemePalette.WithAlpha(accentColor, highOpacity), Offset = 0.10 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, 0.02), Offset = 0.16 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, lowOpacity), Offset = 0.24 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, 0.02), Offset = 0.32 },
                new GradientStop { Color = ThemePalette.WithAlpha(accentColor, highOpacity * 0.82), Offset = 0.38 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, 0.02), Offset = 0.46 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, lowOpacity), Offset = 0.58 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, 0.02), Offset = 0.66 },
                new GradientStop { Color = ThemePalette.WithAlpha(accentColor, highOpacity * 0.74), Offset = 0.74 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, 0.02), Offset = 0.82 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, lowOpacity), Offset = 0.92 },
                new GradientStop { Color = ThemePalette.WithAlpha(baseColor, 0.02), Offset = 1.00 }
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
                new GradientStop { Color = ThemePalette.WithAlpha(second, 0.26), Offset = 0.50 },
                new GradientStop { Color = ThemePalette.WithAlpha(first, 0.12), Offset = 0.74 },
                new GradientStop { Color = ThemePalette.WithAlpha(first, 0.0), Offset = 1.00 }
            }
        };
    }

    private async Task InitializeAsync()
    {
        SetBusy(true, "Поднимаем новый Windows-клиент");
        WindowsLog.Info("InitializeAsync started");

        try
        {
            if (App.IsSmokeTest)
            {
                WindowsLog.Info("Smoke test mode entered");
                ShowScreen(AppScreen.Welcome);
                SetStatus("Smoke test completed.");
                await Task.Delay(250);
                Environment.ExitCode = 0;
                App.Current.Exit();
                return;
            }

            _session = await SessionStore.LoadSessionAsync();
            if (_session is { IsValid: true })
            {
                var refresh = await _apiClient.RefreshSessionAsync(_session);
                if (refresh.session is { IsValid: true } refreshed)
                {
                    _session = refreshed;
                    await SessionStore.SaveSessionAsync(refreshed);
                }
            }
            else
            {
                _session = null;
            }

            await LoadHistoryAsync();
            ApplySessionState();
            ShowScreen(_session is null ? AppScreen.Welcome : AppScreen.Home);
            _ = CheckForUpdatesAsync();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("InitializeAsync failed", ex);
            SetStatus(ex.Message);
            ShowScreen(AppScreen.Welcome);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task CheckForUpdatesAsync()
    {
        try
        {
            _updateInfo = await _apiClient.CheckForUpdateAsync(_currentVersion);
            ApplyUpdateState();
            if (_updateInfo.Available)
            {
                WindowsLog.Info($"Update available: {_updateInfo.LatestVersion}");
                SetStatus($"Доступно обновление Windows {_updateInfo.LatestVersion}.");
            }
        }
        catch (Exception ex)
        {
            WindowsLog.Error("CheckForUpdatesAsync failed", ex);
            _updateInfo = new UpdateInfo { Error = ex.Message };
            ApplyUpdateState();
        }
    }

    private void ShowScreen(AppScreen screen)
    {
        _screen = screen;

        AppNavigationBar.Visibility = screen is AppScreen.Home or AppScreen.Scan or AppScreen.History or AppScreen.Settings
            ? Visibility.Visible
            : Visibility.Collapsed;

        SplashView.Visibility = screen == AppScreen.Splash ? Visibility.Visible : Visibility.Collapsed;
        WelcomeView.Visibility = screen == AppScreen.Welcome ? Visibility.Visible : Visibility.Collapsed;
        LoginView.Visibility = screen == AppScreen.Login ? Visibility.Visible : Visibility.Collapsed;
        RegisterView.Visibility = screen == AppScreen.Register ? Visibility.Visible : Visibility.Collapsed;
        CodeView.Visibility = screen == AppScreen.Code ? Visibility.Visible : Visibility.Collapsed;
        HomeView.Visibility = screen == AppScreen.Home ? Visibility.Visible : Visibility.Collapsed;
        ScanView.Visibility = screen == AppScreen.Scan ? Visibility.Visible : Visibility.Collapsed;
        HistoryView.Visibility = screen == AppScreen.History ? Visibility.Visible : Visibility.Collapsed;
        SettingsView.Visibility = screen == AppScreen.Settings ? Visibility.Visible : Visibility.Collapsed;

        ApplySessionState();
        UpdateNavigationState(screen);
        UpdateScreenContext(screen);
    }

    private void UpdateNavigationState(AppScreen screen)
    {
        ApplyNavButtonStyle(HomeNavButton, screen is AppScreen.Home or AppScreen.Scan);
        ApplyNavButtonStyle(HistoryNavButton, screen == AppScreen.History);
        ApplyNavButtonStyle(SettingsNavButton, screen == AppScreen.Settings);
    }

    private void ApplyNavButtonStyle(Button button, bool active)
    {
        if (App.Current.Resources[active ? "SelectedNavTabButtonStyle" : "NavTabButtonStyle"] is Style style)
        {
            button.Style = style;
        }
    }

    private void UpdateScreenContext(AppScreen screen)
    {
        var (badge, headline, description) = screen switch
        {
            AppScreen.Splash => (
                "Запуск",
                "Готовим NeuralV",
                "Поднимаем палитру, сессию и стартовый экран."),
            AppScreen.Welcome => (
                "Добро пожаловать",
                "Нативный клиент для Windows",
                "Вход, проверка, история и обновления собраны в один интерфейс."),
            AppScreen.Login => (
                "Вход",
                "Почта, пароль и код",
                "После входа сразу открывается основной экран."),
            AppScreen.Register => (
                "Регистрация",
                "Создать аккаунт",
                "Подтверди почту и переходи к проверкам."),
            AppScreen.Code => (
                "Подтверждение",
                "Остался один шаг",
                "Подтверждение завершит вход."),
            AppScreen.Home => (
                "Главный экран",
                "Проверка, статус и обновления",
                "Запуск, состояние и события собраны в одном месте."),
            AppScreen.Scan => (
                "Проверка",
                string.IsNullOrWhiteSpace(_activeScan?.Verdict) ? "Серверная проверка уже идёт" : _activeScan!.Verdict,
                string.IsNullOrWhiteSpace(_activeScan?.Message)
                    ? "Держим прогресс, ленту событий и отмену на одном экране."
                    : _activeScan!.Message),
            AppScreen.History => (
                "История",
                "Последние завершённые проверки",
                "Локальный журнал последних результатов."),
            AppScreen.Settings => (
                "Настройки",
                "Сессия и оформление",
                "Здесь только активная сессия и параметры клиента."),
            _ => (
                "NeuralV",
                "Windows-клиент",
                "Защитный клиент NeuralV.")
        };

        RailBadgeText.Text = badge;
        RailHeadlineText.Text = headline;
        RailDescriptionText.Text = description;
    }

    private void ApplySessionState()
    {
        var hasSession = _session is not null;
        var displayName = hasSession
            ? (!string.IsNullOrWhiteSpace(_session!.User.Name) ? _session.User.Name : _session.User.Email)
            : "Гостевой режим";

        RailUserNameText.Text = displayName;
        RailUserMetaText.Text = hasSession
            ? _session!.User.Email
            : "Войди, чтобы запускать проверки и хранить историю.";
        RailUserStateText.Text = hasSession
            ? (_session!.User.IsPremium ? "Активная премиум-сессия" : "Активная сессия")
            : "Сессия не активна";
        UserLabel.Text = hasSession ? _session!.User.Email : "Не авторизован";
        SettingsSessionText.Text = hasSession
            ? $"Пользователь: {displayName}. Почта: {_session!.User.Email}."
            : "Активной сессии нет.";
    }

    private async Task LoadHistoryAsync()
    {
        _historyItems.Clear();
        foreach (var item in await HistoryStore.LoadAsync())
        {
            _historyItems.Add($"{item.SavedAt.LocalDateTime:dd.MM HH:mm} | {item.Mode} | {item.Verdict} | {item.Message}");
        }

        if (_historyItems.Count == 0)
        {
            _historyItems.Add("История появится после первой завершённой проверки.");
        }

        SeedHomeTimeline();
    }

    private void SeedHomeTimeline()
    {
        if (_homeTimeline.Count > 0)
        {
            return;
        }

        if (_historyItems.Count > 0 && !_historyItems[0].StartsWith("История появится", StringComparison.Ordinal))
        {
            _homeTimeline.Add("История загружена. Последние завершённые проверки доступны во вкладке истории.");
            _homeTimeline.Add(_historyItems[0]);
            return;
        }

        _homeTimeline.Add("Интерфейс готов. После первой завершённой проверки здесь появится живая лента.");
        _homeTimeline.Add("Палитра и визуальная система уже инициализированы.");
    }

    private void ApplyUpdateState()
    {
        if (_updateInfo is null)
        {
            UpdateStatusText.Text = "Статус обновлений пока недоступен.";
            UpdateButton.Visibility = Visibility.Collapsed;
            return;
        }

        if (!string.IsNullOrWhiteSpace(_updateInfo.Error))
        {
            UpdateStatusText.Text = _updateInfo.Error;
            UpdateButton.Visibility = Visibility.Collapsed;
            return;
        }

        if (_updateInfo.Available)
        {
            UpdateStatusText.Text = $"Доступна версия {_updateInfo.LatestVersion}.";
            UpdateButton.Content = $"Установить {_updateInfo.LatestVersion}";
            UpdateButton.Visibility = Visibility.Visible;
            return;
        }

        UpdateStatusText.Text = "Установлена актуальная версия Windows-клиента.";
        UpdateButton.Visibility = Visibility.Collapsed;
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
        HomeStatusText.Text = visible ? message! : GetHomeStatusFallback();
    }

    private void UpdateStatusHomeFallback()
    {
        HomeStatusText.Text = GetHomeStatusFallback();
    }

    private string GetHomeStatusFallback()
    {
        if (_activeScan is not null && !_activeScan.IsFinished)
        {
            return string.IsNullOrWhiteSpace(_activeScan.Message)
                ? "Проверка в процессе. Перейди на экран проверки для подробной ленты."
                : _activeScan.Message;
        }

        return _session is null
            ? "Войди в аккаунт, чтобы запустить первую проверку."
            : "Готов к новой проверке.";
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
        SetStatus(null);
    }

    private void OnShowLoginClick(object sender, RoutedEventArgs e)
    {
        ResetAuthInputs();
        ShowScreen(AppScreen.Login);
    }

    private void OnShowRegisterClick(object sender, RoutedEventArgs e)
    {
        ResetAuthInputs();
        ShowScreen(AppScreen.Register);
    }

    private void OnBackToWelcomeClick(object sender, RoutedEventArgs e)
    {
        ResetAuthInputs();
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
            SetStatus(null);
            CodeHintText.Text = $"Код подтверждения отправлен на {ticket.Email}.";
            ShowScreen(AppScreen.Code);
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
            SetStatus(null);
            CodeHintText.Text = $"Код подтверждения отправлен на {ticket.Email}.";
            ShowScreen(AppScreen.Code);
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
            ResetAuthInputs();
            ApplySessionState();
            SetStatus("Вход выполнен.");
            ShowScreen(AppScreen.Home);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void OnQuickScanClick(object sender, RoutedEventArgs e)
    {
        await StartScanAsync("quick");
    }

    private async void OnDeepScanClick(object sender, RoutedEventArgs e)
    {
        await StartScanAsync("deep");
    }

    private async Task StartScanAsync(string mode)
    {
        if (_session is null)
        {
            SetStatus("Войди в аккаунт, чтобы запустить проверку.");
            ShowScreen(AppScreen.Welcome);
            return;
        }

        SetBusy(true, "Создаём серверную проверку");
        WindowsLog.Info($"Start scan requested: {mode}");
        try
        {
            var roots = WindowsEnvironmentService.DetectScanRoots();
            var installRoots = WindowsEnvironmentService.DetectInstallRoots();
            var result = await _apiClient.StartDesktopScanAsync(_session, mode, "filesystem", Environment.MachineName, Environment.SystemDirectory, roots, installRoots);
            if (result.scan is null)
            {
                WindowsLog.Error($"Desktop scan creation failed: {result.error}");
                SetStatus(result.error ?? "Не удалось создать desktop-задачу.");
                return;
            }

            _activeScan = result.scan;
            SetStatus(null);
            RenderScan(result.scan);
            ShowScreen(AppScreen.Scan);
            _scanPollCts?.Cancel();
            _scanPollCts = new CancellationTokenSource();
            _ = PollScanAsync(result.scan.Id, _scanPollCts.Token);
        }
        catch (Exception ex)
        {
            WindowsLog.Error("StartScanAsync failed", ex);
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
                    ScanSecondaryText.Text = result.error ?? "Не удалось прочитать статус проверки.";
                    await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken);
                    continue;
                }

                _activeScan = result.scan;
                RenderScan(result.scan);
                if (result.scan.IsFinished)
                {
                    SetStatus(result.scan.PrimarySummary);
                    if (result.scan.IsSuccessful)
                    {
                        await HistoryStore.AppendAsync(result.scan, cancellationToken);
                        await LoadHistoryAsync();
                    }
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
                ScanSecondaryText.Text = ex.Message;
            }

            await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken);
        }
    }

    private void RenderScan(DesktopScanState scan)
    {
        ScanPrimaryText.Text = string.IsNullOrWhiteSpace(scan.Verdict) ? "Проверка идёт" : scan.Verdict;
        ScanSecondaryText.Text = string.IsNullOrWhiteSpace(scan.Message)
            ? $"Статус: {scan.Status}"
            : scan.Message;

        _scanTimeline.Clear();
        foreach (var item in scan.Timeline.DefaultIfEmpty(string.IsNullOrWhiteSpace(scan.Message) ? "Сервер обрабатывает проверку." : scan.Message))
        {
            _scanTimeline.Add(item);
        }
        foreach (var finding in scan.Findings)
        {
            _scanTimeline.Add($"{finding.Title}: {finding.Summary}");
        }

        _homeTimeline.Clear();
        _homeTimeline.Add($"{DateTime.Now:HH:mm} | {ScanPrimaryText.Text}");
        foreach (var item in _scanTimeline.Take(7))
        {
            _homeTimeline.Add(item);
        }

        HomeStatusText.Text = scan.PrimarySummary;
        if (_screen == AppScreen.Scan)
        {
            UpdateScreenContext(AppScreen.Scan);
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
            ScanSecondaryText.Text = message;
            SetStatus(message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void OnBackToHomeClick(object sender, RoutedEventArgs e)
    {
        ShowScreen(AppScreen.Home);
    }

    private void OnHomeClick(object sender, RoutedEventArgs e) => ShowScreen(AppScreen.Home);
    private void OnHistoryClick(object sender, RoutedEventArgs e) => ShowScreen(AppScreen.History);
    private void OnSettingsClick(object sender, RoutedEventArgs e) => ShowScreen(AppScreen.Settings);

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
        SessionStore.ClearSession();
        ResetAuthInputs();
        ApplySessionState();
        ShowScreen(AppScreen.Welcome);
    }

    private async void OnDownloadUpdateClick(object sender, RoutedEventArgs e)
    {
        if (_updateInfo is null || string.IsNullOrWhiteSpace(_updateInfo.SetupUrl))
        {
            return;
        }

        await DownloadAndRunUpdateAsync(_updateInfo.SetupUrl, autoMode: false);
    }

    private async Task DownloadAndRunUpdateAsync(string setupUrl, bool autoMode)
    {
        try
        {
            WindowsLog.Info($"DownloadAndRunUpdateAsync started: auto={autoMode}");
            SetBusy(true, autoMode ? "Ставим новую Windows-версию" : "Скачиваем обновление");
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
            var target = Path.Combine(Path.GetTempPath(), "NeuralVSetup-latest.exe");
            await using var remote = await http.GetStreamAsync(setupUrl);
            await using var file = File.Create(target);
            await remote.CopyToAsync(file);
            Process.Start(new ProcessStartInfo
            {
                FileName = target,
                Arguments = "--self-update --no-launch",
                UseShellExecute = true
            });
            WindowsLog.Info($"Update installer started: {target}");
            App.Current.Exit();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("DownloadAndRunUpdateAsync failed", ex);
            UpdateStatusText.Text = ex.Message;
            SetBusy(false);
        }
    }
}
