using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using FullWidget.Bridge;
using FullWidget.Shell;

namespace FullWidget.Core;

/// The online widget market: a list of widgets (index.json, published from a GitHub repository to
/// GitHub Pages) and their .fwz packages. Installing downloads the package, checks its SHA-256
/// against the list, and hands it to the usual install sheet, where the user sees what it may do.
sealed class Market(App app)
{
    public const string DefaultIndex = "https://hmgvibe.github.io/fullwidget-market/index.json";
    const long MaxIndexBytes = 4 << 20, MaxPackageBytes = 16 << 20;
    static readonly TimeSpan Fresh = TimeSpan.FromMinutes(10);
    static readonly TimeSpan FirstCheck = TimeSpan.FromMinutes(2), Every = TimeSpan.FromHours(12);

    static readonly HttpClient Http = CreateHttp();
    static HttpClient CreateHttp()
    {
        var c = new HttpClient(new SocketsHttpHandler { AutomaticDecompression = DecompressionMethods.All }) { Timeout = TimeSpan.FromSeconds(20) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd($"FullWidget/{App.Version}");
        return c;
    }

    JsonElement? index;      // the last list we got
    DateTime fetched;
    Uri? indexUri;
    bool offline;            // the last try to get the list failed
    readonly System.Windows.Forms.Timer timer = new();

    /// Where the list is: FULLWIDGET_MARKET (for testing), else the setting, else the default.
    public Uri IndexUri
    {
        get
        {
            var s = Environment.GetEnvironmentVariable("FULLWIDGET_MARKET") is { Length: > 0 } env ? env
                : app.Config.Data.MarketUrl is { Length: > 0 } cfg ? cfg : DefaultIndex;
            if (!Uri.TryCreate(s, UriKind.Absolute, out var u) || !Allowed(u)) u = new Uri(DefaultIndex);
            return u;
        }
    }

    /// The market's website (the folder of index.json).
    public Uri SiteUri => new(IndexUri, "./");

    /// https only; plain http just for a market on this PC (testing).
    static bool Allowed(Uri u) => u.Scheme == "https" || (u.Scheme == "http" && u.IsLoopback);

    static string Cache => Path.Combine(Paths.LocalDir, "market.json");

    /// { widgets: […], updated, site, offline }. Texts are in the app's language, addresses absolute.
    public async Task<object?> ListAsync(bool refresh)
    {
        var uri = IndexUri;
        offline = false;
        if (refresh || index == null || indexUri != uri || DateTime.UtcNow - fetched > Fresh)
        {
            try
            {
                var bytes = await GetAsync(uri, MaxIndexBytes);
                using var doc = JsonDocument.Parse(bytes);
                if (!doc.RootElement.TryGetProperty("widgets", out var w) || w.ValueKind != JsonValueKind.Array)
                    throw new BridgeException("not a widget market list");
                index = doc.RootElement.Clone();
                indexUri = uri;
                fetched = DateTime.UtcNow;
                try { File.WriteAllBytes(Cache, bytes); } catch (IOException) { }
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or BridgeException or IOException)
            {
                Log.Warn($"Market list from {uri}: {ex.Message}");
                // offline: what we had, or what we saved last time
                if (index == null && File.Exists(Cache))
                    try { index = JsonDocument.Parse(File.ReadAllBytes(Cache)).RootElement.Clone(); indexUri = uri; }
                    catch (JsonException) { }
                if (index == null) throw new BridgeException(Strings.MarketUnreachable);
                offline = true;
            }
        }
        var root = index!.Value;
        return new
        {
            site = SiteUri.ToString(),
            // FullWidget's own plugins: only from FullWidget's own market
            plugins = !OfficialMarket || !root.TryGetProperty("plugins", out var pl) || pl.ValueKind != JsonValueKind.Array ? new List<object>()
                : pl.EnumerateArray().Where(x => Str(x, "id") is { } id && Plugins.IsOfficial(id)).Select(x => (object)new
                {
                    id = Str(x, "id"),
                    name = x.TryGetProperty("name", out var n) ? Text.Pick(n, Str(x, "id") ?? "") : Str(x, "id"),
                    description = x.TryGetProperty("description", out var d) ? Text.Pick(d) : "",
                    author = Str(x, "author") ?? "FullWidget",
                    version = Str(x, "version") ?? "0.0.0",
                    run = Str(x, "run") ?? "",
                    bytes = x.TryGetProperty("bytes", out var b) && b.TryGetInt64(out var bl) ? bl : 0,
                    updated = Str(x, "updated"),
                    installed = Plugins.InstalledVersion(Str(x, "id")!),
                    page = new Uri(SiteUri, "#plugin-" + Uri.EscapeDataString(Str(x, "id") ?? "")).ToString(),
                }).ToList(),
            updated = Str(root, "updated"),
            offline,
            widgets = root.GetProperty("widgets").EnumerateArray().Where(w => Str(w, "id") is { Length: > 0 }).Select(w => new
            {
                id = Str(w, "id"),
                name = w.TryGetProperty("name", out var n) ? Text.Pick(n, Str(w, "id") ?? "") : Str(w, "id"),
                description = w.TryGetProperty("description", out var d) ? Text.Pick(d) : "",
                author = Str(w, "author") ?? "",
                version = Str(w, "version") ?? "0.0.0",
                category = Str(w, "category") ?? "other",
                permissions = w.TryGetProperty("permissions", out var p) && p.ValueKind == JsonValueKind.Array
                    ? p.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0).ToArray() : Array.Empty<string>(),
                icon = Abs(Str(w, "icon")),
                preview = Abs(Str(w, "preview")),
                previews = w.TryGetProperty("previews", out var pv) && pv.ValueKind == JsonValueKind.Array
                    ? pv.EnumerateArray().Select(x => Abs(x.GetString())).Where(x => x != null).ToArray() : Array.Empty<string?>(),
                bytes = w.TryGetProperty("bytes", out var b) && b.TryGetInt64(out var bl) ? bl : 0,
                updated = Str(w, "updated"),
                page = new Uri(SiteUri, "#" + Uri.EscapeDataString(Str(w, "id") ?? "")).ToString(),
            }).ToList(),
        };
    }

