using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using NeuralV.Windows.Services;
using Windows.UI;

namespace NeuralV.Windows;

public partial class App : Application
{
    public static ThemePalette Palette { get; private set; } = ThemePalette.DefaultDark();
    public static bool IsSmokeTest { get; private set; }

    public App()
    {
        WindowsLog.StartSession("winui");
        WindowsLog.Info($"Log file: {WindowsLog.LogFilePath}");
        WindowsLog.Info("App ctor");
        UnhandledException += OnUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnCurrentDomainUnhandledException;
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
            Palette = WallpaperPaletteService.Load();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Wallpaper palette load failed, fallback to default", ex);
            Palette = ThemePalette.DefaultDark();
        }

        ApplyPalette(Resources, Palette);

        if (IsSmokeTest)
        {
            try
            {
                WindowsSmokeVerifier.Run();
                WindowsLog.Info("Smoke verifier completed");
                Environment.ExitCode = 0;
            }
            catch (Exception ex)
            {
                WindowsLog.Error("Smoke verifier failed", ex);
                Environment.ExitCode = 1;
            }
            Current.Exit();
            return;
        }

        try
        {
            var window = new MainWindow();
            window.Activate();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("Window activation failed", ex);
            Environment.ExitCode = 1;
            Current.Exit();
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
        resources["AppSurfaceGradientBrush"] = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = ThemePalette.Blend(palette.SurfaceHigh, palette.Accent, 0.10), Offset = 0.0 },
                new GradientStop { Color = palette.Surface, Offset = 1.0 }
            }
        };
        resources["AppSurfaceStrongGradientBrush"] = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = ThemePalette.Blend(palette.SurfaceStrong, palette.AccentSecondary, 0.22), Offset = 0.0 },
                new GradientStop { Color = ThemePalette.Blend(palette.PrimaryContainer, palette.BackgroundAlt, 0.36), Offset = 1.0 }
            }
        };
        resources["AppAccentGradientBrush"] = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = palette.Accent, Offset = 0.0 },
                new GradientStop { Color = palette.AccentSecondary, Offset = 1.0 }
            }
        };
        resources["AppAccentSoftGradientBrush"] = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = ThemePalette.Blend(palette.PrimaryContainer, palette.Accent, 0.22), Offset = 0.0 },
                new GradientStop { Color = ThemePalette.Blend(palette.SecondaryContainer, palette.AccentSecondary, 0.18), Offset = 1.0 }
            }
        };
        resources["AppSecondaryGradientBrush"] = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = ThemePalette.Blend(palette.SurfaceRaised, palette.AccentSecondary, 0.14), Offset = 0.0 },
                new GradientStop { Color = ThemePalette.Blend(palette.SurfaceStrong, palette.BackgroundAlt, 0.18), Offset = 1.0 }
            }
        };
        resources["AppFieldGradientBrush"] = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = ThemePalette.Blend(palette.Surface, palette.Accent, 0.05), Offset = 0.0 },
                new GradientStop { Color = palette.SurfaceHigh, Offset = 1.0 }
            }
        };
    }

    private static SolidColorBrush Brush(Color color) => new(color);

    private static void OnUnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs e)
    {
        WindowsLog.Error("UI unhandled exception", e.Exception);
    }

    private static void OnCurrentDomainUnhandledException(object? sender, System.UnhandledExceptionEventArgs e)
    {
        WindowsLog.Error("AppDomain unhandled exception", e.ExceptionObject as Exception);
    }

    private static void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        WindowsLog.Error("TaskScheduler unobserved exception", e.Exception);
        e.SetObserved();
    }
}
