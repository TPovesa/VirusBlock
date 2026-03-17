using System.Collections.ObjectModel;
using System.Diagnostics;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Media.Imaging;
using UiEllipse = Microsoft.UI.Xaml.Shapes.Ellipse;
using UiRectangle = Microsoft.UI.Xaml.Shapes.Rectangle;
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
    private readonly Grid WindowRoot = new();

    private SessionData? _session;
    private ChallengeTicket? _challenge;
    private AppScreen _screen = AppScreen.Splash;
    private DesktopScanState? _activeScan;
    private CancellationTokenSource? _scanPollCts;
    private UpdateInfo? _updateInfo;
    private bool _initialized;
    private readonly string _currentVersion = VersionInfo.Current;

    private UiRectangle BackdropGradient = default!;
    private UiRectangle FabricLayerA = default!;
    private UiRectangle FabricLayerB = default!;
    private UiRectangle FabricLayerC = default!;
    private UiEllipse GlowA = default!;
    private UiEllipse GlowB = default!;
    private UiEllipse GlowC = default!;
    private Grid ShellFrame = default!;
    private ColumnDefinition RailColumn = default!;
    private ColumnDefinition GutterColumn = default!;
    private ColumnDefinition ContentColumn = default!;
    private Border RailPanel = default!;
    private Grid ContentShell = default!;
    private Grid HeaderMetaBar = default!;
    private TextBlock RailBadgeText = default!;
    private TextBlock RailHeadlineText = default!;
    private TextBlock RailDescriptionText = default!;
    private TextBlock PaletteSourceLabel = default!;
    private Border PaletteSwatchPrimary = default!;
    private Border PaletteSwatchSecondary = default!;
    private Border PaletteSwatchTertiary = default!;
    private TextBlock PaletteSeedLabel = default!;
    private TextBlock RailUserNameText = default!;
    private TextBlock RailUserMetaText = default!;
    private TextBlock RailUserStateText = default!;
    private TextBlock ThemeModeLabel = default!;
    private TextBlock PaletteModeHeaderLabel = default!;
    private TextBlock VersionLabel = default!;
    private Grid AppNavigationBar = default!;
    private Button HomeNavButton = default!;
    private Button HistoryNavButton = default!;
    private Button SettingsNavButton = default!;
    private TextBlock UserLabel = default!;
    private Border StatusBanner = default!;
    private TextBlock StatusBannerText = default!;
    private FrameworkElement SplashView = default!;
    private Border SplashHalo = default!;
    private UiEllipse SplashOrbitRing = default!;
    private FrameworkElement WelcomeView = default!;
    private FrameworkElement LoginView = default!;
    private TextBox LoginEmailBox = default!;
    private PasswordBox LoginPasswordBox = default!;
    private FrameworkElement RegisterView = default!;
    private TextBox RegisterNameBox = default!;
    private TextBox RegisterEmailBox = default!;
    private PasswordBox RegisterPasswordBox = default!;
    private PasswordBox RegisterPasswordRepeatBox = default!;
    private FrameworkElement CodeView = default!;
    private TextBlock CodeHintText = default!;
    private TextBox VerificationCodeBox = default!;
    private FrameworkElement HomeView = default!;
    private TextBlock HomeStatusText = default!;
    private Button QuickScanButton = default!;
    private Button DeepScanButton = default!;
    private TextBlock UpdateStatusText = default!;
    private Button UpdateButton = default!;
    private ListView HomeTimelineList = default!;
    private FrameworkElement ScanView = default!;
    private TextBlock ScanPrimaryText = default!;
    private TextBlock ScanSecondaryText = default!;
    private ListView ScanTimelineList = default!;
    private FrameworkElement HistoryView = default!;
    private ListView HistoryList = default!;
    private FrameworkElement SettingsView = default!;
    private TextBlock SettingsPaletteText = default!;
    private TextBlock SettingsVersionText = default!;
    private TextBlock SettingsSessionText = default!;
    private Border BusyOverlay = default!;
    private TextBlock BusyText = default!;

    public MainWindow()
    {
        try
        {
            Content = WindowRoot;
            WindowRoot.Loaded += OnRootLoaded;
            WindowRoot.Background = ThemeBrush("AppBackgroundBrush");
            BuildLayout();

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
            TryBeginStoryboard("AmbientMotionStoryboard");
            TryBeginStoryboard("DotLoadingStoryboard");
            TryBeginStoryboard("ScanDotLoadingStoryboard");
            TryBeginStoryboard("BusyDotLoadingStoryboard");
            TryBeginStoryboard("SplashOrbitStoryboard");

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

    private void TryBeginStoryboard(string key)
    {
        try
        {
            if (WindowRoot.Resources.TryGetValue(key, out var value) && value is Storyboard storyboard)
            {
                storyboard.Begin();
            }
        }
        catch (Exception ex)
        {
            WindowsLog.Error($"Storyboard start failed: {key}", ex);
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

    private void BuildLayout()
    {
        WindowRoot.Children.Clear();

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
        WindowRoot.Children.Add(ambientLayer);

        ShellFrame = new Grid { Padding = new Thickness(24) };
        RailColumn = new ColumnDefinition { Width = new GridLength(320) };
        GutterColumn = new ColumnDefinition { Width = new GridLength(20) };
        ContentColumn = new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) };
        ShellFrame.ColumnDefinitions.Add(RailColumn);
        ShellFrame.ColumnDefinitions.Add(GutterColumn);
        ShellFrame.ColumnDefinitions.Add(ContentColumn);
        WindowRoot.Children.Add(ShellFrame);

        BuildRail();
        BuildContentShell();
    }

    private void BuildRail()
    {
        RailPanel = CreateCardBorder("AppSurfaceStrongBrush", "AppOutlineBrush", 28, new Thickness(20));
        Grid.SetColumn(RailPanel, 0);
        ShellFrame.Children.Add(RailPanel);

        var railScroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        };
        RailPanel.Child = railScroll;

        var railStack = new StackPanel();
        railScroll.Content = railStack;

        var brandGrid = new Grid { Margin = new Thickness(0, 0, 0, 18) };
        brandGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        brandGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var logoShell = CreateCardBorder("AppSurfaceHighBrush", "AppOutlineBrush", 18, new Thickness(12));
        logoShell.Width = 64;
        logoShell.Height = 64;
        logoShell.Child = CreateLogoElement();
        brandGrid.Children.Add(logoShell);

        var brandText = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(brandText, 1);
        brandText.Children.Add(new TextBlock
        {
            Text = "NeuralV",
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = 28,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold
        });
        brandText.Children.Add(new TextBlock
        {
            Text = "Windows-клиент",
            Foreground = ThemeBrush("AppMutedTextBrush")
        });
        brandGrid.Children.Add(brandText);
        railStack.Children.Add(brandGrid);

        var badgePill = CreateCardBorder("AppSecondaryContainerBrush", "AppOutlineBrush", 16, new Thickness(10, 6, 10, 6));
        badgePill.HorizontalAlignment = HorizontalAlignment.Left;
        badgePill.Margin = new Thickness(0, 0, 0, 12);
        RailBadgeText = new TextBlock { Foreground = ThemeBrush("AppTextBrush") };
        badgePill.Child = RailBadgeText;
        railStack.Children.Add(badgePill);

        RailHeadlineText = new TextBlock
        {
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = 30,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 8)
        };
        railStack.Children.Add(RailHeadlineText);

        RailDescriptionText = new TextBlock
        {
            Foreground = ThemeBrush("AppMutedTextBrush"),
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 18)
        };
        railStack.Children.Add(RailDescriptionText);

        var paletteCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 22, new Thickness(18));
        paletteCard.Margin = new Thickness(0, 0, 0, 16);
        var paletteStack = new StackPanel();
        paletteStack.Children.Add(CreateSectionTitle("Палитра"));
        PaletteSourceLabel = CreateBodyText("AppMutedTextBrush");
        PaletteSourceLabel.Margin = new Thickness(0, 0, 0, 10);
        paletteStack.Children.Add(PaletteSourceLabel);
        var swatches = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 10) };
        PaletteSwatchPrimary = CreateSwatch();
        PaletteSwatchSecondary = CreateSwatch();
        PaletteSwatchSecondary.Margin = new Thickness(10, 0, 0, 0);
        PaletteSwatchTertiary = CreateSwatch();
        PaletteSwatchTertiary.Margin = new Thickness(10, 0, 0, 0);
        swatches.Children.Add(PaletteSwatchPrimary);
        swatches.Children.Add(PaletteSwatchSecondary);
        swatches.Children.Add(PaletteSwatchTertiary);
        paletteStack.Children.Add(swatches);
        PaletteSeedLabel = CreateBodyText("AppSubtleTextBrush");
        paletteStack.Children.Add(PaletteSeedLabel);
        paletteCard.Child = paletteStack;
        railStack.Children.Add(paletteCard);

        var accountCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 22, new Thickness(18));
        var accountStack = new StackPanel();
        accountStack.Children.Add(CreateSectionTitle("Аккаунт"));
        RailUserNameText = new TextBlock
        {
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = 18,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 6)
        };
        accountStack.Children.Add(RailUserNameText);
        RailUserMetaText = CreateBodyText("AppMutedTextBrush");
        RailUserMetaText.Margin = new Thickness(0, 0, 0, 10);
        accountStack.Children.Add(RailUserMetaText);
        var accountPill = CreateCardBorder("AppSecondaryContainerBrush", "AppOutlineBrush", 16, new Thickness(10, 6, 10, 6));
        accountPill.HorizontalAlignment = HorizontalAlignment.Left;
        RailUserStateText = new TextBlock { Foreground = ThemeBrush("AppTextBrush") };
        accountPill.Child = RailUserStateText;
        accountStack.Children.Add(accountPill);
        accountCard.Child = accountStack;
        railStack.Children.Add(accountCard);
    }

    private void BuildContentShell()
    {
        ContentShell = new Grid();
        Grid.SetColumn(ContentShell, 2);
        ContentShell.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        ContentShell.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        ShellFrame.Children.Add(ContentShell);

        HeaderMetaBar = new Grid { Margin = new Thickness(0, 0, 0, 18) };
        HeaderMetaBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        HeaderMetaBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        HeaderMetaBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        HeaderMetaBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        ContentShell.Children.Add(HeaderMetaBar);

        ThemeModeLabel = AddHeaderPill(HeaderMetaBar, 0, new Thickness(0, 0, 12, 0));
        PaletteModeHeaderLabel = AddHeaderPill(HeaderMetaBar, 1, new Thickness(0, 0, 12, 0));
        VersionLabel = AddHeaderPill(HeaderMetaBar, 3, new Thickness(0));

        var frameCard = CreateCardBorder("AppSurfaceStrongBrush", "AppOutlineBrush", 28, new Thickness(22));
        Grid.SetRow(frameCard, 1);
        ContentShell.Children.Add(frameCard);

        var frameGrid = new Grid();
        frameGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        frameGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        frameGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        frameCard.Child = frameGrid;

        AppNavigationBar = new Grid { Visibility = Visibility.Collapsed, Margin = new Thickness(0, 0, 0, 18) };
        AppNavigationBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        AppNavigationBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        frameGrid.Children.Add(AppNavigationBar);

        var navStack = new StackPanel { Orientation = Orientation.Horizontal };
        HomeNavButton = CreateButton("Обзор", OnHomeClick, "NavTabButtonStyle");
        HomeNavButton.Margin = new Thickness(0, 0, 10, 0);
        HistoryNavButton = CreateButton("История", OnHistoryClick, "NavTabButtonStyle");
        HistoryNavButton.Margin = new Thickness(0, 0, 10, 0);
        SettingsNavButton = CreateButton("Настройки", OnSettingsClick, "NavTabButtonStyle");
        navStack.Children.Add(HomeNavButton);
        navStack.Children.Add(HistoryNavButton);
        navStack.Children.Add(SettingsNavButton);
        AppNavigationBar.Children.Add(navStack);

        var userPillShell = CreateCardBorder("AppSecondaryContainerBrush", "AppOutlineBrush", 14, new Thickness(12, 8, 12, 8));
        Grid.SetColumn(userPillShell, 1);
        UserLabel = new TextBlock { Foreground = ThemeBrush("AppTextBrush") };
        userPillShell.Child = UserLabel;
        AppNavigationBar.Children.Add(userPillShell);

        StatusBanner = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 18, new Thickness(14));
        StatusBanner.Visibility = Visibility.Collapsed;
        StatusBanner.Margin = new Thickness(0, 0, 0, 16);
        Grid.SetRow(StatusBanner, 1);
        StatusBannerText = CreateBodyText("AppTextBrush");
        StatusBanner.Child = StatusBannerText;
        frameGrid.Children.Add(StatusBanner);

        var stageGrid = new Grid();
        Grid.SetRow(stageGrid, 2);
        frameGrid.Children.Add(stageGrid);

        SplashView = BuildSplashView();
        stageGrid.Children.Add(SplashView);

        WelcomeView = BuildWelcomeView();
        stageGrid.Children.Add(WelcomeView);

        LoginView = BuildLoginView();
        stageGrid.Children.Add(LoginView);

        RegisterView = BuildRegisterView();
        stageGrid.Children.Add(RegisterView);

        CodeView = BuildCodeView();
        stageGrid.Children.Add(CodeView);

        HomeView = BuildHomeView();
        stageGrid.Children.Add(HomeView);

        ScanView = BuildScanView();
        stageGrid.Children.Add(ScanView);

        HistoryView = BuildHistoryView();
        stageGrid.Children.Add(HistoryView);

        SettingsView = BuildSettingsView();
        stageGrid.Children.Add(SettingsView);

        BusyOverlay = new Border
        {
            Background = ThemeBrush("AppOverlayScrimBrush"),
            CornerRadius = new CornerRadius(28),
            Visibility = Visibility.Collapsed
        };
        Grid.SetRowSpan(BusyOverlay, 3);
        frameGrid.Children.Add(BusyOverlay);

        var busyHost = new Grid();
        BusyOverlay.Child = busyHost;
        var busyCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineStrongBrush", 18, new Thickness(18));
        busyCard.Width = 320;
        busyCard.HorizontalAlignment = HorizontalAlignment.Center;
        busyCard.VerticalAlignment = VerticalAlignment.Center;
        busyHost.Children.Add(busyCard);
        var busyStack = new StackPanel();
        var busyGlyphShell = new Border
        {
            Width = 72,
            Height = 72,
            CornerRadius = new CornerRadius(36),
            Background = ThemeBrush("AppAccentSoftBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 14)
        };
        var busyGlyph = new Grid();
        busyGlyph.Children.Add(new UiEllipse
        {
            Width = 44,
            Height = 44,
            Stroke = ThemeBrush("AppAccentBrush"),
            StrokeThickness = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        });
        busyGlyphShell.Child = busyGlyph;
        busyStack.Children.Add(busyGlyphShell);
        BusyText = new TextBlock
        {
            Text = "Загрузка",
            Foreground = ThemeBrush("AppTextBrush"),
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap
        };
        busyStack.Children.Add(BusyText);
        busyCard.Child = busyStack;
    }

    private FrameworkElement BuildSplashView()
    {
        var host = new Grid();
        var stack = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = 540
        };
        host.Children.Add(stack);

        var splashGrid = new Grid
        {
            Width = 132,
            Height = 132,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 18)
        };
        SplashHalo = new Border
        {
            Width = 132,
            Height = 132,
            CornerRadius = new CornerRadius(66),
            Background = ThemeBrush("AppAccentSoftBrush")
        };
        SplashOrbitRing = new UiEllipse
        {
            Width = 112,
            Height = 112,
            Stroke = ThemeBrush("AppAccentBrush"),
            StrokeThickness = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        var splashBadge = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 24, new Thickness(12));
        splashBadge.Width = 84;
        splashBadge.Height = 84;
        splashBadge.HorizontalAlignment = HorizontalAlignment.Center;
        splashBadge.VerticalAlignment = VerticalAlignment.Center;
        splashBadge.Child = CreateLogoElement();
        splashGrid.Children.Add(SplashHalo);
        splashGrid.Children.Add(SplashOrbitRing);
        splashGrid.Children.Add(splashBadge);
        stack.Children.Add(splashGrid);
        stack.Children.Add(new TextBlock
        {
            Text = "Запускаем NeuralV",
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = 34,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(0, 0, 0, 10)
        });
        stack.Children.Add(new TextBlock
        {
            Text = "Поднимаем палитру, сессию и основной экран.",
            Foreground = ThemeBrush("AppMutedTextBrush"),
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center
        });
        return host;
    }

    private FrameworkElement BuildWelcomeView()
    {
        var view = CreatePageScroll();
        var stack = CreatePageStack(880);
        stack.Children.Add(CreatePageTitle("NeuralV для Windows"));
        stack.Children.Add(CreatePageSubtitle("Нативный клиент для входа, проверки, истории и обновления."));
        var actions = new StackPanel { Orientation = Orientation.Horizontal };
        var loginButton = CreateButton("Войти в аккаунт", OnShowLoginClick, "NeuralVButtonStyle");
        loginButton.Margin = new Thickness(0, 0, 12, 0);
        actions.Children.Add(loginButton);
        actions.Children.Add(CreateButton("Создать аккаунт", OnShowRegisterClick, "SecondaryButtonStyle"));
        stack.Children.Add(actions);
        view.Content = stack;
        view.Visibility = Visibility.Collapsed;
        return view;
    }

    private FrameworkElement BuildLoginView()
    {
        var view = CreatePageScroll();
        var stack = CreatePageStack(760);
        stack.Children.Add(CreatePageTitle("Вход", 32));
        stack.Children.Add(CreatePageSubtitle("Введи почту и пароль. Потом придёт код подтверждения."));
        stack.Children.Add(CreateFieldLabel("E-mail"));
        LoginEmailBox = CreateTextBox("name@example.com");
        LoginEmailBox.Margin = new Thickness(0, 0, 0, 12);
        stack.Children.Add(LoginEmailBox);
        stack.Children.Add(CreateFieldLabel("Пароль"));
        LoginPasswordBox = CreatePasswordBox();
        LoginPasswordBox.Margin = new Thickness(0, 0, 0, 18);
        stack.Children.Add(LoginPasswordBox);
        var actions = new StackPanel { Orientation = Orientation.Horizontal };
        var backButton = CreateButton("Назад", OnBackToWelcomeClick, "SecondaryButtonStyle");
        backButton.Margin = new Thickness(0, 0, 12, 0);
        actions.Children.Add(backButton);
        actions.Children.Add(CreateButton("Продолжить", OnStartLoginClick, "NeuralVButtonStyle"));
        stack.Children.Add(actions);
        view.Content = stack;
        view.Visibility = Visibility.Collapsed;
        return view;
    }

    private FrameworkElement BuildRegisterView()
    {
        var view = CreatePageScroll();
        var stack = CreatePageStack(760);
        stack.Children.Add(CreatePageTitle("Регистрация", 32));
        stack.Children.Add(CreatePageSubtitle("Создай аккаунт и подтверди почту кодом."));
        stack.Children.Add(CreateFieldLabel("Имя"));
        RegisterNameBox = CreateTextBox();
        RegisterNameBox.Margin = new Thickness(0, 0, 0, 12);
        stack.Children.Add(RegisterNameBox);
        stack.Children.Add(CreateFieldLabel("E-mail"));
        RegisterEmailBox = CreateTextBox("name@example.com");
        RegisterEmailBox.Margin = new Thickness(0, 0, 0, 12);
        stack.Children.Add(RegisterEmailBox);
        stack.Children.Add(CreateFieldLabel("Пароль"));
        RegisterPasswordBox = CreatePasswordBox();
        RegisterPasswordBox.Margin = new Thickness(0, 0, 0, 12);
        stack.Children.Add(RegisterPasswordBox);
        stack.Children.Add(CreateFieldLabel("Повтори пароль"));
        RegisterPasswordRepeatBox = CreatePasswordBox();
        RegisterPasswordRepeatBox.Margin = new Thickness(0, 0, 0, 18);
        stack.Children.Add(RegisterPasswordRepeatBox);
        var actions = new StackPanel { Orientation = Orientation.Horizontal };
        var backButton = CreateButton("Назад", OnBackToWelcomeClick, "SecondaryButtonStyle");
        backButton.Margin = new Thickness(0, 0, 12, 0);
        actions.Children.Add(backButton);
        actions.Children.Add(CreateButton("Создать аккаунт", OnStartRegisterClick, "NeuralVButtonStyle"));
        stack.Children.Add(actions);
        view.Content = stack;
        view.Visibility = Visibility.Collapsed;
        return view;
    }

    private FrameworkElement BuildCodeView()
    {
        var view = CreatePageScroll();
        var stack = CreatePageStack(760);
        stack.Children.Add(CreatePageTitle("Подтверждение", 32));
        CodeHintText = CreatePageSubtitle(string.Empty);
        stack.Children.Add(CodeHintText);
        stack.Children.Add(CreateFieldLabel("Код"));
        VerificationCodeBox = CreateTextBox("123456");
        VerificationCodeBox.Margin = new Thickness(0, 0, 0, 18);
        stack.Children.Add(VerificationCodeBox);
        var actions = new StackPanel { Orientation = Orientation.Horizontal };
        var backButton = CreateButton("Назад", OnBackFromCodeClick, "SecondaryButtonStyle");
        backButton.Margin = new Thickness(0, 0, 12, 0);
        actions.Children.Add(backButton);
        actions.Children.Add(CreateButton("Войти", OnVerifyCodeClick, "NeuralVButtonStyle"));
        stack.Children.Add(actions);
        view.Content = stack;
        view.Visibility = Visibility.Collapsed;
        return view;
    }

    private FrameworkElement BuildHomeView()
    {
        var view = CreatePageScroll();
        var stack = CreatePageStack(960);
        stack.Children.Add(CreatePageTitle("Панель проверки"));
        HomeStatusText = CreatePageSubtitle(string.Empty);
        stack.Children.Add(HomeStatusText);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 18) };
        QuickScanButton = CreateButton("Быстрая проверка", OnQuickScanClick, "NeuralVButtonStyle");
        QuickScanButton.Margin = new Thickness(0, 0, 12, 0);
        DeepScanButton = CreateButton("Глубокая проверка", OnDeepScanClick, "SecondaryButtonStyle");
        actions.Children.Add(QuickScanButton);
        actions.Children.Add(DeepScanButton);
        stack.Children.Add(actions);

        var updateCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 18, new Thickness(14));
        updateCard.Margin = new Thickness(0, 0, 0, 16);
        var updateStack = new StackPanel();
        updateStack.Children.Add(CreateSectionTitle("Обновления", 20));
        UpdateStatusText = CreateBodyText("AppMutedTextBrush");
        UpdateStatusText.Margin = new Thickness(0, 0, 0, 10);
        updateStack.Children.Add(UpdateStatusText);
        UpdateButton = CreateButton("Скачать обновление", OnDownloadUpdateClick, "NeuralVButtonStyle");
        UpdateButton.Visibility = Visibility.Collapsed;
        UpdateButton.HorizontalAlignment = HorizontalAlignment.Left;
        updateStack.Children.Add(UpdateButton);
        updateCard.Child = updateStack;
        stack.Children.Add(updateCard);

        var timelineCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 18, new Thickness(14));
        var timelineStack = new StackPanel();
        timelineStack.Children.Add(CreateSectionTitle("Последние события", 20));
        HomeTimelineList = CreateListView();
        HomeTimelineList.MinHeight = 340;
        timelineStack.Children.Add(HomeTimelineList);
        timelineCard.Child = timelineStack;
        stack.Children.Add(timelineCard);

        view.Content = stack;
        view.Visibility = Visibility.Collapsed;
        return view;
    }

    private FrameworkElement BuildScanView()
    {
        var view = CreatePageScroll();
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(330) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(20) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var leftCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 18, new Thickness(18));
        Grid.SetColumn(leftCard, 0);
        var leftStack = new StackPanel();
        var scanGlyphShell = new Border
        {
            Width = 96,
            Height = 96,
            CornerRadius = new CornerRadius(48),
            Background = ThemeBrush("AppAccentSoftBrush"),
            HorizontalAlignment = HorizontalAlignment.Left,
            Margin = new Thickness(0, 0, 0, 18)
        };
        var scanGlyphGrid = new Grid();
        scanGlyphGrid.Children.Add(new UiEllipse
        {
            Width = 72,
            Height = 72,
            Stroke = ThemeBrush("AppAccentBrush"),
            StrokeThickness = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        });
        scanGlyphGrid.Children.Add(new TextBlock
        {
            Text = "NV",
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = 22,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        });
        scanGlyphShell.Child = scanGlyphGrid;
        leftStack.Children.Add(scanGlyphShell);
        ScanPrimaryText = new TextBlock
        {
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = 24,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 10),
            TextWrapping = TextWrapping.Wrap
        };
        leftStack.Children.Add(ScanPrimaryText);
        ScanSecondaryText = CreateBodyText("AppMutedTextBrush");
        ScanSecondaryText.Margin = new Thickness(0, 0, 0, 18);
        leftStack.Children.Add(ScanSecondaryText);
        var cancelButton = CreateButton("Отменить проверку", OnCancelScanClick, "NeuralVButtonStyle");
        cancelButton.Margin = new Thickness(0, 0, 0, 10);
        leftStack.Children.Add(cancelButton);
        leftStack.Children.Add(CreateButton("Назад", OnBackToHomeClick, "SecondaryButtonStyle"));
        leftCard.Child = leftStack;
        grid.Children.Add(leftCard);

        var rightCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 18, new Thickness(18));
        Grid.SetColumn(rightCard, 2);
        var rightStack = new StackPanel();
        rightStack.Children.Add(CreateSectionTitle("Что происходит сейчас", 20));
        ScanTimelineList = CreateListView();
        ScanTimelineList.MinHeight = 440;
        rightStack.Children.Add(ScanTimelineList);
        rightCard.Child = rightStack;
        grid.Children.Add(rightCard);

        view.Content = grid;
        view.Visibility = Visibility.Collapsed;
        return view;
    }

    private FrameworkElement BuildHistoryView()
    {
        var view = CreatePageScroll();
        var stack = CreatePageStack();
        stack.Children.Add(CreatePageTitle("История"));
        stack.Children.Add(CreatePageSubtitle("Последние завершённые проверки сохраняются локально."));
        HistoryList = CreateListView();
        stack.Children.Add(HistoryList);
        view.Content = stack;
        view.Visibility = Visibility.Collapsed;
        return view;
    }

    private FrameworkElement BuildSettingsView()
    {
        var view = CreatePageScroll();
        var stack = CreatePageStack(760);
        stack.Children.Add(CreatePageTitle("Настройки"));

        var paletteCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 18, new Thickness(18));
        paletteCard.Margin = new Thickness(0, 0, 0, 16);
        var paletteStack = new StackPanel();
        paletteStack.Children.Add(CreateSectionTitle("Визуальная система", 20));
        SettingsPaletteText = CreateBodyText("AppMutedTextBrush");
        SettingsPaletteText.Margin = new Thickness(0, 0, 0, 8);
        SettingsVersionText = CreateBodyText("AppMutedTextBrush");
        paletteStack.Children.Add(SettingsPaletteText);
        paletteStack.Children.Add(SettingsVersionText);
        paletteCard.Child = paletteStack;
        stack.Children.Add(paletteCard);

        var sessionCard = CreateCardBorder("AppSurfaceBrush", "AppOutlineBrush", 18, new Thickness(18));
        var sessionStack = new StackPanel();
        sessionStack.Children.Add(CreateSectionTitle("Сессия", 20));
        SettingsSessionText = CreateBodyText("AppMutedTextBrush");
        SettingsSessionText.Margin = new Thickness(0, 0, 0, 12);
        sessionStack.Children.Add(SettingsSessionText);
        var logoutButton = CreateButton("Выйти из аккаунта", OnLogoutClick, "SecondaryButtonStyle");
        logoutButton.HorizontalAlignment = HorizontalAlignment.Left;
        sessionStack.Children.Add(logoutButton);
        sessionCard.Child = sessionStack;
        stack.Children.Add(sessionCard);

        view.Content = stack;
        view.Visibility = Visibility.Collapsed;
        return view;
    }

    private static ScrollViewer CreatePageScroll()
    {
        return new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        };
    }

    private static StackPanel CreatePageStack(double maxWidth = 0)
    {
        var stack = new StackPanel();
        if (maxWidth > 0)
        {
            stack.MaxWidth = maxWidth;
        }
        return stack;
    }

    private static TextBlock CreatePageTitle(string text, double size = 34)
    {
        return new TextBlock
        {
            Text = text,
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = size,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 10)
        };
    }

    private static TextBlock CreatePageSubtitle(string text)
    {
        return new TextBlock
        {
            Text = text,
            Foreground = ThemeBrush("AppMutedTextBrush"),
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 18)
        };
    }

    private static TextBlock CreateSectionTitle(string text, double size = 22)
    {
        return new TextBlock
        {
            Text = text,
            Foreground = ThemeBrush("AppTextBrush"),
            FontSize = size,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 10)
        };
    }

    private static TextBlock CreateFieldLabel(string text)
    {
        return new TextBlock
        {
            Text = text,
            Foreground = ThemeBrush("AppMutedTextBrush"),
            Margin = new Thickness(0, 0, 0, 6)
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

    private static Border CreateCardBorder(string backgroundKey, string borderKey, double cornerRadius, Thickness padding)
    {
        return new Border
        {
            Background = ThemeBrush(backgroundKey),
            BorderBrush = ThemeBrush(borderKey),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(cornerRadius),
            Padding = padding
        };
    }

    private static Border CreateSwatch()
    {
        return new Border
        {
            Width = 48,
            Height = 48,
            CornerRadius = new CornerRadius(14)
        };
    }

    private TextBlock AddHeaderPill(Grid parent, int column, Thickness margin)
    {
        var shell = CreateCardBorder("AppSecondaryContainerBrush", "AppOutlineBrush", 14, new Thickness(12, 8, 12, 8));
        shell.Margin = margin;
        Grid.SetColumn(shell, column);
        var label = new TextBlock { Foreground = ThemeBrush("AppTextBrush") };
        shell.Child = label;
        parent.Children.Add(shell);
        return label;
    }

    private Button CreateButton(string text, RoutedEventHandler handler, string styleKey)
    {
        var button = new Button { Content = text };
        ApplyAppStyle(button, styleKey);
        button.Foreground = ThemeBrush("AppTextBrush");
        button.BorderBrush = ThemeBrush("AppOutlineBrush");
        button.BorderThickness = new Thickness(1);
        button.Padding = new Thickness(18, 12, 18, 12);
        button.MinHeight = 48;
        button.MinWidth = 148;
        button.CornerRadius = new CornerRadius(20);
        button.HorizontalAlignment = HorizontalAlignment.Left;

        if (string.Equals(styleKey, "NeuralVButtonStyle", StringComparison.Ordinal))
        {
            button.Background = ThemeBrush("AppPrimaryContainerBrush");
            button.Foreground = ThemeBrush("AppOnAccentBrush");
            button.BorderBrush = ThemeBrush("AppPrimaryContainerBrush");
        }
        else if (string.Equals(styleKey, "NavTabButtonStyle", StringComparison.Ordinal))
        {
            button.Background = ThemeBrush("AppSurfaceHighBrush");
        }
        else
        {
            button.Background = ThemeBrush("AppSurfaceBrush");
        }

        button.Click += handler;
        return button;
    }

    private TextBox CreateTextBox(string? placeholderText = null)
    {
        var textBox = new TextBox();
        if (!string.IsNullOrWhiteSpace(placeholderText))
        {
            textBox.PlaceholderText = placeholderText;
        }
        ApplyAppStyle(textBox, "FieldTextBoxStyle");
        textBox.Background = ThemeBrush("AppSurfaceBrush");
        textBox.Foreground = ThemeBrush("AppTextBrush");
        textBox.BorderBrush = ThemeBrush("AppOutlineBrush");
        textBox.BorderThickness = new Thickness(1);
        textBox.Padding = new Thickness(16, 14, 16, 14);
        textBox.MinHeight = 56;
        textBox.CornerRadius = new CornerRadius(18);
        return textBox;
    }

    private PasswordBox CreatePasswordBox()
    {
        var passwordBox = new PasswordBox();
        ApplyAppStyle(passwordBox, "FieldPasswordBoxStyle");
        passwordBox.Background = ThemeBrush("AppSurfaceBrush");
        passwordBox.Foreground = ThemeBrush("AppTextBrush");
        passwordBox.BorderBrush = ThemeBrush("AppOutlineBrush");
        passwordBox.BorderThickness = new Thickness(1);
        passwordBox.Padding = new Thickness(16, 14, 16, 14);
        passwordBox.MinHeight = 56;
        passwordBox.CornerRadius = new CornerRadius(18);
        return passwordBox;
    }

    private ListView CreateListView()
    {
        var listView = new ListView
        {
            SelectionMode = ListViewSelectionMode.None,
            BorderThickness = new Thickness(0),
            Background = new SolidColorBrush(UiColor.FromArgb(0, 0, 0, 0)),
            Foreground = ThemeBrush("AppTextBrush")
        };
        ApplyAppStyle(listView, "TertiaryListViewStyle");
        if (App.Current.Resources.TryGetValue("FlatListViewItemStyle", out var containerStyle) && containerStyle is Style itemStyle)
        {
            listView.ItemContainerStyle = itemStyle;
        }
        return listView;
    }

    private static void ApplyAppStyle(Control control, string styleKey)
    {
        if (App.Current.Resources.TryGetValue(styleKey, out var style) && style is Style typedStyle)
        {
            control.Style = typedStyle;
        }
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
                Stretch = Stretch.Uniform,
                Margin = new Thickness(12)
            };
        }
        catch
        {
            return new TextBlock
            {
                Text = "NV",
                Foreground = ThemeBrush("AppTextBrush"),
                FontSize = 22,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                TextAlignment = TextAlignment.Center
            };
        }
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
        if (App.Current.Resources.TryGetValue(active ? "SelectedNavTabButtonStyle" : "NavTabButtonStyle", out var value) && value is Style style)
        {
            button.Style = style;
            return;
        }

        button.Background = active ? ThemeBrush("AppPrimaryContainerBrush") : ThemeBrush("AppSurfaceHighBrush");
        button.Foreground = active ? ThemeBrush("AppOnAccentBrush") : ThemeBrush("AppTextBrush");
        button.BorderBrush = active ? ThemeBrush("AppPrimaryContainerBrush") : ThemeBrush("AppOutlineBrush");
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
