import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const ffmpeg = () => [process.env.KOTONOHA_FFMPEG, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg",
  ...(process.env.PATH || "").split(path.delimiter).map(dir => path.join(dir, "ffmpeg"))]
  .find((file): file is string => !!file && existsSync(file));

async function run(args: string[], signal?: AbortSignal): Promise<string> {
  const binary = ffmpeg();
  if (!binary) throw Error("声音增强需要 FFmpeg，请先运行 brew install ffmpeg，再重试。");
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let log = "", timedOut = false;
    const abort = () => { child.kill("SIGTERM"); };
    const timer = setTimeout(() => { timedOut = true; abort(); }, 180000);
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (part: string) => { log = (log + part).slice(-64000); });
    child.once("error", error => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); });
    child.once("close", code => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(Error("声音处理已取消。"));
      else if (timedOut) reject(Error("声音处理超时，请稍后重试。"));
      else if (code !== 0) reject(Error(`声音处理失败：${log.slice(-1200)}`));
      else resolve(log);
    });
  });
}

export function voiceFilter(gain: number): string {
  if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw Error("人声增益必须在 0–400% 之间。");
  // -1 dBFS ceiling; disable the limiter's automatic make-up gain. Compensate
  // look-ahead latency so sentence timings remain attached to the source audio.
  return `volume=${gain},alimiter=limit=0.891250938:level=false:attack=5:release=100:latency=true`;
}
export async function enhanceVoice(input: string, output: string, gain: number, signal?: AbortSignal) {
  await run(["-v", "error", "-i", input, "-map", "0:a:0", "-vn", "-af", voiceFilter(gain),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", output], signal);
}

export async function analyzeVoice(input: string, signal?: AbortSignal) {
  const log = await run(["-i", input, "-map", "0:a:0", "-vn", "-af",
    "loudnorm=I=-18:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], signal);
  const match = log.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw Error("无法读取录音响度，请尝试手动调整人声增益。");
  const measured = JSON.parse(match[0]);
  const loudness = Number(measured.input_i), peak = Number(measured.input_tp);
  if (!Number.isFinite(loudness) || !Number.isFinite(peak))
    throw Error("没有检测到可分析的人声，请检查录音是否接近静音。");
  const gain = Math.round(Math.min(4, Math.max(1, 10 ** ((-18 - loudness) / 20))) * 100) / 100;
  return { gain, loudness, peak, capped: gain === 4, target: -18 };
}
