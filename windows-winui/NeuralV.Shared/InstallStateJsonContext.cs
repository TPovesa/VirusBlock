using System.Text.Json;
using System.Text.Json.Serialization;

namespace NeuralV.Windows.Services;

[JsonSourceGenerationOptions(
    JsonSerializerDefaults.Web,
    PropertyNameCaseInsensitive = true,
    WriteIndented = true)]
[JsonSerializable(typeof(InstallState))]
internal sealed partial class InstallStateJsonContext : JsonSerializerContext
{
    public static InstallState? Deserialize(string payload)
    {
        return JsonSerializer.Deserialize(payload, Default.InstallState);
    }

    public static string Serialize(InstallState state)
    {
        return JsonSerializer.Serialize(state, Default.InstallState);
    }
}
