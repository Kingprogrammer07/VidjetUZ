/* The 1.4 update video: widgets that do more, mostly through plugins. Same format as 1.3 (number,
   title and one line on the left, the thing itself on the right). 120 BPM, beat = 0.5 s.
     0   FullWidget 1.4                     4   01 running commands
     11  02 plugins (the heart of it)       24  03 managing plugins
     31  04 official plugins + perf monitor 43  05 widget update reminders
     47  download (to 54)
   Every picture is a function of the time t (see engine.js); live widgets run on a virtual clock (live.js). */
(function () {
  "use strict";
  const { W, clamp, lerp, ease, prog, keys, style, el, letters, reveal, conceal, typed } = E;
  const stage = document.getElementById("stage");
  const px = (v) => `${v.toFixed(2)}px`;
  const bump = (p) => Math.sin(Math.PI * clamp(p));
  const DURATION = 54;

  // ───────────────────────── building blocks ─────────────────────────
  const shots = [];
  function shot(t0, t1, build) {
    const root = el("div", "layer", stage);
    style(root, { display: "none" });
    const s = { t0, t1, root, render: () => {} };
    Object.assign(s, build(root, s) || {});
    shots.push(s);
    return s;
  }
  const box = (parent, cls, x, y, w, h) => {
    const d = el("div", cls, parent);
    style(d, { left: px(x), top: px(y), ...(w != null ? { width: px(w) } : {}), ...(h != null ? { height: px(h) } : {}) });
    return d;
  };
  const LIVE = [];
  function live(parent, o, x, y, w, h) {
    const d = box(parent, "w shadowed", x, y, w, h);
    const frame = el("iframe", "", d);
    frame.setAttribute("scrolling", "no");
    const L = { o, el: d, frame, w: null };
    LIVE.push(L);
    return L;
  }
  const pop = (u, at, d = 0.45) => prog(u, at, d, ease.click);
  function popIn(node, u, at, { dy = 30, s0 = 0.92, extra = "" } = {}) {
    const p = pop(u, at);
    style(node, { opacity: clamp(p * 3).toFixed(4), transform: `translateY(${px(dy * (1 - p))}) scale(${lerp(s0, 1, p).toFixed(4)}) ${extra}` });
    return p;
  }
  const fadeIn = (node, u, at, d = 0.4, dy = 10) => { const p = prog(u, at, d, ease.out); style(node, { opacity: p.toFixed(4), transform: `translateY(${px(dy * (1 - p))})` }); return p; };
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const PLUG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v5M15 3v5M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 17v4"/></svg>';

  // a little syntax colouring for the code on screen
  function hl(line, lang) {
    let h = esc(line);
    const str = [], keep = (m) => `\u0000${str.push(m) - 1}\u0000`;
    h = h.replace(/"[^"]*"/g, keep);
    h = lang === "py" ? h.replace(/(#.*)$/, '<span class="c">$1</span>') : h.replace(/(\/\/.*)$/, '<span class="c">$1</span>');
    const kw = lang === "py" ? /\b(import|for|in|def|return|if)\b/g : /\b(const|await|async|function|return)\b/g;
    h = h.replace(kw, '<span class="k">$1</span>').replace(/\b(widget)\b/g, '<span class="o">$1</span>').replace(/\.(\w+)\(/g, '.<span class="f">$1</span>(');
    return h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<span class="s">${str[i]}</span>`);
  }
  /** A code card: a title bar and numbered lines; `lines` may be typed in later. */
  function codeCard(parent, x, y, w, h, title, lang, lines) {
    const c = box(parent, "code", x, y, w, h);
    c.innerHTML = `<div class="code-bar"><i></i><i></i><i></i><span>${esc(title)}</span></div><div class="code-body"></div>`;
    const body = c.querySelector(".code-body");
    const rows = lines.map((l, i) => { const r = el("div", "ln", body); r.innerHTML = `<b>${i + 1}</b><code></code>`; return { r, code: r.querySelector("code"), text: l, shown: null }; });
    return {
      el: c, rows,
      /** Shows each line, typed from `at` (a list of times, one per line; null = shown at once). */
      set(u, at = []) {
        rows.forEach((row, i) => {
          const a = at[i];
          const txt = a == null ? row.text : typed(row.text, u, a, 30);
          if (txt !== row.shown) { row.shown = txt; row.code.innerHTML = hl(txt, lang) + (a != null && txt.length < row.text.length && txt.length ? '<span class="caret"></span>' : ""); }
        });
      },
      mark(i) { rows.forEach((row, k) => row.r.classList.toggle("on", k === i)); },
    };
  }

  // the cursor and click ripples
  const top = el("div", "layer", stage);
  style(top, { zIndex: "50" });
  const cursor = el("div", "cursor", top, `<svg viewBox="0 0 24 24" width="46" height="46"><path d="M4 2.5v17.2l4.6-4.3 2.9 6.6 2.9-1.3-2.9-6.5h6.3z" fill="#fff" stroke="#111316" stroke-width="1.4" stroke-linejoin="round"/></svg>`);
  const ripple = el("div", "ripple", top);
  const CURSOR = []; // [t0, t1, (t) => { p: [x, y], o, down }]
  const CLICKS = [];

  // ───────────────────────── chapters along the bottom ─────────────────────────
  const CHAPTERS = [["执行命令", 4, 11], ["扩展插件", 11, 24], ["管理插件", 24, 31], ["官方插件", 31, 43], ["更新提醒", 43, 47]];
  const chap = el("div", "chap", top);
  const chapEls = CHAPTERS.map(([name]) => { const d = el("div", "", chap); const s = el("span", "", d); s.textContent = name; const u = el("u", "", d); const i = el("i", "", u); return { s, i }; });
  function renderChapters(t) {
    style(chap, { opacity: (prog(t, 4.1, 0.5) * (1 - prog(t, 46.7, 0.4))).toFixed(4) });
    CHAPTERS.forEach(([, a, b], k) => {
      const p = clamp((t - a) / (b - a));
      chapEls[k].s.classList.toggle("on", t >= a && t < b);
      style(chapEls[k].i, { width: `${(p * 100).toFixed(2)}%` });
    });
  }

  // ───────────────────────── a feature: text left, demo right ─────────────────────────
  const STAGE = { x: 860, y: 140, w: 920, h: 780 };
  function feature(t0, t1, { n, accent, title, desc, chips = [] }, demo) {
    return shot(t0, t1, (root) => {
      const len = t1 - t0;
      const glow = el("div", "glow", root);
      style(glow, { background: `radial-gradient(45% 55% at 72% 46%, ${hexA(accent, 0.2)}, transparent 72%), radial-gradient(40% 50% at 12% 30%, ${hexA(accent, 0.06)}, transparent 70%)` });
      const wrap = el("div", "layer", root);
      const num = box(wrap, "num", 150, 292);
      num.innerHTML = `<b style="color:${accent}">${n}</b><span> / 05　新功能</span>`;
      const tt = box(wrap, "title", 145, 340);
      const tl = letters(tt, title);
      const ds = box(wrap, "desc", 150, 474);
      ds.textContent = desc;
      const cs = box(wrap, "chips", 150, 690);
      style(cs, { "--accent": accent });
      const chipEls = chips.map((c) => el("b", "", cs, c));
      const sb = box(wrap, "stagebox", STAGE.x, STAGE.y, STAGE.w, STAGE.h);
      const tint = el("div", "tint", sb);
      style(tint, { background: `radial-gradient(80% 70% at 50% 0%, ${hexA(accent, 0.16)}, transparent 70%)` });
      const d = demo(sb, { chips: chipEls, t0 }) || {};
      return {
        render(t, u) {
          style(glow, { opacity: (prog(u, 0, 0.6) * (1 - prog(u, len - 0.3, 0.3))).toFixed(4) });
          reveal([num], u, 0.05, { dur: 0.5, rise: 0.4, blur: 6 });
          reveal(tl, u, 0.1, { stagger: 0.035, dur: 0.55, rise: 0.25, blur: 12 });
          reveal([ds], u, 0.35, { dur: 0.7, rise: 0.25, blur: 8 });
          chipEls.forEach((c, i) => popIn(c, u, 0.55 + i * 0.08, { dy: 14, s0: 0.96 }));
          const s = prog(u, 0.05, 0.7, ease.slide);
          style(sb, { opacity: s.toFixed(4), transform: `translateY(${px(50 * (1 - s))}) scale(${lerp(0.97, 1, s).toFixed(4)})` });
          if (d.render) d.render(t, u);
          conceal(wrap, u, len - 0.32, { dur: 0.32, lift: 16 });
        },
      };
    });
  }

  // ───────────────────────── intro (0–4) ─────────────────────────
  shot(0, 4, (root) => {
    const logo = el("img", "logo", root); logo.src = "../build/logo/logo.svg";
    style(logo, { left: px(W / 2 - 66), top: "250px" });
    const big = box(root, "big", 0, 410);
    const bl = letters(big, "FullWidget ");
    const em = el("em", "", big); em.textContent = "1.4";
    const sub = box(root, "sub", 0, 600);
    sub.textContent = "组件能做的事，不用再等更新";
    const menu = box(root, "menu", 0, 720);
    const items = CHAPTERS.map(([name], i) => el("b", i === 1 ? "hot" : "", menu, name));
    return {
      render(t, u) {
        popIn(logo, u, 0.0, { dy: 40, s0: 0.6 });
        reveal(bl, u, 0.45, { stagger: 0.04, dur: 0.5, rise: 0.25, blur: 14 });
        const e = prog(u, 0.95, 0.5, ease.click);
        style(em, { display: "inline-block", opacity: clamp(e * 3).toFixed(4), transform: `translateY(${px(30 * (1 - e))}) scale(${lerp(0.7, 1, e).toFixed(4)})` });
        reveal([sub], u, 1.5, { dur: 0.6, rise: 0.3, blur: 8 });
        items.forEach((b, i) => popIn(b, u, 2.0 + i * 0.12, { dy: 18 }));
        conceal(root, u, 3.6, { dur: 0.4, lift: 24 });
      },
    };
  });

  // ───────────────────────── 01 running commands (4–11) ─────────────────────────
  const GIT = "## main...origin/main [ahead 2]\n M App.cs\n M ui/app.js\nA  Core/Plugins.cs\n?? notes.md\n";
  feature(4, 11, {
    n: "01", accent: "#7de2c4", title: "执行命令",
    desc: "你自己写的组件，可以运行 PowerShell 或任何命令行程序，把输出拿回来显示。",
    chips: ["PowerShell", "cmd", "git · adb · ffmpeg …"],
  }, (sb) => {
    const code = codeCard(sb, 60, 60, 800, 250, "我的组件 · main.js", "js", [
      "// 问 git 这个仓库现在怎样",
      "const r = await widget.shell.exec(\"git\",",
      "  [\"status\", \"--short\", \"--branch\"]);",
      "show(r.stdout);",
    ]);
    const g = live(sb, { folder: "../promo/assets/update-1.4/gitstatus", t0: 6.4, shell: () => GIT }, 220, 340, 480, 320);
    g.el.classList.add("solid");
    const cap = box(sb, "cap", 60, 690); cap.textContent = "只有你自己写的组件能用，安装包和组件市场都不收";
    return {
      render(t, u) {
        popIn(code.el, u, 0.15, { dy: 30 });
        code.set(u, [null, 0.75, 1.95, 2.85]);
        code.mark(u > 3.3 && u < 4.6 ? 3 : u > 0.75 && u < 3.0 ? (u < 1.95 ? 1 : 2) : -1);
        popIn(g.el, u, 2.5, { dy: 40 });
        fadeIn(cap, u, 4.2);
      },
    };
  });

  // ───────────────────────── 02 plugins (11–24) ─────────────────────────
  // what travels between the widget and the plugin: [start (video time), from, to, text, kind]
  const MSG = [
    [13.4, "w", "p", '{"method":"scene","params":{"name":"直播"}}', "req"],
    [15.2, "p", "w", '{"id":1,"result":"ok"}', "res"],
    [17.4, "p", "w", '{"event":"changed","data":{"scene":"直播"}}', "evt"],
    [19.0, "p", "w", '{"event":"changed","data":{"scene":"游戏"}}', "evt"],
    [20.6, "p", "w", '{"event":"changed","data":{"scene":"休息"}}', "evt"],
  ];
  const TRAVEL = 1.25;
  feature(11, 24, {
    n: "02", accent: "#b69cff", title: "扩展插件",
    desc: "FullWidget 还做不到的事，不用等更新：写一个小程序当插件，你的组件就能用上。",
    chips: ["Python", "Node.js", "PowerShell", "C#", "任何语言"],
  }, (sb, { chips }) => {
    const nodes = [
      { k: "w", x: 40, label: "你的组件", sub: "widget.plugin(\"obs\")" },
      { k: "f", x: 350, label: "FullWidget", sub: "转交，管它的启动和结束" },
      { k: "p", x: 660, label: "插件 obs", sub: "python main.py" },
    ].map((n) => {
      const d = box(sb, `node node-${n.k}`, n.x, 40, 220, 150);
      d.innerHTML = (n.k === "f" ? `<img src="../build/logo/logo.svg" alt="">` : n.k === "p" ? `<span class="ic">${PLUG}</span>` : `<span class="ic wi"><i></i><i></i><i></i></span>`)
        + `<b>${esc(n.label)}</b><small>${esc(n.sub)}</small>`;
      return d;
    });
    const wires = [box(sb, "wire", 260, 114, 90, 4), box(sb, "wire", 570, 114, 90, 4)];
    const lane = box(sb, "lane", 40, 206, 840, 52);
    const bubbles = MSG.map(([, , , text, kind]) => { const b = el("div", `bubble ${kind}`, lane); b.textContent = text; return b; });
    const js = codeCard(sb, 40, 290, 410, 390, "组件 · main.js", "js", [
      "const obs = widget.plugin(\"obs\");",
      "",
      "await obs.call(\"scene\",",
      "  { name: \"直播\" });",
      "",
      "obs.on(\"changed\", (d) =>",
      "  show(d.scene));",
    ]);
    const py = codeCard(sb, 470, 290, 410, 390, "插件 · main.py", "py", [
      "for line in sys.stdin:",
      "    req = json.loads(line)",
      "    obs.set_scene(req[\"params\"])",
      "    reply(req[\"id\"], \"ok\")",
      "",
      "# 场景变了：主动告诉组件",
      "emit(\"changed\", {\"scene\": s})",
    ]);
    js.el.classList.add("narrow"); py.el.classList.add("narrow");
    const cap = box(sb, "cap", 40, 708); cap.textContent = "一行一个 JSON：组件发请求，插件回结果，也能随时推送";
    const W0 = 110, W1 = 770; // the lane's two ends (centres of the widget and the plugin)
    return {
      render(t, u) {
        nodes.forEach((n, i) => popIn(n, u, 0.2 + i * 0.15, { dy: 24 }));
        wires.forEach((w, i) => { const p = prog(u, 0.55 + i * 0.15, 0.4, ease.out); style(w, { transform: `scaleX(${p.toFixed(4)})`, opacity: p.toFixed(4) }); });
        popIn(js.el, u, 0.9, { dy: 30 });
        popIn(py.el, u, 1.05, { dy: 30 });
        js.set(u); py.set(u);
        fadeIn(cap, u, 1.6);
        // the messages: each slides along the lane, fading in and out at the ends
        let live = -1;
        MSG.forEach(([at, from, , , kind], i) => {
          const p = prog(t, at, TRAVEL, ease.inOut);
          const on = t >= at - 0.15 && t < at + TRAVEL + 0.25;
          if (on) live = i;
          const b = bubbles[i];
          const bw = b.offsetWidth || 400;
          const x = (from === "w" ? lerp(W0, W1, p) : lerp(W1, W0, p)) - bw / 2;
          const a = on ? clamp(prog(t, at - 0.15, 0.2) * (1 - prog(t, at + TRAVEL, 0.25))) : 0;
          style(b, { left: px(clamp(x, 0, 840 - bw)), opacity: a.toFixed(4) });
          b.classList.toggle("go", kind === "evt");
        });
        // the lines being run, on each side
        const k = live < 0 ? "" : MSG[live][4];
        js.mark(k === "req" ? 2 : k === "res" ? 3 : k === "evt" ? 5 : -1);
        py.mark(k === "req" ? 2 : k === "res" ? 3 : k === "evt" ? 6 : -1);
        nodes[0].classList.toggle("on", live >= 0 && (MSG[live][2] === "w" ? prog(t, MSG[live][0], TRAVEL) > 0.85 : prog(t, MSG[live][0], TRAVEL) < 0.2));
        nodes[2].classList.toggle("on", live >= 0 && (MSG[live][2] === "p" ? prog(t, MSG[live][0], TRAVEL) > 0.85 : prog(t, MSG[live][0], TRAVEL) < 0.2));
        nodes[1].classList.toggle("on", live >= 0 && Math.abs(prog(t, MSG[live][0], TRAVEL) - 0.5) < 0.18);
        // the languages, one after another
        const c = Math.floor((u - 2.2) / 1.6);
        chips.forEach((ch, i) => ch.classList.toggle("on", u > 2.2 && u < 10.2 && i === c % 4));
      },
    };
  });

  // ───────────────────────── 03 managing plugins (24–31) ─────────────────────────
  feature(24, 31, {
    n: "03", accent: "#4cc9f0", title: "管理插件",
    desc: "设置 → 插件：一键新建，允许之后才会运行。保存代码自动重启，崩溃了也会自己拉起来。",
    chips: ["允许才运行", "保存即重启", "崩溃自动重启", "随 FullWidget 退出"],
  }, (sb) => {
    const cc = box(sb, "cc", 40, 90, 840, 480);
    cc.innerHTML = `<div style="position:absolute;left:44px;top:38px" class="h">设置</div><div style="position:absolute;left:44px;top:104px" class="g">插件</div>
      <div class="r" style="top:140px;height:110px"><div class="lab">自己写插件<small>让你自己写的组件做到 FullWidget 还做不到的事</small></div><span class="btn primary">新建插件</span><span class="btn">打开文件夹</span></div>
      <div class="r" style="top:250px;height:110px"><div class="lab"><i class="pdot run"></i>hello<small>运行中 · 我的组件 在用</small></div><span class="mono">main.ps1</span><span class="btn">重新启动</span></div>
      <div class="r" style="top:360px;height:110px"><div class="lab"><i class="pdot" id="obs-dot"></i>obs<small id="obs-st">等你允许</small></div><span class="mono">python main.py</span><span class="slot" id="obs-btn"></span></div>`;
    const dot = cc.querySelector("#obs-dot"), st = cc.querySelector("#obs-st"), slot = cc.querySelector("#obs-btn");
    const dlg = box(sb, "dialog", 130, 150, 660, 430);
    dlg.innerHTML = `<div class="dh"><span class="warn">!</span><div><b>允许插件“obs”？</b><small>D:\\FullWidget\\data\\plugins\\obs</small></div></div>
      <p>允许后，你的组件用到它时，FullWidget 会用你的身份运行下面这个命令。</p><pre>python main.py</pre>
      <div class="df"><span class="btn">取消</span><span class="btn primary">允许</span></div>`;
    const toast = box(sb, "toast", 40, 620); toast.textContent = "✓ 已允许“obs”，插件开始运行";
    const S = { x: STAGE.x, y: STAGE.y };
    const A1 = [S.x + 40 + 840 - 44 - 50, S.y + 90 + 360 + 55]; // "允许" in the list
    const A2 = [S.x + 130 + 660 - 40 - 52, S.y + 150 + 430 - 46]; // "允许" in the dialog
    CURSOR.push([25.6, 29.4, (t) => ({ p: keys(t, [[25.6, [S.x + 760, S.y + 740]], [26.3, A1, ease.inOut], [27.5, A1], [28.2, A2, ease.inOut]]), o: prog(t, 25.6, 0.2) * (1 - prog(t, 29.0, 0.3)), down: false })]);
    CLICKS.push(26.4, 28.3);
    let last = "";
    return {
      render(t, u) {
        popIn(cc, u, 0.15, { dy: 40 });
        const on = t >= 28.3;
        const key = on ? "on" : "off";
        if (key !== last) {
          last = key;
          dot.className = on ? "pdot run" : "pdot wait";
          st.textContent = on ? "运行中 · OBS 场景 在用" : "等你允许";
          slot.innerHTML = on ? `<span class="btn">重新启动</span>` : `<span class="btn primary">允许</span>`;
        }
        const d = prog(t, 26.45, 0.35, ease.click) * (1 - prog(t, 28.35, 0.25, ease.in));
        style(dlg, { opacity: clamp(d * 2).toFixed(4), transform: `translateY(${px(20 * (1 - d))}) scale(${lerp(0.96, 1, d).toFixed(4)})`, display: d > 0.001 ? "block" : "none" });
        style(cc, { filter: d > 0.01 ? `brightness(${(1 - 0.45 * d).toFixed(3)})` : "none" });
        const tp = prog(t, 28.6, 0.45, ease.click);
        style(toast, { opacity: clamp(tp * 3).toFixed(4), transform: `translateY(${px(24 * (1 - tp))})` });
      },
    };
  });

  // ───────────────────────── 04 official plugins (31–43) ─────────────────────────
  const GB = 2 ** 30;
  const perfAt = (vt) => {
    const s = (vt - Live.BASE) / 1000;
    const fps = 141 + 6 * Math.sin(s * 1.3) + 4 * Math.sin(s * 3.7) - 26 * Math.max(0, Math.sin(s * 0.45) - 0.92) * 12;
    return {
      time: vt,
      gpus: [{ name: "GeForce RTX", util: Math.round(84 + 6 * Math.sin(s * 0.8)), vramUsed: (4.5 + 0.15 * Math.sin(s * 0.3)) * GB, vramTotal: 6 * GB, sharedUsed: 0, temp: 70 + Math.sin(s * 0.2), power: 91 + 4 * Math.sin(s), clock: 1702 }],
      fps: { state: "ok", value: Math.round(fps), process: "racer", title: "" },
    };
  };
  feature(31, 43, {
    n: "04", accent: "#f2b45c", title: "官方插件",
    desc: "组件市场新开官方插件专栏，只收 FullWidget 自己做的，源代码公开。第一个：性能数据。",
    chips: ["显卡占用", "显存", "温度和功耗", "游戏帧率"],
  }, (sb) => {
    // part one: the market, install the plugin
    const market = el("div", "layer", sb);
    const head = box(market, "mhead", 60, 60); head.innerHTML = `<b>官方插件</b><span>FullWidget 自己做的插件，只收官方的，源代码都公开</span>`;
    const card = box(market, "mcard", 60, 130, 400, 470);
    card.innerHTML = `<div class="mtop"><span class="tile">${PLUG}</span><div><b>性能数据</b><small><i class="badge">官方</i> v1.0.0</small></div></div>
      <p>显卡使用率、显存、温度和功耗，以及前台游戏的帧率，给“性能监控”这类组件用。</p>
      <div class="run">在你的电脑上运行 <code>main.ps1</code></div><div class="mfoot"><span class="kb">10 KB</span><span class="slot"></span></div>`;
    const slot = card.querySelector(".slot");
    const wcard = box(market, "mcard", 490, 130, 370, 470);
    wcard.innerHTML = `<div class="thumb"><img src="../market/widgets/hmgvibe.perf-monitor/preview/instrument.zh-CN.webp" alt=""></div>
      <b class="wt">性能监控</b><small class="by">hmgvibe · v1.0.0 · 只在线上市场</small><div class="run">需要：<i class="badge">官方插件 性能数据</i></div>`;
    const B = [STAGE.x + 60 + 400 - 28 - 46, STAGE.y + 130 + 470 - 46];
    CURSOR.push([32.3, 34.6, (t) => ({ p: keys(t, [[32.3, [STAGE.x + 700, STAGE.y + 740]], [33.0, B, ease.inOut]]), o: prog(t, 32.3, 0.2) * (1 - prog(t, 34.2, 0.3)), down: false })]);
    CLICKS.push(33.1);
    // part two: the performance monitor over a game
    const game = box(sb, "game", 40, 40, 840, 620);
    game.innerHTML = `<div class="sun"></div><div class="hills"></div><div class="road"><i></i><i></i><i></i><i></i></div>`;
    const stripes = [...game.querySelectorAll(".road i")];
    const perf = live(sb, { folder: "../market/widgets/hmgvibe.perf-monitor", t0: 31, plugin: perfAt,
      script: "history.length = 0; for (let i = 0; i < 54; i++) history.push(Math.round(140 + 7 * Math.sin(i / 3.5) + 4 * Math.sin(i / 1.4) - (i > 36 && i < 41 ? 30 : 0)));" }, 160, 210, 600, 345);
    perf.el.classList.add("solid");
    const cap1 = box(sb, "cap", 40, 690); cap1.textContent = "性能监控：只在线上市场，配合官方插件“性能数据”";
    const cap2 = box(sb, "cap", 40, 690); cap2.textContent = "帧率要 Windows 授权一次，组件上点一下就行";
    let last = "";
    return {
      render(t, u) {
        const out = prog(t, 35.4, 0.45, ease.in);
        style(market, { opacity: (1 - out).toFixed(4), transform: `translateX(${px(-60 * out)})`, display: out < 1 ? "block" : "none" });
        fadeIn(head, u, 0.2);
        popIn(card, u, 0.3, { dy: 40 });
        popIn(wcard, u, 0.45, { dy: 40 });
        const phase = t < 33.1 ? 0 : t < 34.0 ? 1 : 2;
        if (String(phase) !== last) {
          last = String(phase);
          slot.innerHTML = phase === 0 ? `<span class="btn primary">安装</span>` : phase === 1 ? `<span class="btn" style="opacity:.6">下载中…</span>` : `<span class="have">✓ 已安装 v1.0.0</span>`;
        }
        const gin = prog(t, 35.6, 0.6, ease.slide);
        style(game, { opacity: gin.toFixed(4), transform: `scale(${lerp(1.04, 1, gin).toFixed(4)})` });
        stripes.forEach((s, i) => { const z = ((t * 0.9 + i / 4) % 1); style(s, { top: `${(62 + 38 * z * z).toFixed(2)}%`, width: `${(0.25 + 1.4 * z * z).toFixed(2)}%`, height: `${(0.8 + 9 * z * z).toFixed(2)}%`, opacity: (0.25 + 0.6 * z).toFixed(3) }); });
        const pin = prog(t, 36.0, 0.5, ease.click);
        style(perf.el, { opacity: clamp(pin * 3).toFixed(4), transform: `translateY(${px(30 * (1 - pin))}) scale(${lerp(0.94, 1, pin).toFixed(4)})` });
        const c1 = prog(t, 36.6, 0.4, ease.out) * (1 - prog(t, 39.6, 0.3));
        style(cap1, { opacity: c1.toFixed(4), transform: `translateY(${px(10 * (1 - c1))})` });
        const c2 = prog(t, 40.0, 0.4, ease.out);
        style(cap2, { opacity: c2.toFixed(4), transform: `translateY(${px(10 * (1 - c2))})` });
      },
    };
  });

  // ───────────────────────── 05 widget update reminders (43–47) ─────────────────────────
  feature(43, 47, {
    n: "05", accent: "#7de2c4", title: "组件更新提醒",
    desc: "你装的组件出了新版本，托盘提醒一次，点一下就到更新页面。默认关闭，在设置里打开。",
  }, (sb) => {
    const cc = box(sb, "cc", 40, 120, 840, 150);
    cc.innerHTML = `<div class="r" style="top:20px;height:110px"><div class="lab">组件更新提醒<small>每天看一两次你装的组件有没有新版本，只连组件市场</small></div><div class="tog"></div></div>`;
    const tog = cc.querySelector(".tog");
    const desk = box(sb, "minidesk", 40, 320, 840, 400);
    const toast = box(desk, "wtoast", 300, 176, 520);
    toast.innerHTML = `<div class="th"><img src="../build/logo/logo.svg" alt=""><span>FullWidget</span><i>×</i></div><b>“逐时天气”有新版本 1.1.1，点这里更新。</b>`;
    const bar = box(desk, "taskbar", 0, 352, 840, 48);
    bar.innerHTML = `<span class="tray"><img src="../build/logo/logo.svg" alt=""><span>17:30</span></span>`;
    return {
      render(t, u) {
        popIn(cc, u, 0.15, { dy: 30 });
        const on = prog(t, 43.9, 0.25, ease.click);
        tog.classList.toggle("on", on > 0.5);
        style(tog, { "--k": on.toFixed(4) });
        popIn(desk, u, 0.3, { dy: 30, s0: 0.98 });
        const tp = prog(t, 44.6, 0.5, ease.slide);
        style(toast, { opacity: clamp(tp * 2).toFixed(4), transform: `translateX(${px(80 * (1 - tp))})` });
      },
    };
  });

  // ───────────────────────── outro (47–54) ─────────────────────────
  shot(47, DURATION + 1, (root) => {
    const logo = el("img", "logo", root); logo.src = "../build/logo/logo.svg";
    style(logo, { left: px(W / 2 - 66), top: "250px" });
    const big = box(root, "big", 0, 410);
    const bl = letters(big, "FullWidget ");
    const em = el("em", "", big); em.textContent = "1.4";
    const sub = box(root, "sub", 0, 600); sub.textContent = "组件能做的事，由你来扩展";
    const url = box(root, "url", 0, 720); url.innerHTML = `<b>免费下载</b><span>hmgvibe.github.io/FullWidget</span>`;
    const nl = box(root, "note-line", 0, 850); nl.textContent = "插件怎么写：控制中心 → 设置 → 开发文档";
    return {
      render(t, u) {
        popIn(logo, u, 0.0, { dy: 40, s0: 0.6 });
        reveal(bl, u, 0.3, { stagger: 0.04, dur: 0.5, rise: 0.25, blur: 14 });
        const e = prog(u, 0.75, 0.5, ease.click);
        style(em, { display: "inline-block", opacity: clamp(e * 3).toFixed(4), transform: `translateY(${px(30 * (1 - e))}) scale(${lerp(0.7, 1, e).toFixed(4)})` });
        reveal([sub], u, 1.2, { dur: 0.6, rise: 0.3, blur: 8 });
        popIn(url, u, 1.7, { dy: 24 });
        reveal([nl], u, 2.3, { dur: 0.6, rise: 0.3, blur: 6 });
        style(root, { opacity: (1 - prog(t, DURATION - 0.8, 0.8, ease.in)).toFixed(4) });
      },
    };
  });

  // ───────────────────────── the frame ─────────────────────────
  function renderCursor(t) {
    let st = null;
    for (const [a, b, f] of CURSOR) if (t >= a && t < b) st = f(t);
    if (!st) { style(cursor, { opacity: "0" }); style(ripple, { opacity: "0" }); return; }
    let pr = 0;
    for (const c of CLICKS) pr = Math.max(pr, bump(prog(t, c - 0.05, 0.18, ease.linear)));
    style(cursor, { left: px(st.p[0]), top: px(st.p[1]), opacity: st.o.toFixed(4), transform: `scale(${(1 - 0.12 * Math.max(pr, st.down ? 1 : 0)).toFixed(4)})` });
    let rp = -1;
    for (const c of CLICKS) if (t >= c && t < c + 0.45) rp = (t - c) / 0.45;
    style(ripple, { left: px(st.p[0]), top: px(st.p[1]), opacity: rp < 0 ? "0" : (0.9 * (1 - rp) * st.o).toFixed(4), transform: `scale(${rp < 0 ? 0.3 : lerp(0.3, 1.2, ease.out(rp)).toFixed(4)})` });
  }

  function render(t) {
    for (const s of shots) {
      const on = t >= s.t0 && t < s.t1;
      style(s.root, { display: on ? "block" : "none" });
      if (on) s.render(t, t - s.t0);
    }
    renderChapters(t);
    renderCursor(t);
  }

  async function ready() {
    for (const s of shots) style(s.root, { display: "block" });
    const imgs = [...stage.querySelectorAll("img")];
    await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => { i.onload = i.onerror = r; })).then(() => i.decode().catch(() => {}))));
    for (const L of LIVE) L.w = await Live.mount(L.frame, L.o);
    await document.fonts.ready;
  }

  async function sync(t) {
    for (const L of LIVE) if (L.w) L.w.sync(t);
  }

  window.SCENES = {
    ready, render, sync, duration: DURATION,
    marks: [[0, "开场"], ...CHAPTERS.map(([n, a]) => [a, n]), [47, "结尾"]],
  };
})();
