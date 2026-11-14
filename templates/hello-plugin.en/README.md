# {title}

A FullWidget plugin: a small program that lets widgets you write do what FullWidget can't do yet.

- `plugin.json`: `run` says how to start it (here `main.ps1`, run with PowerShell). After changing this file, allow the plugin again in the control center.
- `main.ps1`: reads one request per line from stdin, `{"id":1,"method":"hello","params":{...}}`, and answers with one line on stdout, `{"id":1,"result":...}`; it can also send events at any time, `{"event":"tick","data":...}`. Saving restarts the plugin.

Use it from a widget you wrote: add `"plugin:{name}"` to `permissions` in `widget.json`, then

```js
const hello = widget.plugin("{name}");
console.log(await hello.call("hello", { name: "Sam" }));
console.log(await hello.call("top", { count: 3 }));
hello.on("tick", (d) => console.log("tick", d.time));
```

The full details are in the plugin guide: Control Center → Settings → Plugins → Plugin guide. You can hand the whole guide to an AI and have it change this plugin for you.
