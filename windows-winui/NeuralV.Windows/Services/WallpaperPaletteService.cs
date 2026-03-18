using System.Runtime.InteropServices;
using Microsoft.Win32;
using DrawingBitmap = System.Drawing.Bitmap;
using DrawingSize = System.Drawing.Size;
using UiColor = Windows.UI.Color;

namespace NeuralV.Windows.Services;

public enum PaletteSource
{
    Wallpaper,
    WindowsAccent,
    Default
}

public sealed class ThemePalette
{
    public UiColor Background { get; init; }
    public UiColor BackgroundAlt { get; init; }
    public UiColor Surface { get; init; }
    public UiColor SurfaceRaised { get; init; }
    public UiColor SurfaceStrong { get; init; }
    public UiColor SurfaceHigh { get; init; }
    public UiColor Card { get; init; }
    public UiColor Chrome { get; init; }
    public UiColor Accent { get; init; }
    public UiColor AccentSecondary { get; init; }
    public UiColor AccentTertiary { get; init; }
    public UiColor PrimaryContainer { get; init; }
    public UiColor SecondaryContainer { get; init; }
    public UiColor TertiaryContainer { get; init; }
    public UiColor AccentSoft { get; init; }
    public UiColor AccentMuted { get; init; }
    public UiColor Outline { get; init; }
    public UiColor OutlineStrong { get; init; }
    public UiColor Text { get; init; }
    public UiColor MutedText { get; init; }
    public UiColor SubtleText { get; init; }
    public UiColor OnSurfaceVariant { get; init; }
    public UiColor OnAccent { get; init; }
    public UiColor Success { get; init; }
    public UiColor Warning { get; init; }
    public UiColor Danger { get; init; }
    public bool IsDark { get; init; }
    public PaletteSource Source { get; init; }

    public string SourceLabel => Source switch
    {
        PaletteSource.Wallpaper => "Обои",
        PaletteSource.WindowsAccent => "Акцент Windows",
        _ => "Резервный вариант"
    };

    public string AccentHex => $"#{Accent.R:X2}{Accent.G:X2}{Accent.B:X2}";

    public static ThemePalette DefaultDark() => FromAccent(UiColor.FromArgb(255, 100, 127, 255), true, PaletteSource.Default);

