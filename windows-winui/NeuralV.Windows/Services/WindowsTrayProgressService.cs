using NeuralV.Windows.Models;

namespace NeuralV.Windows.Services;

public static class WindowsTrayProgressService
{
    public static TrayProgressState CreateIdle() =>
        new()
        {
            IsVisible = false,
            IsIndeterminate = false,
            ProgressPercent = 0,
            Title = "NeuralV",
            Subtitle = "Проверка не запущена",
            Tooltip = "NeuralV"
        };

    public static TrayProgressState FromScan(DesktopScanState? scan)
    {
        if (scan is null)
        {
            return CreateIdle();
        }

        var progress = EstimateProgressPercent(scan);
        var visualState = ResolveVisualState(scan.Status);
        var title = scan.IsFinished
            ? "Проверка завершена"
            : $"Проверка: {progress}%";
        var subtitle = string.IsNullOrWhiteSpace(scan.PrimarySummary)
            ? ResolveStatusLabel(scan.Status)
            : scan.PrimarySummary;
        var tooltip = scan.IsFinished
            ? $"NeuralV · {subtitle}"
            : $"NeuralV · {ResolveModeLabel(scan.Mode)} · {progress}%";

        return new TrayProgressState
        {
            IsVisible = !scan.IsFinished,
            IsIndeterminate = scan.Status is "QUEUED" or "PREPARING",
            ScanId = scan.Id,
            Mode = scan.Mode,
            Status = scan.Status,
            ProgressPercent = progress,
            Title = title,
            Subtitle = subtitle,
            Tooltip = tooltip,
            VisualState = visualState
        };
    }

    public static int EstimateProgressPercent(DesktopScanState? scan)
    {
        if (scan is null)
        {
            return 0;
        }

        if (scan.IsFinished)
        {
            return 100;
        }

        return scan.Status switch
        {
            "QUEUED" => 12,
            "PREPARING" => 24,
            "RUNNING" => Math.Min(92, 34 + (scan.Timeline.Count * 8)),
            "AWAITING_UPLOAD" => 46,
            _ => Math.Min(88, 20 + (scan.Timeline.Count * 6))
        };
    }

    public static string ResolveModeLabel(string mode) => mode switch
    {
        "quick" or "QUICK" => "Быстрая",
        "deep" or "FULL" => "Глубокая",
        "selective" or "SELECTIVE" => "Выборочная",
        "app" or "ARTIFACT" => "Проверка программы",
        _ => "Проверка"
    };

    public static string ResolveStatusLabel(string status) => status switch
    {
        "QUEUED" => "В очереди",
        "PREPARING" => "Подготовка",
        "RUNNING" => "Идёт проверка",
        "AWAITING_UPLOAD" => "Ожидается загрузка",
        "COMPLETED" => "Проверка завершена",
        "FAILED" => "Проверка завершилась ошибкой",
        "CANCELLED" => "Проверка отменена",
        _ => "Проверка"
    };

    private static TrayScanVisualState ResolveVisualState(string status) => status switch
    {
        "QUEUED" or "PREPARING" => TrayScanVisualState.Preparing,
        "RUNNING" => TrayScanVisualState.Running,
        "AWAITING_UPLOAD" => TrayScanVisualState.AwaitingUpload,
        "COMPLETED" => TrayScanVisualState.Completed,
        "FAILED" => TrayScanVisualState.Failed,
        "CANCELLED" => TrayScanVisualState.Cancelled,
        _ => TrayScanVisualState.Idle
    };
}
