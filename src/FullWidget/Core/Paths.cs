namespace FullWidget.Core;

/// Where everything lives on disk.
static class Paths
{
    /// Roaming data: config, user widgets, widget storage.
    public static string DataDir { get; private set; } = "";
    /// Machine-local data: WebView2 cache, logs.
    public static string LocalDir { get; private set; } = "";

    public static string ConfigFile => Path.Combine(DataDir, "config.json");
    public static string UserWidgetsDir => Path.Combine(DataDir, "widgets");
    public static string StorageDir => Path.Combine(DataDir, "storage");
    public static string WebViewDataDir => Path.Combine(LocalDir, "WebView2");
    public static string LogFile => Path.Combine(LocalDir, "logs", "app.log");

    /// Set FULLWIDGET_DEV_ROOT to the repository folder to load sdk/ and widgets/ straight from
    /// the source tree: edits show up on reload, without rebuilding.
    static string ResourceRoot =>
        Environment.GetEnvironmentVariable("FULLWIDGET_DEV_ROOT") is { Length: > 0 } dev && Directory.Exists(dev)
            ? dev : AppContext.BaseDirectory;

    public static string BuiltinWidgetsDir => Path.Combine(ResourceRoot, "widgets");
    public static string SdkDir => Path.Combine(ResourceRoot, "sdk");
    public static string ThemesDir => Path.Combine(SdkDir, "themes");
    public static string ControlCenterDir => Path.Combine(ResourceRoot, "ui", "control-center");
    public static string MenuDir => Path.Combine(ResourceRoot, "ui", "menu");
    public static string DocsUiDir => Path.Combine(ResourceRoot, "ui", "docs");
    public static string TemplatesDir => Path.Combine(ResourceRoot, "templates");
    /// The guides, each in Traditional Chinese, Simplified Chinese (when there is one) and English.
    static readonly Dictionary<string, (string Tw, string? Cn, string En)> Guides = new()
    {
        ["widget"] = ("組件開發指南.md", "组件开发指南.md", "widget-guide.en.md"),
        ["plugin"] = ("插件開發指南.md", "插件开发指南.md", "plugin-guide.en.md"),
    };

    /// A developer guide: "widget" (writing widgets) or "plugin" (writing plugins) in the UI
    /// language, Simplified Chinese readers getting the Traditional Chinese one where there is no
    /// other; or one of the guides' files by name (a link from one guide to another).
    public static string Guide(string which)
    {
        string docs = Path.Combine(ResourceRoot, "docs");
        if (which.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) return Path.Combine(docs, which);
        var g = Guides.TryGetValue(which, out var x) ? x : Guides["widget"];
        string? pick = Shell.Strings.Lang switch { "en" => g.En, "zh-CN" => g.Cn, _ => null };
        return pick != null && File.Exists(Path.Combine(docs, pick)) ? Path.Combine(docs, pick) : Path.Combine(docs, g.Tw);
    }

    /// The guide a link names ("插件開發指南.md", "plugin-guide.en.md#…"): which guide, and its file
    /// name; null for other files.
    public static (string Which, string File)? GuideFor(string link)
    {
        string file = Path.GetFileName(Uri.UnescapeDataString(link.Split('#', '?')[0]));
        foreach (var (which, g) in Guides)
            if (file == g.Tw || file == g.Cn || file == g.En) return (which, file);
        return null;
    }

    /// Which guide a file is ("plugin" for 插件开发指南.md…), or the name itself.
    public static string GuideOf(string which) =>
        Guides.FirstOrDefault(kv => which == kv.Key || which == kv.Value.Tw || which == kv.Value.Cn || which == kv.Value.En).Key ?? which;

    /// Where packages are unpacked before the user says yes. Inside the widgets folder, so the
    /// final move stays on one drive; the leading dot keeps the catalog from scanning it.
    public static string StagingDir => Path.Combine(UserWidgetsDir, ".install");

    /// True when FULLWIDGET_DEV_ROOT points at a source tree (built-in widgets and SDK editable).
    public static bool DevRoot => !ResourceRoot.Equals(AppContext.BaseDirectory, StringComparison.OrdinalIgnoreCase);

    /// Data lives next to the exe (see Init).
    public static bool Portable { get; private set; }

    /// The data folders were moved over from the old name (DeskWidgets) on this start.
    public static bool MovedFromOldName { get; private set; }

    /// Before the rename the app kept its data in "DeskWidgets" folders: move them to the new name once.
    static bool MoveOldFolder(string dir)
    {
        var old = Path.Combine(Path.GetDirectoryName(dir)!, "DeskWidgets");
        if (Directory.Exists(dir) || !Directory.Exists(old)) return false;
        try { Directory.Move(old, dir); return true; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return false; } // in use: start fresh, old data stays
    }

    public static void Init(string? overrideDir)
    {
        if (!string.IsNullOrEmpty(overrideDir))
        {
            DataDir = Path.GetFullPath(overrideDir);
            LocalDir = Path.Combine(DataDir, "local");
        }
        else if (Shell.StorePackage.IsPackaged)
        {
            // The Store copy: inside the package's folder (see Shell/StorePackage.cs).
            DataDir = Path.Combine(Shell.StorePackage.Roaming, "FullWidget");
            LocalDir = Path.Combine(Shell.StorePackage.Local, "FullWidget");
            Shell.StorePackage.CopyFrom(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "FullWidget"), DataDir);
        }
        else if (File.Exists(Path.Combine(AppContext.BaseDirectory, "portable")) || File.Exists(Path.Combine(AppContext.BaseDirectory, "portable.txt")))
        {
            // Portable mode: an empty file named "portable" next to the exe keeps all data in .\data.
            Portable = true;
            DataDir = Path.Combine(AppContext.BaseDirectory, "data");
            LocalDir = Path.Combine(DataDir, "local");
        }
        else
        {
            DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "FullWidget");
            LocalDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FullWidget");
            MovedFromOldName = MoveOldFolder(DataDir) | MoveOldFolder(LocalDir);
        }
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(UserWidgetsDir);
        Directory.CreateDirectory(StorageDir);
        Directory.CreateDirectory(Path.GetDirectoryName(LogFile)!);
    }
}