    public static ThemePalette FromAccent(UiColor accent, bool isDark, PaletteSource source)
    {
        accent = NormalizeAccent(accent, isDark);
        ToHsl(accent, out var hue, out var saturation, out _);

        var background = isDark
            ? FromHsl(hue, Clamp01(saturation * 0.18 + 0.05), 0.10)
            : FromHsl(hue, Clamp01(saturation * 0.08 + 0.02), 0.97);
        var backgroundAlt = isDark
            ? FromHsl(hue + 12, Clamp01(saturation * 0.24 + 0.06), 0.14)
            : FromHsl(hue + 10, Clamp01(saturation * 0.10 + 0.03), 0.93);
        var surface = Blend(background, accent, isDark ? 0.15 : 0.07);
        var surfaceRaised = Blend(backgroundAlt, accent, isDark ? 0.18 : 0.10);
        var surfaceStrong = Blend(surfaceRaised, accent, isDark ? 0.22 : 0.14);
        var surfaceHigh = Blend(surfaceStrong, accent, isDark ? 0.28 : 0.18);
        var card = Blend(surfaceStrong, isDark ? UiColor.FromArgb(255, 255, 255, 255) : UiColor.FromArgb(255, 255, 255, 255), isDark ? 0.03 : 0.18);
        var chrome = Blend(background, backgroundAlt, 0.58);
        var accentSecondary = AdjustLightness(RotateHue(accent, -18), isDark ? 0.10 : -0.03);
        var accentTertiary = AdjustLightness(RotateHue(accent, 24), isDark ? 0.12 : -0.04);

        return new ThemePalette
        {
            Background = background,
            BackgroundAlt = backgroundAlt,
            Surface = surface,
            SurfaceRaised = surfaceRaised,
            SurfaceStrong = surfaceStrong,
            SurfaceHigh = surfaceHigh,
            Card = card,
            Chrome = chrome,
            Accent = accent,
            AccentSecondary = accentSecondary,
            AccentTertiary = accentTertiary,
            PrimaryContainer = Blend(surfaceHigh, accent, isDark ? 0.38 : 0.24),
            SecondaryContainer = Blend(surfaceHigh, accentSecondary, isDark ? 0.34 : 0.22),
            TertiaryContainer = Blend(surfaceHigh, accentTertiary, isDark ? 0.32 : 0.20),
            AccentSoft = Blend(surfaceStrong, accent, isDark ? 0.42 : 0.28),
            AccentMuted = Blend(surface, accentSecondary, isDark ? 0.26 : 0.18),
            Outline = Blend(surfaceStrong, isDark ? UiColor.FromArgb(255, 187, 196, 223) : UiColor.FromArgb(255, 91, 102, 128), isDark ? 0.22 : 0.28),
            OutlineStrong = Blend(accent, isDark ? UiColor.FromArgb(255, 235, 240, 255) : UiColor.FromArgb(255, 50, 62, 84), isDark ? 0.28 : 0.24),
            Text = isDark ? UiColor.FromArgb(255, 245, 247, 252) : UiColor.FromArgb(255, 22, 26, 36),
            MutedText = isDark ? UiColor.FromArgb(255, 194, 202, 226) : UiColor.FromArgb(255, 88, 98, 122),
            SubtleText = isDark ? UiColor.FromArgb(255, 150, 160, 187) : UiColor.FromArgb(255, 116, 126, 148),
            OnSurfaceVariant = isDark ? UiColor.FromArgb(255, 219, 225, 243) : UiColor.FromArgb(255, 59, 68, 90),
            OnAccent = GetReadableForeground(accent),
            Success = Blend(UiColor.FromArgb(255, 83, 205, 146), accentSecondary, 0.08),
            Warning = Blend(UiColor.FromArgb(255, 255, 184, 88), accentTertiary, 0.06),
            Danger = Blend(UiColor.FromArgb(255, 255, 121, 144), accentSecondary, 0.12),
            IsDark = isDark,
            Source = source
        };
    }

    public static UiColor Blend(UiColor from, UiColor to, double ratio)
    {
        var clamped = Clamp01(ratio);
        byte Mix(byte a, byte b) => (byte)(a + ((b - a) * clamped));
        return UiColor.FromArgb(255, Mix(from.R, to.R), Mix(from.G, to.G), Mix(from.B, to.B));
    }

    public static UiColor WithAlpha(UiColor color, double opacity)
    {
        return UiColor.FromArgb((byte)(Clamp01(opacity) * 255), color.R, color.G, color.B);
    }

    public static UiColor RotateHue(UiColor color, double delta)
    {
        ToHsl(color, out var hue, out var saturation, out var lightness);
        return FromHsl(hue + delta, saturation, lightness);
    }

    public static UiColor AdjustLightness(UiColor color, double delta)
    {
        ToHsl(color, out var hue, out var saturation, out var lightness);
        return FromHsl(hue, saturation, Clamp01(lightness + delta));
    }

    public static UiColor NormalizeAccent(UiColor color, bool isDark)
    {
        ToHsl(color, out var hue, out var saturation, out var lightness);
        saturation = Math.Max(saturation, isDark ? 0.42 : 0.34);
        lightness = isDark
            ? Math.Clamp(lightness, 0.56, 0.72)
            : Math.Clamp(lightness, 0.42, 0.58);
        return FromHsl(hue, saturation, lightness);
    }

