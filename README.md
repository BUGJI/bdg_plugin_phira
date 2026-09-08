> 目前产物存在大部分编辑器打不开的问题，非常需要开发者的 PR

# bdg_plugin_phira — Phira 谱面转换器

把 Beat Data Generator 工程中的踩点(Tap)转换成 **Phira / RPE 谱面**，
并将谱面、音频、曲绘一起打包为 `.pez`（zip）文件，供 Phira 导入播放。

## 功能

- 每个踩点 marker → 一个 **Tap**(`type:1`) 音符，落在判定线中线上。
- 支持**合并模式**：把所有轨道合并成一条判定线（单轨）；关闭时每条编辑器轨道 = 一条判定线。
- 判定线随流速 `speed=10` 滚动；音符从判定线上方落入(`above:1`)。
- 非合并模式下多条判定线在 X∈[-600,600] 均匀铺开（`moveXEvents`），音符坐标保持 `positionX:0`、`yOffset:-10`。
- META 元信息（曲名/难度/谱师/编曲/曲绘作者）面板手动填写，曲名用工程信息自动填充。
- 谱面名做**文件名基底**：空格→`-`、剔除非法字符；包内 `<基底>.json`、`<基底>.<音频扩展>`、`<基底>.<图扩展>` 与谱面名一致。
- 打包附带 `info.txt`（`#` + `Key: Value`，`load_info` 可读）、音频（`api.system.audioPath()` 取工程音频）、曲绘（用户外部选择）。

## 安装

把整个 `bdg_plugin_phira` 文件夹放入宿主扫描目录：

- 用户目录 `<userData>/plugins/`
- 开发模式下工程根目录的 `plugins/`

## 使用

1. 打开插件面板（菜单「Phira 谱面转换设置」或快捷键 `Alt+P`）。
2. 勾选「合并成单轨（一条判定线）」决定是否合并。
3. 填 META 元信息；点「选择曲绘图片…」选外部配图。
4. 点「生成并导出 .pez」或在「导出」菜单选「Phira 谱面：导出 .pez」。
5. 面板底部日志会显示打包每一步的结果。

## 生成结构

```
<基底>.pez
├─ <基底>.json      # RPE chart（META / BPMList / judgeLineList）
├─ info.txt          # # + Name/Song/Chart/Image/…
├─ <基底>.<音频扩展>  # 工程音频
└─ <基底>.<图扩展>    # 曲绘（可选）
```

`<基部> = sanitize(谱面名)`（空格→`-`，剔除 `\ / : * ? " < > |`）。

## 文件说明

| 文件            | 作用 |
|----------------|------|
| `manifest.json` | 元信息，声明 renderer 与 main 入口 |
| `renderer.js`   | UI 侧：面板、动作、快捷键、导出器；构建谱面 JSON 与 info.txt |
| `main.js`      | 主进程侧：`package` 处理器，用 Node 读音频/曲绘并把各文件打包成合法 zip（自定义 ZIP 写入器 + `zlib.deflateRaw`) |
| `plugin-api.d.ts` | 宿主类型提示（含补充的 `system.audioPath()`） |

## 与宿主机制的对接

- 导出通过 `api.ui.registerExporter` + `api.system.saveFile`。
- 谱面 JSON 由 `renderer.js` 构造并 `JSON.stringify`，经 `api.callMain("package", {...})` 交给 `main.js` 打包落盘（沙箱无法写二进制 zip）。
- 生成的 `META` 同时带 `offset`/`RPEVersion`（供 `parse_rpe` 读谱）与 `name/level/charter/composer/song/illustration`（供 `fix_info` 导入时填元数据，`fs.rs`）。
- 判定线 `Texture:"line.png"` → Phira 使用内置判定线（`JudgeLineKind::Normal`），不依赖包内纹理文件。

## 许可

本插件为独立作品，版权归作者所有。宿主插件加载器与 Phira 以各自许可证发布。
