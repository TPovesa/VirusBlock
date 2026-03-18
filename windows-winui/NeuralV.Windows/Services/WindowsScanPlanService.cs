using System.Diagnostics;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using NeuralV.Windows.Models;

namespace NeuralV.Windows.Services;

public static class WindowsScanPlanService
{
    private static readonly string[] RelatedChildDirectories =
    [
        "bin",
        "lib",
        "libs",
        "runtime",
        "runtimes",
        "plugins",
        "modules",
        "resources",
        "Resources",
        "support",
        "support files",
        "Dependencies"
    ];

    private static readonly string[] AutorunRegistryLocations =
    [
        @"Software\Microsoft\Windows\CurrentVersion\Run",
        @"Software\Microsoft\Windows\CurrentVersion\RunOnce",
        @"Software\Microsoft\Windows\CurrentVersion\RunServices",
        @"Software\Microsoft\Windows\CurrentVersion\RunServicesOnce",
        @"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run",
        @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
        @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce",
        @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run"
    ];

    private static readonly HashSet<string> PayloadExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".dll", ".msi", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jar", ".scr", ".hta", ".com", ".sys", ".drv", ".ocx"
    };

    private static readonly HashSet<string> LauncherFileNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "cmd.exe",
        "powershell.exe",
        "pwsh.exe",
        "conhost.exe",
        "wscript.exe",
        "cscript.exe",
        "rundll32.exe",
        "regsvr32.exe",
        "mshta.exe",
        "msiexec.exe"
    };

    private static readonly HashSet<string> ExcludedInventoryDirectories = new(StringComparer.OrdinalIgnoreCase)
    {
        "cache",
        "caches",
        "temp",
        "tmp",
        "logs",
        "log",
        "packages",
        "package cache",
        "crashdumps",
        "diagnostics",
        "microsoft",
        "microsoftedge",
        "windows",
        "windowsapps",
        "assembly",
        "assemblytemp"
    };

    private static readonly Regex QuotedPathRegex = new(
        "\"(?<path>(?:[A-Za-z]:\\\\|\\\\\\\\)[^\"]+)\"",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    private static readonly Regex FileSystemPathRegex = new(
        @"(?<path>(?:[A-Za-z]:\\|\\\\)[^""\r\n]+?\.(?:exe|dll|msi|bat|cmd|ps1|vbs|js|jar|scr|hta|com|sys|drv|ocx))",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    public static WindowsScanPlan BuildSmartCoveragePlan(
        string mode = "deep",
        string artifactKind = "filesystem",
        string? targetName = null,
        string? targetPath = null)
    {
        var seeds = BuildSmartCoverageSeeds();
        var coverageRoots = BuildSmartCoverageRoots(seeds);
        return CreatePlan(
            mode,
            artifactKind,
            targetName,
            targetPath,
            DesktopCoverageMode.SmartCoverage,
            coverageRoots);
    }

    public static WindowsScanPlan BuildFullDiskPlan(
        string mode = "deep",
        string artifactKind = "filesystem",
        string? targetName = null,
        string? targetPath = null)
    {
        var coverageRoots = BuildDriveCoverageRoots();
        return CreatePlan(
            mode,
            artifactKind,
            targetName,
            targetPath,
            DesktopCoverageMode.FullDisk,
            coverageRoots);
    }

    public static WindowsScanPlan BuildProgramOrFilePlan(
        string mode,
        string artifactKind,
        string targetPath,
        string? targetName = null,
        DesktopCoverageMode coverageMode = DesktopCoverageMode.SmartCoverage)
    {
        var coverageRoots = coverageMode == DesktopCoverageMode.FullDisk
            ? BuildDriveCoverageRoots()
            : BuildSmartCoverageRoots(BuildSmartCoverageSeeds());

        var primaryRoots = new List<WindowsScanRoot>(coverageRoots);
        AddTargetRoot(primaryRoots, artifactKind, targetPath);

        return CreatePlan(
            mode,
            artifactKind,
            targetName,
            targetPath,
            coverageMode,
            primaryRoots);
    }

    public static IReadOnlyList<WindowsScanRoot> BuildSmartCoverageRoots() =>
        BuildSmartCoverageRoots(null);

    public static IReadOnlyList<WindowsScanRoot> BuildSmartCoverageRoots(IReadOnlyList<WindowsScanSeed>? seeds)
    {
        var roots = new List<WindowsScanRoot>();

        AddKnownCoverageRoots(roots);

        foreach (var installRoot in BuildInstallRoots())
        {
            AddExistingRoot(roots, WindowsScanRootKind.Custom, installRoot, $"Ярлыки и точки запуска: {Path.GetFileName(installRoot)}");
        }

        foreach (var seed in seeds ?? BuildSmartCoverageSeeds())
        {
            AddSeedRoot(roots, seed);

            foreach (var relatedRoot in BuildRelatedBinaryRoots(seed.Path))
            {
                AddExistingRoot(
                    roots,
                    WindowsScanRootKind.RelatedBinaryRoot,
                    relatedRoot,
                    $"Связанные файлы и библиотеки: {seed.Name}");
            }
        }

        return roots
            .GroupBy(root => NormalizePathKey(root.Path), StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToArray();
    }

    public static IReadOnlyList<WindowsScanRoot> BuildMetadataRoots()
    {
        return
        [
            new WindowsScanRoot
            {
                Kind = WindowsScanRootKind.ServicesMetadata,
                Path = "metadata://windows/services",
                Label = "Службы Windows",
                Exists = true,
                IsMetadataOnly = true
            },
            new WindowsScanRoot
            {
                Kind = WindowsScanRootKind.ScheduledTasksMetadata,
                Path = "metadata://windows/tasks",
                Label = "Планировщик заданий",
                Exists = true,
                IsMetadataOnly = true
            }
        ];
    }

    public static IReadOnlyList<string> BuildInstallRoots()
    {
        var roots = new List<string>();
        AddIfDirectoryExists(roots, Environment.GetFolderPath(Environment.SpecialFolder.StartMenu));
        AddIfDirectoryExists(roots, Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu));
        AddIfDirectoryExists(roots, Environment.GetFolderPath(Environment.SpecialFolder.Startup));
        AddIfDirectoryExists(roots, Environment.GetFolderPath(Environment.SpecialFolder.CommonStartup));
        AddIfDirectoryExists(roots, Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
        AddIfDirectoryExists(roots, Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory));

        var quickLaunchRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Microsoft",
            "Internet Explorer",
            "Quick Launch",
            "User Pinned",
            "TaskBar");
        AddIfDirectoryExists(roots, quickLaunchRoot);

        return roots
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public static IReadOnlyList<WindowsScanSeed> BuildSmartCoverageSeeds()
    {
        var seeds = new List<WindowsScanSeed>();
        seeds.AddRange(EnumeratePackageInventorySeeds());
        seeds.AddRange(EnumerateShortcutSeeds());
        seeds.AddRange(EnumerateAutorunSeeds());
        seeds.AddRange(EnumerateServiceSeeds());
        seeds.AddRange(EnumerateScheduledTaskSeeds());

        return seeds
            .Where(seed => !string.IsNullOrWhiteSpace(seed.Path))
            .GroupBy(
                seed => $"{seed.Kind}|{NormalizePathKey(seed.Path)}|{NormalizePathKey(seed.RootPath)}|{NormalizePathKey(seed.SourcePath)}",
                StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToArray();
    }

    public static IReadOnlyList<string> BuildRelatedBinaryRoots(string? targetPath)
    {
        if (string.IsNullOrWhiteSpace(targetPath))
        {
            return Array.Empty<string>();
        }

        var roots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var baseDirectory = ResolveBaseDirectory(targetPath);
        if (string.IsNullOrWhiteSpace(baseDirectory))
        {
            return Array.Empty<string>();
        }

        AddDirectoryIfExists(roots, baseDirectory);

        var current = new DirectoryInfo(baseDirectory);
        for (var depth = 0; depth < 4 && current is not null; depth++, current = current.Parent)
        {
            AddDirectoryIfExists(roots, current.FullName);

            foreach (var childName in RelatedChildDirectories)
            {
                AddDirectoryIfExists(roots, Path.Combine(current.FullName, childName));
            }

            if (current.Parent is null || current.Parent.FullName == current.Root.FullName)
            {
                break;
            }
        }

        foreach (var candidateName in CollectCandidateNames(targetPath, baseDirectory))
        {
            foreach (var installRoot in EnumerateCandidateInstallRoots())
            {
                AddDirectoryIfExists(roots, Path.Combine(installRoot, candidateName));
            }
        }

        return roots.ToArray();
    }

    public static IReadOnlyList<string> ExtractExecutablePaths(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return Array.Empty<string>();
        }

        raw = Environment.ExpandEnvironmentVariables(raw.Trim());

        var candidates = new List<string>();
        AddPathCandidate(candidates, raw);

        foreach (Match match in QuotedPathRegex.Matches(raw))
        {
            AddPathCandidate(candidates, match.Groups["path"].Value);
        }

        foreach (Match match in FileSystemPathRegex.Matches(raw))
        {
            AddPathCandidate(candidates, match.Groups["path"].Value);
        }

        if (candidates.Count == 0)
        {
            TryAddTokenizedPaths(candidates, raw);
        }

        var distinct = candidates
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var nonLauncherCandidates = distinct
            .Where(path => !IsLauncherBinary(path))
            .ToArray();

        return nonLauncherCandidates.Length > 0
            ? nonLauncherCandidates
            : distinct;
    }

    public static string? ExtractExecutablePath(string? raw) =>
        ExtractExecutablePaths(raw).FirstOrDefault();

    private static WindowsScanPlan CreatePlan(
        string mode,
        string artifactKind,
        string? targetName,
        string? targetPath,
        DesktopCoverageMode coverageMode,
        IReadOnlyList<WindowsScanRoot> coverageRoots)
    {
        var normalizedTargetPath = targetPath ?? string.Empty;
        var normalizedTargetName = !string.IsNullOrWhiteSpace(targetName)
            ? targetName
            : ResolveTargetName(normalizedTargetPath, artifactKind);

        return new WindowsScanPlan
        {
            Mode = string.IsNullOrWhiteSpace(mode) ? "deep" : mode,
            ArtifactKind = string.IsNullOrWhiteSpace(artifactKind) ? "filesystem" : artifactKind,
            TargetName = normalizedTargetName,
            TargetPath = normalizedTargetPath,
            CoverageMode = coverageMode,
            CoverageRoots = coverageRoots,
            MetadataRoots = BuildMetadataRoots(),
            InstallRoots = BuildInstallRoots(),
            RelatedBinaryRoots = BuildPlanRelatedRoots(normalizedTargetPath, coverageRoots)
        };
    }

    private static IReadOnlyList<WindowsScanRoot> BuildDriveCoverageRoots()
    {
        return DriveInfo.GetDrives()
            .Where(drive => drive.IsReady && drive.DriveType is DriveType.Fixed or DriveType.Removable)
            .Select(drive => new WindowsScanRoot
            {
                Kind = WindowsScanRootKind.DriveRoot,
                Path = drive.RootDirectory.FullName,
                Label = $"Диск {drive.Name.TrimEnd(Path.DirectorySeparatorChar)}",
                Exists = true,
                IsMetadataOnly = false
            })
            .ToArray();
    }

    private static void AddKnownCoverageRoots(ICollection<WindowsScanRoot> roots)
    {
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var roamingAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

        AddExistingRoot(roots, WindowsScanRootKind.UserProfile, userProfile, "Профиль пользователя");
        AddExistingRoot(roots, WindowsScanRootKind.Desktop, Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Рабочий стол");
        AddExistingRoot(roots, WindowsScanRootKind.CommonDesktop, Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), "Общий рабочий стол");
        AddExistingRoot(roots, WindowsScanRootKind.Downloads, Path.Combine(userProfile, "Downloads"), "Загрузки");
        AddExistingRoot(roots, WindowsScanRootKind.Documents, Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Документы");
        AddExistingRoot(roots, WindowsScanRootKind.LocalAppData, localAppData, "Local AppData");
        AddExistingRoot(roots, WindowsScanRootKind.LocalAppPrograms, Path.Combine(localAppData, "Programs"), "Local AppData Programs");
        AddExistingRoot(roots, WindowsScanRootKind.RoamingAppData, roamingAppData, "Roaming AppData");
        AddExistingRoot(roots, WindowsScanRootKind.ProgramData, programData, "ProgramData");
        AddExistingRoot(roots, WindowsScanRootKind.ProgramFiles, programFiles, "Program Files");
        AddExistingRoot(roots, WindowsScanRootKind.ProgramFilesX86, programFilesX86, "Program Files (x86)");
        AddExistingRoot(roots, WindowsScanRootKind.CommonFiles, Path.Combine(programFiles, "Common Files"), "Common Files");
        AddExistingRoot(roots, WindowsScanRootKind.CommonFilesX86, Path.Combine(programFilesX86, "Common Files"), "Common Files (x86)");
        AddExistingRoot(roots, WindowsScanRootKind.StartMenu, Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Меню Пуск");
        AddExistingRoot(roots, WindowsScanRootKind.CommonStartMenu, Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu), "Общее меню Пуск");
        AddExistingRoot(roots, WindowsScanRootKind.Startup, Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Автозагрузка пользователя");
        AddExistingRoot(roots, WindowsScanRootKind.CommonStartup, Environment.GetFolderPath(Environment.SpecialFolder.CommonStartup), "Общая автозагрузка");
    }

    private static IEnumerable<WindowsScanSeed> EnumeratePackageInventorySeeds()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var roamingAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var inventoryRoots = new (string? Path, string Label, int Limit)[]
        {
            (Path.Combine(localAppData, "Programs"), "Local AppData Programs", 96),
            (Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Program Files", 80),
            (Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Program Files (x86)", 80),
            (Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ProgramData", 72),
            (localAppData, "Local AppData", 64),
            (roamingAppData, "Roaming AppData", 48)
        };

        foreach (var (path, label, limit) in inventoryRoots)
        {
            if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
            {
                continue;
            }

            foreach (var directory in SafeEnumerateDirectories(path, limit))
            {
                var directoryName = Path.GetFileName(directory);
                if (string.IsNullOrWhiteSpace(directoryName) || ExcludedInventoryDirectories.Contains(directoryName))
                {
                    continue;
                }

                var representativeBinary = FindRepresentativeBinary(directory, 2, 24);
                if (string.IsNullOrWhiteSpace(representativeBinary))
                {
                    continue;
                }

                yield return new WindowsScanSeed
                {
                    Kind = WindowsScanSeedKind.InstalledProgram,
                    Name = directoryName,
                    Path = representativeBinary,
                    RootPath = directory,
                    Source = label
                };
            }
        }
    }

    private static IEnumerable<WindowsScanSeed> EnumerateShortcutSeeds()
    {
        foreach (var root in BuildInstallRoots())
        {
            foreach (var shortcut in SafeEnumerateFiles(root, "*.lnk", SearchOption.AllDirectories, 96))
            {
                var target = ResolveShortcutTarget(shortcut);
                foreach (var path in ExtractExecutablePaths(target))
                {
                    yield return new WindowsScanSeed
                    {
                        Kind = WindowsScanSeedKind.Shortcut,
                        Name = Path.GetFileName(shortcut),
                        Path = path,
                        RootPath = ResolveBaseDirectory(path) ?? string.Empty,
                        Source = $"Ярлык {Path.GetFileName(shortcut)}",
                        SourcePath = shortcut
                    };
                }
            }
        }
    }

    private static IEnumerable<WindowsScanSeed> EnumerateAutorunSeeds()
    {
        foreach (var (hive, hiveName) in new[] { (Registry.CurrentUser, "HKCU"), (Registry.LocalMachine, "HKLM") })
        {
            foreach (var location in AutorunRegistryLocations)
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
                    foreach (var path in ExtractExecutablePaths(raw))
                    {
                        yield return new WindowsScanSeed
                        {
                            Kind = WindowsScanSeedKind.Autorun,
                            Name = valueName,
                            Path = path,
                            RootPath = ResolveBaseDirectory(path) ?? string.Empty,
                            Source = $@"Автозапуск {hiveName}\{location}",
                            SourcePath = $@"{hiveName}\{location}\{valueName}"
                        };
                    }
                }
            }
        }
    }

    private static IEnumerable<WindowsScanSeed> EnumerateServiceSeeds()
    {
        ServiceController[] services;
        try
        {
            services = ServiceController.GetServices();
        }
        catch
        {
            services = Array.Empty<ServiceController>();
        }

        foreach (var service in services)
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

            foreach (var path in ExtractExecutablePaths(imagePath))
            {
                yield return new WindowsScanSeed
                {
                    Kind = WindowsScanSeedKind.Service,
                    Name = service.DisplayName,
                    Path = path,
                    RootPath = ResolveBaseDirectory(path) ?? string.Empty,
                    Source = $"Служба {service.ServiceName}"
                };
            }
        }
    }

    private static IEnumerable<WindowsScanSeed> EnumerateScheduledTaskSeeds()
    {
        var seeds = new List<WindowsScanSeed>();
        Process? process = null;

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

            process = Process.Start(psi);
            if (process is null)
            {
                return seeds;
            }

            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(5000);

            using var reader = new StringReader(output);
            _ = reader.ReadLine();

            string? line;
            while ((line = reader.ReadLine()) is not null)
            {
                var columns = ParseCsvLine(line);
                if (columns.Count < 19)
                {
                    continue;
                }

                var name = columns[0];
                var taskToRun = columns[18];
                foreach (var path in ExtractExecutablePaths(taskToRun))
                {
                    seeds.Add(new WindowsScanSeed
                    {
                        Kind = WindowsScanSeedKind.ScheduledTask,
                        Name = name,
                        Path = path,
                        RootPath = ResolveBaseDirectory(path) ?? string.Empty,
                        Source = $"Планировщик задач {name}"
                    });
                }
            }
        }
        catch
        {
        }
        finally
        {
            process?.Dispose();
        }

        return seeds;
    }

    private static string? FindRepresentativeBinary(string root, int maxDepth, int maxDirectories)
    {
        return EnumerateBinaryCandidates(root, maxDepth, maxDirectories, 24)
            .OrderByDescending(candidate => GetExtensionPriority(candidate.Path))
            .ThenByDescending(candidate => candidate.Timestamp)
            .Select(candidate => candidate.Path)
            .FirstOrDefault();
    }

    private static IEnumerable<(string Path, DateTime Timestamp)> EnumerateBinaryCandidates(
        string root,
        int maxDepth,
        int maxDirectories,
        int limit)
    {
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
        {
            yield break;
        }

        var queue = new Queue<(string Directory, int Depth)>();
        queue.Enqueue((root, 0));
        var visitedDirectories = 0;
        var emitted = 0;

        while (queue.Count > 0 && visitedDirectories < maxDirectories && emitted < limit)
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

                yield return (file, SafeGetLastWriteTimeUtc(file));
                emitted++;
                if (emitted >= limit)
                {
                    yield break;
                }
            }

            if (depth >= maxDepth)
            {
                continue;
            }

            IEnumerable<string> directories;
            try
            {
                directories = Directory.EnumerateDirectories(directory, "*", SearchOption.TopDirectoryOnly);
            }
            catch
            {
                continue;
            }

            foreach (var childDirectory in directories.Take(24))
            {
                queue.Enqueue((childDirectory, depth + 1));
            }
        }
    }

    private static void AddSeedRoot(ICollection<WindowsScanRoot> roots, WindowsScanSeed seed)
    {
        var rootKind = seed.Kind switch
        {
            WindowsScanSeedKind.Shortcut => WindowsScanRootKind.ShortcutTarget,
            WindowsScanSeedKind.Autorun => WindowsScanRootKind.AutorunTarget,
            WindowsScanSeedKind.Service => WindowsScanRootKind.ServiceTarget,
            WindowsScanSeedKind.ScheduledTask => WindowsScanRootKind.ScheduledTaskTarget,
            _ => WindowsScanRootKind.PackageInstallRoot
        };

        var rootPath = !string.IsNullOrWhiteSpace(seed.RootPath)
            ? seed.RootPath
            : seed.Path;

        var label = seed.Kind switch
        {
            WindowsScanSeedKind.Shortcut => $"Ярлык: {seed.Name}",
            WindowsScanSeedKind.Autorun => $"Автозапуск: {seed.Name}",
            WindowsScanSeedKind.Service => $"Служба: {seed.Name}",
            WindowsScanSeedKind.ScheduledTask => $"Задание: {seed.Name}",
            _ => $"Установка: {seed.Name}"
        };

        AddExistingRoot(roots, rootKind, rootPath, label);
    }

    private static IReadOnlyList<string> BuildPlanRelatedRoots(string? targetPath, IReadOnlyList<WindowsScanRoot> coverageRoots)
    {
        return BuildRelatedBinaryRoots(targetPath)
            .Concat(
                coverageRoots
                    .Where(root => root.Kind == WindowsScanRootKind.RelatedBinaryRoot)
                    .Select(root => root.Path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static void AddTargetRoot(ICollection<WindowsScanRoot> roots, string artifactKind, string targetPath)
    {
        if (string.IsNullOrWhiteSpace(targetPath))
        {
            return;
        }

        if (Directory.Exists(targetPath))
        {
            roots.Add(new WindowsScanRoot
            {
                Kind = WindowsScanRootKind.TargetDirectory,
                Path = targetPath,
                Label = "Выбранная папка программы",
                Exists = true
            });
            return;
        }

        if (File.Exists(targetPath))
        {
            roots.Add(new WindowsScanRoot
            {
                Kind = artifactKind == "file" ? WindowsScanRootKind.TargetFile : WindowsScanRootKind.TargetDirectory,
                Path = targetPath,
                Label = "Выбранный файл программы",
                Exists = true
            });
        }
    }

    private static string ResolveTargetName(string targetPath, string artifactKind)
    {
        if (string.IsNullOrWhiteSpace(targetPath))
        {
            return artifactKind == "filesystem" ? Environment.MachineName : "Выбранный объект";
        }

        if (Directory.Exists(targetPath))
        {
            return new DirectoryInfo(targetPath).Name;
        }

        if (File.Exists(targetPath))
        {
            return Path.GetFileName(targetPath);
        }

        return Path.GetFileName(targetPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
    }

    private static string? ResolveBaseDirectory(string targetPath)
    {
        var normalized = NormalizePathCandidate(targetPath);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return null;
        }

        if (Directory.Exists(normalized))
        {
            return normalized;
        }

        if (File.Exists(normalized))
        {
            return Path.GetDirectoryName(normalized);
        }

        var parent = Path.GetDirectoryName(normalized);
        return !string.IsNullOrWhiteSpace(parent) && Directory.Exists(parent)
            ? parent
            : null;
    }

    private static IEnumerable<string> CollectCandidateNames(string targetPath, string baseDirectory)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var fileName = Path.GetFileNameWithoutExtension(targetPath);
        if (!string.IsNullOrWhiteSpace(fileName))
        {
            names.Add(fileName);
        }

        var directoryName = Path.GetFileName(baseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        if (!string.IsNullOrWhiteSpace(directoryName))
        {
            names.Add(directoryName);
        }

        var parentName = Path.GetFileName(Path.GetDirectoryName(baseDirectory)?.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        if (!string.IsNullOrWhiteSpace(parentName) && RelatedChildDirectories.Contains(directoryName, StringComparer.OrdinalIgnoreCase))
        {
            names.Add(parentName);
        }

        return names;
    }

    private static IEnumerable<string> EnumerateCandidateInstallRoots()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        return
        [
            Path.Combine(localAppData, "Programs"),
            localAppData,
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Common Files"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Common Files")
        ]
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase);
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

    private static List<string> ParseCsvLine(string line)
    {
        var result = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (ch == '"')
            {
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                {
                    current.Append('"');
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
                result.Add(current.ToString());
                current.Clear();
                continue;
            }

            current.Append(ch);
        }

        result.Add(current.ToString());
        return result;
    }

    private static void AddPathCandidate(ICollection<string> candidates, string? path)
    {
        var normalized = NormalizePathCandidate(path);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return;
        }

        var extension = Path.GetExtension(normalized);
        if (PayloadExtensions.Contains(extension) || File.Exists(normalized))
        {
            candidates.Add(normalized);
        }
    }

    private static void TryAddTokenizedPaths(ICollection<string> candidates, string raw)
    {
        var current = new StringBuilder();
        foreach (var ch in raw)
        {
            if (ch == '"' || ch == '\'')
            {
                continue;
            }

            if (char.IsWhiteSpace(ch))
            {
                AddPathCandidate(candidates, current.ToString());
                current.Clear();
                continue;
            }

            current.Append(ch);
        }

        AddPathCandidate(candidates, current.ToString());
    }

    private static string? NormalizePathCandidate(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        path = Environment.ExpandEnvironmentVariables(path.Trim().Trim('"', '\'', ','));
        if (path.StartsWith(@"\\?\"))
        {
            path = path[4..];
        }

        var commaIndex = path.IndexOf(',');
        if (commaIndex > 2 && !path.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase))
        {
            var beforeComma = path[..commaIndex];
            if (PayloadExtensions.Contains(Path.GetExtension(beforeComma)))
            {
                path = beforeComma;
            }
        }

        return string.IsNullOrWhiteSpace(path) ? null : path.Trim();
    }

    private static IEnumerable<string> SafeEnumerateDirectories(string root, int limit)
    {
        try
        {
            return Directory.EnumerateDirectories(root, "*", SearchOption.TopDirectoryOnly)
                .Take(limit)
                .ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static IEnumerable<string> SafeEnumerateFiles(string root, string pattern, SearchOption searchOption, int limit)
    {
        try
        {
            return Directory.EnumerateFiles(root, pattern, searchOption)
                .Take(limit)
                .ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static bool IsLauncherBinary(string path) =>
        LauncherFileNames.Contains(Path.GetFileName(path));

    private static bool LooksExecutable(string path) =>
        PayloadExtensions.Contains(Path.GetExtension(path));

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

    private static string NormalizePathKey(string? path)
    {
        var normalized = NormalizePathCandidate(path);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return string.Empty;
        }

        try
        {
            return Path.GetFullPath(normalized);
        }
        catch
        {
            return normalized;
        }
    }

    private static void AddExistingRoot(ICollection<WindowsScanRoot> roots, WindowsScanRootKind kind, string? path, string label)
    {
        var directory = ResolveBaseDirectory(path ?? string.Empty);
        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
        {
            return;
        }

        roots.Add(new WindowsScanRoot
        {
            Kind = kind,
            Path = directory,
            Label = label,
            Exists = true,
            IsMetadataOnly = false
        });
    }

    private static void AddIfDirectoryExists(ICollection<string> roots, string? path)
    {
        if (!string.IsNullOrWhiteSpace(path) && Directory.Exists(path))
        {
            roots.Add(path);
        }
    }

    private static void AddDirectoryIfExists(ICollection<string> roots, string? path)
    {
        if (!string.IsNullOrWhiteSpace(path) && Directory.Exists(path))
        {
            roots.Add(path);
        }
    }
}
