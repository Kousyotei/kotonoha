import { test } from "node:test";
import assert from "node:assert/strict";
import { initialProject, parseProject } from "../src/model";
import { switchLayout, fitBilingualPages } from "../src/layout-mode";
import { applyTranslations, canUndoTranslation, translationInputs, validateTranslationInputs,
  validateTranslationResult, undoTranslations, type TranslationResult } from "../src/translation";
function fixture() {
  const project = structuredClone(initialProject);
  const inputs = translationInputs(project, false);
  const result: TranslationResult = { model: "local fixture", items: inputs.map(s => ({
    id: s.id, sourceText: s.text, previousTranslation: s.translation, translation: "中文初稿：" + s.text,
  })) };
  return { project, inputs, result };
}
test("默认仅翻译空白译文，已有人工中文保留", () => {
  const { project } = fixture();
  const inputs = translationInputs(project, true);
  assert.ok(inputs.length < project.sentences.length);
  assert.ok(inputs.every(row => !row.translation.trim()));
  assert.equal(translationInputs(project, false).length, project.sentences.length);
});
test("输入拒绝重复句子、空白、坏格式与超限，不悄悄截取", () => {
  const { inputs } = fixture();
  for (const value of [null, [], [inputs[0], inputs[0]], [{ ...inputs[0], text: " " }],
    [{ ...inputs[0], text: "あ".repeat(1001) }], [{ ...inputs[0], translation: 2 }],
    Array.from({ length: 201 }, (_, i) => ({ ...inputs[0], id: String(i) })),
    Array.from({ length: 30 }, (_, i) => ({ ...inputs[0], id: String(i), text: "あ".repeat(1000) }))])
    assert.throws(() => validateTranslationInputs(value));
  assert.deepEqual(validateTranslationInputs(inputs), inputs);
});
test("翻译结果严格按句子 ID、原文、旧译文对应，拒绝缺句、重复或错位", () => {
  const { inputs, result } = fixture();
  assert.equal(validateTranslationResult(result, inputs), result);
  for (const items of [[], result.items.slice(1), [...result.items].reverse(),
    result.items.map((s, i) => i ? s : { ...s, translation: "" }),
    result.items.map((s, i) => i ? s : { ...s, sourceText: "新原文。" }),
    result.items.map((s, i) => i ? s : { ...s, previousTranslation: "新修改。" })])
    assert.throws(() => validateTranslationResult({ ...result, items }, inputs));
});
test("采用勾选的译文，只修改对应中文；正文、音频、时间、注音与分页保留", () => {
  const { project, result } = fixture(), selected = [project.sentences[1].id];
  const applied = applyTranslations(project, result, selected);
  assert.equal(applied.project.sentences[1].translation, result.items[1].translation);
  assert.equal(applied.project.sentences[0].translation, project.sentences[0].translation);
  assert.deepEqual({ ...applied.project, sentences: project.sentences }, project);
  assert.deepEqual(applied.project.sentences[1], { ...project.sentences[1], translation: result.items[1].translation });
  assert.deepEqual(project, initialProject);
});
test("生成期间人工改字、改译文或删除句子时，旧结果不能覆盖新内容", () => {
  const { project, result } = fixture(), selected = result.items.map(s => s.id);
  for (const patch of [{ text: "新正文。" }, { translation: "新的人工译文。" }]) {
    const changed = { ...project, sentences: project.sentences.map((s, i) => i ? s : { ...s, ...patch }) };
    assert.throws(() => applyTranslations(changed, result, selected));
  }
  assert.throws(() => applyTranslations({ ...project, sentences: project.sentences.slice(1) }, result, selected));
  assert.throws(() => applyTranslations(project, result, []));
  assert.throws(() => applyTranslations(project, result, ["missing"]));
});
test("可以撤销采用，后续人工修改会阻止整批撤销", () => {
  const { project, result } = fixture();
  const applied = applyTranslations(project, result, result.items.map(s => s.id));
  assert.ok(canUndoTranslation(applied.project, applied.undo));
  assert.deepEqual(undoTranslations(applied.project, applied.undo), project);
  const changed = { ...applied.project, sentences: applied.project.sentences.map((s, i) => i ? s : { ...s, translation: "新的人工校对" }) };
  assert.equal(canUndoTranslation(changed, applied.undo), false);
  assert.throws(() => undoTranslations(changed, applied.undo));
});
test("采用的中文按原有项目格式保存重开，旧项目仍兼容", () => {
  const { project, result } = fixture();
  const next = applyTranslations(project, result, result.items.map(s => s.id)).project;
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(next))), next);
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(project))), project);
});
test("长中文沿用横排自动拆页，句子顺序和开始结束时间不改变", () => {
  const { project, result } = fixture();
  const bilingual = switchLayout(project, "bilingual");
  const next = fitBilingualPages(applyTranslations(bilingual, result, result.items.map(s => s.id)).project);
  assert.deepEqual(next.pages.flatMap(p => p.sentenceIds), project.sentences.map(s => s.id));
  assert.deepEqual(next.sentences.map(s => [s.id, s.start, s.end]), project.sentences.map(s => [s.id, s.start, s.end]));
});
