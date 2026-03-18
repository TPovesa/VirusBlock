using System.Diagnostics;
using System.ServiceProcess;
using Microsoft.Win32;
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
        var timeline = new List<string> { "Запускаем локальный быстрый проход по ключевым Windows-зонам." };
        var findings = new List<DesktopScanFinding>();
        var graphRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var recentCutoff = DateTime.UtcNow.AddDays(-45);
        var scannedObjects = 0;

        foreach (var root in WindowsScanPlanService.BuildSmartCoverageRoots())
        {
            if (root.IsMetadataOnly || !root.Exists || string.IsNullOrWhiteSpace(root.Path) || !Directory.Exists(root.Path))
            {
                continue;
            }

            var topDirectoryOnly = root.Kind is WindowsScanRootKind.LocalAppData or WindowsScanRootKind.RoamingAppData or WindowsScanRootKind.ProgramData or WindowsScanRootKind.ProgramFiles or WindowsScanRootKind.ProgramFilesX86;
            var matches = EnumerateRecentCandidates(root.Path, recentCutoff, 20, topDirectoryOnly).ToList();
            scannedObjects += matches.Count;
            if (matches.Count > 0)
            {
                timeline.Add($"{root.Label}: нашли {matches.Count} недавних исполняемых файлов и скриптов.");
            }

            foreach (var match in matches.Take(4))
            {
                AddFinding(findings, seenPaths, graphRoots, match, $"Недавний исполняемый объект в зоне {root.Label}");
            }
        }

        foreach (var shortcut in EnumerateShortcuts())
        {
            scannedObjects++;
            timeline.Add($"Ярлык: {Path.GetFileName(shortcut.ShortcutPath)} -> {shortcut.TargetPath}");
            AddFinding(findings, seenPaths, graphRoots, shortcut.TargetPath, $"Целевая программа из ярлыка {Path.GetFileName(shortcut.ShortcutPath)}");
        }

        foreach (var autorun in EnumerateAutoruns())
        {
            scannedObjects++;
            timeline.Add($"Автозапуск: {autorun.Name} -> {autorun.Path}");
            AddFinding(findings, seenPaths, graphRoots, autorun.Path, $"Объект автозапуска {autorun.Name}");
        }

        foreach (var service in EnumerateServices())
        {
            scannedObjects++;
            timeline.Add($"Служба: {service.Name} -> {service.Path}");
            AddFinding(findings, seenPaths, graphRoots, service.Path, $"Исполняемый файл службы {service.Name}");
        }

        foreach (var task in EnumerateScheduledTasks())
        {
            scannedObjects++;
            timeline.Add($"Задание: {task.Name} -> {task.Path}");
            AddFinding(findings, seenPaths, graphRoots, task.Path, $"Исполняемый файл задания {task.Name}");
        }

        var packageInventory = EnumeratePackageInventory();
        timeline.Add($"Инвентарь программ: {packageInventory.Count} записей из install roots.");
        foreach (var package in packageInventory.Take(12))
        {
            if (!string.IsNullOrWhiteSpace(package.Path))
            {
                AddFinding(findings, seenPaths, graphRoots, package.Path!, $"Установленная программа {package.Name}");
            }
            else if (!string.IsNullOrWhiteSpace(package.InstallRoot))
            {
                AddGraphRoot(graphRoots, package.InstallRoot!);
            }
        }

        var coverageRoots = graphRoots.Count == 0
            ? WindowsScanPlanService.BuildSmartCoverageRoots().Select(item => item.Path)
            : graphRoots.AsEnumerable();
        var surfacedFindings = findings.Take(18).ToArray();
        var completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var message = surfacedFindings.Length > 0
            ? $"Быстрая проверка охватила {coverageRoots.Count()} корней и собрала {surfacedFindings.Length} значимых точек для дальнейшего анализа."
            : $"Быстрая проверка охватила {coverageRoots.Count()} корней, явных совпадений не найдено.";

        timeline.Add($"Покрытие: корней={coverageRoots.Count()}, объектов={scannedObjects}, находок={surfacedFindings.Length}.");

        return new DesktopScanState
        {
            Id = Guid.NewGuid().ToString("N"),
            Platform = "windows",
            Mode = "QUICK",
            Status = "COMPLETED",
            Verdict = surfacedFindings.Length > 0 ? "Требуется дополнительная проверка" : "Совпадений не найдено",
            Message = message,
            RiskScore = surfacedFindings.Length == 0 ? 0 : Math.Min(78, 24 + (surfacedFindings.Length * 4)),
            SurfacedFindings = surfacedFindings.Length,
            HiddenFindings = Math.Max(0, findings.Count - surfacedFindings.Length),
            StartedAt = startedAt,
            CompletedAt = completedAt,
            Timeline = timeline.Distinct().Take(120).ToArray(),
            Findings = surfacedFindings
        };
    }

    private static IEnumerable<string> EnumerateRecentCandidates(string root, DateTime recentCutoffUtc, int limit, bool topDirectoryOnly)
    {
        var results = new List<(string Path, DateTime Timestamp)>();
        try
        {
            var searchOption = topDirectoryOnly ? SearchOption.TopDirectoryOnly : SearchOption.AllDirectories;
            foreach (var file in Directory.EnumerateFiles(root, "*", searchOption))
            {
                if (!RiskyExtensions.Contains(Path.GetExtension(file)))
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

                if (timestamp < recentCutoffUtc)
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

        return results.OrderByDescending(item => item.Timestamp).Select(item => item.Path);
    }

    private static IEnumerable<(string ShortcutPath, string TargetPath)> EnumerateShortcuts()
    {
        foreach (var root in WindowsScanPlanService.BuildInstallRoots())
        {
            IEnumerable<string> shortcuts;
            try
            {
                shortcuts = Directory.EnumerateFiles(root, "*.lnk", SearchOption.AllDirectories);
            }
            catch
            {
                continue;
            }

            foreach (var shortcut in shortcuts.Take(48))
            {
                var target = ResolveShortcutTarget(shortcut);
                if (!string.IsNullOrWhiteSpace(target) && LooksExecutable(target))
                {
                    yield return (shortcut, target!);
                }
            }
        }
    }

    private static string? ResolveShortcutTarget(string shortcutPath)
    {
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null)
            {
                return null;
            }
            dynamic shell = Activator.CreateInstance(shellType)!;
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            return shortcut.TargetPath as string;
        }
        catch
        {
            return null;
        }
    }

    private static IEnumerable<(string Name, string Path)> EnumerateAutoruns()
    {
        var locations = new[]
        {
            @"Software\Microsoft\Windows\CurrentVersion\Run",
            @"Software\Microsoft\Windows\CurrentVersion\RunOnce"
        };

        foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            foreach (var location in locations)
            {
                RegistryKey? key = null;
                try
                {
                    key = hive.OpenSubKey(location);
                }
                catch
                {
                }

                if (key is null)
                {
                    continue;
                }

                foreach (var valueName in key.GetValueNames())
                {
                    var raw = key.GetValue(valueName)?.ToString();
                    var path = ExtractExecutablePath(raw);
                    if (!string.IsNullOrWhiteSpace(path))
                    {
                        yield return (valueName, path!);
                    }
                }
            }
        }
    }

    private static IEnumerable<(string Name, string Path)> EnumerateServices()
    {
        foreach (var service in ServiceController.GetServices().Take(80))
        {
            string? imagePath = null;
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{service.ServiceName}");
                imagePath = key?.GetValue("ImagePath")?.ToString();
            }
            catch
            {
            }

            var executable = ExtractExecutablePath(imagePath);
            if (!string.IsNullOrWhiteSpace(executable))
            {
                yield return (service.DisplayName, executable!);
            }
        }
    }

    private static IEnumerable<(string Name, string Path)> EnumerateScheduledTasks()
    {
        var tasks = new List<(string Name, string Path)>();
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "schtasks.exe",
                Arguments = "/query /fo csv /v",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var process = Process.Start(psi);
            if (process is null)
            {
                yield break;
            }

            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(5000);
            using var reader = new StringReader(output);
            _ = reader.ReadLine();
            string? line;
            var seen = 0;
            while ((line = reader.ReadLine()) is not null && seen < 80)
            {
                var columns = ParseCsvLine(line);
                if (columns.Count < 19)
                {
                    continue;
                }
                var name = columns[0];
                var taskToRun = columns[18];
                var executable = ExtractExecutablePath(taskToRun);
                if (!string.IsNullOrWhiteSpace(executable))
                {
                    seen++;
                    tasks.Add((name, executable!));
                }
            }
        }
        catch
        {
        }

        return tasks;
    }

    private static List<PackageInventoryEntry> EnumeratePackageInventory()
    {
        var entries = new List<PackageInventoryEntry>();
        foreach (var root in WindowsScanPlanService.BuildSmartCoverageRoots().Where(item => item.Kind is WindowsScanRootKind.ProgramFiles or WindowsScanRootKind.ProgramFilesX86 or WindowsScanRootKind.LocalAppData or WindowsScanRootKind.RoamingAppData or WindowsScanRootKind.ProgramData))
        {
            if (!Directory.Exists(root.Path))
            {
                continue;
            }

            try
            {
                foreach (var directory in Directory.EnumerateDirectories(root.Path).Take(40))
                {
                    var exe = Directory.EnumerateFiles(directory, "*.exe", SearchOption.TopDirectoryOnly).FirstOrDefault();
                    entries.Add(new PackageInventoryEntry
                    {
                        Name = Path.GetFileName(directory),
                        InstallRoot = directory,
                        Path = exe,
                        Source = root.Label
                    });
                }
            }
            catch
            {
            }
        }
        return entries;
    }

    private static void AddFinding(List<DesktopScanFinding> findings, HashSet<string> seenPaths, HashSet<string> graphRoots, string path, string summary)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        path = Path.GetFullPath(path);
        if (!seenPaths.Add(path))
        {
            return;
        }

        AddGraphRoot(graphRoots, path);
        findings.Add(new DesktopScanFinding
        {
            Id = path,
            Title = Path.GetFileName(path),
            Verdict = "review",
            Summary = summary,
            Engines = Array.Empty<string>()
        });
    }

    private static void AddGraphRoot(HashSet<string> roots, string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        var fullPath = Path.GetFullPath(path);
        var baseDirectory = File.Exists(fullPath) ? Path.GetDirectoryName(fullPath) : fullPath;
        if (string.IsNullOrWhiteSpace(baseDirectory))
        {
            return;
        }

        roots.Add(baseDirectory);
        var related = WindowsScanPlanService.BuildRelatedBinaryRoots(fullPath);
        foreach (var relatedRoot in related)
        {
            if (!string.IsNullOrWhiteSpace(relatedRoot))
            {
                roots.Add(relatedRoot);
            }
        }
    }

    private static bool LooksExecutable(string path) => RiskyExtensions.Contains(Path.GetExtension(path));

    private static string? ExtractExecutablePath(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        raw = raw.Trim();
        if (raw.StartsWith('"'))
        {
            var closing = raw.IndexOf('"', 1);
            if (closing > 1)
            {
                raw = raw[1..closing];
            }
        }
        else
        {
            raw = raw.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? raw;
        }

        raw = Environment.ExpandEnvironmentVariables(raw.Trim('"'));
        return string.IsNullOrWhiteSpace(raw) ? null : raw;
    }

    private static List<string> ParseCsvLine(string line)
    {
        var result = new List<string>();
        var current = new List<char>();
        var inQuotes = false;

        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (ch == '"')
            {
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                {
                    current.Add('"');
                    i++;
                }
                else
                {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (ch == ',' && !inQuotes)
            {
                result.Add(new string(current.ToArray()));
                current.Clear();
                continue;
            }

            current.Add(ch);
        }

        result.Add(new string(current.ToArray()));
        return result;
    }

    private sealed class PackageInventoryEntry
    {
        public string Name { get; init; } = string.Empty;
        public string? Path { get; init; }
        public string? InstallRoot { get; init; }
        public string? Source { get; init; }
    }
}
