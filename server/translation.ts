import { Router } from "express";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { validateTranslationInputs, validateTranslationResult, type TranslationResult, type TranslationInput } from "../src/translation";
import { TRANSLATION_ROOT, TRANSLATION_DIR, TRANSLATION_PYTHON, TRANSLATION_MODEL, TRANSLATION_BYTES, TRANSLATION_SUPPORTED, translationReady } from "./translation-runtime";
type Job = { id: string; kind: "setup" | "translate"; status: "running" | "done" | "error" | "cancelled";
  progress: number; message: string; error?: string; result?: TranslationResult; child?: ChildProcess };
const jobs = new Map<string, Job>();
let active: Job | undefined;
function cancel(job: Job) {
  if (job.status !== "running") return;
  job.status = "cancelled"; job.message = "已取消，已有译文保留。";
  if (job.child?.pid) try { process.kill(-job.child.pid, "SIGTERM"); } catch { /* Already exited. */ }
}
function execute(job: Job, command: string, args: string[], input?: unknown) {
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(command, args, { cwd: TRANSLATION_ROOT, detached: true,
      env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"] });
    job.child = child;
    let pending = "", stderr = "", result: unknown;
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === "progress" && Number.isFinite(event.progress) && job.status === "running") {
            job.progress = Math.max(0, Math.min(1, event.progress)); job.message = String(event.message);
          } else if (event.type === "result") result = event.items;
        } catch { /* pip/setup output is not necessarily JSON. */ }
      }
      if (pending.length > 2000000) { child.kill("SIGTERM"); reject(Error("翻译组件输出过长。")); }
    });
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
    child.stdin.on("error", () => {}); child.stdin.end(input ? JSON.stringify(input) : "");
    child.once("error", reject);
    child.once("close", code => {
      job.child = undefined;
      if (code === 0 && job.status === "running") resolve(result);
      else reject(Error(stderr.trim() || "本地翻译任务已停止。"));
    });
  });
}
async function finish(job: Job, work: () => Promise<void>) {
  const timer = setTimeout(() => {
    job.error = "本地翻译任务超时，请减少句子后重试。"; cancel(job); job.status = "error";
  }, 15 * 60 * 1000);
  timer.unref();
  try {
    await work();
    if (job.status === "running") { job.status = "done"; job.progress = 1; job.message = job.kind === "setup" ? "本地翻译已就绪。" : "翻译初稿已生成，请检查后采用。"; }
  } catch (error) {
    if (job.status !== "cancelled") { job.status = "error"; job.error ||= error instanceof Error ? error.message : String(error); job.message = "任务失败，已有译文保留。"; }
  } finally {
    clearTimeout(timer); if (active === job) active = undefined;
    setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref();
  }
}
export const translationRouter = Router();
translationRouter.get("/status", (_req, res) => res.json({ ready: translationReady(), supported: TRANSLATION_SUPPORTED, activeJob: active?.id,
  model: TRANSLATION_MODEL, modelMB: Math.ceil(TRANSLATION_BYTES / 1000000) }));
for (const setup of [true, false]) translationRouter.post(setup ? "/setup" : "/", (req, res) => {
  if (!TRANSLATION_SUPPORTED) { res.status(400).json({ error: "Hy-MT2 本地翻译需要 Apple Silicon Mac。中文仍可手动编辑。" }); return; }
  if (active) { res.status(409).json({ error: "已有翻译任务，请等待或取消。" }); return; }
  let inputs: TranslationInput[] = [];
  if (!setup) {
    if (!translationReady()) { res.status(400).json({ error: "请先准备本地翻译模型。" }); return; }
    try { inputs = validateTranslationInputs(req.body?.sentences); }
    catch (error) { res.status(400).json({ error: String(error) }); return; }
  }
  const job: Job = { id: randomUUID(), kind: setup ? "setup" : "translate", status: "running", progress: 0, message: "正在准备…" };
  jobs.set(job.id, job); active = job; res.json({ id: job.id });
  void finish(job, async () => {
    if (setup) {
      await execute(job, process.execPath, ["--import", "tsx", path.join(TRANSLATION_ROOT, "scripts/setup-translation.ts")]);
      if (!translationReady()) throw Error("翻译组件准备后未通过就绪检查，请重试。");
    } else {
      job.message = "正在加载本地翻译模型…";
      const output = await execute(job, TRANSLATION_PYTHON, [path.join(TRANSLATION_ROOT, "python/translate.py"), "--model", TRANSLATION_DIR], { sentences: inputs });
      if (!Array.isArray(output) || output.length !== inputs.length || output.some((row, i) => row?.id !== inputs[i].id || typeof row.translation !== "string"))
        throw Error("翻译结果与原句不匹配，已有译文保留。");
      job.result = validateTranslationResult({ model: TRANSLATION_MODEL, items: inputs.map((s, i) => ({ id: s.id, sourceText: s.text, previousTranslation: s.translation, translation: output[i].translation })) }, inputs);
    }
  });
});
translationRouter.get("/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: "翻译记录已过期，请重新生成。" }); return; }
  const { child, ...record } = job; res.json(record);
});
translationRouter.post("/:id/cancel", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: "翻译任务不存在。" }); return; }
  cancel(job); res.json({ status: job.status });
});
process.once("exit", () => { if (active) cancel(active); });
