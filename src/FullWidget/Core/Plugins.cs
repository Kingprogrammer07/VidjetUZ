using System.ComponentModel;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FullWidget.Bridge;
using FullWidget.Windows;

namespace FullWidget.Core;

/// Plugins: small programs the user writes for themselves, so their own widgets can do what
/// FullWidget can't do yet. Each one is a folder in plugins\ with a plugin.json that says how to
/// start it. FullWidget runs it as its own process (hidden, in FullWidget's job) and talks to it
/// with one JSON object per line over stdin/stdout:
///
///   to the plugin:   {"id": 1, "method": "hello", "params": {...}, "widget": "me.my-widget"}
///   its answer:      {"id": 1, "result": ...}   or   {"id": 1, "error": "what went wrong"}
///   an event:        {"event": "changed", "data": ...}   (to every widget listening)
///
/// What it writes to stderr goes to the log. A plugin starts when a widget first uses it and
/// stops after some idle minutes; one that keeps crashing is left stopped. A plugin runs only
/// after the user allowed it in the control center, and again after its plugin.json changes.
/// Plugins never come in packages or from the market: only widgets the user wrote may use them.
sealed class Plugins
{
    public static string Dir => Path.Combine(Paths.DataDir, "plugins");
    static readonly Regex NameRx = new("^[a-z0-9][a-z0-9._-]{0,63}$", RegexOptions.IgnoreCase);
    static readonly int[] RestartDelays = { 1000, 5000, 15000, 30000 };
    const int CrashLimit = 5;
    static readonly TimeSpan CrashWindow = TimeSpan.FromMinutes(3);
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(30), MaxTimeout = TimeSpan.FromMinutes(10);

    readonly App app;
    readonly Dictionary<string, Plugin> running = new(StringComparer.OrdinalIgnoreCase);
    readonly System.Windows.Forms.Timer idle = new() { Interval = 30_000 };
    readonly System.Windows.Forms.Timer changes = new() { Interval = 600 };
    readonly HashSet<string> changed = new(StringComparer.OrdinalIgnoreCase);
    FileSystemWatcher? watcher;
    readonly Dictionary<string, DateTime> mutedUntil = new(StringComparer.OrdinalIgnoreCase); // folders FullWidget itself just wrote

    public Plugins(App app)
    {
        this.app = app;
        idle.Tick += (_, _) => StopIdle();
        changes.Tick += (_, _) => { changes.Stop(); OnChanged(); };
    }

    public static bool IsName(string name) => NameRx.IsMatch(name);

    /// FullWidget's own plugins, installed from the market: fullwidget.<name>.
    public static bool IsOfficial(string name) => name.StartsWith("fullwidget.", StringComparison.OrdinalIgnoreCase) && IsName(name);

    // ───────────────────────── plugin.json ─────────────────────────

    /// What plugin.json says; Problem is set when it can't be used.
    sealed record Info(string Name, string Folder, string Title, string Description, string Run, string Hash, int IdleMinutes, string? Problem, string Version = "");

