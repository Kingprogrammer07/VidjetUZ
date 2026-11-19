using System.Text.Json;

namespace FullWidget.Core;

/// <summary>Shared Uzbek words for the host and built-in widget manifests.</summary>
static class Uzbek
{
    static readonly Lazy<Dictionary<string, string>> Words = new(() =>
    {
        var file = Path.Combine(Paths.SdkDir, "uz.json");
        if (!File.Exists(file)) return new Dictionary<string, string>();
        return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(file)) ?? new();
    });

    public static string Translate(string english) =>
        Words.Value.TryGetValue(english, out var uz) ? uz : english.Replace("FullWidget", "VidjetUZ");
}
