import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { duration, parseProject } from "../src/model";

const filename = process.argv[2];
if (!filename)
  throw Error("用法：npm run verify:export -- <project.kotonoha.json>");
const project = parseProject(JSON.parse(await readFile(filename, "utf8")));
const base = process.env.APP_URL || "http://127.0.0.1:5173";
const response = await fetch(`${base}/api/render`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(project),
});
const job = await response.json();
if (!response.ok) throw Error(job.error || `HTTP ${response.status}`);
const deadline = Date.now() + 10 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const response = await fetch(`${base}/api/render/${job.id}`);
  const status = await response.json();
  if (!response.ok || status.error)
    throw Error(status.error || `HTTP ${response.status}`);
  if (status.status !== "done") continue;
  const video = await fetch(`${base}/api/render/${job.id}/video`);
  if (!video.ok || !video.headers.get("content-type")?.startsWith("video/"))
    throw Error("下载返回了非视频响应");
  const bytes = Buffer.from(await video.arrayBuffer());
  if (bytes.length < 1000) throw Error("下载文件大小异常");
  await mkdir(".qa", { recursive: true });
  const output = path.resolve(".qa/verified-export.mp4");
  await writeFile(output, bytes);
  const binaries = path.resolve(
    `node_modules/@remotion/compositor-${process.platform}-${process.arch}`,
  );
  const probe = spawnSync(
    path.join(binaries, "ffprobe"),
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", output],
    { encoding: "utf8", env: { ...process.env, DYLD_LIBRARY_PATH: binaries } },
  );
  if (probe.status !== 0) throw Error(probe.stderr);
  const info = JSON.parse(probe.stdout);
  const v = info.streams.find((s: any) => s.codec_type === "video");
  const a = info.streams.find((s: any) => s.codec_type === "audio");
  if (
    v?.width !== 1920 ||
    v?.height !== 1080 ||
    v?.r_frame_rate !== "30/1" ||
    v?.codec_name !== "h264" ||
    a?.codec_name !== "aac"
  )
    throw Error("输出编码或画面参数错误");
  if (Math.abs(Number(info.format.duration) - duration(project)) > 0.1)
    throw Error("输出时长与项目不符");
  const decoded = spawnSync(
    path.join(binaries, "ffmpeg"),
    [
      "-v",
      "error",
      "-i",
      output,
      "-vn",
      "-f",
      "wav",
      "-c:a",
      "pcm_s16le",
      "-ac",
      "1",
      "pipe:1",
    ],
    {
      env: { ...process.env, DYLD_LIBRARY_PATH: binaries },
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  if (decoded.status !== 0)
    throw Error("输出音频无法解码：" + decoded.stderr.toString());
  const start = decoded.stdout.indexOf(Buffer.from("data")) + 8;
  if (start < 8) throw Error("WAV 数据块不存在");
  let maximum = 0;
  for (let i = start; i < decoded.stdout.length - 1; i += 2)
    maximum = Math.max(maximum, Math.abs(decoded.stdout.readInt16LE(i)));
  if ((project.voice || project.music) && maximum === 0)
    throw Error("输出音轨全为静音");
  console.log(
    JSON.stringify(
      {
        passed: true,
        output,
        bytes: bytes.length,
        width: v.width,
        height: v.height,
        fps: v.r_frame_rate,
        videoCodec: v.codec_name,
        audioCodec: a.codec_name,
        seconds: info.format.duration,
        audioPeak: maximum,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
throw Error("导出验证超时");
