# 言の葉 · 日语朗读工作室

[日本語](README.md) · [架构](docs/architecture.md) · [模型评估](docs/evaluation.md) · [测试](docs/testing.md) · [上传 GitHub](docs/publishing.zh-CN.md)

在本机把日语文章和朗读录音制作成带注音、中文译文和逐句高亮的视频。技术栈为 React、TypeScript、Remotion、Express 与 Python；本地模型结果先预览、人工修正，再选择采用。

## 快速开始

已在 macOS / Apple Silicon / Node.js 22 验证基本编辑流程。安装 Node.js 22 或更新版本后：

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:5173，保持终端运行。也可双击 `start.command`；仓库不包含本机的 Node 安装。前端使用 5173，API 使用 3001。

基础编辑、预览和保存不需要下载 AI 模型。公开示例为原创短文《雨上がりの手紙》；用「打开项目文件」选择 `samples/demo.kotonoha.json` 可载入逐句中文译文。示例没有录音，请导入你自己的 MP3 / WAV / M4A。

默认日语界面，右上角可以切换中文，浏览器会记住选择。编辑后点击「保存」或 ⌘S / Ctrl+S，可在刷新后恢复正文草稿、音频和设置。「导出项目备份」下载便携 JSON 文件。

## 可选功能

| 功能 | 准备命令 | 条件 |
| --- | --- | --- |
| 自动注音 | `npm run setup:furigana` | 首次下载 JMdict |
| 本地日中翻译 | `npm run setup:translation` | Apple Silicon、uv；约 1.02 GB 模型 |
| 已知原文与朗读的自动对齐 | `npm run setup:alignment` | Apple Silicon / macOS 15+、uv；约 1.3 GB 模型 |
| 人声增强 | `brew install ffmpeg` | 完整 FFmpeg，支持 alimiter / loudnorm |

uv 可通过 `brew install uv` 安装。首次准备还可能下载 Python 和依赖。模型和字典安装后在本机运行，录音与正文不上传到模型服务。模型不随 Git 仓库分发。

## 编辑与导出

- 支持传统竖排与日中双语横排、Ruby 注音、容量分页与手动切页。
- 中文逐句绑定日文；朗读时双方同时高亮，上一句保持高亮至下一句开始。
- 自动对齐结果可预览、应用、撤销；手动时间可锁定。
- 注音区分词典、推断与人工确认，点击注音或汉字可以编辑。
- 人声支持 0–400% 增益，超过 100% 时处理峰值；准备完成后可播放和导出。
- MP4 使用 1920×1080 / 30 fps / H.264 + AAC；Chrome 缺失时首次会下载 Remotion 浏览器。
- 本机保存按浏览器及地址隔离，清除站点数据会删除存档。重要项目可另存 JSON 备份。

## 测试与面试讲解

```sh
npm test
npm run verify:locale
npm run verify:playback-page
npm run verify:storage
npm run build
```

这些检查不依赖私人录音或模型。存储检查默认生成测试音；测试音不代表日语朗读或模型精度。GitHub Actions 执行以上基础检查，真实模型和 MP4 验证方法见 [Testing](docs/testing.md)。

工程重点：句子 ID 映射与结果校验、人工采用和旧结果保护、模型任务进度/取消、事务保存、预览与导出共用排版。详细设计见 [架构](docs/architecture.md)。模型取舍与评估边界见 [Evaluation](docs/evaluation.md)。

## 已知限制和来源

翻译、读音和对齐都可能有误，需要人工校对。没有宣称统一基准准确率。长句可能需要拆句或缩小字号。逐帧 CPU 导出仍较慢。服务重启不恢复执行中的任务。完整 App 需要 Express / Python / FFmpeg 运行环境，GitHub Pages 适合放介绍页面。

公开示例中的中文是手工编辑的展示内容，不是模型评测结果。开发使用了 AI 辅助工具。第三方模型与辞典的来源、许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
