/// <reference path="plugin-api.d.ts" />
window.__bdgPluginRegister(function activate(api) {
  var mergeMode = true;

  var nameInput = null;
  var levelInput = null;
  var charterInput = null;
  var composerInput = null;
  var illustratorInput = null;
  var illustrationPath = "";
  var illPathLabel = null;
  var logEl = null;

  function log(msg) {
    api.log(msg);
    if (logEl) {
      logEl.textContent = msg + "\n" + logEl.textContent;
    }
  }

  function logError(err) {
    var text = err;
    if (err && err.message) text = err.message;
    log("error: " + text);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function inputField(host, labelText, value) {
    var block = el("div", "phira-field");
    var lab = el("div", "phira-field-label", labelText);
    var inp = document.createElement("input");
    inp.type = "text";
    if (value) inp.value = value;
    block.appendChild(lab);
    block.appendChild(inp);
    host.appendChild(block);
    return inp;
  }

  // 把 beat 浮点数转成 RPE 的 Triple 数组 [整数, 分子, 分母]（i + n/d）
  function beatToTriple(beat, maxDen) {
    var whole = Math.floor(beat + 1e-9);
    var frac = beat - whole;
    if (frac < 0) { whole -= 1; frac += 1; }
    var best = { n: 0, d: 1, err: Math.abs(frac) };
    for (var d = 1; d <= maxDen; d++) {
      var n = Math.round(frac * d);
      var err = Math.abs(frac - n / d);
      if (err < best.err) { best = { n: n, d: d, err: err }; }
      if (err < 1e-9) break;
    }
    if (best.n === best.d) { whole += 1; best = { n: 0, d: 1, err: 0 }; }
    return [whole, best.n, best.d];
  }

  function noteFromMarker(m) {
    return {
      type: 1,
      above: 1, // 音符从判定线上方落入（之前的 below 方向是反的）
      startTime: beatToTriple(m.beat, 192),
      endTime: [0, 0, 1],
      positionX: 0, // 音符坐标不分散，保持判定线中线
      yOffset: -10,
      alpha: 255,
      size: 1,
      speed: 1,
      isFake: 0,
      visibleTime: 1e9,
    };
  }

  // 判定线：滚动流速设为 10（speedEvents start=end=10），并按 xPos 分散判定线 X 位置
  function judgeLine(name, notes, maxBeat, xPos) {
    var end = beatToTriple(Math.max(maxBeat, 1), 192);
    return {
      Name: name,
      Texture: "line.png",
      father: -1,
      rotateWithFather: false,
      eventLayers: [
        {
          speedEvents: [
            { easingType: 1, startTime: [0, 0, 1], endTime: end, start: 10, end: 10 },
          ],
          moveXEvents: [
            { easingType: 1, startTime: [0, 0, 1], endTime: end, start: xPos, end: xPos },
          ],
        },
      ],
      notes: notes,
      isCover: 0,
      zOrder: 0,
      posControl: [],
      sizeControl: [],
      alphaControl: [],
      yControl: [],
    };
  }

  // 第 i 条判定线（共 n 条）的 X 位置，在 [-600, 600] 均匀铺开
  function trackX(n, i) {
    if (n < 2) return 0;
    return (i / (n - 1) * 2 - 1) * 600;
  }

  function maxMarkerBeat(ms) {
    var mx = 0;
    for (var i = 0; i < ms.length; i++) if (ms[i].beat > mx) mx = ms[i].beat;
    return mx;
  }

  function val(inp) { return inp ? inp.value.trim() : ""; }

  // 谱面名做基底：空格->-、剔除非法文件名字符，作为所有文件名统一前缀
  function sanitizeName(name) {
    return (String(name || "")
      .replace(/\s+/g, "-")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")) || "chart";
  }
  function chartBase(s) { return sanitizeName(val(nameInput) || s.name); }

  function extOf(p) {
    var n = baseName(p);
    var i = n.lastIndexOf(".");
    return i >= 0 ? n.slice(i).toLowerCase() : "";
  }

  function buildChart(s, audioPath) {
    var bpm = s.baseBpm || 120;
    var offset = Math.round(s.offsetMs || 0);
    var base = chartBase(s);
    var audioName = base + extOf(audioPath);
    var illName = base + extOf(illustrationPath);

    var byTime = function (a, b) { return a.beat - b.beat; };
    var judgeLines = [];

    if (mergeMode) {
      var notes = s.markers.slice().sort(byTime).map(noteFromMarker);
      judgeLines.push(judgeLine("Line", notes, maxMarkerBeat(s.markers), 0));
    } else {
      for (var i = 0; i < s.tracks.length; i++) {
        var track = s.tracks[i];
        var tm = s.markers.filter(function (m) { return m.trackId === track.id; });
        var tn = tm.slice().sort(byTime).map(noteFromMarker);
        judgeLines.push(judgeLine(track.name || "Line " + (i + 1), tn, maxMarkerBeat(tm), trackX(s.tracks.length, i)));
      }
    }

    var meta = {
      offset: offset,
      RPEVersion: 160,
      name: base,
      level: val(levelInput),
      charter: val(charterInput),
      composer: val(composerInput),
      song: audioName,
      illustration: illName,
      background: illName,
    };

    return {
      META: meta,
      BPMList: [{ bpm: bpm, startTime: [0, 0, 1] }],
      judgeLineList: judgeLines,
    };
  }

  function buildInfoTxt(s, audioPath) {
    var base = chartBase(s);
    var lines = ["#", "Name: " + base];
    if (extOf(audioPath)) lines.push("Song: " + base + extOf(audioPath));
    lines.push("Chart: " + base + ".json");
    if (extOf(illustrationPath)) lines.push("Image: " + base + extOf(illustrationPath));
    if (val(levelInput)) lines.push("Level: " + val(levelInput));
    if (val(composerInput)) lines.push("Artist: " + val(composerInput));
    if (val(charterInput)) lines.push("Charter: " + val(charterInput));
    if (val(illustratorInput)) lines.push("Illustrator: " + val(illustratorInput));
    return lines.join("\n");
  }

  function baseName(p) {
    if (!p) return "";
    var parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || "";
  }

  function exportChart() {
    var s = api.project.snapshot();
    if (!s.markers.length) {
      log("没有踩点(Tap)，无可导出内容");
      return;
    }
    log("开始导出 .pez  (踩点 x" + s.markers.length + ", 合并=" + mergeMode + ")");

    var audioPath = api.system.audioPath ? (api.system.audioPath() || "") : "";
    if (!audioPath) log("warning: 未取到工程音频路径(audioPath)，.pez 将不含音频");
    else log("音频路径: " + audioPath);

    if (illustrationPath) log("曲绘: " + illustrationPath);
    else log("warning: 未选择曲绘，.pez 将不含配图");

    var base = chartBase(s);
    var audioName = base + extOf(audioPath);
    var illName = base + extOf(illustrationPath);
    var chartName = base + ".json";
    log("文件名基底: " + base);

    var chart = buildChart(s, audioPath);
    var infoTxt = buildInfoTxt(s, audioPath);

    api.system
      .saveFile({
        title: "导出 Phira 谱面 (.pez)",
        defaultPath: base + ".pez",
        filters: [{ name: "Phira PEZ", extensions: ["pez"] }],
      })
      .then(function (res) {
        if (res.canceled || !res.filePath) {
          log("已取消导出");
          return;
        }
        log("已选保存路径: " + res.filePath + ", 调 main 打包...");
        return api.callMain("package", {
          outPath: res.filePath,
          json: JSON.stringify(chart, null, 2),
          infoTxt: infoTxt,
          audioPath: audioPath,
          audioName: audioName,
          illustrationPath: illustrationPath,
          illustrationName: illName,
          chartName: chartName,
        });
      })
      .then(function (result) {
        if (result === undefined) return; // canceled
        if (result && result.ok) {
          log("导出成功: " + (result.entries || []).join(", "));
        } else {
          log("导出失败: main 返回 " + JSON.stringify(result));
        }
      })
      .catch(logError);
  }

  var panel = api.ui.registerPanel({
    id: "phira-convert",
    title: { zh: "Phira 谱面转换设置", en: "Phira Converter Settings" },
    mount: function mount(host) {
      host.textContent = "";

      var s = api.project.snapshot();

      var wrap = el("div", "phira-wrap");
      host.appendChild(wrap);

      var tip = el("div", "phira-tip");
      tip.textContent = "放置 Tap 踩点后导出：每个踩点 = 一个 Tap 音符。";
      wrap.appendChild(tip);

      var row = el("label", "phira-row");
      var chk = el("input");
      chk.type = "checkbox";
      chk.checked = mergeMode;
      chk.addEventListener("change", function () {
        mergeMode = chk.checked;
        syncHint();
      });
      row.appendChild(chk);
      row.appendChild(document.createTextNode("合并成单轨（一条判定线，Tap 居中 X=0）"));
      wrap.appendChild(row);

      var hint = el("div", "phira-hint");
      hint.id = "phira-hint";
      wrap.appendChild(hint);

      var sep1 = el("div", "phira-sep", "META 元信息");
      wrap.appendChild(sep1);

      nameInput = inputField(wrap, "曲名", s.name || "");
      levelInput = inputField(wrap, "难度", "");
      charterInput = inputField(wrap, "谱师", "");
      composerInput = inputField(wrap, "编曲", "");
      illustratorInput = inputField(wrap, "曲绘作者", "");

      var sep2 = el("div", "phira-sep", "曲绘（配图）");
      wrap.appendChild(sep2);

      var illRow = el("div", "phira-row");
      var btnIll = el("button", "phira-btn", "选择曲绘图片…");
      btnIll.addEventListener("click", function () {
        api.system
          .pickFile({
            title: "选择曲绘图片",
            filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "bmp", "gif", "webp"] }],
          })
          .then(function (p) {
            if (!p) return;
            illustrationPath = p;
            if (illPathLabel) illPathLabel.textContent = illustrationPath;
            log("已选曲绘: " + illustrationPath);
          })
          .catch(logError);
      });
      illRow.appendChild(btnIll);
      illPathLabel = el("span", "phira-path", illustrationPath);
      illRow.appendChild(illPathLabel);
      wrap.appendChild(illRow);

      var btnExport = el("button", "phira-btn", "生成并导出 .pez");
      btnExport.addEventListener("click", exportChart);
      wrap.appendChild(btnExport);

      logEl = el("pre", "phira-log");
      logEl.textContent = "";
      wrap.appendChild(logEl);

      function syncHint() {
        hint.textContent = mergeMode
          ? "当前：所有轨道合并为一条判定线"
          : "当前：每条轨道对应一条判定线（Tap 仍居中）";
      }
      syncHint();

      return function unmount() { host.textContent = ""; logEl = null; };
    },
  });

  api.ui.registerAction({
    label: { zh: "Phira 谱面转换设置", en: "Phira Converter Settings" },
    run: function () { panel.open(); },
  });

  api.ui.registerShortcut({
    id: "toggle-phira-convert",
    label: { zh: "切换 Phira 转换面板", en: "Toggle Phira converter panel" },
    combo: "Alt+P",
    run: function () { panel.toggle(); },
  });

  api.ui.registerExporter({
    label: { zh: "Phira 谱面：导出 .pez", en: "Phira chart: Export .pez" },
    run: exportChart,
  });

  api.log("Phira converter contributions registered, mergeMode=" + mergeMode);

  return function dispose() {
    api.log("Phira converter disposed");
  };
});
