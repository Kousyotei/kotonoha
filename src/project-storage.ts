import { parseProject, type Media, type Project } from "./model";

const DATABASE = "kotonoha-studio";
const STORE = "workspace";
const CURRENT = "current";
type StoredMedia = Omit<Media, "src"> & { blob: Blob };
type StoredWorkspace = {
  version: 1;
  project: Omit<Project, "voice" | "music">;
  voice: StoredMedia | null;
  music: StoredMedia | null;
  draft: string;
  savedAt: string;
};
export type LocalWorkspace = { project: Project; draft: string; savedAt: string };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(Error("此浏览器不支持本机项目存储，请导出项目备份。"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error || Error("无法打开本机项目存储。"));
    request.onblocked = () => {
      blocked = true;
      reject(Error("本机项目存储被其他页面占用，请关闭其他 App 标签页后重试。"));
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (blocked) database.close();
      else resolve(database);
    };
  });
}

// Finish encoding before starting the transaction: awaiting other work inside
// an IndexedDB transaction can cause it to auto-commit before the write.
async function storeMedia(media: Media | null): Promise<StoredMedia | null> {
  if (!media) return null;
  const response = await fetch(media.src);
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith("audio/"))
    throw Error(`无法保存音频「${media.name}」，请检查音频后重试。`);
  return { name: media.name, duration: media.duration, blob };
}
function restoreMedia(media: StoredMedia | null): Promise<Media | null> {
  if (media === null) return Promise.resolve(null);
  if (!media || !(media.blob instanceof Blob) || !media.blob.size ||
      !media.blob.type.startsWith("audio/") || typeof media.name !== "string")
    return Promise.reject(Error("本机项目中的音频记录无效。"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error(`无法恢复音频「${media.name}」。`));
    reader.onabort = () => reject(Error("音频恢复已取消。"));
    reader.onload = () => resolve({ name: media.name, duration: media.duration, src: String(reader.result) });
    reader.readAsDataURL(media.blob);
  });
}

export async function saveLocalProject(project: Project, draft: string): Promise<string> {
  // Editing errors such as overlapping times may be saved and fixed later.
  // Project imports and MP4 exports retain their existing strict validation.
  parseProject(project, { allowEditingErrors: true });
  if (typeof draft !== "string") throw Error("正文草稿无效。");
  const { voice, music, ...metadata } = project;
  const savedVoice = await storeMedia(voice);
  const savedMusic = await storeMedia(music);
  const savedAt = new Date().toISOString();
  const record: StoredWorkspace = { version: 1, project: metadata,
    voice: savedVoice, music: savedMusic, draft, savedAt };
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      // A single transaction replaces the complete snapshot, including both
      // audio files. Failure leaves the previously committed snapshot intact.
      const transaction = database.transaction(STORE, "readwrite", { durability: "strict" });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || Error("本机保存未完成，原保存版本保留。"));
      transaction.onerror = () => { /* onabort reports transaction failure. */ };
      transaction.objectStore(STORE).put(record, CURRENT);
    });
    return savedAt;
  } finally { database.close(); }
}

export async function loadLocalProject(): Promise<LocalWorkspace | null> {
  const database = await openDatabase();
  let record: StoredWorkspace | undefined;
  try {
    record = await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(CURRENT);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || Error("无法读取本机保存的项目。"));
      transaction.onerror = () => { /* onabort reports transaction failure. */ };
    });
  } finally { database.close(); }
  if (record === undefined) return null;
  if (!record || record.version !== 1 || typeof record.draft !== "string" ||
      typeof record.savedAt !== "string" || !Number.isFinite(Date.parse(record.savedAt)))
    throw Error("本机项目记录无效，原保存数据未改动。请打开项目备份或重试。");
  const voice = await restoreMedia(record.voice);
  const music = await restoreMedia(record.music);
  const project = parseProject({ ...record.project, voice, music }, { allowEditingErrors: true });
  return { project, draft: record.draft, savedAt: record.savedAt };
}

export function storageFailure(error: unknown): string {
  if (error instanceof Error && error.name === "QuotaExceededError")
    return "本机存储空间不足，保存未完成。原保存版本保留，请导出项目备份。";
  if (error instanceof Error && ["SecurityError", "InvalidStateError"].includes(error.name))
    return "浏览器不允许访问本机项目存储，请检查网站存储权限，或导出项目备份。";
  return error instanceof Error ? error.message : String(error);
}