    public static void ToHsl(UiColor color, out double hue, out double saturation, out double lightness)
    {
        var r = color.R / 255d;
        var g = color.G / 255d;
        var b = color.B / 255d;
        var max = Math.Max(r, Math.Max(g, b));
        var min = Math.Min(r, Math.Min(g, b));
        var delta = max - min;

        lightness = (max + min) / 2d;

        if (delta == 0)
        {
            hue = 0;
            saturation = 0;
            return;
        }

        saturation = lightness > 0.5
            ? delta / (2d - max - min)
            : delta / (max + min);

        hue = max switch
        {
            _ when max == r => ((g - b) / delta) + (g < b ? 6 : 0),
            _ when max == g => ((b - r) / delta) + 2,
            _ => ((r - g) / delta) + 4
        };
        hue *= 60d;
    }

    public static UiColor FromHsl(double hue, double saturation, double lightness)
    {
        hue = NormalizeHue(hue) / 360d;
        saturation = Clamp01(saturation);
        lightness = Clamp01(lightness);

        double r;
        double g;
        double b;

        if (saturation == 0)
        {
            r = g = b = lightness;
        }
        else
        {
            var q = lightness < 0.5
                ? lightness * (1 + saturation)
                : lightness + saturation - (lightness * saturation);
            var p = 2 * lightness - q;
            r = HueToRgb(p, q, hue + (1d / 3d));
            g = HueToRgb(p, q, hue);
            b = HueToRgb(p, q, hue - (1d / 3d));
        }

        return UiColor.FromArgb(255, (byte)Math.Round(r * 255), (byte)Math.Round(g * 255), (byte)Math.Round(b * 255));
    }

    private static UiColor GetReadableForeground(UiColor background)
    {
        return RelativeLuminance(background) > 0.42
            ? UiColor.FromArgb(255, 16, 20, 30)
            : UiColor.FromArgb(255, 248, 250, 255);
    }

    private static double RelativeLuminance(UiColor color)
    {
        static double Channel(byte value)
        {
            var normalized = value / 255d;
            return normalized <= 0.03928
                ? normalized / 12.92
                : Math.Pow((normalized + 0.055) / 1.055, 2.4);
        }

        return (0.2126 * Channel(color.R)) + (0.7152 * Channel(color.G)) + (0.0722 * Channel(color.B));
    }

    private static double HueToRgb(double p, double q, double t)
    {
        if (t < 0)
        {
            t += 1;
        }
        if (t > 1)
        {
            t -= 1;
        }
        if (t < 1d / 6d)
        {
            return p + ((q - p) * 6d * t);
        }
        if (t < 1d / 2d)
        {
            return q;
        }
        if (t < 2d / 3d)
        {
            return p + ((q - p) * ((2d / 3d) - t) * 6d);
        }
        return p;
    }

    private static double NormalizeHue(double hue)
    {
        var normalized = hue % 360d;
        return normalized < 0 ? normalized + 360d : normalized;
    }

    private static double Clamp01(double value) => Math.Clamp(value, 0d, 1d);
}

public static class WallpaperPaletteService
{
    private const uint SpiGetDeskWallpaper = 0x0073;

    public static ThemePalette Load(ThemeModePreference mode = ThemeModePreference.System, bool dynamicColorsEnabled = true)
    {
        var isDark = mode switch
        {
            ThemeModePreference.Dark => true,
            ThemeModePreference.Light => false,
            _ => DetectDarkMode()
        };

        if (!dynamicColorsEnabled)
        {
            return ThemePalette.FromAccent(UiColor.FromArgb(255, 100, 127, 255), isDark, PaletteSource.Default);
        }

        var wallpaperAccent = TryReadWallpaperAccent();
        if (wallpaperAccent.HasValue)
        {
            return ThemePalette.FromAccent(wallpaperAccent.Value, isDark, PaletteSource.Wallpaper);
        }

        var accent = ReadAccentColor();
        var source = accent.HasValue ? PaletteSource.WindowsAccent : PaletteSource.Default;
        return ThemePalette.FromAccent(accent ?? UiColor.FromArgb(255, 100, 127, 255), isDark, source);
    }

