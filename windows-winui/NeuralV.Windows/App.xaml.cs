using System.Diagnostics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Controls;
using NeuralV.Windows.Models;
using NeuralV.Windows.Services;
using Windows.UI;
namespace NeuralV.Windows;

public partial class App : Application
{
    public static ThemePalette Palette { get; private set; } = ThemePalette.DefaultDark();
    public static ClientPreferences Preferences { get; private set; } = new();
    public static bool IsSmokeTest { get; private set; }
    private Window? _window;

    public App()
    {
        WindowsLog.StartSession("winui");
        WindowsLog.Info($"Log file: {WindowsLog.LogFilePath}");
        WindowsLog.Info("App ctor");
        UnhandledException += OnUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnCurrentDomainUnhandledException;
        AppDomain.CurrentDomain.ProcessExit += OnProcessExit;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var smokeFromArgs = (args.Arguments ?? string.Empty)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(arg => string.Equals(arg, "--smoke-test", StringComparison.OrdinalIgnoreCase));
        var smokeFromEnv = string.Equals(
            Environment.GetEnvironmentVariable("NEURALV_SMOKE_TEST"),
            "1",
            StringComparison.OrdinalIgnoreCase);
        IsSmokeTest = smokeFromArgs || smokeFromEnv;

        try
        {
            WindowsLog.Info($"Launch arguments: {args.Arguments}");
            WindowsLog.Info($"Smoke test mode: {IsSmokeTest}");
            WindowsLog.Info("Loading client preferences");
            Preferences = ClientPreferencesStore.Load();
            WindowsLog.Info("Client preferences loaded");
            WindowsLog.Info("Loading palette");
            Palette = WallpaperPaletteService.Load(Preferences.ThemeMode, Preferences.DynamicColorsEnabled);
            WindowsLog.Info("Palette loaded");
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Wallpaper palette load failed, fallback to default", ex);
            Preferences = ClientPreferencesStore.Load();
            Palette = ThemePalette.DefaultDark();
        }

        ApplyPalette(Resources, Palette);

        try
        {
            WindowsLog.Info("Touching install metadata");
            var installState = InstallStateStore.ResolveExistingInstall(Environment.ProcessPath)
                ?? InstallStateStore.CreateDefault(
                    InstallLayout.ResolveInstallRootFromExecutablePath(Environment.ProcessPath ?? AppContext.BaseDirectory),
                    VersionInfo.Current);
            installState.Version = VersionInfo.Current;
            installState.AutoStartEnabled = Preferences.AutoStartEnabled;
            InstallStateStore.Save(installState);
            WindowsBundleInstaller.EnsureAutoStart(installState);
            WindowsLog.Info($"Install metadata saved: {installState.InstallRoot}");

            WindowsLog.Info("Creating main window");
            _window = new MainWindow();
            WindowsLog.Info("Main window created");

            if (IsSmokeTest && _window is MainWindow smokeWindow)
            {
                smokeWindow.RunSmokeValidation();
                WindowsSmokeVerifier.Run();
                WindowsLog.Info("Smoke verifier completed");
                Environment.ExitCode = 0;
                Current.Exit();
                return;
            }

            _window.Activate();
            WindowsLog.Info("Main window activated");
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Window activation failed", ex);
            if (IsSmokeTest)
            {
                WriteSmokeFailureDetails(ex);
                Environment.ExitCode = 1;
                Current.Exit();
                return;
            }
            ShowStartupFailureWindow(ex);
        }
    }

    public static void ApplyPalette(ResourceDictionary resources, ThemePalette palette)
    {
        resources["AppBackgroundBrush"] = Brush(palette.Background);
        resources["AppBackgroundAltBrush"] = Brush(palette.BackgroundAlt);
        resources["AppSurfaceBrush"] = Brush(palette.Surface);
        resources["AppSurfaceRaisedBrush"] = Brush(palette.SurfaceRaised);
        resources["AppSurfaceStrongBrush"] = Brush(palette.SurfaceStrong);
        resources["AppSurfaceHighBrush"] = Brush(palette.SurfaceHigh);
        resources["AppCardBrush"] = Brush(palette.Card);
        resources["AppChromeBrush"] = Brush(palette.Chrome);
        resources["AppAccentBrush"] = Brush(palette.Accent);
        resources["AppAccentSecondaryBrush"] = Brush(palette.AccentSecondary);
        resources["AppAccentTertiaryBrush"] = Brush(palette.AccentTertiary);
        resources["AppPrimaryContainerBrush"] = Brush(palette.PrimaryContainer);
        resources["AppSecondaryContainerBrush"] = Brush(palette.SecondaryContainer);
        resources["AppTertiaryContainerBrush"] = Brush(palette.TertiaryContainer);
        resources["AppAccentSoftBrush"] = Brush(palette.AccentSoft);
        resources["AppAccentMutedBrush"] = Brush(palette.AccentMuted);
        resources["AppOutlineBrush"] = Brush(palette.Outline);
        resources["AppOutlineStrongBrush"] = Brush(palette.OutlineStrong);
        resources["AppTextBrush"] = Brush(palette.Text);
        resources["AppMutedTextBrush"] = Brush(palette.MutedText);
        resources["AppSubtleTextBrush"] = Brush(palette.SubtleText);
        resources["AppOnSurfaceVariantBrush"] = Brush(palette.OnSurfaceVariant);
        resources["AppOnAccentBrush"] = Brush(palette.OnAccent);
        resources["AppSuccessBrush"] = Brush(palette.Success);
        resources["AppWarningBrush"] = Brush(palette.Warning);
        resources["AppDangerBrush"] = Brush(palette.Danger);
        resources["AppOverlayScrimBrush"] = Brush(ThemePalette.WithAlpha(palette.Background, 0.68));
        resources["AppSurfaceGradientBrush"] = Brush(ThemePalette.Blend(palette.SurfaceHigh, palette.Accent, 0.06));
        resources["AppSurfaceStrongGradientBrush"] = Brush(ThemePalette.Blend(palette.SurfaceStrong, palette.AccentSecondary, 0.12));
        resources["AppAccentGradientBrush"] = Brush(palette.Accent);
        resources["AppAccentSoftGradientBrush"] = Brush(ThemePalette.Blend(palette.PrimaryContainer, palette.Accent, 0.16));
        resources["AppSecondaryGradientBrush"] = Brush(ThemePalette.Blend(palette.SurfaceRaised, palette.AccentSecondary, 0.08));
        resources["AppFieldGradientBrush"] = Brush(ThemePalette.Blend(palette.Surface, palette.Accent, 0.04));
    }

