using System.Runtime.InteropServices;
using System.Text;
using FullWidget.Native;

namespace FullWidget.Shell;

/// Keeps desktop-layer widgets visible through "Show desktop" (Win+D, the corner of the taskbar).
///
/// Those widgets sit just above the desktop window, owned by Progman. On Windows 11 24H2 and
/// later, Show desktop raises Progman and the widgets go up with it. On Windows 10 and earlier
/// Windows 11, it raises a separate desktop window (a WorkerW holding the icons) over everything,
/// and the widgets end up under it, hidden. So: when the desktop comes to the front, above every
/// app window, the widgets let go of Progman and stay always on top (without taking focus: Windows
/// keeps a background program's windows under the focused one otherwise); as soon as an app has
/// the focus again, they go back down above the desktop. Clicking an empty bit of desktop beside
/// an open app changes nothing: the desktop isn't in front of that app.
sealed class ShowDesktop : IDisposable
{
    const uint EVENT_SYSTEM_FOREGROUND = 3, WINEVENT_OUTOFCONTEXT = 0;
    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int obj, int child, uint thread, uint time);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc proc, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr hwnd);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
    const uint GW_HWNDNEXT = 2;
    const int DWMWA_CLOAKED = 14;

    readonly Action<bool> changed;
    readonly WinEventProc proc; // kept: the hook calls it for as long as it lives
    readonly IntPtr hook;
    readonly System.Windows.Forms.Timer settle = new() { Interval = 300 };

    /// True while the desktop is in front of every app window.
    public bool Shown { get; private set; }

    /// changed(true): lift the widgets; changed(false): put them back above the desktop.
    public ShowDesktop(Action<bool> changed)
    {
        this.changed = changed;
        proc = (_, _, _, _, _, _, _) => { Check(); settle.Stop(); settle.Start(); };
        hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, proc, 0, 0, WINEVENT_OUTOFCONTEXT);
        // the shell may still be moving windows when the event comes: look again a moment later
        settle.Tick += (_, _) => { settle.Stop(); Check(); };
    }

    /// Looks at the foreground window and what's in front; also called now and then, for a Win+D
    /// pressed while the desktop already had the focus (no foreground change then).
    public void Check()
    {
        var fg = Win32.GetForegroundWindow();
        if (fg == IntPtr.Zero) return;
        Win32.GetWindowThreadProcessId(fg, out uint pid);
        if (pid == Environment.ProcessId) return; // a widget or the control center: leave things as they are
        bool now = IsDesktop(fg) && DesktopInFront();
        if (now == Shown) return;
        Shown = now;
        changed(now);
    }

    static string ClassOf(IntPtr hwnd)
    {
        var sb = new StringBuilder(64);
        Win32.GetClassName(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    static bool IsDesktop(IntPtr hwnd) => ClassOf(hwnd) is "Progman" or "WorkerW";

    /// True when the first ordinary window from the top (visible, not always-on-top, not ours,
    /// not the taskbar) is the desktop: no app window is in front of it.
    static bool DesktopInFront()
    {
        for (var h = GetTopWindow(IntPtr.Zero); h != IntPtr.Zero; h = Win32.GetWindow(h, GW_HWNDNEXT))
        {
            if (!Win32.IsWindowVisible(h) || Win32.IsIconic(h)) continue;
            if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out int cloaked, 4) == 0 && cloaked != 0) continue; // on another virtual desktop, or a hidden UWP frame
            if ((Win32.GetWindowLongPtr(h, -20).ToInt64() & Win32.WS_EX_TOPMOST) != 0) continue; // taskbar, overlays
            Win32.GetWindowThreadProcessId(h, out uint pid);
            if (pid == Environment.ProcessId) continue; // our widgets
            if (!Win32.GetWindowRect(h, out var r) || r.Right - r.Left <= 1 || r.Bottom - r.Top <= 1) continue;
            return IsDesktop(h);
        }
        return false;
    }

    public void Dispose()
    {
        settle.Dispose();
        if (hook != IntPtr.Zero) UnhookWinEvent(hook);
    }
}
