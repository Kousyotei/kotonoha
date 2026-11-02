import express from "express";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseProject } from "../src/model";
import { browserExecutable } from "./browser";
import { alignmentRouter } from "./alignment";
import { furiganaRouter } from "./furigana";
import { translationRouter } from "./translation";
import { voiceRouter } from "./voice";
import { enhanceVoice } from "./voice-processing";
const app = express();
const root = process.cwd();
const renderRoot = path.join(root, ".renders");
await mkdir(renderRoot, { recursive: true });
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    origin &&
    !/^http:\/\/(localhost|127\.0\.0\.1):(5173|3001)$/.test(origin)
  ) {
    res.status(403).json({ error: "仅接受本地编辑器请求" });
    return;
  }
  next();
});
app.use(express.json({ limit: "450mb" }));
app.use("/api/alignment", alignmentRouter);
app.use("/api/furigana", furiganaRouter);
app.use("/api/translation", translationRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/assets", express.static(renderRoot));
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "kotonoha",
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
  }),
);
type Job = {
  status: "rendering" | "done" | "error";
  progress: number;
  error?: string;
  output: string;
};
const jobs = new Map<string, Job>();
let active = false;
let bundlePromise: Promise<string> | null = null;
app.post("/api/render", async (req, res) => {
  if (active) {
    res.status(409).json({ error: "已有视频正在导出，请稍候" });
    return;
  }
  let project;
  try {
    project = parseProject(req.body);
  } catch (e) {
    res.status(400).json({ error: String(e) });
    return;
  }
  active = true;
  const id = randomUUID();
  const dir = path.join(renderRoot, id);
  try {
    await mkdir(dir);
  } catch (error) {
    active = false;
    res.status(500).json({ error: `无法创建导出目录：${String(error)}` });
    return;
  }
  const job: Job = {
    status: "rendering",
    progress: 0,
    output: path.join(dir, "video.mp4"),
  };
  jobs.set(id, job);
  res.json({ id });
  try {
    for (const key of ["voice", "music"] as const) {
      const media = project[key];
      if (media) {
        const match = media.src.match(/^data:audio\/([\w.+-]+);base64,(.*)$/s);
        if (!match) throw Error("无效音频");
        const ext =
          (
            {
              mpeg: "mp3",
              mp3: "mp3",
              wav: "wav",
              "x-wav": "wav",
              mp4: "m4a",
              "x-m4a": "m4a",
              ogg: "ogg",
              aac: "aac",
              flac: "flac",
              webm: "webm",
            } as Record<string, string>
          )[match[1]] || "bin";
        let filename = `${key}.${ext}`;
        await writeFile(
          path.join(dir, filename),
          Buffer.from(match[2], "base64"),
        );
        if (key === "voice" && project.voiceVolume > 1) {
          const enhanced = "voice-enhanced.m4a";
          await enhanceVoice(path.join(dir, filename), path.join(dir, enhanced), project.voiceVolume);
          filename = enhanced;
          project.voiceVolume = 1;
        }
        project[key] = {
          ...media,
          src: `http://127.0.0.1:3001/api/assets/${id}/${filename}`,
        };
      }
    }
    bundlePromise ??= bundle({
      entryPoint: path.join(root, "src/video-entry.tsx"),
    });
    const serveUrl = await bundlePromise;
    const inputProps = { project };
    const composition = await selectComposition({
      serveUrl,
      id: "Reading",
      inputProps,
      browserExecutable: browserExecutable(),
      chromeMode: browserExecutable() ? "chrome-for-testing" : "headless-shell",
    });
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      crf: 18,
      outputLocation: job.output,
      concurrency: 2,
      browserExecutable: browserExecutable(),
      chromeMode: browserExecutable() ? "chrome-for-testing" : "headless-shell",
      onProgress: ({ progress }) => {
        job.progress = progress;
      },
    });
    job.status = "done";
    job.progress = 1;
  } catch (e) {
    job.status = "error";
    job.error = String(e);
    bundlePromise = null;
  } finally {
    active = false;
  }
  // Local temporary assets and exports are retained for 24h, then removed.
  const timer = setTimeout(() => {
    jobs.delete(id);
    void rm(dir, { recursive: true, force: true });
  }, 86400000);
  timer.unref();
});
app.get("/api/render/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "导出记录不存在" });
    return;
  }
  res.json({ status: job.status, progress: job.progress, error: job.error });
});
app.get("/api/render/:id/video", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "done") {
    res.status(404).end();
    return;
  }
  res.download(job.output, "reading.mp4", { dotfiles: "allow" });
});
if (process.env.NODE_ENV !== "production") {
  app.get("/", (_req, res) => res.redirect("http://127.0.0.1:5173/"));
}
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("/", (_req, res) => res.sendFile(path.join(root, "dist/index.html")));
}
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(400).json({ error: err.message });
  },
);
app.listen(3001, "127.0.0.1", () =>
  console.log(
    process.env.NODE_ENV === "production"
      ? "编辑器：http://127.0.0.1:3001"
      : "编辑器：http://127.0.0.1:5173（3001 是导出服务）",
  ),
);
