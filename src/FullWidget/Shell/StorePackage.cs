using System.Runtime.InteropServices;
using System.Text;
using FullWidget.Core;
using FullWidget.Providers;

namespace FullWidget.Shell;

/// The Microsoft Store copy: FullWidget installed as an MSIX package (build/msix).
///
/// A packaged app differs in three ways that matter here:
/// - its files are read-only, and the Store updates it, so the app's own updater stays off;
/// - "start with Windows" is a startup task declared in the package, switched on and off through
///   Windows (Settings → Apps → Startup lists it too), not a Run entry in the registry;
/// - what it writes to %APPDATA% and HKCU goes to a private copy that only the package sees. So the
///   data folder is named by its real place inside the package's folder, which File Explorer opens
///   too, and the .fwz file type comes from the package as well.
static class StorePackage
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern int GetCurrentPackageFamilyName(ref uint length, StringBuilder? name);

    /// The package family name ("hmgvibe.FullWidget_xxxx"), or null for an ordinary copy.
    public static string? FamilyName { get; } = Find();
    public static bool IsPackaged => FamilyName != null;

    static string? Find()
    {
        try
        {
            uint n = 0;
            if (GetCurrentPackageFamilyName(ref n, null) != 122) return null; // 122: buffer too small, i.e. there is a package
            var sb = new StringBuilder((int)n);
            return GetCurrentPackageFamilyName(ref n, sb) == 0 ? sb.ToString() : null;
        }
        catch (EntryPointNotFoundException) { return null; }
    }

    /// The package's own folder for what it would write to %APPDATA% / %LOCALAPPDATA%.
    public static string Roaming => Path.Combine(PackageDir, "LocalCache", "Roaming");
    public static string Local => Path.Combine(PackageDir, "LocalCache", "Local");
    static string PackageDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Packages", FamilyName!);

    /// The first start of the Store copy on a PC that has the ordinary FullWidget: take its settings
    /// and widgets along. The ordinary copy keeps its own.
    public static bool CopyFrom(string from, string to)
    {
        if (Directory.Exists(to) || !Directory.Exists(from)) return false;
        string tmp = to + ".copying";
        try
        {
            if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
            foreach (var dir in Directory.EnumerateDirectories(from, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(Path.Combine(tmp, Path.GetRelativePath(from, dir)));
            Directory.CreateDirectory(tmp);
            foreach (var file in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
                File.Copy(file, Path.Combine(tmp, Path.GetRelativePath(from, file)));
            Directory.Move(tmp, to);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            try { Directory.Delete(tmp, true); } catch (Exception) { /* left for next time */ }
            return false;
        }
    }

    // ── the startup task (Package.appxmanifest: <desktop:StartupTask TaskId="FullWidget">) ──

    const string TaskId = "FullWidget";
    // StartupTaskState: 0 disabled, 1 disabled by the user (Task Manager / Settings), 2 enabled,
    // 3 disabled by policy, 4 enabled by policy
    static int state = -1;

    /// Whether FullWidget starts with Windows, as of the last look (Refresh).
    public static bool StartupEnabled => state is 2 or 4;

    /// The user turned it off in Windows' own list: only they can turn it back on there.
    public static bool StartupBlocked => state is 1 or 3;

    public static async Task RefreshStartup()
    {
        IntPtr task = await GetTask();
        if (task == IntPtr.Zero) return;
        try { state = WinRt.I32(task, 8); } // get_State
        finally { WinRt.Release(task); }
    }

    /// Turns starting with Windows on or off; false when Windows wouldn't (turned off by the user
    /// in Settings, or by policy).
    public static async Task<bool> SetStartup(bool on)
    {
        IntPtr task = await GetTask();
        if (task == IntPtr.Zero) return false;
        try
        {
            if (on)
            {
                IntPtr op = WinRt.Ptr(task, 6); // RequestEnableAsync
                if (op == IntPtr.Zero) return false;
                try { if (await Completed(op)) state = WinRt.I32(op, 8); } // GetResults
                finally { WinRt.Release(op); }
            }
            else
            {
                Disable(task);
                state = WinRt.I32(task, 8);
            }
            Log.Info($"Startup task: {state}");
            return StartupEnabled == on;
        }
        finally { WinRt.Release(task); }
    }

    static async Task<IntPtr> GetTask()
    {
        if (!IsPackaged) return IntPtr.Zero;
        IntPtr statics = IntPtr.Zero, op = IntPtr.Zero;
        try
        {
            var iid = new Guid("ee5b60bd-a148-41a7-b26e-e8b88a1e62f8"); // IStartupTaskStatics
            IntPtr cls = WinRt.HString("Windows.ApplicationModel.StartupTask");
            try { Marshal.ThrowExceptionForHR(WinRt.RoGetActivationFactory(cls, ref iid, out statics)); }
            finally { WinRt.WindowsDeleteString(cls); }
            IntPtr id = WinRt.HString(TaskId);
            try { op = GetAsync(statics, id); }
            finally { WinRt.WindowsDeleteString(id); }
            if (!await Completed(op)) return IntPtr.Zero;
            return WinRt.Ptr(op, 8); // GetResults: the IStartupTask
        }
        catch (Exception ex) when (ex is COMException or InvalidCastException)
        {
            Log.Warn($"Startup task: {ex.Message}");
            return IntPtr.Zero;
        }
        finally { WinRt.Release(op); WinRt.Release(statics); }
    }

    static unsafe void Disable(IntPtr task) => ((delegate* unmanaged<IntPtr, int>)WinRt.V(task)[7])(task);

    static unsafe IntPtr GetAsync(IntPtr statics, IntPtr id)
    {
        IntPtr r = IntPtr.Zero;
        Marshal.ThrowExceptionForHR(((delegate* unmanaged<IntPtr, IntPtr, IntPtr*, int>)WinRt.V(statics)[7])(statics, id, &r));
        return r;
    }

    /// Waits for a WinRT async operation (they finish within milliseconds).
    static async Task<bool> Completed(IntPtr op)
    {
        if (op == IntPtr.Zero) return false;
        var iid = new Guid("00000036-0000-0000-C000-000000000046"); // IAsyncInfo
        if (Marshal.QueryInterface(op, in iid, out var info) < 0) return false;
        try
        {
            for (int i = 0; i < 200; i++)
            {
                int st = WinRt.I32(info, 7); // get_Status: 0 started, 1 completed, 2 canceled, 3 error
                if (st != 0) return st == 1;
                await Task.Delay(i < 20 ? 5 : 25);
            }
            return false;
        }
        finally { WinRt.Release(info); }
    }
}
