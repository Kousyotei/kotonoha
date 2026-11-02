import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { initialProject, parseProject } from "../src/model";
import { translationInputs, validateTranslationResult, applyTranslations, undoTranslations } from "../src/translation";
const base = "http://127.0.0.1:3001", endpoint = base + "/api/translation";
const filename = process.argv[2];
const project = filename ? parseProject(JSON.parse(await readFile(filename, "utf8"))) : structuredClone(initialProject);
async function start(path: string, body?: unknown) {
  const response = await fetch(endpoint + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data.id as string;
}
async function wait(id: string) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const response = await fetch(endpoint + "/" + id), data = await response.json();
    assert.ok(response.ok, JSON.stringify(data));
    if (data.status === "error") throw Error(data.error);
    if (data.status === "done" || data.status === "cancelled") return data;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error("Translation verification timed out");
}
assert.equal((await (await fetch(endpoint + "/status")).json()).ready, true);
assert.equal((await wait(await start("/setup"))).status, "done");
const inputs = translationInputs(project, false);
const done = await wait(await start("", { sentences: inputs }));
const result = validateTranslationResult(done.result, inputs);
const chosen = result.items.map(item => item.id);
const applied = applyTranslations(project, result, chosen);
assert.deepEqual({ ...applied.project, sentences: project.sentences }, project);
assert.deepEqual(undoTranslations(applied.project, applied.undo), project);
assert.deepEqual(parseProject(JSON.parse(JSON.stringify(applied.project))), applied.project);
for (const path of ["/api/transcription/status", "/api/punctuation/status"])
  assert.equal((await fetch(base + path)).status, 404);
for (const body of [{}, { sentences: [] }, { sentences: [inputs[0], inputs[0]] },
  { sentences: [{ ...inputs[0], text: "あ".repeat(1001) }] }]) {
  assert.equal((await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, 400);
}
const cancelId = await start("", { sentences: inputs });
assert.equal((await fetch(endpoint + "/" + cancelId + "/cancel", { method: "POST" })).ok, true);
assert.equal((await wait(cancelId)).status, "cancelled");
await writeFile(".qa/translation-result.json", JSON.stringify(result, null, 2));
await writeFile(".qa/translation-project.kotonoha.json", JSON.stringify(applied.project, null, 2));
console.log(JSON.stringify({ ok: true, count: result.items.length, model: result.model,
  retiredRoutes: "404", savedAndUndo: true, unchanged: "正文、音频、注音、分页与句子时间", results: result.items.map(item => ({ source: item.sourceText, translation: item.translation })) }, null, 2));
