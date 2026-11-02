import { Router } from "express";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { analyzeVoice, enhanceVoice } from "./voice-processing";
const root = path.resolve(".voice-jobs");
let active = 0;
export const voiceRouter = Router();
for (const analyze of [false, true]) voiceRouter.post(analyze ? "/analyze" : "/prepare", async (req, res) => {
  if (active >= 2) { res.status(429).json({ error: "声音处理繁忙，请稍后重试。" }); return; }
  const media = req.body?.voice, gain = req.body?.gain;
  const match = typeof media?.src === "string" && media.src.match(/^data:audio\/[\w.+-]+;base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match || !Number.isFinite(media.duration) || media.duration <= 0 ||
    (!analyze && (!Number.isFinite(gain) || gain < 0 || gain > 4))) {
    res.status(400).json({ error: "无效的人声录音或增益参数。" }); return;
  }
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length || bytes.length > 150 * 1024 * 1024) {
    res.status(400).json({ error: "人声录音需在 0–150 MB 以内。" }); return;
  }
  active++;
  const controller = new AbortController();
  const closed = () => { if (!res.writableEnded) controller.abort(); };
  res.on("close", closed);
  let directory: string | undefined;
  try {
    await mkdir(root, { recursive: true }); directory = await mkdtemp(path.join(root, "voice-"));
    const input = path.join(directory, "original.audio"), output = path.join(directory, "enhanced.m4a");
    await writeFile(input, bytes);
    if (analyze) res.json(await analyzeVoice(input, controller.signal));
    else {
      await enhanceVoice(input, output, gain, controller.signal);
      res.type("audio/mp4").set("Cache-Control", "no-store");
      await new Promise<void>((resolve, reject) => res.sendFile(output, { dotfiles: "allow" }, error => error ? reject(error) : resolve()));
    }
  } catch (error) {
    if (!res.headersSent && !res.destroyed)
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    active--; res.removeListener("close", closed);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});