    // ───────────────────────── telling the user about new versions ─────────────────────────

    public void Start()
    {
        timer.Tick += (_, _) => { timer.Interval = (int)Every.TotalMilliseconds; _ = CheckUpdatesAsync(); };
        timer.Interval = (int)FirstCheck.TotalMilliseconds;
        timer.Enabled = app.Config.Data.WidgetUpdateCheck;
    }

    public void SetAuto(bool on)
    {
        app.Config.Data.WidgetUpdateCheck = on;
        app.Config.SaveSoon();
        if (on && !timer.Enabled) { timer.Interval = (int)FirstCheck.TotalMilliseconds; timer.Start(); }
        if (!on) timer.Stop();
    }

    /// Widgets the market could update: not built in, and not the user's own.
    IEnumerable<WidgetManifest> Installed() => app.Catalog.All.Where(m => !m.Builtin && !app.Config.Data.OwnWidgets.Contains(m.Id, StringComparer.OrdinalIgnoreCase));

    /// Reads the list and says from the tray which installed widgets have a newer version, each
    /// version once; official plugins too. With nothing from the market there is nothing to look
    /// for, so it doesn't go online.
    public async Task CheckUpdatesAsync()
    {
        var mine = Installed().ToDictionary(m => m.Id, StringComparer.OrdinalIgnoreCase);
        bool officialPlugins = Directory.Exists(Plugins.Dir) && Directory.GetDirectories(Plugins.Dir).Any(d => Plugins.IsOfficial(Path.GetFileName(d)));
        if (mine.Count == 0 && !officialPlugins) return;
        try { await ListAsync(refresh: true); }
        catch (BridgeException) { return; }
        if (offline || index == null) return;
        var told = app.Config.Data.WidgetUpdatesNotified;
        var found = new List<(WidgetManifest m, string v)>();
        var pluginsFound = new List<(string id, string name, string v)>();
        foreach (var w in index.Value.GetProperty("widgets").EnumerateArray())
        {
            if (Str(w, "id") is not { } id || !mine.TryGetValue(id, out var m) || Str(w, "version") is not { } v) continue;
            if (CompareVersions(v, m.Version) <= 0 || (told.TryGetValue(id, out var t) && CompareVersions(t, v) >= 0)) continue;
            found.Add((m, v));
        }
        if (index.Value.TryGetProperty("plugins", out var pl) && pl.ValueKind == JsonValueKind.Array && OfficialMarket)
            foreach (var x in pl.EnumerateArray())
            {
                if (Str(x, "id") is not { } pid || Plugins.InstalledVersion(pid) is not { Length: > 0 } have || Str(x, "version") is not { } v) continue;
                if (CompareVersions(v, have) <= 0 || (told.TryGetValue("plugin:" + pid, out var t) && CompareVersions(t, v) >= 0)) continue;
                pluginsFound.Add((pid, x.TryGetProperty("name", out var n) ? Text.Pick(n, pid) : pid, v));
            }
        if (found.Count + pluginsFound.Count == 0) return;
        foreach (var (pid, _, v) in pluginsFound) told["plugin:" + pid] = v;
        foreach (var (m, v) in found) told[m.Id] = v;
        app.Config.SaveSoon();
        Log.Info($"Market: new versions of {string.Join(", ", found.Select(f => $"{f.m.Id} {f.v}").Concat(pluginsFound.Select(f => $"{f.id} {f.v}")))}");
        int total = found.Count + pluginsFound.Count;
        string text = total > 1 ? Strings.WidgetUpdates(total)
            : found.Count == 1 ? Strings.WidgetUpdate(found[0].m.DisplayName, found[0].v) : Strings.WidgetUpdate(pluginsFound[0].name, pluginsFound[0].v);
        app.Tray.Balloon(text, () => app.OpenControlCenter(page: "online"));
    }

