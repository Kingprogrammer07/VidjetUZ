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
    /// A developer guide in the UI language (Chinese readers share the Traditional Chinese one):
    /// "widget" (writing widgets) or "plugin" (writing plugins).
    public static string Guide(string which)
    {
        var (zh, en) = which == "plugin" ? ("插件開發指南.md", "plugin-guide.en.md") : ("組件開發指南.md", "widget-guide.en.md");
        string english = Path.Combine(ResourceRoot, "docs", en);
        return Shell.Strings.Lang == "en" && File.Exists(english) ? english : Path.Combine(ResourceRoot, "docs", zh);
    }

    /// Which guide a link names: "插件開發指南.md", "plugin-guide.en.md#…" → "plugin"; null for other files.
    public static string? GuideFor(string link)
    {
        string file = Path.GetFileName(Uri.UnescapeDataString(link.Split('#', '?')[0]));
        return file switch
        {
            "插件開發指南.md" or "plugin-guide.en.md" => "plugin",
            "組件開發指南.md" or "widget-guide.en.md" => "widget",
            _ => null,
        };
    }

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
