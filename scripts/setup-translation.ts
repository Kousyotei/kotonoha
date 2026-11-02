import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, writeFile, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { TRANSLATION_ROOT, TRANSLATION_DIR, TRANSLATION_PYTHON, TRANSLATION_READY,
  TRANSLATION_FILES, TRANSLATION_REPO, TRANSLATION_REVISION, TRANSLATION_SUPPORTED,
  TRANSLATION_BYTES, translationReady } from "../server/translation-runtime";
const event = (message: string, progress: number) => process.stdout.write(JSON.stringify({ type: "progress", message, progress }) + "\n");
function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: TRANSLATION_ROOT, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(Error(`翻译组件准备失败（退出代码 ${code}），请检查终端。`)));
  });
}
async function hash(file: string) {
  const sha = createHash("sha256");
  for await (const chunk of createReadStream(file)) sha.update(chunk);
  return sha.digest("hex");
}
async function download(url: string, file: string, expected: string, size: number, progress: (bytes: number) => void) {
  if (await hash(file).catch(() => "") === expected) { progress(size); return; }
  const temp = file + ".partial";
  const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok || !response.body) throw Error(`翻译模型下载失败（HTTP ${response.status}），请检查网络后重试。`);
  const output = await open(temp, "w"), reader = response.body.getReader(), sha = createHash("sha256");
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > size) throw Error("翻译模型下载大小异常，未安装。");
      sha.update(value); await output.writeFile(value); progress(bytes);
    }
    await output.close();
    if (bytes !== size || sha.digest("hex") !== expected) throw Error("翻译模型校验失败，未安装，请重试。");
    await rename(temp, file);
  } catch (error) {
    await reader.cancel().catch(() => {}); await output.close().catch(() => {});
    await rm(temp, { force: true }); throw error;
  } finally { reader.releaseLock(); }
}
try {
  if (!TRANSLATION_SUPPORTED) throw Error("Hy-MT2 本地翻译需要 Apple Silicon Mac。中文仍可手动编辑。");
  if (translationReady()) { event("本地翻译已就绪，无需重复下载。", 1); process.exit(0); }
  const uv = [process.env.KOTONOHA_UV, path.join(os.homedir(), ".local/bin/uv"), "/opt/homebrew/bin/uv",
    ...(process.env.PATH || "").split(path.delimiter).map(dir => path.join(dir, "uv"))].find(value => value && existsSync(value));
  if (!uv) throw Error("未找到 uv。请先按 README 安装 uv（已有 Homebrew 可运行 brew install uv），再准备翻译模型。");
  event("正在准备独立的本地翻译环境…", 0.03);
  if (!existsSync(TRANSLATION_PYTHON)) await run(uv, ["venv", "--python", "3.11", path.dirname(path.dirname(TRANSLATION_PYTHON))]);
  await run(uv, ["pip", "sync", "--python", TRANSLATION_PYTHON, path.join(TRANSLATION_ROOT, "python/translation-requirements.lock")]);
  let downloaded = 0, lastEvent = 0;
  const hashes: Record<string, string> = {};
  await mkdir(TRANSLATION_DIR, { recursive: true });
  for (const file of TRANSLATION_FILES) {
      await download(`https://huggingface.co/${TRANSLATION_REPO}/resolve/${TRANSLATION_REVISION}/${file.name}`,
        path.join(TRANSLATION_DIR, file.name), file.sha, file.bytes, bytes => {
          if (Date.now() - lastEvent > 700) {
            event(`正在准备 Hy-MT2 模型 ${Math.round((downloaded + bytes) / TRANSLATION_BYTES * 100)}%…`, 0.1 + 0.8 * (downloaded + bytes) / TRANSLATION_BYTES);
            lastEvent = Date.now();
          }
        });
      downloaded += file.bytes; hashes[file.name] = file.sha;
  }
  event("正在检查真实翻译输出…", 0.93);
  await run(TRANSLATION_PYTHON, [path.join(TRANSLATION_ROOT, "python/translate.py"), "--model", TRANSLATION_DIR, "--probe"]);
  await writeFile(TRANSLATION_READY + ".tmp", JSON.stringify({ version: 2, revision: TRANSLATION_REVISION, selfTest: true, hashes,
    platform: process.platform, arch: process.arch, installedAt: new Date().toISOString() }, null, 2));
  await rename(TRANSLATION_READY + ".tmp", TRANSLATION_READY);
  event("本地翻译模型已就绪，之后可离线使用。", 1);
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
