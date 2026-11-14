# {title}

一个 FullWidget 插件：一个小程序，让你自己写的组件做到 FullWidget 还做不到的事。

- `plugin.json`：`run` 写怎样启动它（这里是 `main.ps1`，用 PowerShell 运行）。改了这个文件要在控制中心再允许一次。
- `main.ps1`：从 stdin 每行读一个请求 `{"id":1,"method":"hello","params":{...}}`，往 stdout 每行回一个 `{"id":1,"result":...}`；也可以随时发出事件 `{"event":"tick","data":...}`。保存后插件会自动重新启动。

在你自己写的组件里用它：`widget.json` 的 `permissions` 加上 `"plugin:{name}"`，然后

```js
const hello = widget.plugin("{name}");
console.log(await hello.call("hello", { name: "小明" }));
console.log(await hello.call("top", { count: 3 }));
hello.on("tick", (d) => console.log("tick", d.time));
```

完整说明见开发文档的“插件”一章。