    private static bool DetectDarkMode()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int value && value == 0;
        }
        catch
        {
            return true;
        }
    }

    private static UiColor? ReadAccentColor()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\DWM");
            var raw = key?.GetValue("ColorizationColor");
            if (raw is int intValue)
            {
                return ColorFromArgb(intValue);
            }
            if (raw is uint uintValue)
            {
                return ColorFromArgb(unchecked((int)uintValue));
            }
        }
        catch
        {
        }

        return null;
    }

    private static UiColor? TryReadWallpaperAccent()
    {
        var path = GetWallpaperPath();
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            return null;
        }

        try
        {
            using var bitmap = new DrawingBitmap(path);
            using var sample = new DrawingBitmap(bitmap, new DrawingSize(Math.Min(96, bitmap.Width), Math.Min(96, bitmap.Height)));
            var buckets = new Dictionary<int, PaletteBucket>();

            var stepX = Math.Max(1, sample.Width / 28);
            var stepY = Math.Max(1, sample.Height / 28);
            for (var y = 0; y < sample.Height; y += stepY)
            {
                for (var x = 0; x < sample.Width; x += stepX)
                {
                    var pixel = sample.GetPixel(x, y);
                    if (pixel.A < 96)
                    {
                        continue;
                    }

                    var color = UiColor.FromArgb(pixel.A, pixel.R, pixel.G, pixel.B);
                    ThemePalette.ToHsl(color, out var hue, out var saturation, out var lightness);
                    if (lightness < 0.14 || lightness > 0.86 || saturation < 0.10)
                    {
                        continue;
                    }

                    var hueBucket = (int)(hue / 18d);
                    var saturationBucket = Math.Min(4, (int)(saturation * 5d));
                    var lightBucket = Math.Min(4, (int)(lightness * 5d));
                    var key = (hueBucket << 8) | (saturationBucket << 4) | lightBucket;
                    var balance = Math.Max(0.12, 1d - (Math.Abs(lightness - 0.52d) * 1.65d));
                    var score = (0.35d + (saturation * 0.65d)) * balance;

                    if (!buckets.TryGetValue(key, out var bucket))
                    {
                        bucket = new PaletteBucket();
                        buckets[key] = bucket;
                    }

                    bucket.Score += score;
                    bucket.SumR += pixel.R;
                    bucket.SumG += pixel.G;
                    bucket.SumB += pixel.B;
                    bucket.Count++;
                }
            }

            var selected = buckets.Values
                .Where(bucket => bucket.Count > 1)
                .OrderByDescending(bucket => bucket.Score * Math.Max(2, bucket.Count))
                .FirstOrDefault();

            if (selected is null)
            {
                return null;
            }

            return UiColor.FromArgb(
                255,
                (byte)(selected.SumR / selected.Count),
                (byte)(selected.SumG / selected.Count),
                (byte)(selected.SumB / selected.Count));
        }
        catch
        {
            return null;
        }
    }

    private static UiColor ColorFromArgb(int value)
    {
        var a = (byte)((value >> 24) & 0xFF);
        var r = (byte)((value >> 16) & 0xFF);
        var g = (byte)((value >> 8) & 0xFF);
        var b = (byte)(value & 0xFF);
        return UiColor.FromArgb(a == 0 ? (byte)255 : a, r, g, b);
    }

    private static string GetWallpaperPath()
    {
        var buffer = new char[2048];
        return SystemParametersInfoW(SpiGetDeskWallpaper, (uint)buffer.Length, buffer, 0)
            ? new string(buffer).TrimEnd('\0')
            : string.Empty;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SystemParametersInfoW(uint uiAction, uint uiParam, [Out] char[] pvParam, uint fWinIni);

    private sealed class PaletteBucket
    {
        public double Score { get; set; }
        public long SumR { get; set; }
        public long SumG { get; set; }
        public long SumB { get; set; }
        public int Count { get; set; }
    }
}
