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
        "Resources"
    ];

    public static WindowsScanPlan BuildSmartCoveragePlan(
        string mode = "deep",
        string artifactKind = "filesystem",
        string? targetName = null,
        string? targetPath = null)
    {
        var coverageRoots = BuildSmartCoverageRoots();
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
            : BuildSmartCoverageRoots();

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

    public static IReadOnlyList<WindowsScanRoot> BuildSmartCoverageRoots()
    {
        var roots = new List<WindowsScanRoot>();
        AddExistingRoot(roots, WindowsScanRootKind.UserProfile, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Профиль пользователя");
        AddExistingRoot(roots, WindowsScanRootKind.Desktop, Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Рабочий стол");
        AddExistingRoot(roots, WindowsScanRootKind.Downloads, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"), "Загрузки");
        AddExistingRoot(roots, WindowsScanRootKind.Documents, Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Документы");
        AddExistingRoot(roots, WindowsScanRootKind.LocalAppData, Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Local AppData");
        AddExistingRoot(roots, WindowsScanRootKind.RoamingAppData, Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Roaming AppData");
        AddExistingRoot(roots, WindowsScanRootKind.ProgramFiles, Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Program Files");
        AddExistingRoot(roots, WindowsScanRootKind.ProgramFilesX86, Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Program Files (x86)");
        AddExistingRoot(roots, WindowsScanRootKind.StartMenu, Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Меню Пуск");
        AddExistingRoot(roots, WindowsScanRootKind.CommonStartMenu, Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu), "Общее меню Пуск");
        AddExistingRoot(roots, WindowsScanRootKind.Startup, Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Автозагрузка пользователя");
        AddExistingRoot(roots, WindowsScanRootKind.CommonStartup, Environment.GetFolderPath(Environment.SpecialFolder.CommonStartup), "Общая автозагрузка");
        return roots
            .GroupBy(root => root.Path, StringComparer.OrdinalIgnoreCase)
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
        return roots
            .Distinct(StringComparer.OrdinalIgnoreCase)
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
        for (var depth = 0; depth < 3 && current is not null; depth++, current = current.Parent)
        {
            AddDirectoryIfExists(roots, current.FullName);

            foreach (var childName in RelatedChildDirectories)
            {
                AddDirectoryIfExists(roots, Path.Combine(current.FullName, childName));
            }
        }

        var candidateName = Path.GetFileNameWithoutExtension(targetPath);
        if (!string.IsNullOrWhiteSpace(candidateName))
        {
            AddDirectoryIfExists(roots, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", candidateName));
            AddDirectoryIfExists(roots, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), candidateName));
            AddDirectoryIfExists(roots, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), candidateName));
        }

        return roots.ToArray();
    }

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
            RelatedBinaryRoots = BuildRelatedBinaryRoots(normalizedTargetPath)
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
        if (Directory.Exists(targetPath))
        {
            return targetPath;
        }

        if (File.Exists(targetPath))
        {
            return Path.GetDirectoryName(targetPath);
        }

        return null;
    }

    private static void AddExistingRoot(ICollection<WindowsScanRoot> roots, WindowsScanRootKind kind, string? path, string label)
    {
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
        {
            return;
        }

        roots.Add(new WindowsScanRoot
        {
            Kind = kind,
            Path = path,
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
