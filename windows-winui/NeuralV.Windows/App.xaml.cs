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
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        IsSmokeTest = (args.Arguments ?? string.Empty)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(arg => string.Equals(arg, "--smoke-test", StringComparison.OrdinalIgnoreCase));

        try
        {
            Palette = WallpaperPaletteService.Load();
        }
        catch
        {
            Palette = ThemePalette.DefaultDark();
        }

        ApplyPalette(Resources, Palette);

        var window = new MainWindow();
        window.Activate();
    }

    public static void ApplyPalette(ResourceDictionary resources, ThemePalette palette)
    {
        resources["AppBackgroundBrush"] = Brush(palette.Background);
        resources["AppSurfaceBrush"] = Brush(palette.Surface);
        resources["AppSurfaceRaisedBrush"] = Brush(palette.SurfaceRaised);
        resources["AppAccentBrush"] = Brush(palette.Accent);
        resources["AppAccentSoftBrush"] = Brush(palette.AccentSoft);
        resources["AppOutlineBrush"] = Brush(palette.Outline);
        resources["AppTextBrush"] = Brush(palette.Text);
        resources["AppMutedTextBrush"] = Brush(palette.MutedText);
        resources["AppSuccessBrush"] = Brush(palette.Success);
        resources["AppWarningBrush"] = Brush(palette.Warning);
        resources["AppDangerBrush"] = Brush(palette.Danger);
    }

    private static SolidColorBrush Brush(Color color) => new(color);
}
