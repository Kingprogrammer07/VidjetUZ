using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using FullWidget.Bridge;
using FullWidget.Windows;

namespace FullWidget.Providers;

/// widget.shell.run / widget.shell.exec: a command on this PC, its output handed back to the
/// widget. Only for widgets the user wrote (the "shell.run" permission can't come in a package).
/// Commands run hidden, in FullWidget's job (Native/Job.cs), and end when their widget closes.
sealed class Commands
{
    const int MaxOutputChars = 4 << 20, MaxRunning = 8;
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(30), MaxTimeout = TimeSpan.FromMinutes(10);

    readonly Dictionary<WidgetWindow, HashSet<Process>> running = new();

    static Commands() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    /// "utf-8" (default), "oem" (what console programs on this PC write by default) or "ansi".
    public static Encoding EncodingFor(string? name) => name?.ToLowerInvariant() switch
    {
        null or "" or "utf-8" or "utf8" => new UTF8Encoding(false),
        "oem" => Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage),
        "ansi" => Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.ANSICodePage),
        _ => throw new BridgeException($"unknown encoding '{name}' (utf-8, oem or ansi)"),
    };

    /// A command line for PowerShell (default) or cmd.
    public static ProcessStartInfo ForShell(string command, string? shell)
    {
        switch (shell?.ToLowerInvariant())
        {
            case null or "" or "powershell":
            {
                // UTF-8 in and out, no progress bars, errors as their plain message (not the whole
                // command echoed back); passed encoded so no quoting gets in the way
                // (the input is read here as UTF-8: Windows PowerShell's own $input would decode it with the OEM code page)
                string script = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=$OutputEncoding=New-Object Text.UTF8Encoding $false\n"
                    + "$__t=(New-Object IO.StreamReader([Console]::OpenStandardInput(),(New-Object Text.UTF8Encoding $false))).ReadToEnd()\n"
                    + "$__in=if($__t.Length){$__t.TrimEnd(\"`r`n\") -split \"`r?`n\"}else{@()}\n"
                    + "$__in | & {\n" + command + "\n} 2>&1 | ForEach-Object { if ($_ -is [Management.Automation.ErrorRecord]) { [Console]::Error.WriteLine($_.ToString()) } else { $_ } }";
                var psi = new ProcessStartInfo("powershell.exe");
                foreach (var a in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes(script)) })
                    psi.ArgumentList.Add(a);
                return psi;
            }
            case "cmd":
                // without a console there is no code page to switch: cmd writes in the OEM one (the default for it)
                return new ProcessStartInfo("cmd.exe") { Arguments = $"/d /s /c \"{command}\"" };
            default:
                throw new BridgeException($"unknown shell '{shell}' (powershell or cmd)");
        }
    }

    /// A program with its arguments, no shell in between.
    public static ProcessStartInfo ForProgram(string file, IEnumerable<string> args)
    {
        var psi = new ProcessStartInfo(file);
        foreach (var a in args) psi.ArgumentList.Add(a);
        return psi;
    }

    /// Runs it to the end (or the timeout) and returns { code, ok, stdout, stderr, timedOut, truncated }.
    public async Task<object> RunAsync(WidgetWindow w, ProcessStartInfo psi, string? input, TimeSpan timeout, Encoding encoding, bool powershell)
    {
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = psi.RedirectStandardOutput = psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = psi.StandardErrorEncoding = encoding;
        psi.StandardInputEncoding = new UTF8Encoding(false);
        if (string.IsNullOrEmpty(psi.WorkingDirectory)) psi.WorkingDirectory = w.Manifest.Dir;

        if (!running.TryGetValue(w, out var mine)) running[w] = mine = new HashSet<Process>();
        if (mine.Count >= MaxRunning) throw new BridgeException($"too many commands running at once ({MaxRunning})");
        Process proc;
        try { proc = Process.Start(psi) ?? throw new BridgeException($"could not start {psi.FileName}"); }
        catch (Win32Exception ex) { throw new BridgeException($"could not start {psi.FileName}: {ex.Message}"); }
        Native.Job.Add(proc);
        mine.Add(proc);
        try
        {
            var stdout = new Capture(proc.StandardOutput);
            var stderr = new Capture(proc.StandardError);
            try
            {
                if (input != null) await proc.StandardInput.WriteAsync(input);
                proc.StandardInput.Close();
            }
            catch (IOException) { /* it didn't read its input */ }

            bool timedOut = false;
            using (var cts = new CancellationTokenSource(timeout))
            {
                try { await proc.WaitForExitAsync(cts.Token); }
                catch (OperationCanceledException) { timedOut = true; Kill(proc); await proc.WaitForExitAsync(); }
            }
            // something it started may still hold the output open: take what came
            await Task.WhenAny(Task.WhenAll(stdout.Done, stderr.Done), Task.Delay(1500));
            string err = stderr.Text;
            if (powershell) err = FromClixml(err);
            return new
            {
                code = timedOut ? (int?)null : proc.ExitCode,
                ok = !timedOut && proc.ExitCode == 0,
                stdout = stdout.Text,
                stderr = err,
                timedOut,
                truncated = stdout.Truncated || stderr.Truncated,
            };
        }
        finally
        {
            mine.Remove(proc);
            if (mine.Count == 0) running.Remove(w);
            proc.Dispose();
        }
    }

    /// The widget closed: end what it started.
    public void Stop(WidgetWindow w)
    {
        if (!running.Remove(w, out var mine)) return;
        foreach (var p in mine) Kill(p);
    }

    public void StopAll()
    {
        foreach (var w in running.Keys.ToList()) Stop(w);
    }

    static void Kill(Process p)
    {
        try { if (!p.HasExited) p.Kill(entireProcessTree: true); }
        catch (Exception ex) when (ex is InvalidOperationException or Win32Exception or NotSupportedException) { }
    }

    /// Reads a stream to its end, keeping the first MaxOutputChars characters.
    sealed class Capture
    {
        readonly StringBuilder sb = new();
        public bool Truncated { get; private set; }
        public Task Done { get; }
        public string Text { get { lock (sb) return sb.ToString(); } }

        public Capture(StreamReader r) => Done = Task.Run(async () =>
        {
            var buf = new char[8192];
            try
            {
                for (int n; (n = await r.ReadAsync(buf)) > 0;)
                    lock (sb)
                    {
                        int room = MaxOutputChars - sb.Length;
                        if (n > room) Truncated = true;
                        if (room > 0) sb.Append(buf, 0, Math.Min(n, room));
                    }
            }
            catch (Exception ex) when (ex is IOException or ObjectDisposedException) { }
        });
    }

    /// Windows PowerShell writes errors to a redirected stderr as CLIXML; this turns them back into text.
    static string FromClixml(string s)
    {
        int at = s.IndexOf("#< CLIXML", StringComparison.Ordinal);
        if (at < 0) return s;
        var lines = Regex.Matches(s[at..], "<S S=\"(?:Error|Warning)\">(.*?)</S>", RegexOptions.Singleline)
            .Select(m => WebUtility.HtmlDecode(Regex.Replace(m.Groups[1].Value, "_x([0-9A-Fa-f]{4})_", x => ((char)Convert.ToInt32(x.Groups[1].Value, 16)).ToString())));
        return s[..at] + string.Concat(lines);
    }
}