    public static void ApplyClientPreferences(ClientPreferences preferences)
    {
        Preferences = preferences ?? new ClientPreferences();
        Palette = WallpaperPaletteService.Load(Preferences.ThemeMode, Preferences.DynamicColorsEnabled);
        ApplyPalette(Current.Resources, Palette);
    }

    private static SolidColorBrush Brush(Color color) => new(color);

    private static void OnUnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs e)
    {
        WindowsLog.Error("UI unhandled exception", e.Exception);
        if (IsSmokeTest && e.Exception is not null)
        {
            WriteSmokeFailureDetails(e.Exception);
        }
    }

    private static void OnCurrentDomainUnhandledException(object? sender, System.UnhandledExceptionEventArgs e)
    {
        WindowsLog.Error("AppDomain unhandled exception", e.ExceptionObject as Exception);
        if (IsSmokeTest && e.ExceptionObject is Exception exception)
        {
            WriteSmokeFailureDetails(exception);
        }
    }

    private static void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        WindowsLog.Error("TaskScheduler unobserved exception", e.Exception);
        if (IsSmokeTest)
        {
            WriteSmokeFailureDetails(e.Exception);
        }
        e.SetObserved();
    }

    private static void OnProcessExit(object? sender, EventArgs e)
    {
        WindowsLog.Info($"Process exit code: {Environment.ExitCode}");
    }

    private void ShowStartupFailureWindow(Exception exception)
    {
        try
        {
            var window = new Window
            {
                Title = "NeuralV"
            };

            var outer = new Grid
            {
                Background = Brush(Palette.Background)
            };

            var card = new Border
            {
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                Background = Brush(Palette.SurfaceStrong),
                BorderBrush = Brush(Palette.OutlineStrong),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(28),
                Padding = new Thickness(28),
                MaxWidth = 720
            };

            var stack = new StackPanel
            {
                Spacing = 18
            };

            stack.Children.Add(new TextBlock
            {
                Text = "NeuralV не смог открыть основной интерфейс",
                Foreground = Brush(Palette.Text),
                FontSize = 30,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                TextWrapping = TextWrapping.Wrap
            });
            stack.Children.Add(new TextBlock
            {
                Text = "Клиент записал подробности в log.txt. Это аварийное окно запускается специально, чтобы программа не закрывалась молча.",
                Foreground = Brush(Palette.MutedText),
                FontSize = 15,
                TextWrapping = TextWrapping.Wrap
            });
            stack.Children.Add(new TextBlock
            {
                Text = $"log.txt: {WindowsLog.LogFilePath}",
                Foreground = Brush(Palette.Text),
                FontSize = 14,
                TextWrapping = TextWrapping.Wrap
            });

            var details = new ScrollViewer
            {
                MaxHeight = 220,
                Content = new TextBlock
                {
                    Text = exception.ToString(),
                    Foreground = Brush(Palette.SubtleText),
                    FontSize = 13,
                    TextWrapping = TextWrapping.Wrap
                }
            };
            stack.Children.Add(details);

            var actions = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 12
            };

            var openLogFolder = new Button
            {
                Content = "Открыть папку логов"
            };
            openLogFolder.Click += (_, _) =>
            {
                try
                {
                    var folder = Path.GetDirectoryName(WindowsLog.LogFilePath);
                    if (!string.IsNullOrWhiteSpace(folder))
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = folder,
                            UseShellExecute = true
                        });
                    }
                }
                catch (Exception openEx)
                {
                    WindowsLog.Error("Open log folder failed", openEx);
                }
            };

            var closeButton = new Button
            {
                Content = "Закрыть"
            };
            closeButton.Click += (_, _) => Current.Exit();

            actions.Children.Add(openLogFolder);
            actions.Children.Add(closeButton);
            stack.Children.Add(actions);

            card.Child = stack;
            outer.Children.Add(card);

            window.Content = outer;
            _window = window;
            _window.Activate();
        }
        catch (Exception fallbackEx)
        {
            WindowsLog.Error("Startup fallback window failed", fallbackEx);
            WriteSmokeFailureDetails(fallbackEx);
            Environment.ExitCode = 1;
            Current.Exit();
        }
    }

    private static void WriteSmokeFailureDetails(Exception exception)
    {
        try
        {
            var installRoot = InstallLayout.ResolveInstallRootFromExecutablePath(Environment.ProcessPath ?? AppContext.BaseDirectory);
            var path = Path.Combine(installRoot, "smoke-error.txt");
            File.WriteAllText(path, exception.ToString());
        }
        catch
        {
        }
    }
}
