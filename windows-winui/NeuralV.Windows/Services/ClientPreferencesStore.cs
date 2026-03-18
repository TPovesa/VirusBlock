using System.Text;
using System.Text.Json;
using NeuralV.Windows.Models;

namespace NeuralV.Windows.Services;

public static class ClientPreferencesStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public static string PreferencesFilePath => Path.Combine(SessionStore.AppDirectory, "preferences.json");

    public static async Task<ClientPreferences> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(PreferencesFilePath))
        {
            return new ClientPreferences();
        }

        try
        {
            var payload = await File.ReadAllTextAsync(PreferencesFilePath, cancellationToken);
            return JsonSerializer.Deserialize<ClientPreferences>(payload, JsonOptions) ?? new ClientPreferences();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("ClientPreferencesStore.LoadAsync failed", ex);
            return new ClientPreferences();
        }
    }

    public static ClientPreferences Load()
    {
        if (!File.Exists(PreferencesFilePath))
        {
            return new ClientPreferences();
        }

        try
        {
            var payload = File.ReadAllText(PreferencesFilePath, Encoding.UTF8);
            return JsonSerializer.Deserialize<ClientPreferences>(payload, JsonOptions) ?? new ClientPreferences();
        }
        catch (Exception ex)
        {
            WindowsLog.Error("ClientPreferencesStore.Load failed", ex);
            return new ClientPreferences();
        }
    }

    public static async Task SaveAsync(ClientPreferences preferences, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(SessionStore.AppDirectory);
        var payload = JsonSerializer.Serialize(preferences, JsonOptions);
        await File.WriteAllTextAsync(PreferencesFilePath, payload, Encoding.UTF8, cancellationToken);
    }
}
