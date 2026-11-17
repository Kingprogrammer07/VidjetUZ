# Microsoft Store 上架說明

FullWidget 以 MSIX 套件上架 Microsoft Store。Store 會用微軟的證書替套件簽名，不用自己買證書；從 Store 安裝的用戶也不會看到「未知的發行者」警告。

GitHub 上的版本照舊（安裝程式和兩個 zip，有自己的更新器）。兩種版本可以並存。

## Store 版和 GitHub 版的差別

程式碼只有一份，程式啟動時自己判斷是不是從 Store 安裝的（`Shell/StorePackage.cs`）。

| | GitHub 版 | Store 版 |
|---|---|---|
| 更新 | 程式內的更新器（設定 → 關於） | Store 自動更新；設定頁只顯示「由 Microsoft Store 更新。」，沒有「檢查更新」和「自動檢查更新」 |
| 開機自動啟動 | 登錄檔的 Run 項目 | 套件裏的啟動工作，由 Windows 開關，也會出現在「設定 → 應用 → 啟動」。預設關閉 |
| 雙擊 .fwz 安裝 | 設定裏的開關，寫到登錄檔 | 套件自帶，設定頁不顯示這一項 |
| 資料位置 | `%APPDATA%\FullWidget` | `%LOCALAPPDATA%\Packages\<套件名>\LocalCache\Roaming\FullWidget`。設定頁的「資料位置 → 打開」照樣能用 |
| 解除安裝 | 資料留着 | 資料跟着刪掉（Windows 對 Store 應用的規定） |

- **第一次啟動 Store 版**：如果這台電腦裝過 GitHub 版，會把它的設定、組件和插件複製一份過來；GitHub 版的資料不動。
- **用戶在 Windows 的「啟動」設定裏關掉了自動啟動**：程式不能自己打開，設定頁會改成提示，並提供「打開設定」按鈕。

## 打包

```bash
powershell -ExecutionPolicy Bypass -File build/msix/make-msix.ps1
```

- 會打包自帶 .NET 的版本（跟 `-full` zip 一樣），輸出到 `dist\FullWidget-<版本>-x64.msix`，約 49 MB。還沒建置時會先建置。
- 需要 Windows SDK（`makeappx.exe`、`makepri.exe`）。
- 套件的身分從 `build/msix/identity.json` 讀取。這個檔案要等 Partner Center 給了身分後才建（見下一節）。
- 版本號取自 `FullWidget.csproj`，後面補 `.0`。例如 1.4.1 會寫成 `1.4.1.0`，Store 要求最後一位是 0。
- 圖標由 `build/make-icon.ps1 -Msix` 從 logo 畫出來，包括工作列、開始選單、磁貼和啟動畫面各種尺寸。

### 在自己電腦上試

```bash
powershell -ExecutionPolicy Bypass -File build/msix/make-msix.ps1 -Test
```

- 這會用測試身分 `FullWidget.Test` 打包。
- 未簽名的套件不能直接安裝。開了 Windows 的開發人員模式後，可以登記資料夾來安裝：

```powershell
Add-AppxPackage -Register D:\Claude\Widget\dist\msix\package\AppxManifest.xml
```

- 從開始選單打開「FullWidget」就是 Store 版的行為。
- 試完用 `Get-AppxPackage FullWidget.Test | Remove-AppxPackage` 移除，它的資料會一起刪掉。

2026-11-17 測過（測試身分）：
- 資料寫在套件資料夾，檔案總管看得到。
- 原有的設定和組件複製過來了，組件照常啟動。
- 設定頁正確：沒有更新項目，也沒有 .fwz 開關。
- 開機自動啟動能打開和關閉，重新啟動後狀態正確。

## 上架步驟

### 1. 開發者帳號（只做一次）

1. 到 <https://storedeveloper.microsoft.com> 註冊個人帳號。免費，用個人的 Microsoft 帳號登入。
2. 用身分證件和自拍完成身分驗證。
3. 「發行者顯示名稱」填 **hmgvibe**。這會顯示在 Store 頁面上，取代真名。

### 2. 保留名稱，拿到套件身分（只做一次）

1. Partner Center → **Apps and games → New product → MSIX or PWA app**，保留名稱 **FullWidget**。
2. 進入這個應用 → **Product management → Product identity**，抄下三個值，存成 `build/msix/identity.json`：

