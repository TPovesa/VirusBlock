using NeuralV.Windows.Models;

namespace NeuralV.Windows.Services;

public static class WindowsLocalQuickScanService
{
    private static readonly HashSet<string> RiskyExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".dll", ".msi", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jar", ".scr", ".hta", ".com", ".sys", ".drv", ".ocx"
    };

    public static DesktopScanState Run()
    {
        var startedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var timeline = new List<string> { "Запускаем локальный быстрый проход по install roots, автозапуску, сервисам, задачам и связанным Windows-зонам." };
        var findings = new List<DesktopScanFinding>();
        var graphRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var recentCutoff = DateTime.UtcNow.AddDays(-60);
        var scannedObjects = 0;

        var seeds = WindowsScanPlanService.BuildSmartCoverageSeeds();
        var coverageRoots = WindowsScanPlanService.BuildSmartCoverageRoots(seeds)
            .Where(root => !root.IsMetadataOnly && root.Exists && !string.IsNullOrWhiteSpace(root.Path))
            .ToArray();

        AppendSeedSummary(timeline, seeds);

        foreach (var seed in seeds)
        {
            scannedObjects++;
            timeline.Add(BuildSeedTimeline(seed));
            AddFinding(findings, seenPaths, graphRoots, seed.Path, BuildSeedSummary(seed));

            if (!string.IsNullOrWhiteSpace(seed.RootPath))
            {
                AddGraphRoot(graphRoots, seed.RootPath);
            }
        }

        foreach (var root in coverageRoots)
        {
            var matches = EnumerateCoverageCandidates(root, recentCutoff, 10).ToArray();
            scannedObjects += matches.Length;

            if (matches.Length > 0)
            {
                timeline.Add($"{root.Label}: нашли {matches.Length} релевантных исполняемых файлов, библиотек и скриптов.");
            }

            foreach (var match in matches.Take(4))
            {
                AddFinding(findings, seenPaths, graphRoots, match, $"Релевантный бинарный объект в зоне {root.Label}");
            }
        }

        var effectiveCoverageRoots = coverageRoots
            .Select(item => item.Path)
            .Concat(graphRoots)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var surfacedFindings = findings.Take(18).ToArray();
        var completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var message = surfacedFindings.Length > 0
            ? $"Быстрая проверка охватила {effectiveCoverageRoots.Length} корней и собрала {surfacedFindings.Length} значимых точек для дальнейшего анализа."
            : $"Быстрая проверка охватила {effectiveCoverageRoots.Length} корней, явных совпадений не найдено.";

        timeline.Add($"Покрытие: корней={effectiveCoverageRoots.Length}, объектов={scannedObjects}, находок={surfacedFindings.Length}.");

        return new DesktopScanState
        {
            Id = Guid.NewGuid().ToString("N"),
            Platform = "windows",
            Mode = "QUICK",
            Status = "COMPLETED",
            Verdict = surfacedFindings.Length > 0 ? "Требуется дополнительная проверка" : "Совпадений не найдено",
            Message = message,
            RiskScore = surfacedFindings.Length == 0 ? 0 : Math.Min(84, 28 + (surfacedFindings.Length * 4)),
            SurfacedFindings = surfacedFindings.Length,
            HiddenFindings = Math.Max(0, findings.Count - surfacedFindings.Length),
            StartedAt = startedAt,
            CompletedAt = completedAt,
            Timeline = timeline.Distinct().Take(160).ToArray(),
            Findings = surfacedFindings
        };
    }

    private static void AppendSeedSummary(ICollection<string> timeline, IReadOnlyCollection<WindowsScanSeed> seeds)
    {
        var installedPrograms = seeds.Count(seed => seed.Kind == WindowsScanSeedKind.InstalledProgram);
        var shortcuts = seeds.Count(seed => seed.Kind == WindowsScanSeedKind.Shortcut);
        var autoruns = seeds.Count(seed => seed.Kind == WindowsScanSeedKind.Autorun);
        var services = seeds.Count(seed => seed.Kind == WindowsScanSeedKind.Service);
        var scheduledTasks = seeds.Count(seed => seed.Kind == WindowsScanSeedKind.ScheduledTask);

        timeline.Add(
            $"Точки входа: installs={installedPrograms}, ярлыки={shortcuts}, автозапуск={autoruns}, службы={services}, задания={scheduledTasks}.");
    }

    private static string BuildSeedTimeline(WindowsScanSeed seed)
    {
        return seed.Kind switch
        {
            WindowsScanSeedKind.Shortcut => $"Ярлык: {seed.Name} -> {seed.Path}",
            WindowsScanSeedKind.Autorun => $"Автозапуск: {seed.Name} -> {seed.Path}",
            WindowsScanSeedKind.Service => $"Служба: {seed.Name} -> {seed.Path}",
            WindowsScanSeedKind.ScheduledTask => $"Задание: {seed.Name} -> {seed.Path}",
            _ => $"Установка: {seed.Name} -> {seed.Path}"
        };
    }

    private static string BuildSeedSummary(WindowsScanSeed seed)
    {
        return seed.Kind switch
        {
            WindowsScanSeedKind.Shortcut => $"Целевая программа из ярлыка {seed.Name}",
            WindowsScanSeedKind.Autorun => $"Объект автозапуска {seed.Name}",
            WindowsScanSeedKind.Service => $"Исполняемый файл службы {seed.Name}",
            WindowsScanSeedKind.ScheduledTask => $"Исполняемый файл задания {seed.Name}",
            _ => $"Установленная программа {seed.Name}"
        };
    }

    private static IEnumerable<string> EnumerateCoverageCandidates(WindowsScanRoot root, DateTime recentCutoffUtc, int limit)
    {
        if (string.IsNullOrWhiteSpace(root.Path))
        {
            return Array.Empty<string>();
        }

        if (File.Exists(root.Path))
        {
            return LooksExecutable(root.Path)
                ? [root.Path]
                : Array.Empty<string>();
        }

        if (!Directory.Exists(root.Path))
        {
            return Array.Empty<string>();
        }

        var (maxDepth, maxDirectories) = root.Kind switch
        {
            WindowsScanRootKind.ProgramFiles or
            WindowsScanRootKind.ProgramFilesX86 or
            WindowsScanRootKind.ProgramData or
            WindowsScanRootKind.LocalAppData or
            WindowsScanRootKind.RoamingAppData or
            WindowsScanRootKind.UserProfile => (2, 72),

            WindowsScanRootKind.LocalAppPrograms or
            WindowsScanRootKind.CommonFiles or
            WindowsScanRootKind.CommonFilesX86 or
            WindowsScanRootKind.PackageInstallRoot or
            WindowsScanRootKind.ShortcutTarget or
            WindowsScanRootKind.AutorunTarget or
            WindowsScanRootKind.ServiceTarget or
            WindowsScanRootKind.ScheduledTaskTarget or
            WindowsScanRootKind.RelatedBinaryRoot => (3, 48),

            WindowsScanRootKind.StartMenu or
            WindowsScanRootKind.CommonStartMenu or
            WindowsScanRootKind.Startup or
            WindowsScanRootKind.CommonStartup or
            WindowsScanRootKind.Desktop or
            WindowsScanRootKind.CommonDesktop or
            WindowsScanRootKind.Documents or
            WindowsScanRootKind.Downloads => (3, 36),

            _ => (2, 32)
        };

        return EnumerateRiskyFiles(root.Path, maxDepth, maxDirectories, limit * 4)
            .OrderByDescending(candidate => candidate.IsRecent)
            .ThenByDescending(candidate => candidate.Priority)
            .ThenByDescending(candidate => candidate.Timestamp)
            .Select(candidate => candidate.Path)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(limit)
            .ToArray();

        IEnumerable<(string Path, DateTime Timestamp, bool IsRecent, int Priority)> EnumerateRiskyFiles(
            string baseDirectory,
            int depthLimit,
            int directoryLimit,
            int candidateLimit)
        {
            var queue = new Queue<(string Directory, int Depth)>();
            queue.Enqueue((baseDirectory, 0));
            var visitedDirectories = 0;
            var emitted = 0;

            while (queue.Count > 0 && visitedDirectories < directoryLimit && emitted < candidateLimit)
            {
                var (directory, depth) = queue.Dequeue();
                visitedDirectories++;

                IEnumerable<string> files;
                try
                {
                    files = Directory.EnumerateFiles(directory, "*", SearchOption.TopDirectoryOnly);
                }
                catch
                {
                    continue;
                }

                foreach (var file in files)
                {
                    if (!LooksExecutable(file))
                    {
                        continue;
                    }

                    var timestamp = SafeGetLastWriteTimeUtc(file);
                    yield return (file, timestamp, timestamp >= recentCutoffUtc, GetExtensionPriority(file));
                    emitted++;
                    if (emitted >= candidateLimit)
                    {
                        yield break;
                    }
                }

                if (depth >= depthLimit)
                {
                    continue;
                }

                IEnumerable<string> childDirectories;
                try
                {
                    childDirectories = Directory.EnumerateDirectories(directory, "*", SearchOption.TopDirectoryOnly);
                }
                catch
                {
                    continue;
                }

                foreach (var childDirectory in childDirectories.Take(24))
                {
                    queue.Enqueue((childDirectory, depth + 1));
                }
            }
        }
    }

    private static void AddFinding(List<DesktopScanFinding> findings, HashSet<string> seenPaths, HashSet<string> graphRoots, string path, string summary)
    {
        var normalizedPath = NormalizeFullPath(path);
        if (string.IsNullOrWhiteSpace(normalizedPath) || !seenPaths.Add(normalizedPath))
        {
            return;
        }

        AddGraphRoot(graphRoots, normalizedPath);
        findings.Add(new DesktopScanFinding
        {
            Id = normalizedPath,
            Title = Path.GetFileName(normalizedPath),
            Verdict = "review",
            Summary = summary,
            Engines = Array.Empty<string>()
        });
    }

    private static void AddGraphRoot(HashSet<string> roots, string path)
    {
        var normalizedPath = NormalizeFullPath(path);
        if (string.IsNullOrWhiteSpace(normalizedPath))
        {
            return;
        }

        var baseDirectory = Directory.Exists(normalizedPath)
            ? normalizedPath
            : Path.GetDirectoryName(normalizedPath);
        if (string.IsNullOrWhiteSpace(baseDirectory) || !Directory.Exists(baseDirectory))
        {
            return;
        }

        roots.Add(baseDirectory);

        foreach (var relatedRoot in WindowsScanPlanService.BuildRelatedBinaryRoots(normalizedPath))
        {
            if (!string.IsNullOrWhiteSpace(relatedRoot))
            {
                roots.Add(relatedRoot);
            }
        }
    }

    private static string? NormalizeFullPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        path = Environment.ExpandEnvironmentVariables(path.Trim().Trim('"', '\''));
        try
        {
            return Path.GetFullPath(path);
        }
        catch
        {
            return null;
        }
    }

    private static bool LooksExecutable(string path) => RiskyExtensions.Contains(Path.GetExtension(path));

    private static int GetExtensionPriority(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".exe" => 4,
            ".dll" => 3,
            ".sys" or ".drv" or ".ocx" => 2,
            _ => 1
        };
    }

    private static DateTime SafeGetLastWriteTimeUtc(string path)
    {
        try
        {
            return File.GetLastWriteTimeUtc(path);
        }
        catch
        {
            return DateTime.MinValue;
        }
    }
}
