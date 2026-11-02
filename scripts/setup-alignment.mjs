import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
const root = path.resolve(import.meta.dirname, "..");
const event = (message, progress) =>
  process.stdout.write(
    JSON.stringify({ type: "progress", message, progress }) + "\n",
  );
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: "1" },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(Error(`${command} 退出代码 ${code}`)),
    );
  });
}
try {
  if (
    process.platform !== "darwin" ||
    process.arch !== "arm64" ||
    Number(os.release().split(".")[0]) < 24
  )
    throw Error("此本地模型需要 Apple Silicon Mac 和 macOS 15 或更新版本。");
  const uvCandidates = [
    process.env.KOTONOHA_UV,
    path.join(os.homedir(), ".local/bin/uv"),
    "/opt/homebrew/bin/uv",
    ...(process.env.PATH || "")
      .split(path.delimiter)
      .map((dir) => path.join(dir, "uv")),
  ].filter(Boolean);
  const uv = uvCandidates.find((candidate) => existsSync(candidate));
  if (!uv)
    throw Error(
      "未找到 uv。请先运行 brew install uv，或按 README 安装 uv 后重试。",
    );
  event("正在准备独立 Python 3.11 环境…", 0.05);
  const python = path.join(root, ".venv-align/bin/python");
  if (!existsSync(python))
    await run(uv, ["venv", "--python", "3.11", path.join(root, ".venv-align")]);
  event("正在安装本地对齐组件…", 0.15);
  await run(uv, [
    "pip",
    "install",
    "--python",
    python,
    "-r",
    path.join(root, "python/requirements.lock"),
  ]);
  await run(python, [
    path.join(root, "python/download_model.py"),
    "--dest",
    path.join(root, ".models/qwen3-forced-aligner"),
  ]);
  event("本地模型已准备完成", 1);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
