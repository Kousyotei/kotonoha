import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { initialProject, parseProject, validate, type Project } from "../src/model";
import { loadLocalProject, saveLocalProject, storageFailure } from "../src/project-storage";

// Node lacks FileReader. Only supply its browser I/O boundary; all application
// serialization, IndexedDB requests, transactions and validation run unchanged.
class NodeFileReader {
  result: string | null = null;
  onload?: () => void;
  onerror?: () => void;
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then(buffer => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onload?.();
    }).catch(() => this.onerror?.());
  }
}
Object.assign(globalThis, { FileReader: NodeFileReader });
beforeEach(() => { Object.assign(globalThis, { indexedDB: new IDBFactory() }); });

const audio = (name: string, bytes: Buffer) => ({ name, duration: 4.25,
  src: `data:audio/mp4;base64,${bytes.toString("base64")}` });
const readStored = async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("kotonoha-studio", 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const result = await new Promise<{ count: number; record: any }>((resolve, reject) => {
    const transaction = database.transaction("workspace");
    const record = transaction.objectStore("workspace").get("current");
    const count = transaction.objectStore("workspace").count();
    transaction.oncomplete = () => resolve({ count: count.result, record: record.result });
    transaction.onabort = () => reject(transaction.error);
  });
  database.close(); return result;
};

test("首次打开没有存档；保存后重新连接可恢复项目和未应用的正文草稿", async () => {
  assert.equal(await loadLocalProject(), null);
  const project = structuredClone(initialProject);
  project.title = "编辑中的作品";
  project.voiceVolume = 4;
  project.sentences[1].translation = "人工修正过的译文。";
  project.sentences[1].note = "保留注释";
  const draft = project.text + "\n尚未应用的新段落。";
  const date = await saveLocalProject(project, draft);
  assert.deepEqual(await loadLocalProject(), { project, draft, savedAt: date });
});

test("两路音频以 Blob 存储，超过 localStorage 常见容量仍能逐字节恢复", async () => {
  const project = structuredClone(initialProject);
  const bytes = Buffer.alloc(6 * 1024 * 1024, 79);
  project.voice = audio("voice-fixture.m4a", bytes);
  project.music = audio("配乐.m4a", Buffer.from([0, 255, 127, 42]));
  await saveLocalProject(project, project.text);
  const stored = await readStored();
  assert.ok(stored.record.voice.blob instanceof Blob);
  assert.equal(stored.record.voice.blob.size, bytes.length);
  assert.equal("src" in stored.record.voice, false);
  assert.equal("voice" in stored.record.project, false);
  assert.equal(stored.record.music.blob.size, 4);
  const restored = (await loadLocalProject())!;
  assert.deepEqual(restored.project, project);
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(restored.project))), project);
});

test("重复保存覆盖同一记录，替换或删除音频后不会恢复旧音频", async () => {
  const project = structuredClone(initialProject);
  project.voice = audio("旧录音.m4a", Buffer.from([1, 2, 3]));
  await saveLocalProject(project, "旧草稿");
  const next = { ...project, title: "新版本", voice: audio("新录音.m4a", Buffer.from([4, 5])) };
  await saveLocalProject(next, "新草稿");
  await saveLocalProject({ ...next, voice: null }, "最终草稿");
  assert.equal((await readStored()).count, 1);
  const restored = (await loadLocalProject())!;
  assert.equal(restored.project.title, "新版本");
  assert.equal(restored.project.voice, null);
  assert.equal(restored.draft, "最终草稿");
});

test("保存未完成的时间与排版调整，恢复后继续提示校验问题而不丢失编辑", async () => {
  const project = structuredClone(initialProject);
  project.sentences[0].end = project.sentences[1].end;
  assert.ok(validate(project).length);
  assert.throws(() => parseProject(project));
  await saveLocalProject(project, project.text);
  assert.deepEqual((await loadLocalProject())!.project, project);
  assert.ok(validate((await loadLocalProject())!.project).length);
});

test("存储空间不足时不报告成功，之前的完整项目仍保留", async () => {
  await saveLocalProject(initialProject, "原草稿");
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException("full", "QuotaExceededError"); };
  try {
    await assert.rejects(saveLocalProject({ ...initialProject, title: "不应写入" }, "新草稿"),
      (error: unknown) => storageFailure(error).includes("存储空间不足"));
  } finally { IDBObjectStore.prototype.put = put; }
  assert.equal((await loadLocalProject())!.project.title, initialProject.title);
  assert.equal((await loadLocalProject())!.draft, "原草稿");
});

test("损坏音频或无效项目在提交前拒绝，不覆盖原保存版本", async () => {
  await saveLocalProject(initialProject, "保留草稿");
  const invalid = { ...initialProject, voice: { name: "bad", duration: 1, src: "data:audio/mp4;base64,%%%" } };
  await assert.rejects(saveLocalProject(invalid, "错误草稿"));
  await assert.rejects(saveLocalProject({ version: 99 } as unknown as Project, "错误草稿"));
  assert.equal((await loadLocalProject())!.draft, "保留草稿");
});

test("写入请求成功后事务被中止，整份新快照回滚，保存仍必须报错", async () => {
  await saveLocalProject(initialProject, "已提交版本");
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    const request = put.apply(this, args);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  };
  try {
    await assert.rejects(saveLocalProject({ ...initialProject, title: "不能提交" }, "未提交版本"));
  } finally { IDBObjectStore.prototype.put = put; }
  assert.equal((await loadLocalProject())!.draft, "已提交版本");
  assert.equal((await loadLocalProject())!.project.title, initialProject.title);
});
