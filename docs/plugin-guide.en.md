# FullWidget plugin guide

A plugin is a small program you write for yourself, so the widgets you write can do what FullWidget can't do yet: read data from another app, talk to hardware, call tools on your PC, run some Python… in any language you like.

This guide is complete on purpose: you can hand it to an AI and have it write the plugin and the widget that uses it.

中文：[插件開發指南](插件開發指南.md)（繁體）　·　[插件开发指南](插件开发指南.md)（简体）

- [Let an AI do it](#let-an-ai-do-it)
- [What a plugin is](#what-a-plugin-is)
- [Try one in five minutes](#try-one-in-five-minutes)
- [The folder and plugin.json](#the-folder-and-pluginjson)
- [The protocol](#the-protocol)
- [When it runs](#when-it-runs)
- [Using it in a widget](#using-it-in-a-widget)
- [Complete examples](#complete-examples)
- [Debugging](#debugging)
- [Safety and limits](#safety-and-limits)
- [Common errors](#common-errors)
- [Before you're done](#before-youre-done)

---

## Let an AI do it

1. Press **Copy all** at the top right of this guide (on GitHub, use the copy button at the top right of the file).
2. Open the AI you use (ChatGPT, Claude, Gemini…), paste it, and then say what you want. For example:

```
Above is the FullWidget plugin guide. Please make me a plugin and a widget that uses it:

What I want: show on my desktop whether OBS is streaming and for how long; clicking it starts or stops the stream.
Language I'll use: Python (Python 3.12 is installed)
Plugin name: obs

Please give me:
1. The full content of every file in the plugin folder (plugin.json and the program), and what to install first.
2. The full content of every file in the widget folder (widget.json, index.html, main.js, style.css).
3. Where to put them, how to allow the plugin in the Control Center, and how to test it.
```

3. Create the files the AI gives you:
   - The plugin goes in the plugins folder: Control Center → Settings → Plugins → Open folder, then make a folder named like the plugin.
   - Make the widget with Control Center → Add widgets → New widget, then paste the AI's files into it.
4. Back in Control Center → Settings → Plugins, press **Allow** on the plugin's row.
5. If something goes wrong, paste the error and the last few dozen lines of `app.log` back to the AI (see [Debugging](#debugging)).

How to write the widget itself (widget.json, themes, layout, the other APIs) is in the [widget guide](widget-guide.en.md). Giving the AI both works best.

---

## What a plugin is

A plugin is a folder in the plugins folder, with:

- `plugin.json`: its name and how to start it.
- The program: a script (`.py`, `.js`, `.ps1`, `.bat`) or an `.exe`, in any language.

FullWidget runs it as a separate program (with no window) and talks to it over **standard input and standard output**, one JSON object per line:

```
widget  ──widget.plugin("obs").call("status")──▶  FullWidget  ──{"id":1,"method":"status"}──▶  plugin
widget  ◀──────────── result ───────────────────  FullWidget  ◀──{"id":1,"result":{...}}──────  plugin
widget  ◀──────── .on("changed", …) ────────────  FullWidget  ◀──{"event":"changed",...}──────  plugin (any time)
```

**When you need one:**

| What you want | Use |
|---|---|
| Data from the web | No plugin: `widget.fetch` in the widget (`network:` permission) |
| Run a command now and then and show its output | No plugin: `widget.shell.run` or `widget.shell.exec` in the widget (`shell.run` permission, see the [widget guide](widget-guide.en.md)) |
| Something that stays running, keeps state, or sends data all the time (connected to OBS, watching hardware, reading a sensor every second) | A plugin |
| A library from some language (Python's `psutil`, a Node SDK) | A plugin |
| A command that is slow to start each time | A plugin: it starts once, and every call after that is quick |

**Limits:** only widgets you wrote can use your plugins. Widgets made with New widget can use them right away; a widget you copied into the widgets folder needs its permissions allowed once under My widgets in the Control Center. Widgets that use plugins can't be packed into packages (.fwz) and aren't accepted on the widget market.

---

## Try one in five minutes

1. Control Center → Settings → Plugins → **New plugin**, named `hello`. FullWidget makes a working PowerShell plugin, opens its folder and allows it.
2. Control Center → Add widgets → **New widget**.
3. In the widget's `widget.json`, add `"plugin:hello"` to `permissions`:

```json
"permissions": ["plugin:hello"]
```

4. In the widget's `main.js`:

```js
const hello = widget.plugin("hello");
document.body.textContent = await hello.call("hello", { name: "Sam" });
hello.on("tick", (d) => console.log("the plugin says it is", d.time));
```

The widget shows "Hello, Sam! …". The example's `main.ps1` has comments; start from there.

---

## The folder and plugin.json

The plugins folder is `plugins` in FullWidget's data folder, usually `%AppData%\FullWidget\plugins` (Control Center → Settings → Plugins → Open folder):

```
plugins\
  obs\                 the folder's name is the plugin's name
    plugin.json
    main.py
    requirements.txt   (up to you: anything else the plugin needs)
```

**Plugin name** (the folder's name): letters, digits, `.`, `_` and `-`, starting with a letter or digit, up to 64 characters, case doesn't matter. Names starting with `fullwidget.` are kept for the [official plugins](#official-plugins).

**plugin.json:**

```json
{
  "name": "OBS",
  "description": "Reads whether OBS is streaming or recording, and starts and stops them.",
  "run": "main.py",
  "idleMinutes": 5
}
```

| Field | Required | |
|---|---|---|
| `run` | yes | How to start it. See below |
| `name` | no | The name in the Control Center; the folder's name by default. May be `{"zh-TW": "…", "zh-CN": "…", "en": "…"}` |
| `description` | no | One sentence on what it does, shown in the Control Center. May be per language too |
| `idleMinutes` | no | Stop it after this many minutes with no widget using it; `5` by default. `0` keeps it running until FullWidget exits. At most 1440 |
| `version` | no | A version like `"1.0.0"`, shown in the Control Center |

Save it as UTF-8 (a BOM is fine). It may have `//` comments and trailing commas.

**What `run` can be:** it runs in the plugin's folder.

| `run` | What runs |
|---|---|
| `"main.py"` | `python main.py` (Python installed, `python` on PATH) |
| `"main.js"` or `"main.mjs"` | `node main.js` (Node.js installed) |
| `"main.ps1"` | `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File main.ps1` (Windows PowerShell 5.1, built in) |
| `"main.bat"` or `"main.cmd"` | `cmd.exe /d /s /c main.bat` |
| `"bin\\tool.exe --port 4455"` | That program, with those arguments |
| `"python -u main.py --verbose"` | Any full command works too |
| `"\"C:\\Program Files\\My Tool\\tool.exe\" --serve"` | Quote a path with spaces |
| `"pwsh -NoProfile -File main.ps1"` | PowerShell 7 |
| `".venv\\Scripts\\python.exe main.py"` | A Python virtual environment in the plugin's folder |

**Change plugin.json and it needs allowing again.** FullWidget remembers plugin.json's exact content; when it changes (even by a space), the plugin goes back to "waiting for you to allow it". Changing the program itself doesn't.

---

## The protocol

Every message is **one JSON object on one line**, UTF-8, ending with a newline. No newlines inside the JSON (a newline in a string is `\n`, which JSON libraries do by default).

### From FullWidget to the plugin (standard input)

```json
{"id": 1, "method": "hello", "params": {"name": "Sam"}, "widget": "user.my-widget", "instance": "a1b2c3"}
```

| Field | |
|---|---|
| `id` | An integer numbering this request. Send it back in the answer |
| `method` | A string: the first argument of the widget's `call` |
| `params` | The second argument of `call`, any JSON value; `null` when there was none |
| `widget` | The id of the calling widget (`id` in its `widget.json`) |
| `instance` | Which one on the desktop (differs when the same widget is placed twice) |

### The plugin's answer (standard output)

Success:

```json
{"id": 1, "result": "Hello, Sam"}
```

`result` may be any JSON value (string, number, object, array, `null`). It's what the widget's `await plugin.call(...)` gets.

Failure:

```json
{"id": 1, "error": "Can't find OBS. Is it open?"}
```

Make `error` a sentence for people: the widget's promise rejects and `e.message` is that sentence. A `{"message": "…"}` object works too.

- Answer every request exactly once. Without an answer, the widget's call fails after its timeout (30 s by default).
- Answers may come in any order: FullWidget may send the next request before you've answered. Do slow work on another thread or asynchronously, and handle later requests meanwhile.
- An answer for an unknown `id` (say, one that already timed out) is ignored.

### Events from the plugin (standard output)

```json
{"event": "changed", "data": {"streaming": true, "seconds": 125}}
```

Send these at any time, without a request. Every widget listening with `.on()` gets it; with nobody listening it's dropped. `event` is a string, `data` any JSON value.

### Rules

- **Standard output is only for these three kinds of JSON lines.** Anything else (`print("debug")`, progress bars, a library's warnings) makes FullWidget write a warning to its log and is ignored. Write messages for yourself to **standard error** (stderr): they go to `app.log`, marked `[plugin name]`.
- **Flush after every line**, or it sits in a buffer and FullWidget never gets it:
  - Python: `print(..., flush=True)` (FullWidget also sets `PYTHONUNBUFFERED=1`).
  - Node.js: `process.stdout.write(json + "\n")` goes out at once.
  - C#: `Console.Out.Flush()`.
  - PowerShell: `[Console]::Out.WriteLine(...)` then `[Console]::Out.Flush()`.
- **UTF-8 everywhere**, without a BOM. FullWidget sets `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` for Python. In C# and PowerShell set the output encoding yourself (see the examples).
- When several threads write to standard output, use a lock and write whole lines, or two lines get mixed.
- **Standard input closing** (end of file) means FullWidget wants you to stop: tidy up and exit. After 3 seconds the plugin is ended.

### Environment variables

| Variable | |
|---|---|
| `FULLWIDGET_PLUGIN` | The plugin's name |
| `FULLWIDGET_VERSION` | FullWidget's version, like `1.4.0` |
| `FULLWIDGET_LANG` | The interface language: `zh-TW`, `zh-CN` or `en`, e.g. for error messages |

The working folder is the plugin's folder, so relative paths reach your own files.

---

## When it runs

- **It starts when first used.** FullWidget starts it the first time a widget calls `call` or `on`. All widgets share that one program.
- **It stops when unused.** With no widget listening with `on` and no request waiting, after `idleMinutes` minutes FullWidget closes its standard input so it exits. It starts again when next needed. Use `"idleMinutes": 0` to keep it running.
- **It restarts if it stops on its own.** When the plugin exits by itself (an error, a crash) and widgets are still listening to its events, FullWidget starts it again after 1, 5, 15 and 30 seconds. Requests waiting for an answer fail at once.
- **It's left stopped if it keeps crashing.** After 5 stops in 3 minutes FullWidget stops restarting it; the Control Center shows it kept stopping, with the last error. Fix it, then press **Restart** under Settings → Plugins.
- **Saving restarts it.** When a file in the plugin's folder changes, a running plugin restarts by itself.
- **It ends with FullWidget.** When FullWidget exits, the plugin and every program it started end too; nothing is left running in the background.

So start quickly, never wait for someone to type, and keep any state you need in a file (read it back after a restart).

---

## Using it in a widget

**1. Declare the permission** in the widget's `widget.json`:

```json
"permissions": ["plugin:obs"]
```

One `plugin:name` for each plugin it uses.

**2. Call methods:**

```js
const obs = widget.plugin("obs");

try {
  const s = await obs.call("status");                       // waits for the plugin's result
  render(s);
} catch (e) {
  show(e.message);                                          // the plugin's error, or why the plugin can't run
}

await obs.call("start", { scene: "Live" });                 // the second argument is the plugin's params
await obs.call("export", null, { timeout: 120_000 });       // slow work: wait up to 120 s (30 s by default, 10 minutes at most)
```

**3. Listen to events:**

```js
const off = obs.on("changed", (data) => render(data));     // the plugin sent {"event":"changed","data":…}
obs.on("*", (data, event) => console.log(event, data));    // "*" gets every event
off();                                                      // stop listening
```

- `on` starts the plugin if needed and keeps it running while you listen.
- When the widget closes or reloads, FullWidget stops its listening for you.
- After the plugin restarts, events keep coming without another `on`. But the plugin's state after a restart is yours to fetch again: usually the plugin sends one event with its whole state when it starts, or the widget calls it now and then.

**4. Handle a plugin that can't run.** A failed `call` may mean the plugin isn't allowed yet, isn't installed, or keeps crashing. Show `e.message` in the widget so people know where to look. See [Common errors](#common-errors).

TypeScript types are in `sdk/widget.d.ts`:

```ts
interface Plugin {
  readonly name: string;
  call<T = any>(method: string, params?: any, options?: { timeout?: number }): Promise<T>;
  on(event: string, listener: (data: any, event: string) => void): () => void;
}
```

---

## Complete examples

These four plugins do exactly the same; pick the language you know:

- Method `hello`: params `{"name": "Sam"}`, answers `"Hello, Sam"`.
- Method `add`: params `{"a": 1, "b": 2}`, answers `3`.
- Method `slow`: answers `"done"` after 3 seconds, showing slow work doesn't hold up other requests.
- Any other method answers with an error.
- An event `tick` every 5 seconds: `{"time": "14:03:05"}`.

Each works as it is, with this widget:

**The widget's `widget.json`** (the `permissions` line is what matters):

```json
{
  "id": "user.plugin-demo",
  "name": "Plugin demo",
  "version": "1.0.0",
  "entry": "index.html",
  "size": { "width": 260, "height": 140 },
  "permissions": ["plugin:demo"]
}
```

**The widget's `index.html`** (FullWidget adds the `widget` object and the base styles itself):

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
  <div id="hello" class="w-title">…</div>
  <div id="tick" class="w-label">Waiting for the plugin's first tick</div>
  <script src="main.js"></script>
</body>
</html>
```

**The widget's `main.js`:**

```js
const demo = widget.plugin("demo");
const $ = (id) => document.getElementById(id);

try {
  $("hello").textContent = await demo.call("hello", { name: "Sam" });
  console.log("1 + 2 =", await demo.call("add", { a: 1, b: 2 }));
} catch (e) {
  $("hello").textContent = "The plugin can't run: " + e.message;
}

demo.on("tick", (d) => { $("tick").textContent = "Plugin time " + d.time; });
```

### Python

Folder `plugins\demo\`. Install [Python 3](https://www.python.org/downloads/) first (tick "Add python.exe to PATH").

`plugin.json`:

```json
{ "name": "Demo (Python)", "run": "main.py" }
```

`main.py`:

```python
import json, sys, threading, time

lock = threading.Lock()

def send(obj):
    """One JSON line to stdout. Several threads write, hence the lock."""
    line = json.dumps(obj, ensure_ascii=False)
    with lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()

def log(*args):
    """Messages for yourself: stderr, which ends up in FullWidget's app.log."""
    print(*args, file=sys.stderr, flush=True)

def slow(params):
    time.sleep(3)
    return "done"

METHODS = {
    "hello": lambda p: f"Hello, {p['name']}",
    "add": lambda p: p["a"] + p["b"],
    "slow": slow,
}

def handle(req):
    try:
        fn = METHODS.get(req.get("method"))
        if fn is None:
            send({"id": req["id"], "error": f"no method {req.get('method')}"})
            return
        send({"id": req["id"], "result": fn(req.get("params") or {})})
    except Exception as e:
        send({"id": req.get("id"), "error": f"{type(e).__name__}: {e}"})

def ticker():
    while True:
        time.sleep(5)
        send({"event": "tick", "data": {"time": time.strftime("%H:%M:%S")}})

log("started")
threading.Thread(target=ticker, daemon=True).start()
for line in sys.stdin:                      # end of input: FullWidget wants us to stop
    if not line.strip():
        continue
    req = json.loads(line)
    # a thread per request: a slow "slow" doesn't hold up the ones after it
    threading.Thread(target=handle, args=(req,), daemon=True).start()
log("stopping")
```

For other packages, open a terminal in the plugin's folder and run `python -m pip install <package>`. To keep them apart from your other Python projects, make a virtual environment (`python -m venv .venv`, then `.venv\Scripts\pip install <package>`) and set `run` to `".venv\\Scripts\\python.exe main.py"`.

### Node.js

Folder `plugins\demo\`. Install [Node.js](https://nodejs.org/) first.

`plugin.json`:

```json
{ "name": "Demo (Node.js)", "run": "main.js" }
```

`main.js`:

```js
const readline = require("node:readline");

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const log = (...args) => console.error(...args);   // stderr → FullWidget's app.log

const methods = {
  hello: (p) => `Hello, ${p.name}`,
  add: (p) => p.a + p.b,
  slow: () => new Promise((r) => setTimeout(() => r("done"), 3000)),
};

async function handle(req) {
  const fn = methods[req.method];
  if (!fn) return send({ id: req.id, error: `no method ${req.method}` });
  try {
    send({ id: req.id, result: await fn(req.params || {}) });
  } catch (e) {
    send({ id: req.id, error: String(e && e.message || e) });
  }
}

log("started");
const timer = setInterval(() => send({ event: "tick", data: { time: new Date().toTimeString().slice(0, 8) } }), 5000);

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => { if (line.trim()) handle(JSON.parse(line)); });   // no await: requests run side by side
rl.on("close", () => { log("stopping"); clearInterval(timer); process.exit(0); });   // stdin closed: stop
```

`console.log` writes to stdout, so don't debug with it in a plugin; use `console.error`. For npm packages, run `npm install <package>` in the plugin's folder; `node_modules` in the plugin's folder is fine.

### PowerShell

Nothing to install; it comes with Windows. Folder `plugins\demo\`. Save the files as **UTF-8 with BOM** if they contain anything beyond English (Notepad: Save as → Encoding: UTF-8 with BOM).

`plugin.json`:

```json
{ "name": "Demo (PowerShell)", "run": "main.ps1" }
```

`main.ps1`:

```powershell
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false

function Send($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 10))
  [Console]::Out.Flush()
}
function Log($text) { [Console]::Error.WriteLine($text) }   # stderr → app.log

$methods = @{
  hello = { param($p) "Hello, $($p.name)" }
  add   = { param($p) $p.a + $p.b }
  slow  = { param($p) Start-Sleep -Seconds 3; "done" }
}

function Answer($text) {
  $req = $null
  try {
    $req = $text | ConvertFrom-Json
    $m = $methods[$req.method]
    if (-not $m) { Send @{ id = $req.id; error = "no method $($req.method)" }; return }
    Send @{ id = $req.id; result = (& $m $req.params) }
  } catch {
    Send @{ id = $(if ($req) { $req.id } else { $null }); error = $_.Exception.Message }
  }
}

Log "started"
# Read with OpenStandardInput: in Windows PowerShell 5.1, [Console]::In blocks the whole program while it waits
$reader = New-Object IO.StreamReader([Console]::OpenStandardInput(), (New-Object Text.UTF8Encoding $false))
$next = $reader.ReadLineAsync()
$lastTick = Get-Date
while ($true) {
  if (-not $next.Wait(500)) {
    if (((Get-Date) - $lastTick).TotalSeconds -ge 5) {
      $lastTick = Get-Date
      Send @{ event = "tick"; data = @{ time = (Get-Date -Format "HH:mm:ss") } }
    }
    continue
  }
  $text = $next.Result
  if ($null -eq $text) { break }          # stdin closed: stop
  if ($text.Trim()) { Answer $text }
  $next = $reader.ReadLineAsync()
}
Log "stopping"
```

PowerShell does one thing at a time: during `slow`'s 3 seconds, other requests and ticks wait. For slow work, Python, Node.js or C# suit better, or schedule it yourself with `Start-Job`.

### C#

Good for Windows APIs, or when you want a single `.exe`. Install the [.NET SDK](https://dotnet.microsoft.com/download) first.

Make the project anywhere except the plugins folder (otherwise every build restarts the plugin):

```bat
dotnet new console -n DemoPlugin
cd DemoPlugin
```

`Program.cs`:

```csharp
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

Console.OutputEncoding = new UTF8Encoding(false);
Console.InputEncoding = new UTF8Encoding(false);
var stdout = Console.Out;
var gate = new object();

void Send(JsonObject obj)
{
    string line = obj.ToJsonString();                 // one line, no indenting
    lock (gate) { stdout.WriteLine(line); stdout.Flush(); }
}
void Log(string text) => Console.Error.WriteLine(text);   // stderr → app.log

async Task<JsonNode?> Run(string method, JsonNode? p) => method switch
{
    "hello" => $"Hello, {(string?)p?["name"]}",
    "add" => (double)p!["a"]! + (double)p!["b"]!,
    "slow" => await Task.Delay(3000).ContinueWith(_ => (JsonNode?)"done"),
    _ => throw new InvalidOperationException($"no method {method}"),
};

async Task Handle(string text)
{
    JsonNode? id = null;
    try
    {
        var req = JsonNode.Parse(text)!.AsObject();
        id = req["id"]?.DeepClone();
        var result = await Run((string)req["method"]!, req["params"]);
        Send(new JsonObject { ["id"] = id, ["result"] = result });
    }
    catch (Exception e)
    {
        Send(new JsonObject { ["id"] = id, ["error"] = e.Message });
    }
}

Log("started");
using var timer = new Timer(_ => Send(new JsonObject
{
    ["event"] = "tick",
    ["data"] = new JsonObject { ["time"] = DateTime.Now.ToString("HH:mm:ss") },
}), null, 5000, 5000);

while (Console.ReadLine() is string line)             // null: stdin closed, stop
    if (line.Trim().Length > 0) _ = Task.Run(() => Handle(line));   // a new line each time, never overwritten by the next
Log("stopping");
```

Build it into one `.exe` in the plugin's folder:

```bat
dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o "%AppData%\FullWidget\plugins\demo\bin"
```

`plugin.json`:

```json
{ "name": "Demo (C#)", "run": "bin\\DemoPlugin.exe" }
```

With `--self-contained false` the exe is small and uses .NET 9, which FullWidget needs anyway. If you use FullWidget's full build that runs without installing anything, use `--self-contained true` instead.

### Other languages

Any language that reads standard input and writes standard output works (Go, Rust, Java, Ruby, AutoHotkey v2…). Follow [the protocol](#the-protocol) and put the command that starts it in `run`.

---

## Debugging

**Test the plugin on its own in a terminal first.** Open a terminal in the plugin's folder, feed it a request and see what comes back:

```bat
echo {"id":1,"method":"hello","params":{"name":"test"}} | python main.py
```

```powershell
'{"id":1,"method":"hello","params":{"name":"test"}}' | node main.js
```

You should see one line, `{"id":1,"result":"Hello, test"}`. You can also run `python main.py` on its own, paste JSON lines and press Enter to see the answers; Ctrl+Z then Enter (on Windows) ends the input, and the plugin should exit.

**Read the log.** `%LocalAppData%\FullWidget\logs\app.log` has:

- `Plugin demo: started (main.py), pid 1234`: it started, and with which command.
- `[plugin demo] …`: what the plugin wrote to stderr, including Python's tracebacks.
- `[plugin demo] wrote something that isn't a JSON line`: something other than JSON went to standard output.
- `Plugin demo: exited on its own (exit code 1)`: the plugin ended by itself; look above for its error.
- `Plugin demo: could not start "…"`: the command is wrong, or `python` or `node` isn't on PATH.

**Look in the Control Center.** Each row under Settings → Plugins shows the state (running, not running, waiting for you to allow it, kept stopping), which widgets use it, and the last error. A running plugin can be restarted or stopped there.

**Look in the widget.** Turn on Developer mode under Settings in the Control Center and press F12 on the widget: failed calls show in the Console.

---

## Safety and limits

- A plugin runs as you and can do anything you can on this PC. So a plugin runs only once you **allow** it under Settings → Plugins, which shows the command it will run; after plugin.json changes, it needs allowing again.
- Only widgets you wrote can use plugins. Widgets from packages (.fwz) and from the market can't use yours ([official plugins](#official-plugins) aside); a widget you copied in by hand needs you to allow it under My widgets.
- Plugins can't go in packages, and the market doesn't take widgets that use them. To share one, give someone both the plugin folder and the widget folder, and let them put them in place and allow them.
- When someone asks you to put a folder in `plugins`, look at what it does first.

### Official plugins

The widget market has an Official plugins section with FullWidget's own plugins only, all named `fullwidget.…`, their source public in the [market's plugins folder](https://github.com/hmgvibe/fullwidget-market/tree/main/plugins). Install them in the Control Center under Add widgets → Online → Official plugins; once installed they're allowed. Any widget, market ones included, may use them, e.g. `"plugin:fullwidget.perf"`.

| Official plugin | Provides |
|---|---|
| `fullwidget.perf` Performance data | A `stats` event every second: GPU load, video memory, temperature, power and clock, and the frame rate of the game in front. Methods: `stats`, `info`, `enableFps`. See its [README](https://github.com/hmgvibe/fullwidget-market/tree/main/plugins/fullwidget.perf) |

---

## Common errors

What `e.message` says when a widget's `call` fails:

| Message | Why, and what to do |
|---|---|
| `no plugin "demo" (looked for …\plugin.json)` | There's no `demo\plugin.json` in the plugins folder. Check the folder's name and place |
| `plugin "demo": plugin.json: …` | plugin.json isn't valid JSON, or has no `run` |
| `plugin "demo" hasn't been allowed yet` | Press Allow under Settings → Plugins |
| `plugin "demo" could not start "…"` | The command in `run` wasn't found: a wrong path, or Python or Node isn't installed or on PATH |
| `plugin "demo" didn't answer "hello" within 30 s` | No answer: no flush, a wrong `id`, stuck, or really slow work (wait longer with `{ timeout }`) |
| `plugin "demo" stopped (exit code 1)` | The plugin ended before answering; see its error in `app.log` |
| `plugin "demo" kept stopping and was left stopped` | 5 crashes in 3 minutes. Fix it, then press Restart under Settings → Plugins |
| `plugin "demo" was stopped` | You pressed Stop in the Control Center, or the plugin restarted |
| `permission denied: add "plugin:demo" to permissions in widget.json` | `"plugin:demo"` is missing from `permissions` in `widget.json` |
| `permission "plugin:demo" is declared but the user has not allowed it yet` | The widget was copied in by hand: allow its permissions under My widgets → this widget |
| `built-in widgets don't use "plugin:demo"` | FullWidget's built-in widgets can't use plugins; use a widget you made |
| The plugin's own `error` | Passed through as it is, e.g. `no method foo` |

---

## Before you're done

A checklist for you (or the AI):

- [ ] The plugin folder's name is the name in `widget.plugin("…")`, and `widget.json` has the `"plugin:name"` permission.
- [ ] `plugin.json` has `run`, and running that command in the plugin's folder starts it.
- [ ] Standard output gets only JSON lines, each flushed; debug messages go to stderr.
- [ ] Every request is answered once with its `id`; failures answer with `error` instead of crashing.
- [ ] Slow work doesn't hold up other requests (threads in Python, async in Node, Tasks in C#).
- [ ] It exits when standard input ends.
- [ ] Input and output are UTF-8.
- [ ] Tested in a terminal with `echo {...} | command`, with the right answer.
- [ ] The widget handles a failed `call` and shows `e.message`.