```json
{
  "Name": "Package/Identity/Name 的值",
  "Publisher": "Package/Identity/Publisher 的值，例如 CN=XXXXXXXX-XXXX-…",
  "PublisherDisplayName": "Package/Properties/PublisherDisplayName 的值"
}
```

這三個值不是秘密，可以提交到倉庫。

### 3. 打包

執行上面「打包」一節的指令，得到 `dist\FullWidget-<版本>-x64.msix`。

### 4. 建立提交（Submission）

| 欄位 | 填什麼 |
|---|---|
| Pricing and availability | 免費（Free）；市場選全部 |
| Properties → Category | Personalization（個人化） |
| Properties → Privacy policy | `https://github.com/hmgvibe/FullWidget#privacy`（README 的隱私一節） |
| Properties → Website / Support | `https://hmgvibe.github.io/FullWidget/`；支援填 `https://github.com/hmgvibe/FullWidget/issues` |
| Properties → System requirements | 不用填 |
| Age ratings | 填問卷：沒有暴力等內容；**會**連網（天氣等），**沒有**用戶之間的交流；**不**收集個人資料。結果應該是 3+ / Everyone |
| Packages | 上傳 `.msix` |
| Store listings | 加三種語言：繁體中文（zh-TW）、簡體中文（zh-CN）、英文（en-US），內容見下面 |
| Submission options → Notes for certification | 見最後一節。會用到 `runFullTrust`，也有插件和線上組件，**一定要寫**，審核比較容易過 |

### 5. 送審

送出後通常幾小時到三個工作天會有結果。沒通過的話，Partner Center 會寫出原因。

### 以後每次發新版本

1. 照常發佈 GitHub 版本（改 csproj 版本號、打標籤）。
2. 執行 `make-msix.ps1`。
3. Partner Center → **Update** 一個新的提交，只換 Packages 裏的 `.msix`，其他欄位會沿用。

## 商店頁面文字

### 繁體中文（zh-TW）

**描述**

FullWidget 是一個不一樣的 Windows 桌面小組件：免費、開源，沒有帳號、廣告和統計。

裝好就有 38 個組件：時鐘、日曆、天氣、系統監控、網速、待辦清單、便籤、倒數日、番茄鐘、媒體控制、相框、新聞訂閱、匯率……點一下就放上桌面，拖動時會自動對齊。

想改多深就改多深：三套主題一鍵換掉整個桌面；顏色、透明度、圓角、字體在控制中心邊調邊看；表單不夠用時，直接寫 CSS。每個組件可以置頂、普通或沉到桌面層，可以鎖定、滑鼠穿透，底可以是卡片、毛玻璃或完全透明。

不夠用就自己加：一個組件就是一個小網頁（HTML、CSS、JS），附完整的開發文檔，可以整份交給 AI 幫你寫。還可以接插件，或從組件市場安裝別人做的組件；別人的組件安裝前會列出它要用的權限，你同意才裝。

所有組件共用一個網頁引擎；全螢幕玩遊戲或看影片時自動暫停，不搶效能。

**簡短描述**

免費、開源的 Windows 桌面小組件。裝好就有 38 個組件，外觀隨你改，功能隨你加。

**功能（Features）**

- 38 個內建組件：時鐘、天氣、系統監控、待辦、便籤、媒體控制等
- 三套主題，一鍵換掉整個桌面
- 顏色、透明度、圓角、字體可調，也能直接寫 CSS
- 拖動自動對齊；置頂、普通或放在桌面層
- 組件市場：一鍵安裝別人做的組件
- 用 HTML、CSS、JS 寫自己的組件，可以接插件
- 全螢幕時自動暫停，不搶效能
- 沒有帳號、廣告和統計

**搜尋詞**：小組件、桌面美化、時鐘、天氣、系統監控、widget、桌面

### 簡體中文（zh-CN）

**描述**

FullWidget 是一个不一样的 Windows 桌面小组件：免费、开源，没有账号、广告和统计。

装好就有 38 个组件：时钟、日历、天气、系统监控、网速、待办清单、便签、倒数日、番茄钟、媒体控制、相框、新闻订阅、汇率……点一下就放上桌面，拖动时会自动对齐。

想改多深就改多深：三套主题一键换掉整个桌面；颜色、透明度、圆角、字体在控制中心边调边看；表单不够用时，直接写 CSS。每个组件可以置顶、普通或沉到桌面层，可以锁定、鼠标穿透，底可以是卡片、毛玻璃或完全透明。

