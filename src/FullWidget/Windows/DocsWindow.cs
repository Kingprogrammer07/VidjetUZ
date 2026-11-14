using System.Diagnostics;
using System.Text.Json;
using FullWidget.Core;
using FullWidget.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using static FullWidget.Native.Win32;

namespace FullWidget.Windows;

/// Shows a developer guide (docs/組件開發指南.md or docs/插件開發指南.md) rendered in the control
/// center's style. Links between the guides open the other one here.
sealed class DocsWindow : Form
{
    const string Host = "docs.fullwidget.local";
    static readonly Color Surface = Color.FromArgb(14, 16, 19);

    readonly App app;
    readonly WebView2 web;
    string which;
    bool ready;

    public DocsWindow(App app, string which)
    {
        this.app = app;
        this.which = which;
        Text = $"{Strings.AppName} {Strings.DocsTitle}";
        Icon = AppIcon.Create();
        BackColor = Surface;
        StartPosition = FormStartPosition.Manual;
        web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Surface };
        Controls.Add(web);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int dark = 1;
        DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, 4);
        uint caption = (uint)(Surface.B << 16 | Surface.G << 8 | Surface.R);
        DwmSetWindowAttribute(Handle, DWMWA_CAPTION_COLOR, ref caption, 4);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        double s = DeviceDpi / 96.0;
        MinimumSize = new Size((int)(640 * s), (int)(480 * s));
        var wa = Screen.FromPoint(Cursor.Position).WorkingArea;
        var size = new Size(Math.Min((int)(1120 * s), wa.Width - 40), Math.Min((int)(780 * s), wa.Height - 40));
        Bounds = new Rectangle(wa.Left + (wa.Width - size.Width) / 2 + (int)(24 * s), wa.Top + (wa.Height - size.Height) / 2 + (int)(24 * s), size.Width, size.Height);
        try
        {
            await web.EnsureCoreWebView2Async(app.Env);
            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = app.Config.Data.DeveloperMode;
            core.Settings.AreDefaultContextMenusEnabled = true; // copy text
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.SetVirtualHostNameToFolderMapping(Host, Paths.DocsUiDir, CoreWebView2HostResourceAccessKind.Allow);
            core.WebMessageReceived += OnMessage;
            // Links to the web open in the user's browser; nothing else may replace the page.
            core.NewWindowRequested += (_, a) => { a.Handled = true; OpenExternal(a.Uri); };
            core.NavigationStarting += (_, a) =>
            {
                if (a.Uri.StartsWith($"https://{Host}/", StringComparison.OrdinalIgnoreCase)) return;
                a.Cancel = true;
                OpenExternal(a.Uri);
            };
            core.Navigate($"https://{Host}/index.html");
        }
        catch (Exception ex)
        {
            Log.Error("Docs window failed to load", ex);
        }
    }

    /// Shows the other guide ("widget" or "plugin"), or the same one again.
    public void ShowGuide(string which, string? anchor = null)
    {
        this.which = which;
        if (ready) Send(anchor);
    }

    void Send(string? anchor = null)
    {
        string text;
        try { text = File.ReadAllText(Paths.Guide(which)); }
        catch (IOException ex) { text = $"# {Strings.GuideMissing}\n\n{ex.Message}"; }
        web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { ev = "doc", d = text, lang = Strings.Lang, which, anchor }, Json.Web));
    }

    static void OpenExternal(string uri)
    {
        if (Uri.TryCreate(uri, UriKind.Absolute, out var u) && u.Scheme is "http" or "https")
            Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
    }

    void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonElement msg;
        try { msg = JsonSerializer.Deserialize<JsonElement>(e.WebMessageAsJson); }
        catch { return; }
        if (msg.ValueKind != JsonValueKind.Object || !msg.TryGetProperty("m", out var m)) return;
        switch (m.GetString())
        {
            case "ready":
                ready = true;
                Send();
                break;
            case "open": // a link to the other guide
                if (msg.TryGetProperty("href", out var h) && h.GetString() is { } href && Paths.GuideFor(href) is { } other)
                {
                    int hash = href.IndexOf('#');
                    ShowGuide(other, hash >= 0 ? Uri.UnescapeDataString(href[(hash + 1)..]) : null);
                }
                break;
        }
    }
}
