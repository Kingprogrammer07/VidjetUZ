/* The 1.3 update video: what's new, one feature per chapter, the same layout each time (number,
   title and one line on the left, the real widget doing it on the right). 120 BPM, beat = 0.5 s.
     0   FullWidget 1.3, what changed            4   01 lyrics
     11  02 shortcuts                            19  03 Bank of China rates
     24  04 memory halved                        29  05 updating in the app
     34  06 monitors                             39  fixes
     42  download (to 48)
   Every picture is a function of the time t (see engine.js); live widgets run on a virtual clock (live.js). */
(function () {
  "use strict";
  const { W, H, clamp, lerp, ease, prog, keys, style, el, letters, reveal, conceal, typed } = E;
  const stage = document.getElementById("stage");
  const px = (v) => `${v.toFixed(2)}px`;
  const bump = (p) => Math.sin(Math.PI * clamp(p));
  const DURATION = 48;

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
  const SIZE = { clock: [600, 300], weather: [640, 400], sysinfo: [600, 420], calendar: [600, 600], media: [680, 272], forecast: [720, 420] };
  function picture(parent, folder, x, y, w) {
    const h = (w * SIZE[folder][1]) / SIZE[folder][0];
    const d = box(parent, "w shadowed", x, y, w, h);
    const img = el("img", "", d);
    img.src = folder === "clock" ? "assets/clock-0941.instrument.zh-CN.png" : `../site/assets/widgets/${folder}/instrument.zh-CN.webp`;
    return { el: d, x, y, w, h };
  }
  const LIVE = [];
  function live(parent, o, x, y, w, h) {
    const d = box(parent, "w shadowed", x, y, w, h);
    const frame = el("iframe", "", d);
    frame.setAttribute("scrolling", "no");
    const L = { o, el: d, frame, w: null };
    LIVE.push(L);
    return L;
  }
  /** Things pop in from below with a little overshoot. */
  const pop = (u, at, d = 0.45) => prog(u, at, d, ease.click);
  function popIn(node, u, at, { dy = 30, s0 = 0.92, extra = "" } = {}) {
    const p = pop(u, at);
    style(node, { opacity: clamp(p * 3).toFixed(4), transform: `translateY(${px(dy * (1 - p))}) scale(${lerp(s0, 1, p).toFixed(4)}) ${extra}` });
    return p;
  }
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

  // the cursor and click ripples
  const top = el("div", "layer", stage);
  style(top, { zIndex: "50" });
  const cursor = el("div", "cursor", top, `<svg viewBox="0 0 24 24" width="46" height="46"><path d="M4 2.5v17.2l4.6-4.3 2.9 6.6 2.9-1.3-2.9-6.5h6.3z" fill="#fff" stroke="#111316" stroke-width="1.4" stroke-linejoin="round"/></svg>`);
  const ripple = el("div", "ripple", top);
  const CURSOR = []; // [t0, t1, (t) => { p: [x, y], o, down }]
  const CLICKS = [];

  // ───────────────────────── chapters along the bottom ─────────────────────────
  const CHAPTERS = [["歌词", 4, 11], ["快捷键", 11, 19], ["中行汇率", 19, 24], ["内存减半", 24, 29], ["软件内更新", 29, 34], ["多显示器", 34, 39], ["修复", 39, 42]];
  const chap = el("div", "chap", top);
  const chapEls = CHAPTERS.map(([name]) => { const d = el("div", "", chap); const s = el("span", "", d); s.textContent = name; const u = el("u", "", d); const i = el("i", "", u); return { s, i }; });
  function renderChapters(t) {
    style(chap, { opacity: (prog(t, 4.1, 0.5) * (1 - prog(t, 41.7, 0.4))).toFixed(4) });
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
      num.innerHTML = n ? `<b style="color:${accent}">${n}</b><span> / 06　新功能</span>` : `<b style="color:${accent}">＋</b><span>　问题修复</span>`;
      const tt = box(wrap, "title", 145, 340);
      const tl = letters(tt, title);
      const ds = box(wrap, "desc", 150, 474);
      ds.textContent = desc;
      const cs = box(wrap, "chips", 150, 640);
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
    const em = el("em", "", big); em.textContent = "1.3";
    const sub = box(root, "sub", 0, 600);
    sub.textContent = "这次更新了什么";
    const menu = box(root, "menu", 0, 720);
    const items = CHAPTERS.slice(0, 6).map(([name]) => el("b", "", menu, name));
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

  // ───────────────────────── 01 lyrics (4–11) ─────────────────────────
  const LYRICS = [
    [70000, "海风吹过窗台的贝壳"], [73200, "你说夏天会走得很慢"], [76400, "我们把影子留在沙滩"],
    [78400, "等一朵浪花慢慢靠岸"], [80400, "晴天的海边 我们还在"], [82400, "把今天写进日记最后一页"],
    [84400, "风一吹 就翻开"], [86400, "那片蓝色的海"],
  ].map(([t, text]) => ({ t, text }));
  feature(4, 11, {
    n: "01", accent: "#7de2c4", title: "同步歌词",
    desc: "媒体控制组件显示正在播放的歌词，跟着进度走，不会配错版本。",
    chips: ["网易云音乐", "QQ音乐", "酷狗音乐"],
  }, (sb) => {
    const X = 120, Y = 170, WD = 680, H0 = 272, H1 = 470;
    const m = live(sb, { folder: "media", t0: 4, lyrics: LYRICS }, X, Y, WD, H0);
    const c1 = box(sb, "cap", 120, 90); c1.textContent = "正在唱的那句，就在歌手那一行";
    const c2 = box(sb, "cap", 120, 90); c2.textContent = "拉高卡片，变成滚动歌词";
    const HK = [[7.1, H0], [8.2, H1, ease.inOut]];
    const sx = STAGE.x, sy = STAGE.y;
    CURSOR.push([6.4, 9.4, (t) => {
      const h = keys(t, HK);
      const p = t < 7.05 ? keys(t, [[6.4, [sx + 760, sy + 700]], [7.0, [sx + X + WD / 2, sy + Y + H0 - 4], ease.inOut]]) : [sx + X + WD / 2, sy + Y + h - 4];
      return { p, o: prog(t, 6.4, 0.2) * (1 - prog(t, 9.0, 0.3)), down: t >= 7.05 && t < 8.25 };
    }]);
    CLICKS.push(7.05);
    return {
      render(t, u) {
        popIn(m.el, u, 0.15, { dy: 40 });
        style(m.el, { height: px(keys(t, HK)) });
        const a = prog(u, 0.9, 0.4, ease.out) * (1 - prog(u, 2.9, 0.3));
        style(c1, { opacity: a.toFixed(4), transform: `translateY(${px(10 * (1 - a))})` });
        const b = prog(u, 4.3, 0.4, ease.out);
        style(c2, { opacity: b.toFixed(4), transform: `translateY(${px(10 * (1 - b))})` });
      },
    };
  });

  // ───────────────────────── 02 shortcuts (11–19) ─────────────────────────
  const PRESS = [[11.6, "N"], [14.0, "N"], [14.5, "T"], [16.3, "T"], [16.9, "W"], [18.0, "W"]];
  const NOTE0 = "周五前交设计稿\n给房东打电话", NOTE_ADD = "\n下午三点开会", TODO_ADD = "买咖啡豆";
  const noteType = [], todoType = [];
  for (let i = 1; i <= NOTE_ADD.length; i++) noteType.push([12.1 + i * 0.14, (w, d) => { const x = d.getElementById("text"); x.value = NOTE0 + NOTE_ADD.slice(0, i); }]);
  for (let i = 1; i <= TODO_ADD.length; i++) todoType.push([15.0 + i * 0.16, (w, d) => { d.getElementById("new").value = TODO_ADD.slice(0, i); }]);
  todoType.push([15.9, (w, d) => d.getElementById("add").requestSubmit()]);
  feature(11, 19, {
    n: "02", accent: "#4cc9f0", title: "全局快捷键",
    desc: "在任何程序里都能用，可以在设置里改。再按一次或点别处，就放回原位。",
    chips: ["<kbd>Ctrl+Alt+N</kbd>呼出便签", "<kbd>Ctrl+Alt+T</kbd>呼出待办", "<kbd>Ctrl+Alt+W</kbd>显示/隐藏全部"],
  }, (sb, { chips }) => {
    const desk = el("div", "desk", sb);
    const note = live(desk, { folder: "notes", t0: 11, storage: { text: NOTE0 }, actions: noteType }, 50, 380, 330, 292);
    const todo = live(desk, { folder: "todo", t0: 11, storage: { items: [{ id: "a", text: "回复客户邮件", done: true }, { id: "b", text: "交电费", done: false }] }, actions: todoType }, 560, 250, 320, 343);
    const clock = picture(desk, "clock", 600, 40, 280);
    // the cards are see-through; a solid back keeps the document from showing through one called up
    note.el.classList.add("solid"); todo.el.classList.add("solid");
    const doc = box(desk, "doc", 170, 110, 600, 470);
    doc.innerHTML = `<div class="doc-bar"><i></i>周报.docx</div><div class="doc-body">${[92, 78, 88, 64, 95, 70, 84, 58, 76, 90, 66].map((w) => `<p style="width:${w}%"></p>`).join("")}</div>`;
    const ring = el("div", "ring", desk);
    const hud = box(desk, "keys", 0, 670);
    const keysFor = (k) => `<kbd>Ctrl</kbd><i>+</i><kbd>Alt</kbd><i>+</i><kbd>${k}</kbd>`;
    // which widget is up front: note 11.6–14.0, todo 14.5–16.3; everything hidden 16.9–18.0
    const up = (t, a, b) => prog(t, a, 0.35, ease.click) * (1 - prog(t, b, 0.3, ease.inOut));
    return {
      render(t, u) {
        const pn = up(t, 11.6, 14.0), pt = up(t, 14.5, 16.3);
        const hidden = prog(t, 16.9, 0.25, ease.in) * (1 - prog(t, 18.0, 0.35, ease.click));
        style(note.el, { zIndex: pn > 0.02 ? "5" : "1", transform: `scale(${(1 + 0.08 * pn).toFixed(4)})`, opacity: (1 - hidden).toFixed(4) });
        style(todo.el, { zIndex: pt > 0.02 ? "5" : "1", transform: `scale(${(1 + 0.08 * pt).toFixed(4)})`, opacity: (1 - hidden).toFixed(4) });
        style(clock.el, { opacity: (1 - hidden).toFixed(4), transform: `scale(${(1 - 0.06 * hidden).toFixed(4)})` });
        style(doc, { zIndex: "3" });
        // a ring around the one called up
        const tgt = pn >= pt ? note : todo, pr = Math.max(pn, pt), b = tgt.el.__s;
        const x = parseFloat(b.left), y = parseFloat(b.top), w = parseFloat(b.width), h = parseFloat(b.height);
        const k = 1.08;
        style(ring, { zIndex: "6", left: px(x + (w * (1 - k)) / 2 - 6), top: px(y + (h * (1 - k)) / 2 - 6), width: px(w * k + 12), height: px(h * k + 12), opacity: (pr * 0.9).toFixed(4) });
        // the keys being pressed
        let last = null;
        for (const p of PRESS) if (t >= p[0] && t < p[0] + 0.9) last = p;
        if (last) { if (hud.__k !== last[1] + last[0]) { hud.__k = last[1] + last[0]; hud.innerHTML = keysFor(last[1]); } }
        const hp = last ? prog(t, last[0], 0.25, ease.click) * (1 - prog(t, last[0] + 0.65, 0.25)) : 0;
        style(hud, { zIndex: "8", left: px(STAGE.w / 2 - 170), opacity: clamp(hp * 2).toFixed(4), transform: `translateY(${px(16 * (1 - hp))}) scale(${lerp(0.9, 1, hp).toFixed(4)})` });
        // the chip for the shortcut in use
        const on = t >= 11.6 && t < 14.4 ? 0 : t >= 14.5 && t < 16.8 ? 1 : t >= 16.9 && t < 18.6 ? 2 : -1;
        chips.forEach((c, i) => c.classList.toggle("on", i === on));
        popIn(desk, u, 0.1, { dy: 0, s0: 1 });
      },
    };
  });

  // ───────────────────────── 03 Bank of China rates (19–24) ─────────────────────────
  feature(19, 24, {
    n: "03", accent: "#ffd166", title: "中国银行牌价",
    desc: "汇率组件可以改用中国银行外汇牌价，每 30 分钟检查一次，还能选用哪一种价。",
  }, (sb) => {
    const card = box(sb, "w shadowed", 70, 110, 470, 517);
    const img = el("img", "", card); img.src = "assets/update-1.3/currency-boc.png";
    const list = box(sb, "prices", 590, 150);
    const P = ["中行折算价", "现汇卖出价", "现钞卖出价", "现汇买入价", "现钞买入价"].map((n) => el("div", "", list, n));
    const src = box(sb, "cap", 70, 660); src.textContent = "数据：中国银行 · 每 100 外币换算成每 1 单位";
    return {
      render(t, u) {
        popIn(card, u, 0.15, { dy: 40 });
        P.forEach((p, i) => popIn(p, u, 0.35 + i * 0.07, { dy: 16 }));
        const on = u < 1.5 ? 0 : Math.min(4, Math.floor((u - 1.5) / 0.5) + 1) % 5;
        P.forEach((p, i) => p.classList.toggle("on", i === (u < 4.0 ? on : 0)));
        popIn(src, u, 0.9, { dy: 12 });
      },
    };
  });

  // ───────────────────────── 04 memory halved (24–29) ─────────────────────────
  feature(24, 29, {
    n: "04", accent: "#4cc9f0", title: "内存占用减半",
    desc: "启动后把用不到的内存还给系统，右键菜单用到时才加载。",
  }, (sb) => {
    const MAX = 454, BW = 500;
    const rows = [["你桌面上有 13 个组件", 240, 120], ["38 个组件全开", 454, 245]].map(([l, a, b], i) => {
      const m = box(sb, "mem", 90, 170 + i * 230);
      m.innerHTML = `<div class="l">${l}</div><div class="row"><span class="k">之前</span><div class="bar was"></div><span class="v">${a} MB</span></div><div class="row" style="margin-top:14px"><span class="k">现在</span><div class="bar now"></div><span class="v"></span></div>`;
      const [was, now] = m.querySelectorAll(".bar");
      const v = m.querySelectorAll(".v")[1];
      style(was, { width: px((a / MAX) * BW) });
      return { m, now, v, a, b };
    });
    const note = box(sb, "cap", 90, 660); note.textContent = "FullWidget 和它的网页引擎进程合计 · 启动 4 分钟后实测";
    return {
      render(t, u) {
        rows.forEach((r, i) => {
          popIn(r.m, u, 0.15 + i * 0.15, { dy: 30 });
          const p = prog(u, 0.9 + i * 0.35, 1.3, ease.inOut);
          const val = lerp(r.a, r.b, p);
          style(r.now, { width: px((val / MAX) * BW) });
          r.v.innerHTML = p < 1 ? `${Math.round(val)} MB` : `${r.b} MB <span style="color:#7de2c4;font-size:26px">−${Math.round((1 - r.b / r.a) * 100)}%</span>`;
        });
        popIn(note, u, 1.2, { dy: 12 });
      },
    };
  });

  // ───────────────────────── 05 updating in the app (29–34) ─────────────────────────
  feature(29, 34, {
    n: "05", accent: "#b69cff", title: "在软件里更新",
    desc: "设置 → 关于 → 检查更新。下载后核对校验值，装好自动重新打开。",
  }, (sb) => {
    const cc = box(sb, "cc", 60, 170, 800, 420);
    cc.innerHTML = `<div style="position:absolute;left:44px;top:40px" class="h">设置</div><div style="position:absolute;left:44px;top:110px" class="g">关于</div>
      <div class="r" style="top:150px;height:130px"><div class="lab">版本<small class="st"></small></div><span class="ver">FullWidget 1.3.0</span><span class="slot"></span></div>
      <div class="r" style="top:280px;height:110px"><div class="lab">自动检查更新<small>默认关闭，不会擅自联网</small></div><div class="tog"></div></div>`;
    const st = cc.querySelector(".st"), slot = cc.querySelector(".slot"), ver = cc.querySelector(".ver");
    const toast = box(sb, "toast", 60, 640); toast.textContent = "✓ 已经是最新版本，FullWidget 已重新打开";
    const B = { x: STAGE.x + 60 + 800 - 44 - 70, y: STAGE.y + 170 + 150 + 65 };
    CURSOR.push([29.4, 32.0, (t) => ({ p: keys(t, [[29.4, [STAGE.x + 700, STAGE.y + 720]], [29.95, [B.x, B.y], ease.inOut]]), o: prog(t, 29.4, 0.2) * (1 - prog(t, 31.6, 0.3)), down: false })]);
    CLICKS.push(30.0, 30.9);
    let last = "";
    return {
      render(t, u) {
        popIn(cc, u, 0.15, { dy: 40 });
        const phase = t < 30.0 ? 0 : t < 30.45 ? 1 : t < 30.9 ? 2 : t < 32.2 ? 3 : t < 32.8 ? 4 : 5;
        const pct = Math.round(100 * prog(t, 30.9, 1.3, ease.soft));
        const key = phase === 3 ? `3-${pct}` : String(phase);
        if (key !== last) {
          last = key;
          st.textContent = ["", "正在检查更新…", "有新版本可以更新了。下载约 4 MB，装好后自动重新打开。", "正在下载新版本…", "正在安装，FullWidget 会自动关闭再重新打开…", "已是最新版本（刚刚检查）"][phase];
          style(ver, { display: phase === 3 ? "none" : "inline" });
          slot.innerHTML = phase === 0 ? `<span class="btn">检查更新</span>` : phase === 1 ? `<span class="btn" style="opacity:.5">检查中…</span>`
            : phase === 2 ? `<span class="btn primary">更新</span>` : phase === 3 ? `<span style="display:flex;align-items:center;gap:14px"><span class="prog"><i style="width:${pct}%"></i></span><span class="pct">${pct}%</span></span>`
              : phase === 4 ? `<span class="btn" style="opacity:.5">安装中…</span>` : `<span class="btn">检查更新</span>`;
        }
        const tp = prog(t, 32.8, 0.45, ease.click);
        style(toast, { opacity: clamp(tp * 3).toFixed(4), transform: `translateY(${px(24 * (1 - tp))})` });
      },
    };
  });

  // ───────────────────────── 06 monitors (34–39) ─────────────────────────
  feature(34, 39, {
    n: "06", accent: "#f2b45c", title: "多显示器",
    desc: "副屏关掉时，上面的组件跟着一起休息；开回来后，回到原来的位置。",
  }, (sb) => {
    const mons = [70, 480].map((x, i) => {
      const m = box(sb, "mon", x, 230, 370, 360);
      const scr = el("div", "scr", m); style(scr, { height: "232px" });
      const wall = el("div", "wall", scr);
      const neck = el("div", "neck", m); style(neck, { left: px(185 - 30), top: "242px" });
      const foot = el("div", "foot", m); style(foot, { left: px(185 - 110), top: "308px" });
      const led = el("div", "led", m); style(led, { left: px(185 - 5), top: "248px" });
      const lab = el("div", "label", m); style(lab, { top: "344px" }); lab.textContent = i ? "副屏" : "主屏";
      return { m, scr, wall, led };
    });
    const left = [picture(mons[0].scr, "clock", 20, 20, 170), picture(mons[0].scr, "weather", 200, 20, 150)];
    const right = [picture(mons[1].scr, "sysinfo", 20, 22, 160), picture(mons[1].scr, "calendar", 200, 20, 140)];
    const cap = box(sb, "cap", 70, 650);
    // the second monitor: off at 35.6, back on at 37.4
    return {
      render(t, u) {
        mons.forEach((m, i) => popIn(m.m, u, 0.15 + i * 0.1, { dy: 30 }));
        left.forEach((w, i) => popIn(w.el, u, 0.4 + i * 0.08, { dy: 10 }));
        const off = prog(t, 35.6, 0.35, ease.in) * (1 - prog(t, 37.4, 0.45, ease.out));
        style(mons[1].wall, { opacity: (1 - off).toFixed(4) });
        style(mons[1].led, { background: off > 0.5 ? "#ffb547" : "#7de2c4", boxShadow: off > 0.5 ? "0 0 10px #ffb547" : "0 0 10px #7de2c4" });
        right.forEach((w, i) => {
          const p = pop(u, 0.48 + i * 0.08);
          const back = prog(t, 37.65 + i * 0.1, 0.4, ease.click);
          const vis = t < 35.6 ? clamp(p * 3) : t < 37.4 ? 1 - off : back;
          style(w.el, { opacity: vis.toFixed(4), transform: `scale(${(t >= 37.4 ? lerp(0.9, 1, back) : 1).toFixed(4)})` });
        });
        const txt = t < 35.6 ? "" : t < 37.4 ? "副屏关了 → 上面的组件一起隐藏，不再更新" : "副屏开回来 → 组件回到原位";
        if (cap.textContent !== txt) cap.textContent = txt;
        const cp = txt ? prog(t, t < 37.4 ? 35.75 : 37.6, 0.35, ease.out) : 0;
        style(cap, { opacity: cp.toFixed(4), transform: `translateY(${px(10 * (1 - cp))})` });
      },
    };
  });

  // ───────────────────────── fixes (39–42) ─────────────────────────
  feature(39, 42, {
    n: "", accent: "#7de2c4", title: "还修好了",
    desc: "这两个问题都是用户反馈的，谢谢大家。",
  }, (sb) => {
    const F = [["网速显示准了", "以前会多算好几倍，现在和任务管理器一致"], ["控制中心不再一片空白", "某个组件出问题时只跳过它，其他照常显示"]]
      .map(([a, b], i) => { const d = box(sb, "fix", 80, 270 + i * 190); d.innerHTML = `<i>✓</i><div>${a}<small>${b}</small></div>`; return d; });
    return { render(t, u) { F.forEach((d, i) => popIn(d, u, 0.3 + i * 0.25, { dy: 24 })); } };
  });

  // ───────────────────────── outro (42–48) ─────────────────────────
  shot(42, DURATION + 1, (root) => {
    const logo = el("img", "logo", root); logo.src = "../build/logo/logo.svg";
    style(logo, { left: px(W / 2 - 66), top: "250px" });
    const big = box(root, "big", 0, 410);
    const bl = letters(big, "FullWidget ");
    const em = el("em", "", big); em.textContent = "1.3";
    const sub = box(root, "sub", 0, 600); sub.textContent = "免费、开源的 Windows 11 桌面小组件";
    const url = box(root, "url", 0, 720); url.innerHTML = `<b>免费下载</b><span>hmgvibe.github.io/FullWidget</span>`;
    const nl = box(root, "note-line", 0, 850); nl.textContent = "以后的新版本，在「设置 → 关于」里就能更新";
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
    marks: [[0, "开场"], ...CHAPTERS.map(([n, a]) => [a, n]), [42, "结尾"]],
  };
})();