    /// "1.10.0" vs "1.9.2", by numbers (the control center compares the same way).
    static int CompareVersions(string a, string b)
    {
        static int[] Parts(string v) => v.Split('-', '+')[0].Split('.').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray();
        int[] x = Parts(a), y = Parts(b);
        for (int i = 0; i < Math.Max(x.Length, y.Length); i++)
        {
            int d = (i < x.Length ? x[i] : 0) - (i < y.Length ? y[i] : 0);
            if (d != 0) return Math.Sign(d);
        }
        return 0;
    }

    /// The market this copy reads is FullWidget's own (or a test market set with FULLWIDGET_MARKET):
    /// only then are plugins offered, as a market set by hand could hand out anything.
    bool OfficialMarket =>
        IndexUri.ToString() == DefaultIndex || Environment.GetEnvironmentVariable("FULLWIDGET_MARKET") is { Length: > 0 };

    /// Downloads an official plugin, checks it against the list, and installs it. The control
    /// center showed what it runs and the user said yes before this is called.
    public async Task<object?> InstallPluginAsync(string id)
    {
        if (!OfficialMarket) throw new BridgeException(Strings.MarketNoSuchWidget);
        if (index == null) await ListAsync(false);
        var entry = index!.Value.TryGetProperty("plugins", out var pl) && pl.ValueKind == JsonValueKind.Array
            ? pl.EnumerateArray().FirstOrDefault(x => Str(x, "id") == id) : default;
        if (entry.ValueKind != JsonValueKind.Object || !Plugins.IsOfficial(id)) throw new BridgeException(Strings.MarketNoSuchWidget);
        var url = Abs(Str(entry, "package")) ?? throw new BridgeException(Strings.MarketNoSuchWidget);
        var want = (Str(entry, "sha256") ?? "").ToLowerInvariant();
        if (want.Length != 64) throw new BridgeException(Strings.MarketBadPackage);
        var bytes = await GetAsync(new Uri(url), MaxPackageBytes);
        if (Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != want)
        {
            Log.Warn($"Market plugin {url}: SHA-256 doesn't match the list");
            throw new BridgeException(Strings.MarketBadPackage);
        }
        string version = Str(entry, "version") ?? "";
        app.Plugins.InstallOfficial(id, bytes, version);
        app.Config.Notify();
        return new { id, version };
    }

    /// Downloads a widget's package, checks it, and opens the install sheet in the control center.
    public async Task<object?> InstallAsync(string id)
    {
        if (index == null) await ListAsync(false);
        var entry = index!.Value.GetProperty("widgets").EnumerateArray().FirstOrDefault(w => Str(w, "id") == id);
        if (entry.ValueKind != JsonValueKind.Object) throw new BridgeException(Strings.MarketNoSuchWidget);
        if (Catalog.IsReserved(id)) throw new BridgeException(string.Format(Strings.ReservedInstall, id));
        var url = Abs(Str(entry, "package")) ?? throw new BridgeException(Strings.MarketNoSuchWidget);
        var want = (Str(entry, "sha256") ?? "").ToLowerInvariant();
        if (want.Length != 64) throw new BridgeException(Strings.MarketBadPackage);

        var bytes = await GetAsync(new Uri(url), MaxPackageBytes);
        if (Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != want)
        {
            Log.Warn($"Market package {url}: SHA-256 doesn't match the list");
            throw new BridgeException(Strings.MarketBadPackage);
        }
        Directory.CreateDirectory(Paths.StagingDir);
        var file = Path.Combine(Paths.StagingDir, $"market-{Guid.NewGuid():N}.fwz");
        await File.WriteAllBytesAsync(file, bytes);
        Log.Info($"Market: downloaded {id} {Str(entry, "version")} ({bytes.Length} bytes)");
        try { app.OpenPackage(file, Strings.FromMarket); }
        finally { try { File.Delete(file); } catch (IOException) { } }
        return new { id };
    }

    /// An address in the list, made absolute; null if it isn't one we'd fetch.
    string? Abs(string? rel)
    {
        if (string.IsNullOrEmpty(rel) || indexUri == null) return null;
        return Uri.TryCreate(indexUri, rel, out var u) && Allowed(u) ? u.ToString() : null;
    }

    static async Task<byte[]> GetAsync(Uri uri, long max)
    {
        if (!Allowed(uri)) throw new BridgeException(Strings.MarketBadPackage);
        using var resp = await Http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead);
        resp.EnsureSuccessStatusCode();
        await using var s = await resp.Content.ReadAsStreamAsync();
        using var ms = new MemoryStream();
        var buf = new byte[81920];
        int n;
        while ((n = await s.ReadAsync(buf)) > 0)
        {
            if (ms.Length + n > max) throw new BridgeException(Strings.MarketBadPackage);
            ms.Write(buf, 0, n);
        }
        return ms.ToArray();
    }

    static string? Str(JsonElement e, string key) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