    static Info? Read(string name)
    {
        string dir = Path.Combine(Dir, name), file = Path.Combine(dir, "plugin.json");
        if (!IsName(name) || !File.Exists(file)) return null;
        byte[] bytes;
        try { bytes = File.ReadAllBytes(file); }
        catch (IOException ex) { return new Info(name, dir, name, "", "", "", 5, ex.Message); }
        string hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        try
        {
            // Notepad and PowerShell may save it with a BOM
            var json = bytes.AsMemory(bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF ? 3 : 0);
            using var doc = JsonDocument.Parse(json, new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
            var r = doc.RootElement;
            if (r.ValueKind != JsonValueKind.Object) throw new JsonException("plugin.json must be an object");
            string title = r.TryGetProperty("name", out var n) ? Text.Pick(n.Clone(), name) : name;
            string desc = r.TryGetProperty("description", out var d) ? Text.Pick(d.Clone()) : "";
            string run = r.TryGetProperty("run", out var x) && x.ValueKind == JsonValueKind.String ? x.GetString()!.Trim() : "";
            int idleMin = r.TryGetProperty("idleMinutes", out var i) && i.TryGetInt32(out var im) ? Math.Clamp(im, 0, 24 * 60) : 5;
            string version = r.TryGetProperty("version", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
            return new Info(name, dir, title, desc, run, hash, idleMin, run.Length == 0 ? "\"run\" is missing: how to start the plugin, e.g. \"python main.py\"" : null, version);
        }
        catch (JsonException ex) { return new Info(name, dir, name, "", "", hash, 5, ex.Message); }
    }

    static IEnumerable<string> Names() =>
        Directory.Exists(Dir)
            ? Directory.GetDirectories(Dir).Select(Path.GetFileName).OfType<string>()
                .Where(n => IsName(n) && File.Exists(Path.Combine(Dir, n, "plugin.json"))).OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            : Enumerable.Empty<string>();

    bool Approved(Info info) =>
        app.Config.Data.PluginApprovals.TryGetValue(info.Name.ToLowerInvariant(), out var h) && h == info.Hash;

    // ───────────────────────── what widgets do ─────────────────────────

    /// widget.plugin(name).call(method, params): starts the plugin if needed and waits for its answer.
    public async Task<JsonElement> CallAsync(WidgetWindow w, string name, string method, JsonElement args, TimeSpan timeout)
    {
        var p = Ensure(name);
        long id = ++p.NextId;
        var answer = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        p.Pending[id] = answer;
        p.LastUse = DateTime.UtcNow;
        string line = JsonSerializer.Serialize(new { id, method, @params = args.ValueKind == JsonValueKind.Undefined ? (object?)null : args, widget = w.Manifest.Id, instance = w.Cfg.Id });
        try { await p.Input!.WriteLineAsync(line); }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or NullReferenceException)
        {
            p.Pending.Remove(id);
            throw new BridgeException($"plugin \"{name}\" is not running");
        }
        try { return await answer.Task.WaitAsync(timeout); }
        catch (TimeoutException)
        {
            p.Pending.Remove(id);
            throw new BridgeException($"plugin \"{name}\" didn't answer \"{method}\" within {timeout.TotalSeconds:0} s");
        }
        finally { p.LastUse = DateTime.UtcNow; }
    }

    /// widget.plugin(name).on(...): the widget gets the plugin's events while it listens.
    public void Listen(WidgetWindow w, string name)
    {
        var p = Get(name);
        p.Listeners.Add(w);
        p.LastUse = DateTime.UtcNow;
        if (p.Proc == null) Ensure(name); // throws (not allowed yet, broken…) but the widget stays listening
    }

    public void Unlisten(WidgetWindow w, string? name = null)
    {
        foreach (var p in running.Values)
            if (name == null || p.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) p.Listeners.Remove(w);
    }

    Plugin Get(string name)
    {
        name = name.ToLowerInvariant();
        if (!running.TryGetValue(name, out var p)) running[name] = p = new Plugin(name);
        return p;
    }

    /// The plugin, running; or why it can't run.
    Plugin Ensure(string name)
    {
        var info = Read(name.ToLowerInvariant()) ?? throw new BridgeException($"no plugin \"{name}\" (looked for {Path.Combine(Dir, name, "plugin.json")})");
        if (info.Problem != null) throw new BridgeException($"plugin \"{name}\": plugin.json: {info.Problem}");
        if (!Approved(info)) { app.Config.Notify(); throw new BridgeException($"plugin \"{name}\" hasn't been allowed yet (control center → Settings → Plugins)"); }
        var p = Get(info.Name);
        if (p.Proc != null) return p;
        if (p.Broken) throw new BridgeException($"plugin \"{name}\" kept stopping and was left stopped; fix it and restart it in the control center");
        Start(p, info);
        return p;
    }

    // ───────────────────────── running ─────────────────────────

    sealed class Plugin(string name)
    {
        public string Name { get; } = name;
        public Process? Proc;
        public StreamWriter? Input;
        public long NextId;
        public readonly Dictionary<long, TaskCompletionSource<JsonElement>> Pending = new();
        public readonly HashSet<WidgetWindow> Listeners = new();
        public DateTime LastUse = DateTime.UtcNow, Started;
        public readonly List<DateTime> Crashes = new();
        public bool Broken, Stopping;
        public string? Problem;          // the last thing that went wrong, for the control center
        public int IdleMinutes = 5;
        public System.Windows.Forms.Timer? Restart;
    }

    void Start(Plugin p, Info info)
    {
        var psi = StartInfo(info);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = psi.RedirectStandardOutput = psi.RedirectStandardError = true;
        psi.StandardInputEncoding = psi.StandardOutputEncoding = psi.StandardErrorEncoding = new UTF8Encoding(false);
        psi.WorkingDirectory = info.Folder;
        psi.Environment["FULLWIDGET_PLUGIN"] = info.Name;
        psi.Environment["FULLWIDGET_VERSION"] = App.Version;
        psi.Environment["FULLWIDGET_LANG"] = Shell.Strings.Lang;
        psi.Environment["PYTHONUNBUFFERED"] = "1";
        psi.Environment["PYTHONUTF8"] = "1";
        psi.Environment["PYTHONIOENCODING"] = "utf-8";

        Process proc;
        try { proc = Process.Start(psi) ?? throw new Win32Exception("no process"); }
        catch (Win32Exception ex)
        {
            p.Problem = $"could not start \"{info.Run}\": {ex.Message}";
            Log.Warn($"Plugin {p.Name}: {p.Problem}");
            app.Config.Notify();
            throw new BridgeException($"plugin \"{p.Name}\" {p.Problem}");
        }
        Native.Job.Add(proc);
        proc.EnableRaisingEvents = true;
        proc.Exited += (_, _) => app.Post(() => OnExited(p, proc));
        p.Proc = proc;
        p.Input = proc.StandardInput;
        p.Input.AutoFlush = true;
        p.Started = p.LastUse = DateTime.UtcNow;
        p.IdleMinutes = info.IdleMinutes;
        p.Problem = null;
        _ = Task.Run(() => ReadOutput(p, proc));
        _ = Task.Run(() => ReadErrors(p, proc));
        idle.Start();
        EnsureWatcher();
        Log.Info($"Plugin {p.Name}: started ({info.Run}), pid {proc.Id}");
        app.Config.Notify();
    }

    /// plugin.json's "run": a program and its arguments. A script on its own runs with what
    /// usually runs it: main.ps1 with PowerShell, main.py with Python, main.js with Node.
    static ProcessStartInfo StartInfo(Info info)
    {
        string run = info.Run, file, rest;
        if (run.StartsWith('"')) { int q = run.IndexOf('"', 1); file = q < 0 ? run[1..] : run[1..q]; rest = q < 0 ? "" : run[(q + 1)..].Trim(); }
        else { int sp = run.IndexOf(' '); file = sp < 0 ? run : run[..sp]; rest = sp < 0 ? "" : run[(sp + 1)..].Trim(); }
        string local = Path.Combine(info.Folder, file);
        if (!Path.IsPathRooted(file) && File.Exists(local)) file = local;
        string Q(string s) => s.Contains(' ') ? $"\"{s}\"" : s;
        return Path.GetExtension(file).ToLowerInvariant() switch
        {
            ".ps1" => new ProcessStartInfo("powershell.exe", $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File {Q(file)} {rest}".TrimEnd()),
            ".py" => new ProcessStartInfo("python", $"{Q(file)} {rest}".TrimEnd()),
            ".js" or ".mjs" => new ProcessStartInfo("node", $"{Q(file)} {rest}".TrimEnd()),
            ".bat" or ".cmd" => new ProcessStartInfo("cmd.exe", $"/d /s /c \"{Q(file)} {rest}\""),
            _ => new ProcessStartInfo(file, rest),
        };
    }

    async Task ReadOutput(Plugin p, Process proc)
    {
        try
        {
            var r = proc.StandardOutput;
            for (string? line; (line = await r.ReadLineAsync()) != null;)
                if (line.Length > 0) { var l = line; app.Post(() => OnLine(p, proc, l)); }
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException) { }
    }

    async Task ReadErrors(Plugin p, Process proc)
    {
        try
        {
            var r = proc.StandardError;
            for (string? line; (line = await r.ReadLineAsync()) != null;)
                if (line.Length > 0) Log.Info($"[plugin {p.Name}] {(line.Length > 2000 ? line[..2000] + "…" : line)}");
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException) { }
    }

    void OnLine(Plugin p, Process proc, string line)
    {
        if (p.Proc != proc) return;
        JsonElement msg;
        try { using var doc = JsonDocument.Parse(line); msg = doc.RootElement.Clone(); }
        catch (JsonException)
        {
            Log.Warn($"[plugin {p.Name}] wrote something that isn't a JSON line (use stderr for messages): {(line.Length > 200 ? line[..200] + "…" : line)}");
            return;
        }
        if (msg.ValueKind != JsonValueKind.Object) return;
        if (msg.TryGetProperty("event", out var ev) && ev.ValueKind == JsonValueKind.String)
        {
            var data = msg.TryGetProperty("data", out var d) ? d : default;
            var payload = new { plugin = p.Name, @event = ev.GetString(), data = data.ValueKind == JsonValueKind.Undefined ? (object?)null : data };
            foreach (var w in p.Listeners.ToList()) w.Send("plugin", payload);
            return;
        }
        if (msg.TryGetProperty("id", out var idEl) && idEl.TryGetInt64(out var id) && p.Pending.Remove(id, out var answer))
        {
            if (msg.TryGetProperty("error", out var err) && err.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
            {
                string text = err.ValueKind == JsonValueKind.String ? err.GetString()!
                    : err.ValueKind == JsonValueKind.Object && err.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString()! : err.ToString();
                answer.TrySetException(new BridgeException(text));
            }
            else answer.TrySetResult(msg.TryGetProperty("result", out var res) ? res : JsonSerializer.SerializeToElement<object?>(null));
        }
    }

    void OnExited(Plugin p, Process proc)
    {
        if (p.Proc != proc) { proc.Dispose(); return; }
        int code = 0;
        try { code = proc.ExitCode; } catch (InvalidOperationException) { }
        bool asked = p.Stopping;
        Detach(p, $"plugin \"{p.Name}\" stopped (exit code {code})");
        proc.Dispose();
        if (asked) { Log.Info($"Plugin {p.Name}: stopped"); app.Config.Notify(); return; }

        var now = DateTime.UtcNow;
        p.Crashes.RemoveAll(t => now - t > CrashWindow);
        p.Crashes.Add(now);
        p.Problem = $"exited on its own (exit code {code})";
        Log.Warn($"Plugin {p.Name}: {p.Problem}");
        if (p.Crashes.Count >= CrashLimit)
        {
            p.Broken = true;
            p.Problem = $"stopped {CrashLimit} times in {CrashWindow.TotalMinutes:0} minutes (last exit code {code}); left stopped";
            Log.Warn($"Plugin {p.Name}: {p.Problem}");
        }
        else if (p.Listeners.Count > 0)
        {
            // widgets are waiting for its events: start it again, a little later each time
            p.Restart?.Dispose();
            p.Restart = new System.Windows.Forms.Timer { Interval = RestartDelays[Math.Min(p.Crashes.Count, RestartDelays.Length) - 1] };
            p.Restart.Tick += (_, _) =>
            {
                p.Restart?.Dispose();
                p.Restart = null;
                if (p.Proc == null && !p.Broken && p.Listeners.Count > 0) try { Ensure(p.Name); } catch (BridgeException) { }
            };
            p.Restart.Start();
        }
        app.Config.Notify();
    }

    /// Forgets the process and fails the calls still waiting on it.
    void Detach(Plugin p, string why)
    {
        p.Proc = null;
        p.Input = null;
        p.Stopping = false;
        foreach (var a in p.Pending.Values) a.TrySetException(new BridgeException(why));
        p.Pending.Clear();
    }

    /// Asks it to stop by closing its input; after 3 s it is ended.
    void Stop(Plugin p)
    {
        var proc = p.Proc;
        if (proc == null) return;
        p.Stopping = true;
        try { p.Input?.Close(); } catch (IOException) { }
        _ = Task.Delay(3000).ContinueWith(_ => app.Post(() => { if (p.Proc == proc) Kill(proc); }));
    }

    static void Kill(Process proc)
    {
        try { if (!proc.HasExited) proc.Kill(entireProcessTree: true); }
        catch (Exception ex) when (ex is InvalidOperationException or Win32Exception or NotSupportedException) { }
    }

    void StopIdle()
    {
        var now = DateTime.UtcNow;
        foreach (var p in running.Values)
            if (p.Proc != null && !p.Stopping && p.IdleMinutes > 0 && p.Listeners.Count == 0 && p.Pending.Count == 0
                && now - p.LastUse > TimeSpan.FromMinutes(p.IdleMinutes))
            {
                Log.Info($"Plugin {p.Name}: unused for {p.IdleMinutes} min, stopping");
                Stop(p);
            }
        if (!running.Values.Any(p => p.Proc != null)) idle.Stop();
    }

    /// Ends it now and, if widgets are listening, starts it again.
    public void Restart(string name)
    {
        var p = Get(name);
        p.Restart?.Dispose();
        p.Restart = null;
        if (p.Proc is { } proc) { Detach(p, $"plugin \"{p.Name}\" is restarting"); Kill(proc); }
        p.Broken = false;
        p.Crashes.Clear();
        p.Problem = null;
        if (p.Listeners.Count > 0) try { Ensure(name); } catch (BridgeException) { }
        app.Config.Notify();
    }

    public void StopNow(string name)
    {
        if (running.TryGetValue(name, out var p) && p.Proc is { } proc) { p.Stopping = true; Detach(p, $"plugin \"{p.Name}\" was stopped"); Kill(proc); Log.Info($"Plugin {p.Name}: stopped"); }
        app.Config.Notify();
    }

    public void StopAll()
    {
        foreach (var p in running.Values)
            if (p.Proc is { } proc) { Detach(p, "FullWidget is closing"); Kill(proc); }
        watcher?.Dispose();
        watcher = null;
    }

    // ───────────────────────── the control center ─────────────────────────

    public void Allow(string name)
    {
        var info = Read(name.ToLowerInvariant()) ?? throw new BridgeException($"no plugin \"{name}\"");
        app.Config.Data.PluginApprovals[info.Name.ToLowerInvariant()] = info.Hash;
        app.Config.SaveSoon();
        Log.Info($"Plugin {info.Name}: allowed ({info.Run})");
        var p = Get(info.Name);
        p.Broken = false;
        p.Problem = null;
        if (p.Listeners.Count > 0 && p.Proc == null) try { Ensure(info.Name); } catch (BridgeException) { }
        app.Config.Notify();
    }

    public object State() => Names().Select(Read).OfType<Info>().Select(info =>
    {
        running.TryGetValue(info.Name, out var p);
        string status = info.Problem != null ? "invalid"
            : !Approved(info) ? "unapproved"
            : p?.Proc != null ? "running"
            : p?.Broken == true ? "broken" : "stopped";
        return new
        {
            name = info.Name,
            official = IsOfficial(info.Name),
            version = info.Version,
            title = info.Title,
            description = info.Description,
            run = info.Run,
            status,
            changed = status == "unapproved" && app.Config.Data.PluginApprovals.ContainsKey(info.Name.ToLowerInvariant()),
            problem = info.Problem ?? p?.Problem,
            users = p == null ? Array.Empty<string>() : p.Listeners.Select(w => w.Manifest.DisplayName).Distinct().ToArray(),
        };
    }).ToList();

    /// "新建插件": a working plugin from the template, allowed (the user just made it), its folder opened.
    public string Create(string title)
    {
        title = title.Trim();
        if (title.Length == 0) throw new BridgeException(Shell.Strings.PluginNameRequired);
        string baseName = Regex.Replace(title.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        if (!IsName(baseName)) baseName = "my-plugin";
        string name = baseName;
        for (int i = 2; Directory.Exists(Path.Combine(Dir, name)); i++) name = $"{baseName}-{i}";

        string src = Path.Combine(Paths.TemplatesDir, $"hello-plugin.{Shell.Strings.Lang}");
        if (!Directory.Exists(src)) src = Path.Combine(Paths.TemplatesDir, "hello-plugin");
        if (!Directory.Exists(src)) throw new BridgeException(Shell.Strings.NoTemplate);
        string dir = Path.Combine(Dir, name);
        Directory.CreateDirectory(dir);
        foreach (var f in Directory.GetFiles(src))
        {
            // the template says {name} and {title} where the new plugin's go; a .ps1 keeps its BOM (PowerShell 5.1 needs it)
            string to = Path.Combine(dir, Path.GetFileName(f));
            if (Path.GetExtension(f).ToLowerInvariant() is ".ps1" or ".md" or ".js" or ".py")
                File.WriteAllText(to, File.ReadAllText(f).Replace("{name}", name).Replace("{title}", title), new UTF8Encoding(f.EndsWith(".ps1", StringComparison.OrdinalIgnoreCase)));
            else File.Copy(f, to);
        }
        // its name in plugin.json
        string json = Path.Combine(dir, "plugin.json");
        var node = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(json))!.AsObject();
        node["name"] = title;
        File.WriteAllText(json, node.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));

        Allow(name);
        EnsureWatcher();
        Log.Info($"Plugin {name}: created in {dir}");
        Process.Start("explorer.exe", $"\"{dir}\"");
        return name;
    }

    /// The version of an installed plugin (plugin.json's "version"), or null.
    public static string? InstalledVersion(string name) => Read(name.ToLowerInvariant()) is { } i ? i.Version : null;

    /// Puts an official plugin from the market in place (the package was checked against the
    /// market's SHA-256), replacing the version there, and allows it: the user just said yes to it.
    public void InstallOfficial(string name, byte[] zip, string version)
    {
        if (!IsOfficial(name)) throw new BridgeException($"\"{name}\" is not an official plugin");
        name = name.ToLowerInvariant();
        Directory.CreateDirectory(Dir);
        string dir = Path.Combine(Dir, name), stage = dir + ".new", old = dir + ".old";
        foreach (var d in new[] { stage, old }) if (Directory.Exists(d)) Directory.Delete(d, true);
        using (var ms = new MemoryStream(zip))
        using (var archive = new System.IO.Compression.ZipArchive(ms))
            foreach (var e in archive.Entries)
            {
                if (e.FullName.EndsWith('/')) continue;
                string to = Path.GetFullPath(Path.Combine(stage, e.FullName));
                if (!to.StartsWith(stage + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new BridgeException(Shell.Strings.MarketBadPackage);
                Directory.CreateDirectory(Path.GetDirectoryName(to)!);
                System.IO.Compression.ZipFileExtensions.ExtractToFile(e, to);
            }
        if (!File.Exists(Path.Combine(stage, "plugin.json"))) { Directory.Delete(stage, true); throw new BridgeException(Shell.Strings.MarketBadPackage); }

        bool wasRunning = running.TryGetValue(name, out var p) && p.Proc != null;
        if (wasRunning) StopNow(name);
        mutedUntil[name] = DateTime.UtcNow.AddSeconds(3); // our own writes: not an edit to react to
        if (Directory.Exists(dir)) Directory.Move(dir, old);
        Directory.Move(stage, dir);
        try { if (Directory.Exists(old)) Directory.Delete(old, true); } catch (IOException) { }
        changed.Remove(name);
        Log.Info($"Plugin {name}: installed {version} from the market");
        Allow(name);
        EnsureWatcher();
    }

    public void OpenFolder(string? name)
    {
        string dir = name != null && IsName(name) && Directory.Exists(Path.Combine(Dir, name)) ? Path.Combine(Dir, name) : Dir;
        Directory.CreateDirectory(dir);
        EnsureWatcher();
        Process.Start("explorer.exe", $"\"{dir}\"");
    }

    // ───────────────────────── editing a plugin ─────────────────────────

    /// Saving a file of a running plugin restarts it; a changed plugin.json needs allowing again.
    void EnsureWatcher()
    {
        if (watcher != null || !Directory.Exists(Dir)) return;
        try
        {
            watcher = new FileSystemWatcher(Dir) { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite };
            FileSystemEventHandler on = (_, e) =>
            {
                string rel = Path.GetRelativePath(Dir, e.FullPath);
                string name = rel.Split(Path.DirectorySeparatorChar)[0];
                app.Post(() =>
                {
                    if (mutedUntil.TryGetValue(name, out var until) && DateTime.UtcNow < until) return;
                    changed.Add(name); changes.Stop(); changes.Start();
                });
            };
            watcher.Changed += on;
            watcher.Created += on;
            watcher.Deleted += on;
            watcher.Renamed += (s, e) => on(s, e);
            watcher.EnableRaisingEvents = true;
        }
        catch (Exception ex) when (ex is IOException or ArgumentException) { Log.Warn($"Plugins: can't watch {Dir}: {ex.Message}"); }
    }

    void OnChanged()
    {
        foreach (var name in changed.ToList())
        {
            changed.Remove(name);
            if (!running.TryGetValue(name, out var p)) continue;
            var info = Read(name.ToLowerInvariant());
            if (p.Proc != null)
            {
                Log.Info($"Plugin {name}: files changed, restarting");
                if (info == null || info.Problem != null || !Approved(info)) StopNow(name);
                else Restart(name);
            }
            else
            {
                // fixed, perhaps: widgets waiting for it get it now
                p.Broken = false;
                p.Crashes.Clear();
                p.Problem = null;
                if (p.Listeners.Count > 0) try { Ensure(name); } catch (BridgeException) { }
            }
        }
        app.Config.Notify();
    }
}
