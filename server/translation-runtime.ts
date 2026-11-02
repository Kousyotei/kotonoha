import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
export const TRANSLATION_ROOT = path.resolve(import.meta.dirname, "..");
export const TRANSLATION_MODEL = "Hy-MT2 1.8B · MLX 4bit · 日→简体中文";
export const TRANSLATION_DIR = path.join(TRANSLATION_ROOT, ".models/translation-hy-mt2");
export const TRANSLATION_PYTHON = path.join(TRANSLATION_ROOT, ".venv-translation-quality/bin/python");
export const TRANSLATION_READY = path.join(TRANSLATION_DIR, "ready.json");
export const TRANSLATION_SUPPORTED = process.platform === "darwin" && process.arch === "arm64";
export const TRANSLATION_REPO = "mlx-community/Hy-MT2-1.8B-4bit";
export const TRANSLATION_REVISION = "e5c6fe56c7b3bc77fae5ae92db31f2178f1e6912";
export const TRANSLATION_FILES = [
  {
    "name": "config.json",
    "sha": "63180daf56cf2ca15223b358eae0bcb5252b7fd4bfa2b2882b36e82f4c410da8",
    "bytes": 1688
  },
  {
    "name": "model.safetensors",
    "sha": "a9cecbc77050b86b2fa3df3a8941d34ed3585cdbcce07bd64b3da289d50537c6",
    "bytes": 1007776125
  },
  {
    "name": "model.safetensors.index.json",
    "sha": "6026955be1656bf6cf7b9ffd56aac91c88287ba13fbab8b9f140655464b9de4b",
    "bytes": 57380
  },
  {
    "name": "tokenizer.json",
    "sha": "b475bbef1b0b2fd57dcb865332b546475bd1ede2deb3bb91bafd0c047a8a530a",
    "bytes": 9527287
  },
  {
    "name": "tokenizer_config.json",
    "sha": "9c8fad86305966b62964ad3f4b56d00fb3234141028a31710ca312ba3e417cd9",
    "bytes": 359
  },
  {
    "name": "chat_template.jinja",
    "sha": "b7491ec0e9c869dfce20f2176758099bf248d979dd05530ede99deb21698acee",
    "bytes": 654
  },
  {
    "name": "generation_config.json",
    "sha": "0e28667f1cb4c7b880b9223b2d87978f88e79ed7ae037de1021f826c18d4ed6f",
    "bytes": 221
  },
  {
    "name": "LICENSE.txt",
    "sha": "1af3c6dc0c697277cbb6b68720787c1caa43a79c5626bf9f19cd8c00de9c8cd4",
    "bytes": 11629
  }
] as const;
export const TRANSLATION_BYTES = TRANSLATION_FILES.reduce((n, file) => n + file.bytes, 0);
export function translationReady() {
  try {
    const marker = JSON.parse(readFileSync(TRANSLATION_READY, "utf8"));
    return TRANSLATION_SUPPORTED && existsSync(TRANSLATION_PYTHON) && marker.version === 2 &&
      marker.selfTest === true && marker.revision === TRANSLATION_REVISION &&
      marker.platform === process.platform && marker.arch === process.arch &&
      TRANSLATION_FILES.every(file => marker.hashes?.[file.name] === file.sha &&
        statSync(path.join(TRANSLATION_DIR, file.name)).size === file.bytes);
  } catch { return false; }
}
