import type { Media } from "./model";

const MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  wave: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
  aif: "audio/aiff",
  aiff: "audio/aiff",
};
export function audioMime(name: string, browserType: string): string {
  const extension = name.split(".").at(-1)?.toLowerCase() || "";
  return (
    MIME_TYPES[extension] ||
    (browserType.startsWith("audio/") ? browserType : "")
  );
}
export function metadataDuration(
  element: HTMLAudioElement,
  src: string,
  timeout = 20000,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener("loadedmetadata", loaded);
      element.removeEventListener("durationchange", loaded);
      element.removeEventListener("error", failed);
      element.removeAttribute("src");
      element.load();
    };
    const loaded = () => {
      if (!Number.isFinite(element.duration) || element.duration <= 0) return;
      const seconds = element.duration;
      cleanup();
      resolve(seconds);
    };
    const failed = () => {
      cleanup();
      reject(Error("浏览器无法解码此音频"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(Error("读取音频时长超时"));
    }, timeout);
    // Attach listeners before assigning src: cached or tiny audio may load immediately.
    element.addEventListener("loadedmetadata", loaded);
    element.addEventListener("durationchange", loaded);
    element.addEventListener("error", failed);
    element.preload = "metadata";
    element.src = src;
    element.load();
  });
}
async function decodedDuration(blob: Blob): Promise<number> {
  const context = new AudioContext();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const decoded = await Promise.race([
      (async () => {
        const buffer = await blob.arrayBuffer();
        return context.decodeAudioData(buffer);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("音频解码超时")), 20000);
      }),
    ]);
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0)
      throw Error("音频时长无效");
    return decoded.duration;
  } finally {
    clearTimeout(timer);
    void context.close().catch(() => {});
  }
}
export async function importAudio(
  file: File,
  progress: (message: string) => void,
): Promise<Media> {
  if (file.size === 0) throw Error("文件是空的，请重新选择音频。");
  if (file.size > 150 * 1024 * 1024) throw Error("单个音频请小于 150 MB。");
  const mime = audioMime(file.name, file.type);
  if (!mime)
    throw Error(
      "未识别音频格式。请使用 MP3、WAV、M4A、AAC、FLAC、OGG 或 WebM。",
    );
  const blob = file.slice(0, file.size, mime);
  progress("正在读取音频时长…");
  const url = URL.createObjectURL(blob);
  let seconds: number;
  try {
    try {
      seconds = await metadataDuration(new Audio(), url);
    } catch {
      progress("正在尝试兼容解码…");
      seconds = await decodedDuration(blob);
    }
  } catch {
    throw Error(
      `无法读取「${file.name}」。请确认文件已下载到本机、能够正常播放；也可以转换为 MP3 或 WAV 后重试。`,
    );
  } finally {
    URL.revokeObjectURL(url);
  }
  progress("正在载入项目…");
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const timer = setTimeout(() => {
      reject(Error("读取文件超时，请先将音频下载到本机后重试。"));
      reader.abort();
    }, 30000);
    reader.onerror = () => {
      clearTimeout(timer);
      reject(Error("文件读取失败，请确认文件已下载到本机。"));
    };
    reader.onabort = () => {
      clearTimeout(timer);
      reject(Error("文件读取已取消。"));
    };
    reader.onload = () => {
      clearTimeout(timer);
      resolve(reader.result as string);
    };
    reader.onprogress = (event) => {
      if (event.lengthComputable)
        progress(
          `正在载入项目 ${Math.round((event.loaded / event.total) * 100)}%`,
        );
    };
    reader.readAsDataURL(blob);
  });
  return { name: file.name, src, duration: seconds };
}
