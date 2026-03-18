using System.Reflection;

namespace NeuralV.Windows;

public static class VersionInfo
{
    public static string Current
    {
        get
        {
            var informational = Assembly.GetExecutingAssembly()
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
                .InformationalVersion;
            if (!string.IsNullOrWhiteSpace(informational))
            {
                return informational.Split('+', 2)[0];
            }

            var version = Assembly.GetExecutingAssembly().GetName().Version;
            return version is null ? "1.5.11" : $"{version.Major}.{version.Minor}.{version.Build}";
        }
    }
}
