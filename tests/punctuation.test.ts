import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { initialProject, parseProject } from "../src/model";
import { applyPunctuation, insertPunctuation, onlyAddsPunctuation, undoPunctuation,
  validatePunctuationSuggestion, type PunctuationSuggestion } from "../src/punctuation";
import { editTranscription, validTranscription, type TranscriptionDraft } from "../src/transcription";

const fixture = (): TranscriptionDraft => ({
  id: "asr-1", audioId: createHash("sha256").update("recording").digest("hex"),
  audioName: "punctuation-fixture.m4a", duration: 12, language: "ja", model: "Whisper Base",
  originalText: "夢を見た 女が言った", text: "夢を見た 女が言った",
  segments: [{ start: 0, end: 12, text: "夢を見た 女が言った" }], generatedAt: new Date().toISOString(),
});
function suggestion(text: string): PunctuationSuggestion {
  const insertions = [{ after: 4, mark: "。" as const }, { after: Array.from(text).length, mark: "。" as const }];
  return { sourceText: text, text: insertPunctuation(text, insertions), insertions, model: "BERT" };
}
test("补标点只插入指定的日语标点，保留空白、原有标点及 Unicode 字符", () => {
  const text = "夢🙂 を見た、\n𠮷野へ行く";
  const after = insertPunctuation(text, [{ after: 6, mark: "。" }]);
  assert.equal(after, "夢🙂 を見た。、\n𠮷野へ行く");
  assert.ok(onlyAddsPunctuation(text, after));
  for (const [before, changed] of [["夢を見た", "夢を観た。"], ["夢 を見た", "夢を見た。"], ["夢、見た", "夢見た。"]])
    assert.equal(onlyAddsPunctuation(before, changed), false);
});
test("拒绝改字、删除、越界、乱序、重复位置以及非许可的标点", () => {
  const good = suggestion(fixture().text);
  for (const patch of [
    { text: "夢を観た。 女が言った。" }, { text: good.text.replace(" ", "") },
    { insertions: [{ after: 999, mark: "。" }] },
    { insertions: [{ after: 4, mark: "。" }, { after: 4, mark: "、" }] },
    { insertions: [{ after: 4, mark: "。" }, { after: 2, mark: "、" }] },
    { insertions: [{ after: 0, mark: "。" }] },
    { insertions: [{ after: 4, mark: "？" }] },
  ]) assert.throws(() => validatePunctuationSuggestion({ ...good, ...patch } as PunctuationSuggestion));
});
test("从当前人工校对稿补标点，原识别稿与时间片段保留；过期结果不能覆盖新修改", () => {
  const draft = editTranscription(fixture(), "夢を見た 女は言った");
  const result = applyPunctuation(draft, suggestion(draft.text));
  assert.equal(result.text, "夢を見た。 女は言った。");
  assert.equal(result.originalText, draft.originalText);
  assert.deepEqual(result.segments, draft.segments);
  assert.equal(result.editedAt, draft.editedAt);
  assert.equal(result.punctuation.beforeText, draft.text);
  assert.ok(validTranscription(result));
  assert.throws(() => applyPunctuation(editTranscription(draft, "新修改。"), suggestion(draft.text)));
});
test("撤销恢复补标点前的人工版本；之后改字就禁止整稿撤销", () => {
  const before = fixture(), result = applyPunctuation(before, suggestion(before.text));
  assert.deepEqual(undoPunctuation(result), before);
  assert.throws(() => undoPunctuation(editTranscription(result, result.text + "新修改。")));
});
test("保存重开保留标点撤销记录，不改变正文、注音、翻译、分页与音频时间", () => {
  const draft = fixture(), before = structuredClone(initialProject);
  const p = { ...before, transcription: applyPunctuation(draft, suggestion(draft.text)) };
  const loaded = parseProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(loaded, p);
  assert.deepEqual(loaded.sentences, before.sentences);
  assert.deepEqual(loaded.pages, before.pages);
  assert.deepEqual(loaded.style, before.style);
  assert.equal(undoPunctuation(loaded.transcription!).text, draft.text);
  assert.throws(() => parseProject({ ...p, transcription: { ...p.transcription,
    punctuation: { ...p.transcription.punctuation, afterText: "文字被改了" } } }));
});
