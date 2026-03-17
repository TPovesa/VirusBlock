using System.Collections.ObjectModel;
using System.Diagnostics;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using NeuralV.Windows.Models;
using NeuralV.Windows.Services;
using Windows.Graphics;
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
        InitializeComponent();
        HomeTimelineList.ItemsSource = _homeTimeline;
        ScanTimelineList.ItemsSource = _scanTimeline;
        HistoryList.ItemsSource = _historyItems;
        ExtendsContentIntoTitleBar = false;
        Title = "NeuralV";
        var hwnd = WindowNative.GetWindowHandle(this);
        var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
        var appWindow = AppWindow.GetFromWindowId(windowId);
        appWindow.Resize(new SizeInt32(1440, 920));
        ThemeModeLabel.Text = App.Palette.IsDark ? "Тёмная" : "Светлая";
        VersionLabel.Text = $"Windows {_currentVersion}";
        UpdateStatusText.Text = "Проверяем актуальную сборку...";
        ApplyAmbientPalette();
        Closed += (_, _) =>
        {
            _scanPollCts?.Cancel();
            _apiClient.Dispose();
        };
    }

    private async void OnRootLoaded(object sender, RoutedEventArgs e)
    {
        if (_initialized)
        {
            return;
        }
        _initialized = true;
        if (WindowRoot.Resources["AmbientMotionStoryboard"] is Storyboard storyboard)
        {
            storyboard.Begin();
        }
        if (WindowRoot.Resources["DotLoadingStoryboard"] is Storyboard dotStoryboard)
        {
            dotStoryboard.Begin();
        }
        await InitializeAsync();
    }

    private void ApplyAmbientPalette()
    {
        GlowA.Fill = BuildGlowBrush(App.Palette.Accent, 0.88);
        GlowB.Fill = BuildGlowBrush(ThemePalette.Blend(App.Palette.Accent, App.Palette.Text, 0.52), 0.42);
        GlowC.Fill = BuildGlowBrush(ThemePalette.Blend(App.Palette.Accent, App.Palette.Background, 0.35), 0.30);
    }

    private static Brush BuildGlowBrush(UiColor color, double opacity)
    {
        var solid = UiColor.FromArgb((byte)(255 * opacity), color.R, color.G, color.B);
        return new RadialGradientBrush
        {
            GradientStops =
            {
                new GradientStop { Color = solid, Offset = 0.0 },
                new GradientStop { Color = UiColor.FromArgb(0, color.R, color.G, color.B), Offset = 1.0 }
            }
        };
    }

    private async Task InitializeAsync()
    {
        SetBusy(true, "Поднимаем новую Windows-версию");
        try
        {
            if (App.IsSmokeTest)
            {
                ShowScreen(AppScreen.Welcome);
                SetStatus("Smoke test completed.");
                await Task.Delay(250);
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
            ShowScreen(_session is null ? AppScreen.Welcome : AppScreen.Home);
            _ = CheckForUpdatesAsync();
        }
        catch (Exception ex)
        {
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
                SetStatus($"Доступно обновление Windows {_updateInfo.LatestVersion}.");
            }
        }
        catch (Exception ex)
        {
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

        UserLabel.Text = _session?.User.Email ?? "Не авторизован";
    }

    private async Task LoadHistoryAsync()
    {
        _historyItems.Clear();
        foreach (var item in await HistoryStore.LoadAsync())
        {
            _historyItems.Add($"{item.SavedAt.LocalDateTime:dd.MM HH:mm} • {item.Mode} • {item.Verdict} • {item.Message}");
        }
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
        if (visible)
        {
            HomeStatusText.Text = message!;
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
            ShowScreen(AppScreen.Welcome);
            return;
        }

        SetBusy(true, "Создаём серверную проверку");
        try
        {
            var roots = WindowsEnvironmentService.DetectScanRoots();
            var installRoots = WindowsEnvironmentService.DetectInstallRoots();
            var result = await _apiClient.StartDesktopScanAsync(_session, mode, "filesystem", Environment.MachineName, Environment.SystemDirectory, roots, installRoots);
            if (result.scan is null)
            {
                SetStatus(result.error ?? "Не удалось создать desktop-задачу.");
                return;
            }

            _activeScan = result.scan;
            ScanProgressRing.IsActive = true;
            SetStatus(null);
            RenderScan(result.scan);
            ShowScreen(AppScreen.Scan);
            _scanPollCts?.Cancel();
            _scanPollCts = new CancellationTokenSource();
            _ = PollScanAsync(result.scan.Id, _scanPollCts.Token);
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
                    ScanSecondaryText.Text = result.error ?? "Не удалось прочитать статус проверки.";
                    await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken);
                    continue;
                }

                _activeScan = result.scan;
                RenderScan(result.scan);
                if (result.scan.IsFinished)
                {
                    ScanProgressRing.IsActive = false;
                    SetStatus(result.scan.PrimarySummary);
                    if (result.scan.IsSuccessful)
                    {
                        await HistoryStore.AppendAsync(result.scan, cancellationToken);
                        await LoadHistoryAsync();
                    }
                    return;
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
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
        foreach (var item in _scanTimeline.Take(8))
        {
            _homeTimeline.Add(item);
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

        _scanPollCts?.Cancel();
        _session = null;
        SessionStore.ClearSession();
        ResetAuthInputs();
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
            App.Current.Exit();
        }
        catch (Exception ex)
        {
            UpdateStatusText.Text = ex.Message;
            SetBusy(false);
        }
    }
}