不够用就自己加：一个组件就是一个小网页（HTML、CSS、JS），附完整的开发文档，可以整份交给 AI 帮你写。还可以接插件，或从组件市场安装别人做的组件；别人的组件安装前会列出它要用的权限，你同意才装。

所有组件共用一个网页引擎；全屏玩游戏或看视频时自动暂停，不抢性能。

**简短描述**

免费、开源的 Windows 桌面小组件。装好就有 38 个组件，外观随你改，功能随你加。

**功能（Features）**

- 38 个内置组件：时钟、天气、系统监控、待办、便签、媒体控制等
- 三套主题，一键换掉整个桌面
- 颜色、透明度、圆角、字体可调，也能直接写 CSS
- 拖动自动对齐；置顶、普通或放在桌面层
- 组件市场：一键安装别人做的组件
- 用 HTML、CSS、JS 写自己的组件，可以接插件
- 全屏时自动暂停，不抢性能
- 没有账号、广告和统计

**搜索词**：小组件、桌面美化、时钟、天气、系统监控、widget、桌面

### English (en-US)

**Description**

FullWidget is a different kind of desktop widget for Windows: free, open source, with no account, no ads and no tracking.

38 widgets are ready the moment it's installed: clocks, calendar, weather, system monitor, network speed, to-do list, notes, countdowns, Pomodoro timer, media controls, photo frame, news feeds, exchange rates and more. One click puts one on your desktop, and widgets snap into line as you drag them.

Change as much as you like: three themes restyle the whole desktop at once; colors, opacity, corners and fonts are adjusted live in the Control Center; and when that isn't enough, write CSS. Each widget can stay on top, sit with your windows or sink to the desktop, and can be locked or made click-through, on a card, frosted glass or no background at all.

Add what's missing: a widget is a small web page (HTML, CSS, JS), with a complete guide you can hand to an AI to write one for you. Connect plugins, or install widgets other people made from the widget market; before installing, each one lists what it needs, and nothing is installed without your OK.

All widgets share one web engine, and they pause while a game or video is full screen.

**Short description**

Free, open-source desktop widgets for Windows. 38 widgets the moment it's installed; change how they look, add what's missing.

**Features**

- 38 built-in widgets: clocks, weather, system monitor, to-do, notes, media controls and more
- Three themes that restyle the whole desktop at once
- Adjust colors, opacity, corners and fonts, or write CSS
- Snap-to-align dragging; always on top, normal, or on the desktop layer
- Widget market: install widgets other people made in one click
- Write your own widgets in HTML, CSS and JS, and connect plugins
- Pauses during full-screen games and videos
- No account, no ads, no tracking

**Search terms**: widgets, desktop widgets, clock, weather, system monitor, customization, desktop

### 截圖

- 至少 1 張，建議 4–6 張。PNG，1366×768 或更大（建議 1920×1080 或 2560×1440）。
- 三種語言可以共用一組，也可以各放一組。
- 建議內容：桌面上的一組組件、三套主題對比、控制中心的外觀設定、添加組件頁、組件市場。

## Notes for certification（貼到提交的「Notes for certification」欄）

```
FullWidget is a desktop widget host: a full-trust WinForms app that shows widgets (small HTML pages in WebView2) on the desktop.

Why runFullTrust: widgets are placed on the desktop layer next to the wallpaper, and show system information (CPU, memory, disks, network, battery, media sessions), which needs Win32 APIs.

No account or sign-in is needed. There are no ads, no analytics and no tracking. The privacy policy lists every network connection: https://github.com/hmgvibe/FullWidget#privacy

How to test: start FullWidget; a clock, weather and system monitor widget appear on the desktop. Click the FullWidget icon in the notification area to open the Control Center, where widgets are added, themed and configured.

Community widgets and plugins are a core, described feature. They are only installed when the user chooses to, from the in-app widget market (Control Center > Add widgets > Online) or from a .fwz file. Before installing, the app lists the websites and system features a widget asks for, and installs it only after the user agrees. Widgets run isolated in WebView2. Plugins (local helper programs, e.g. for GPU temperature) can only be used by widgets the user wrote themselves, not by downloaded widgets.

The Store version does not update itself: its built-in updater is turned off, and updates come through the Store. Starting with Windows uses the package's startup task and is off until the user turns it on.
```
