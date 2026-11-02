import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { initialProject, parseProject, type Project } from "../src/model";
import { useProjectPersistence } from "../src/use-project-persistence";
import { loadLocalProject } from "../src/project-storage";
import { demoAudio } from "./demo-audio";

// Exercise the real persistence hook across React unmount/remount with a real
// audio payload. IndexedDB/FileReader are Node shims; this is not a desktop UI test.
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
const windowShim = new EventTarget();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, FileReader: NodeFileReader,
  indexedDB: new IDBFactory(), window: windowShim });
let state!: ReturnType<typeof useProjectPersistence>;
let project!: Project, draft!: string;
let editProject: React.Dispatch<React.SetStateAction<Project>>;
let editDraft: React.Dispatch<React.SetStateAction<string>>;
function Harness() {
  const [p, setProject] = useState(initialProject), [d, setDraft] = useState(initialProject.text);
  state = useProjectPersistence(p, d, saved => { setProject(saved.project); setDraft(saved.draft); });
  project = p; draft = d; editProject = setProject; editDraft = setDraft;
  return <><button onClick={() => void state.save()} disabled={state.saving}>保存</button><p>{state.status}</p><p>{state.error}</p></>;
}
let view: ReactTestRenderer;
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error("Persistence component did not reach expected state");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
  }
}
const filename = process.argv[2] || "samples/demo.kotonoha.json";
const sample = parseProject(JSON.parse(await readFile(filename, "utf8")));
if (!sample.voice) sample.voice = { name: "generated-test-tone.wav", duration: 3,
  src: `data:audio/wav;base64,${demoAudio().toString("base64")}` };
const audioFile = sample.voice.name;
const audioBytes = Buffer.from(sample.voice.src.slice(sample.voice.src.indexOf(",") + 1), "base64");
sample.music = { ...sample.voice, name: "second-test-track" };
const pendingDraft = sample.text + "\n尚未应用的正文修正。";
const fetchOriginal = globalThis.fetch;
try {
  await act(async () => { view = create(<Harness />); });
  await until(() => !state.loading);
  await act(async () => { editProject(sample); editDraft(pendingDraft); });
  assert.equal(state.dirty, true);
  const unloading = new Event("beforeunload", { cancelable: true });
  windowShim.dispatchEvent(unloading); assert.equal(unloading.defaultPrevented, true);

  const key = Object.assign(new Event("keydown", { cancelable: true }), { key: "s", metaKey: true, ctrlKey: false, altKey: false });
  await act(async () => { windowShim.dispatchEvent(key); });
  assert.equal(key.defaultPrevented, true);
  await until(() => !state.saving);
  assert.equal(state.error, ""); assert.equal(state.dirty, false);
  const cleanUnload = new Event("beforeunload", { cancelable: true });
  windowShim.dispatchEvent(cleanUnload); assert.equal(cleanUnload.defaultPrevented, false);
  await act(async () => { view.unmount(); });
  await act(async () => { view = create(<Harness />); });
  await until(() => !state.loading);
  assert.deepEqual(project, sample); assert.equal(draft, pendingDraft); assert.equal(state.dirty, false);
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const restoredBytes = Buffer.from(project.voice!.src.split(",")[1], "base64");
  assert.equal(digest(restoredBytes), digest(audioBytes));

  // Hold media I/O, then edit while saving. The old snapshot may commit, but
  // the new edits must still be marked dirty and require another save.
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (input, options) => { await barrier; return fetchOriginal(input, options); };
  await act(async () => { view.root.findByType("button").props.onClick(); });
  assert.equal(state.saving, true);
  await act(async () => { editProject(p => ({ ...p, title: "保存期间继续修改" })); });
  release(); await until(() => !state.saving); globalThis.fetch = fetchOriginal;
  assert.equal(state.dirty, true);
  assert.equal((await loadLocalProject())!.project.title, sample.title);
  await act(async () => { view.root.findByType("button").props.onClick(); });
  await until(() => !state.saving);
  assert.equal(state.dirty, false);
  assert.equal((await loadLocalProject())!.project.title, "保存期间继续修改");

  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException("full", "QuotaExceededError"); };
  try {
    await act(async () => { editProject(p => ({ ...p, title: "失败的修改" })); });
    await act(async () => { view.root.findByType("button").props.onClick(); });
    await until(() => !state.saving);
    assert.equal(state.dirty, true); assert.match(state.error, /存储空间不足/);
  } finally { IDBObjectStore.prototype.put = put; }
  await act(async () => { view.unmount(); });
  await act(async () => { view = create(<Harness />); });
  await until(() => !state.loading);
  assert.equal(project.title, "保存期间继续修改");
  assert.equal(draft, pendingDraft);
  assert.equal(project.voice!.src, sample.voice.src);
  assert.equal(project.music!.src, sample.music.src);
  await mkdir(".qa", { recursive: true });
  await writeFile(".qa/persistence-component-check.json", JSON.stringify({
    passed: true, audioFile, audioBytes: audioBytes.length, sha256: digest(restoredBytes),
    reloadByRemount: true, bothAudioTracksPreserved: true, unsavedDraftPreserved: true,
    keyboardSave: true, concurrentEditsStayDirty: true, failedSavePreservesCommittedData: true,
    environment: "Actual React hook + fake-indexeddb/FileReader Node shims, not desktop browser automation",
  }, null, 2));
  console.log("Audio bytes, project/draft restore, keyboard save, dirty-state guard, concurrent edits and save-failure recovery passed.");
} finally {
  globalThis.fetch = fetchOriginal;
  await act(async () => { view?.unmount(); });
}
