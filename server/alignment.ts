import { Router } from "express";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { parseProject, type Project } from "../src/model";
import type { AlignmentResult } from "../src/alignment";

const root = process.cwd(),
  python = path.join(root, ".venv-align/bin/python"),
  model = path.join(root, ".models/qwen3-forced-aligner");
type Job = {
  id: string;
  status: "running" | "done" | "error" | "cancelled";
  progress: number;
  message: string;
  result?: AlignmentResult;
  error?: string;
  child?: ChildProcess;
};
const jobs = new Map<string, Job>();
let active: Job | undefined;
const supported =
  process.platform === "darwin" &&
  process.arch === "arm64" &&
  Number(os.release().split(".")[0]) >= 24;
const ready = () =>
  supported &&
  existsSync(python) &&
  existsSync(path.join(model, "model.safetensors")) &&
  existsSync(path.join(model, "ready.json"));
function execute(
  job: Job,
  command: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
) {
  return new Promise<void>((resolve, reject) => {
    if (job.status === "cancelled") {
      reject(Error("任务已取消"));
      return;
    }
    const child = spawn(command, args, {
      cwd: root,
      detached: true,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    job.child = child;
    let pending = "",
      stderr = "";
    child.stdout?.on("data", (data) => {
      pending += data.toString();
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (job.status === "cancelled") continue;
          if (event.type === "progress") {
            job.progress = event.progress;
            job.message = event.message;
          }
          if (event.type === "error") job.error = event.message;
          if (event.type === "result")
            job.result = {
              sentences: event.sentences,
              duration: event.duration,
              model: event.model,
            };
        } catch {
          /* Human-readable installer output. */
        }
      }
    });
    child.stderr?.on("data", (data) => {
      stderr = (stderr + data.toString()).slice(-3000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      job.child = undefined;
      if (code === 0 && job.status !== "cancelled") resolve();
      else reject(Error(job.error || stderr.trim() || "任务已取消"));
    });
  });
}
function cancel(job: Job) {
  job.status = "cancelled";
  job.message = "任务已取消";
  const pid = job.child?.pid;
  if (pid)
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
}
function createJob() {
  const job: Job = {
    id: randomUUID(),
    status: "running",
    progress: 0,
    message: "正在准备…",
  };
  jobs.set(job.id, job);
  active = job;
  return job;
}
async function finish(job: Job, work: () => Promise<void>) {
  const timer = setTimeout(
    () => {
      job.error = "任务超时，请检查网络或缩短录音后重试。";
      cancel(job);
      job.status = "error";
    },
    30 * 60 * 1000,
  );
  timer.unref();
  try {
    await work();
    if (job.status === "running") {
      job.status = "done";
      job.progress = 1;
      job.message = "已完成";
    }
  } catch (error) {
    if (job.status !== "cancelled") {
      job.status = "error";
      job.error = job.error || String(error);
      job.message = "任务失败";
    }
  } finally {
    clearTimeout(timer);
    if (active === job) active = undefined;
    setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref();
  }
}
export const alignmentRouter = Router();
alignmentRouter.get("/status", (_req, res) =>
  res.json({
    supported,
    ready: ready(),
    activeJob: active?.id,
    model: "Qwen3-ForcedAligner-0.6B · MLX 8-bit",
  }),
);
alignmentRouter.post("/setup", (_req, res) => {
  if (!supported) {
    res
      .status(400)
      .json({
        error: "本地自动对齐需要 Apple Silicon Mac 和 macOS 15 或更新版本。",
      });
    return;
  }
  if (active) {
    res.status(409).json({ error: "已有模型任务正在运行，请先等待或取消。" });
    return;
  }
  const job = createJob();
  res.json({ id: job.id });
  void finish(job, () =>
    execute(job, process.execPath, [
      path.join(root, "scripts/setup-alignment.mjs"),
    ]),
  );
});
alignmentRouter.post("/", (req, res) => {
  if (!ready()) {
    res.status(400).json({ error: "请先点击「准备本地模型」。" });
    return;
  }
  if (active) {
    res.status(409).json({ error: "已有模型任务正在运行，请先等待或取消。" });
    return;
  }
  let project: Project;
  try {
    project = parseProject(req.body);
    if (!project.voice) throw Error("请先导入朗读录音。");
    if (project.voice.duration > 300)
      throw Error("当前自动对齐支持 5 分钟以内录音。");
    if (project.sentences.every((s) => s.timingLocked))
      throw Error("所有句子均已锁定，请先解锁需要对齐的句子。");
    if (project.sentences.reduce((n, s) => n + s.text.length, 0) > 8000)
      throw Error("自动对齐正文请控制在 8000 字以内。");
  } catch (error) {
    res.status(400).json({ error: String(error) });
    return;
  }
  const job = createJob();
  res.json({ id: job.id });
  void finish(job, async () => {
    const dir = path.join(root, ".alignment-jobs", job.id);
    await mkdir(dir, { recursive: true });
    try {
      const data = project.voice!.src.match(
        /^data:audio\/[\w.+-]+;base64,(.*)$/s,
      );
      if (!data) throw Error("无效的录音数据。");
      await writeFile(
        path.join(dir, "input.audio"),
        Buffer.from(data[1], "base64"),
      );
      await writeFile(
        path.join(dir, "request.json"),
        JSON.stringify({ sentences: project.sentences }),
      );
      job.message = "正在读取人声录音…";
      job.progress = 0.05;
      const binaries = path.join(
        root,
        `node_modules/@remotion/compositor-${process.platform}-${process.arch}`,
      );
      await execute(
        job,
        path.join(binaries, "ffmpeg"),
        [
          "-v",
          "error",
          "-i",
          path.join(dir, "input.audio"),
          "-t",
          "301",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          "-y",
          path.join(dir, "audio.wav"),
        ],
        { DYLD_LIBRARY_PATH: binaries },
      );
      await execute(
        job,
        python,
        [
          path.join(root, "python/alignment_worker.py"),
          "--request",
          path.join(dir, "request.json"),
          "--audio",
          path.join(dir, "audio.wav"),
          "--model",
          model,
        ],
        {
          HF_HUB_OFFLINE: "1",
          HF_HUB_DISABLE_TELEMETRY: "1",
          TOKENIZERS_PARALLELISM: "false",
        },
      );
      if (!job.result) throw Error("模型没有返回对齐结果。");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
alignmentRouter.get("/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "任务记录已过期，请重新运行。" });
    return;
  }
  const { child, ...publicJob } = job;
  res.json(publicJob);
});
alignmentRouter.post("/:id/cancel", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "任务不存在。" });
    return;
  }
  if (job.status === "running") cancel(job);
  res.json({ status: job.status });
});
process.once("exit", () => {
  if (active?.child?.pid)
    try {
      process.kill(-active.child.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (active) cancel(active);
    process.exit(0);
  });
}
