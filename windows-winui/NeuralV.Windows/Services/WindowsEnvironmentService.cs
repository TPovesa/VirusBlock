namespace NeuralV.Windows.Services;

public static class WindowsEnvironmentService
{
    public static IReadOnlyList<string> DetectScanRoots() =>
        WindowsScanPlanService.BuildSmartCoveragePlan().ScanRoots;

    public static IReadOnlyList<string> DetectInstallRoots() =>
        WindowsScanPlanService.BuildInstallRoots();

    public static IReadOnlyList<NeuralV.Windows.Models.WindowsScanRoot> DetectSmartCoverageRoots() =>
        WindowsScanPlanService.BuildSmartCoverageRoots();

    public static IReadOnlyList<NeuralV.Windows.Models.WindowsScanRoot> DetectMetadataRoots() =>
        WindowsScanPlanService.BuildMetadataRoots();
}
