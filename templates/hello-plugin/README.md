# {title}

一個 FullWidget 插件：一個小程式，讓你自己寫的組件做到 FullWidget 還做不到的事。

- `plugin.json`：`run` 寫怎樣啟動它（這裏是 `main.ps1`，用 PowerShell 運行）。改了這個檔案要在控制中心再允許一次。
- `main.ps1`：從 stdin 每行讀一個請求 `{"id":1,"method":"hello","params":{...}}`，往 stdout 每行回一個 `{"id":1,"result":...}`；也可以隨時送出事件 `{"event":"tick","data":...}`。存檔後插件會自動重新啟動。

在你自己寫的組件裏用它：`widget.json` 的 `permissions` 加上 `"plugin:{name}"`，然後

```js
const hello = widget.plugin("{name}");
console.log(await hello.call("hello", { name: "小明" }));
console.log(await hello.call("top", { count: 3 }));
hello.on("tick", (d) => console.log("tick", d.time));
```

完整說明見開發文檔的「插件」一章。
