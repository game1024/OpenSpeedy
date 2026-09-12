/* ==========================================================================
   OpenSpeedy — landing page behaviour
   ========================================================================== */
(function () {
  "use strict";

  var REPO = "game1024/OpenSpeedy";
  // Shipped version, used until (and unless) the Releases API answers. Keep in
  // step with package.json / src-tauri/tauri.conf.json.
  var FALLBACK_VER = "3.3.11";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------------
     i18n
     ------------------------------------------------------------------------ */

  var DICT = {
    zh: {
      "nav.features": "功能",
      "nav.shots": "截图",
      "nav.api": "接口",
      "nav.download": "下载",

      "hero.tag": "开源游戏变速控制器",
      "hero.sub": "纯 Ring-3 层 API Hook，不加载内核驱动。为任意 Windows 进程实时调整时间流速，x86 与 x64 通吃。",
      "hero.cta.dl": "下载 v{ver}",
      "hero.cta.gh": "GitHub",
      "hero.float": "桥接在线 · 32/64 位就绪",
      "hero.meta.win": "Windows 10+",
      "hero.meta.lic": "GPL-3.0",
      "hero.meta.nodrv": "无内核驱动",

      "stat.stars": "Stars",
      "stat.dl": "总下载量",
      "stat.ver": "最新版本",
      "stat.lic": "开源协议",

      "band.cap": "RING-3 API HOOK · 无内核驱动",

      "feat.eyebrow": "能力",
      "feat.h": "它做什么",
      "feat.lede": "一个进程列表，一个倍率滑块，就这些。剩下的交给 17 个被 Hook 的 Windows 时间 API。",
      "feat.1.t": "实时倍率",
      "feat.1.d": "拖动即生效，无需重启游戏。变速步长与档位可分别配置，也可按住快捷键临时加速。",
      "feat.1.g": "SP_SetSpeed",
      "feat.2.t": "档位与快捷键",
      "feat.2.d": "升速、降速、重置各绑定一个全局快捷键，加速档位可预设，冲突会被立即报出。",
      "feat.2.g": "REGISTER HOTKEY",
      "feat.3.t": "名称 / PID 双视图",
      "feat.3.d": "按进程名分组，或按 PID 逐条展开。搜索同时匹配进程名、PID 与窗口标题。",
      "feat.3.g": "ENUMERATE",
      "feat.4.t": "x86 + x64 桥接",
      "feat.4.d": "同一份界面同时驱动 32 位与 64 位目标进程，桥接在线状态在标题栏实时可见。",
      "feat.4.g": "BRIDGE",
      "feat.5.t": "不碰内核",
      "feat.5.d": "全部 Hook 停留在 Ring-3，不加载内核驱动、不改动系统内核，卸载即完全还原。",
      "feat.5.g": "MINHOOK · RING 3",
      "feat.6.t": "12 种语言",
      "feat.6.d": "界面与文档覆盖 12 种语言，含简体与繁体中文。深色、浅色主题随你切换。",
      "feat.6.g": "i18n × 12",

      "api.eyebrow": "原理",
      "api.h": "被 Hook 的时间 API",
      "api.lede": "OpenSpeedy 不修改游戏逻辑，只接管游戏读取时间的入口。所有 Hook 在目标进程内完成，向下调用原始实现。",
      "api.flow.1.t": "注入",
      "api.flow.1.d": "由桥接进程把 speedpatch 注入目标进程，失败会在界面上直接报出原因。",
      "api.flow.2.t": "接管",
      "api.flow.2.d": "MinHook 在 17 个时间 API 上挂载 detour，读到的时刻按倍率缩放后返回。",
      "api.flow.3.t": "还原",
      "api.flow.3.d": "关闭加速或卸载 DLL 时移除全部 Hook，游戏恢复真实时间。",
      "api.col.fn": "函数",
      "api.col.dll": "所属库",
      "api.col.desc": "作用",
      "api.count": "{n} 个 Hook",
      "api.backend": "后端 speedpatch.dll",

      "fn.sleep": "线程休眠",
      "fn.sleepex": "可中断的线程休眠",
      "fn.wait1": "等待单个对象就绪或超时",
      "fn.wait1ex": "可警报的单项等待",
      "fn.waitn": "等待多个对象中的任意一个或全部",
      "fn.waitnex": "可警报的多项等待",
      "fn.swt": "设置可等待定时器",
      "fn.swtex": "设置可等待定时器（扩展）",
      "fn.settimer": "创建基于消息的计时器",
      "fn.tgt": "系统启动至今的毫秒数",
      "fn.tst": "多媒体定时器事件",
      "fn.gmt": "消息队列中的时间戳",
      "fn.gtc": "系统启动至今的毫秒数",
      "fn.gtc64": "系统启动至今的毫秒数（64 位）",
      "fn.qpc": "高精度性能计数器",
      "fn.gstaft": "系统时间（FILETIME）",
      "fn.gstpaft": "高精度系统时间（FILETIME）",

      "shot.eyebrow": "界面",
      "shot.h": "看一眼",
      "shot.lede": "深色与浅色、中文与 English——四种组合都是真实截图，不是效果图。",
      "shot.l.theme": "主题",
      "shot.l.lang": "界面语言",
      "shot.l.page": "页面",
      "shot.dark": "深色",
      "shot.light": "浅色",
      "shot.home": "主页",
      "shot.settings": "设置",
      "shot.about": "关于",
      "shot.alt": "OpenSpeedy {page}页（{theme}主题，{lang}界面）",

      "dl.eyebrow": "获取",
      "dl.h": "装它",
      "dl.lede": "一条命令，或者从 Releases 直接拿安装包。",
      "dl.m1.t": "Winget",
      "dl.m1.b": "推荐",
      "dl.m1.d": "装完新开一个终端，直接输入 openspeedy 启动。",
      "dl.m2.t": "手动下载",
      "dl.m2.b": "便携",
      "dl.m2.d": "从 Releases 页面取最新版本的安装包或绿色版。",
      "dl.m2.link": "打开 Releases",
      "dl.copy": "复制",
      "dl.copied": "已复制",
      "dl.req.os": "系统",
      "dl.req.arch": "架构",
      "dl.req.src": "源码",

      "note.t": "使用前请读一遍",
      "note.1": "本工具仅供学习和研究使用。",
      "note.2": "部分在线游戏带有反作弊系统，使用本工具可能导致账号被封禁。",
      "note.3": "过度加速可能导致游戏物理引擎异常或崩溃。",
      "note.4": "不建议在竞技类在线游戏中使用。",
      "note.5": "开源产品不带数字签名，可能被杀毒软件误报。",
      "note.6": "遇到问题先查 FAQ，网盘类问题请勿提 Issue。",

      "foot.d": "开源游戏变速控制器。纯 Ring-3 层 API Hook，不加载内核驱动。",
      "foot.l.product": "产品",
      "foot.l.res": "资源",
      "foot.l.ack": "鸣谢",
      "foot.api": "使用的接口",
      "foot.req": "系统要求",
      "foot.changelog": "更新日志",
      "foot.license": "开源协议",
      "foot.issues": "问题反馈",
      "foot.wiki": "FAQ / Wiki",
      "foot.contrib": "参与贡献",
      "foot.disc": "免责声明：OpenSpeedy 仅用于教育和研究目的。用户应自行承担使用本软件的全部风险与责任。",
    },

    en: {
      "nav.features": "Features",
      "nav.shots": "Screenshots",
      "nav.api": "API",
      "nav.download": "Download",

      "hero.tag": "The best open-source game speed controller",
      "hero.sub": "Pure Ring-3 API hooking — no kernel driver. Rescales time for any Windows process in real time, on both x86 and x64.",
      "hero.cta.dl": "Download v{ver}",
      "hero.cta.gh": "GitHub",
      "hero.float": "Bridge online · 32/64-bit ready",
      "hero.meta.win": "Windows 10+",
      "hero.meta.lic": "GPL-3.0",
      "hero.meta.nodrv": "No kernel driver",

      "stat.stars": "Stars",
      "stat.dl": "Total downloads",
      "stat.ver": "Latest release",
      "stat.lic": "License",

      "band.cap": "RING-3 API HOOK · NO KERNEL DRIVER",

      "feat.eyebrow": "Capabilities",
      "feat.h": "What it does",
      "feat.lede": "A process list and a multiplier slider. That is the whole interface — 17 hooked Windows time APIs do the rest.",
      "feat.1.t": "Live multiplier",
      "feat.1.d": "Drag and it takes effect immediately, no game restart. Configure the step and the gear presets separately, or hold a key to speed up.",
      "feat.1.g": "SP_SetSpeed",
      "feat.2.t": "Gears & hotkeys",
      "feat.2.d": "Bind a global hotkey each to speed up, slow down and reset. Gear presets are configurable and conflicts are reported instantly.",
      "feat.2.g": "REGISTER HOTKEY",
      "feat.3.t": "By name or by PID",
      "feat.3.d": "Group the list by process name, or expand it per PID. Search matches process name, PID and window title at once.",
      "feat.3.g": "ENUMERATE",
      "feat.4.t": "x86 + x64 bridge",
      "feat.4.d": "One interface drives both 32-bit and 64-bit targets. Bridge status is visible in the title bar at all times.",
      "feat.4.g": "BRIDGE",
      "feat.5.t": "Never touches the kernel",
      "feat.5.d": "Every hook stays in Ring-3. No kernel driver is loaded and nothing in the kernel is modified — unloading restores everything.",
      "feat.5.g": "MINHOOK · RING 3",
      "feat.6.t": "12 languages",
      "feat.6.d": "Interface and docs ship in 12 languages, Simplified and Traditional Chinese included. Dark and light themes, your call.",
      "feat.6.g": "i18n × 12",

      "api.eyebrow": "How it works",
      "api.h": "The hooked time APIs",
      "api.lede": "OpenSpeedy does not touch game logic — it intercepts the calls a game uses to read time. Every hook runs inside the target process and calls the original implementation underneath.",
      "api.flow.1.t": "Inject",
      "api.flow.1.d": "The bridge process injects speedpatch into the target. A failure reports its reason directly in the UI.",
      "api.flow.2.t": "Intercept",
      "api.flow.2.d": "MinHook installs a detour on 17 time APIs. The instant they read is scaled by the multiplier before it is returned.",
      "api.flow.3.t": "Restore",
      "api.flow.3.d": "Disabling speed or unloading the DLL removes every hook and the game returns to real time.",
      "api.col.fn": "Function",
      "api.col.dll": "Library",
      "api.col.desc": "Purpose",
      "api.count": "{n} hooks",
      "api.backend": "backend speedpatch.dll",

      "fn.sleep": "Suspends the current thread",
      "fn.sleepex": "Interruptible thread suspension",
      "fn.wait1": "Waits for one object or a timeout",
      "fn.wait1ex": "Alertable single-object wait",
      "fn.waitn": "Waits for any or all of several objects",
      "fn.waitnex": "Alertable multi-object wait",
      "fn.swt": "Sets a waitable timer",
      "fn.swtex": "Sets a waitable timer (extended)",
      "fn.settimer": "Creates a message-based timer",
      "fn.tgt": "Milliseconds since system start",
      "fn.tst": "Multimedia timer event",
      "fn.gmt": "Timestamp of a message in the queue",
      "fn.gtc": "Milliseconds since system start",
      "fn.gtc64": "Milliseconds since system start (64-bit)",
      "fn.qpc": "High-resolution performance counter",
      "fn.gstaft": "System time as FILETIME",
      "fn.gstpaft": "Precise system time as FILETIME",

      "shot.eyebrow": "Interface",
      "shot.h": "Take a look",
      "shot.lede": "Dark and light, Chinese and English — all four combinations are real captures, not mockups.",
      "shot.l.theme": "Theme",
      "shot.l.lang": "App language",
      "shot.l.page": "Page",
      "shot.dark": "Dark",
      "shot.light": "Light",
      "shot.home": "Home",
      "shot.settings": "Settings",
      "shot.about": "About",
      "shot.alt": "OpenSpeedy {page} page ({theme} theme, {lang} interface)",

      "dl.eyebrow": "Get it",
      "dl.h": " Install it",
      "dl.lede": "One command, or grab the installer straight from Releases.",
      "dl.m1.t": "Winget",
      "dl.m1.b": "Recommended",
      "dl.m1.d": "Open a new terminal afterwards, then run openspeedy.",
      "dl.m2.t": "Manual download",
      "dl.m2.b": "Portable",
      "dl.m2.d": "Get the latest installer or portable build from the Releases page.",
      "dl.m2.link": "Open Releases",
      "dl.copy": "Copy",
      "dl.copied": "Copied",
      "dl.req.os": "OS",
      "dl.req.arch": "Platform",
      "dl.req.src": "Source",

      "note.t": "Read this first",
      "note.1": "This tool is for learning and research only.",
      "note.2": "Some online games run anti-cheat systems. Using this tool may get your account banned.",
      "note.3": "Excessive speeding can break a game's physics engine or crash it.",
      "note.4": "Not recommended for competitive online games.",
      "note.5": "Open-source builds are unsigned and may be flagged by antivirus software.",
      "note.6": "Check the FAQ first. Please do not file issues about cloud-drive mirrors.",

      "foot.d": "Open-source game speed controller. Pure Ring-3 API hooking, no kernel driver.",
      "foot.l.product": "Product",
      "foot.l.res": "Resources",
      "foot.l.ack": "Credits",
      "foot.api": "API surface",
      "foot.req": "Requirements",
      "foot.changelog": "Changelog",
      "foot.license": "License",
      "foot.issues": "Issues",
      "foot.wiki": "FAQ / Wiki",
      "foot.contrib": "Contributing",
      "foot.disc": "Disclaimer: OpenSpeedy is for educational and research purposes only. Users assume all risk and responsibility for its use.",
    },
  };

  // ?lang=en / ?lang=zh wins, then the visitor's last choice, then their
  // browser language.
  var lang = "zh";
  try {
    var qs = new URLSearchParams(location.search).get("lang");
    var saved = localStorage.getItem("os-lang");
    if (qs === "zh" || qs === "en") lang = qs;
    else if (saved === "zh" || saved === "en") lang = saved;
    else if (!/^zh/i.test(navigator.language || "")) lang = "en";
  } catch (e) { /* storage blocked — keep the default */ }

  function t(key, vars) {
    var s = (DICT[lang] && DICT[lang][key]) || DICT.zh[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.replace("{" + k + "}", vars[k]);
      });
    }
    return s;
  }

  function applyI18n() {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(",").forEach(function (pair) {
        var bits = pair.split(":");
        el.setAttribute(bits[0].trim(), t(bits[1].trim()));
      });
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-title")));
    });

    document.querySelectorAll("[data-lang-btn]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lang-btn") === lang));
    });

    syncLangShots();
    if (pendingVersion) fillVersion(pendingVersion);
  }

  // Images tagged [data-shot="theme:page"] follow the *page* language, so the
  // hero capture matches the copy beside it.
  function syncLangShots() {
    document.querySelectorAll("[data-shot]").forEach(function (el) {
      var bits = el.getAttribute("data-shot").split(":");
      el.src = "assets/shots/" + bits[0] + "-" + bits[1] + "-" +
               (lang === "zh" ? "zh" : "en") + ".webp";
    });
  }

  function setLang(next) {
    lang = next;
    try { localStorage.setItem("os-lang", lang); } catch (e) { /* ignore */ }
    applyI18n();
    if (!viewerLangTouched) { viewer.lang = lang === "zh" ? "zh" : "en"; syncViewer(); }
    syncViewerControls();
  }

  document.querySelectorAll("[data-lang-btn]").forEach(function (b) {
    b.addEventListener("click", function () {
      var next = b.getAttribute("data-lang-btn");
      if (next !== lang) setLang(next);
    });
  });

  /* ------------------------------------------------------------------------
     Hero film  — the looping capture that replaced the hero screenshot. It
     autoplays in HTML, so this only has to honour a reduce-motion preference:
     stop it where it stands, leaving the poster frame and the controls, so
     anyone who wants to watch can still start it by hand.
     ------------------------------------------------------------------------ */

  var heroFilm = document.querySelector(".shot-frame video");
  if (heroFilm) {
    var calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    var syncHeroFilm = function () {
      if (calmMotion.matches) {
        heroFilm.pause();
        heroFilm.controls = true;
      } else {
        heroFilm.controls = false;
        // Rejects when the browser refuses the autoplay — the poster stays up.
        var started = heroFilm.play();
        if (started) started.catch(function () { /* expected: autoplay blocked */ });
      }
    };
    syncHeroFilm();
    if (calmMotion.addEventListener) calmMotion.addEventListener("change", syncHeroFilm);
    else if (calmMotion.addListener) calmMotion.addListener(syncHeroFilm);
  }

  /* ------------------------------------------------------------------------
     Live GitHub stats  — cached 30 min so repeat visits don't burn the
     unauthenticated 60/hr budget. Nothing is shown if the API is unreachable.
     ------------------------------------------------------------------------ */

  var CACHE_KEY = "os-gh-stats-v1";
  var CACHE_TTL = 30 * 60 * 1000;
  var pendingVersion = null;

  function num(n) {
    return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);
  }

  // Two kinds of version display: [data-ver] holds an already-translated
  // string containing {ver} (applyI18n ran first), [data-ver-tpl] holds a
  // language-independent template.
  function fillVersion(tag) {
    pendingVersion = tag;
    document.querySelectorAll("[data-ver]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (key) {
        // Re-derive from the dictionary every time — this element's text may
        // already hold a resolved version from an earlier call, so replacing
        // "{ver}" in its current textContent would be a no-op.
        el.textContent = t(key).replace("{ver}", tag);
      } else {
        if (!el.dataset.verTpl) el.dataset.verTpl = el.textContent;
        el.textContent = el.dataset.verTpl.replace("{ver}", tag);
      }
    });
    document.querySelectorAll("[data-ver-tpl]").forEach(function (el) {
      el.textContent = el.getAttribute("data-ver-tpl").replace("{ver}", tag);
    });
  }

  function paint(s) {
    if (s.stars != null) {
      var v = num(s.stars);
      ["s-stars", "nav-stars", "cta-stars"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.textContent = id === "s-stars" ? v : "★ " + v;
      });
    }
    if (s.downloads != null) document.getElementById("s-dl").textContent = num(s.downloads);
    if (s.tag) fillVersion(s.tag);
  }

  function loadStats() {
    var cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    } catch (e) { /* ignore */ }

    if (cached && Date.now() - cached.at < CACHE_TTL) { paint(cached); return; }

    var repoReq = fetch("https://api.github.com/repos/" + REPO)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); });
    var relReq = fetch("https://api.github.com/repos/" + REPO + "/releases?per_page=100")
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); });

    Promise.allSettled([repoReq, relReq]).then(function (res) {
      var out = {};
      if (res[0].status === "fulfilled") out.stars = res[0].value.stargazers_count;
      if (res[1].status === "fulfilled" && Array.isArray(res[1].value)) {
        var rel = res[1].value;
        out.downloads = rel.reduce(function (sum, r) {
          return sum + (r.assets || []).reduce(function (a, x) { return a + (x.download_count || 0); }, 0);
        }, 0);
        var latest = rel.filter(function (r) { return !r.draft && !r.prerelease; })[0] || rel[0];
        if (latest && latest.tag_name) out.tag = latest.tag_name.replace(/^v/, "");
      }
      if (Object.keys(out).length) {
        out.at = Date.now();
        paint(out);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
      } else {
        // API unreachable. Drop the two live cells rather than print numbers we
        // do not have; the strip falls back to version + licence.
        document.querySelectorAll("[data-live]").forEach(function (el) {
          var cell = el.closest(".stat");
          if (cell) cell.remove();
        });
        var strip = document.querySelector(".stats");
        if (strip) strip.classList.add("stats--static");
      }
    });
  }

  /* ------------------------------------------------------------------------
     Nav scroll state
     ------------------------------------------------------------------------ */

  var nav = document.getElementById("nav");
  var heroShot = document.getElementById("hero-shot");
  var heroGlow = document.querySelector(".hero");
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY;
      nav.classList.toggle("is-stuck", y > 40);

      if (!reduce && y < window.innerHeight * 1.1) {
        if (heroShot) heroShot.style.transform = "translate3d(0," + (y * 0.055).toFixed(2) + "px,0)";
        if (heroGlow) heroGlow.style.setProperty("--par", y.toFixed(1));
      }
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ------------------------------------------------------------------------
     Scroll reveal
     ------------------------------------------------------------------------ */

  var reveals = document.querySelectorAll(".rv");
  if (reduce || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("is-in");
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });

    // Safety net: whatever IO missed (print, restored scroll position, a
    // browser that never fires the callback) lands visible rather than stuck
    // at opacity 0.
    setTimeout(function () {
      document.querySelectorAll(".rv:not(.is-in)").forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 1.5) el.classList.add("is-in");
      });
    }, 2500);
  }

  /* ------------------------------------------------------------------------
     Screenshot viewer — the 12 captures form a theme × lang × page cube
     ------------------------------------------------------------------------ */

  var viewer = { theme: "dark", lang: "zh", page: "home" };
  var viewerLangTouched = false;
  var stage = document.getElementById("viewer-stage");
  var layers = {};

  if (stage) {
    Object.keys({ "dark-zh": 1, "dark-en": 1, "light-zh": 1, "light-en": 1 }).forEach(function (k) {
      var parts = k.split("-");
      var img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.dataset.theme = parts[0];
      img.dataset.lang = parts[1];
      layers[k] = img;
      stage.appendChild(img);
    });
  }

  function shotAlt() {
    var pd = t("shot." + viewer.page);
    var th = t("shot." + viewer.theme);
    var lg = viewer.lang === "zh" ? "中文" : "English";
    return t("shot.alt", { page: pd, theme: th, lang: lg });
  }

  function syncViewer() {
    if (!stage) return;
    Object.keys(layers).forEach(function (k) {
      var img = layers[k];
      var on = img.dataset.theme === viewer.theme && img.dataset.lang === viewer.lang;
      var src = "assets/shots/" + img.dataset.theme + "-" + viewer.page + "-" + img.dataset.lang + ".webp";
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
      img.classList.toggle("is-on", on);
      if (on) img.alt = shotAlt();
      else img.alt = "";
    });
  }

  function syncViewerControls() {
    document.querySelectorAll("[data-v]").forEach(function (b) {
      var on = viewer[b.getAttribute("data-v")] === b.getAttribute("data-val");
      b.setAttribute("aria-pressed", String(on));
    });
  }

  document.querySelectorAll("[data-v]").forEach(function (b) {
    b.addEventListener("click", function () {
      var dim = b.getAttribute("data-v");
      viewer[dim] = b.getAttribute("data-val");
      if (dim === "lang") viewerLangTouched = true;
      syncViewer();
      syncViewerControls();
    });
  });

  if (stage) { viewer.lang = lang === "zh" ? "zh" : "en"; syncViewer(); syncViewerControls(); }

  /* ------------------------------------------------------------------------
     Copy to clipboard
     ------------------------------------------------------------------------ */

  document.querySelectorAll(".copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy") || "";
      var done = function () {
        btn.classList.add("is-done");
        btn.setAttribute("aria-label", t("dl.copied"));
        setTimeout(function () {
          btn.classList.remove("is-done");
          btn.setAttribute("aria-label", t("dl.copy"));
        }, 1600);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (e) { /* ignore */ }
        document.body.removeChild(ta);
        done();
      }
    });
  });

  /* ------------------------------------------------------------------------
     Feature cards — pointer-tracked glow
     ------------------------------------------------------------------------ */

  if (!reduce && window.matchMedia("(pointer: fine)").matches) {
    document.querySelectorAll(".feat").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
        card.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
      });
    });
  }

  /* ------------------------------------------------------------------------
     Embers — a low-cost canvas drift behind the hero
     ------------------------------------------------------------------------ */

  (function embers() {
    var cv = document.getElementById("embers");
    if (!cv || reduce) return;

    var ctx = cv.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0, parts = [], raf = null, visible = true, last = 0;

    var COLORS = ["#fcde94", "#f7ad3b", "#f6a430", "#e95f11", "#c73415", "#9d260d"];

    function resize() {
      var r = cv.getBoundingClientRect();
      w = r.width;
      h = r.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var target = Math.max(18, Math.min(46, Math.round(w / 34)));
      parts = [];
      for (var i = 0; i < target; i++) parts.push(spawn(true));
    }

    function spawn(seed) {
      return {
        x: Math.random() * w,
        y: seed ? Math.random() * h : h + 12,
        r: 0.7 + Math.random() * 1.9,
        vy: 0.18 + Math.random() * 0.62,
        vx: (Math.random() - 0.5) * 0.22,
        a: 0.18 + Math.random() * 0.55,
        ph: Math.random() * Math.PI * 2,
        sp: 0.006 + Math.random() * 0.016,
        c: COLORS[(Math.random() * COLORS.length) | 0],
      };
    }

    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      if (ts - last < 1000 / 45) return;
      last = ts;

      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.ph += p.sp;
        p.x += p.vx + Math.sin(p.ph) * 0.24;
        p.y -= p.vy;
        if (p.y < -14 || p.x < -30 || p.x > w + 30) parts[i] = spawn(false);

        var alpha = p.a * (0.55 + 0.45 * Math.sin(p.ph * 1.7));
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    resize();
    window.addEventListener("resize", resize, { passive: true });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }, { threshold: 0 })
        .observe(cv);
    }
    raf = requestAnimationFrame(frame);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { cancelAnimationFrame(raf); raf = null; }
      else if (!raf) { raf = requestAnimationFrame(frame); }
    });
  })();

  /* ------------------------------------------------------------------------
     Footer year + boot
     ------------------------------------------------------------------------ */

  var yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  applyI18n();
  fillVersion(FALLBACK_VER); // never leave a raw {ver} on screen
  loadStats();
})();
