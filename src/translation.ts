import type { Project } from "./model";

export type TranslationInput = { id: string; text: string; translation: string };
export type TranslationItem = {
  id: string;
  sourceText: string;
  previousTranslation: string;
  translation: string;
};
export type TranslationResult = { model: string; items: TranslationItem[] };
export type TranslationUndo = { id: string; text: string; before: string; after: string }[];
export const TRANSLATION_MAX_SENTENCES = 200;
export const TRANSLATION_MAX_SOURCE = 1000;
export const TRANSLATION_MAX_TARGET = 2000;
export function validateTranslationInputs(value: unknown): TranslationInput[] {
  if (!Array.isArray(value) || !value.length || value.length > TRANSLATION_MAX_SENTENCES)
    throw Error("每次请选择 1–200 句正文进行翻译。");
  const ids = new Set<string>();
  let total = 0;
  for (const item of value) {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 160 || ids.has(item.id) ||
        typeof item.text !== "string" || !item.text.trim() || item.text.length > TRANSLATION_MAX_SOURCE ||
        typeof item.translation !== "string" || item.translation.length > 30000)
      throw Error("翻译句子无效、重复或过长；单句请控制在 1000 字以内。");
    ids.add(item.id); total += item.text.length;
  }
  if (total > 20000) throw Error("每次翻译请控制在 20000 字以内。");
  return value.map(({ id, text, translation }) => ({ id, text, translation }));
}
export function translationInputs(project: Project, onlyMissing: boolean) {
  return project.sentences.filter(s => !onlyMissing || !s.translation.trim())
    .map(({ id, text, translation }) => ({ id, text, translation }));
}
export function validateTranslationResult(value: TranslationResult, inputs?: TranslationInput[]) {
  if (!value || typeof value.model !== "string" || !Array.isArray(value.items) ||
      !value.items.length || value.items.length > TRANSLATION_MAX_SENTENCES ||
      (inputs && value.items.length !== inputs.length))
    throw Error("翻译结果格式无效，已有译文保留。");
  const ids = new Set<string>();
  for (const [i, item] of value.items.entries()) {
    if (!item || typeof item.id !== "string" || ids.has(item.id) ||
        typeof item.sourceText !== "string" || !item.sourceText.trim() ||
        typeof item.previousTranslation !== "string" ||
        typeof item.translation !== "string" || !item.translation.trim() || item.translation.length > TRANSLATION_MAX_TARGET ||
        (inputs && (item.id !== inputs[i].id || item.sourceText !== inputs[i].text || item.previousTranslation !== inputs[i].translation)))
      throw Error("翻译结果与原句不匹配或为空，已有译文保留。");
    ids.add(item.id);
  }
  return value;
}
export function translationIsCurrent(project: Project, result: TranslationResult) {
  const byId = new Map(project.sentences.map(s => [s.id, s]));
  return result.items.every(item => {
    const sentence = byId.get(item.id);
    return sentence?.text === item.sourceText && sentence.translation === item.previousTranslation;
  });
}
export function applyTranslations(project: Project, result: TranslationResult, selected: string[]) {
  validateTranslationResult(result);
  const selectedIds = new Set(selected), byId = new Map(result.items.map(item => [item.id, item]));
  if (!selectedIds.size || selectedIds.size !== selected.length || selected.some(id => !byId.has(id)))
    throw Error("请选择要采用的译文。");
  const chosen = result.items.filter(item => selectedIds.has(item.id));
  if (!translationIsCurrent(project, { ...result, items: chosen }))
    throw Error("正文或已有译文已修改，未覆盖新的编辑内容。请重新翻译。");
  const undo: TranslationUndo = [];
  const sentences = project.sentences.map(sentence => {
    const item = byId.get(sentence.id);
    if (!item || !selectedIds.has(sentence.id)) return sentence;
    undo.push({ id: sentence.id, text: sentence.text, before: sentence.translation, after: item.translation });
    return { ...sentence, translation: item.translation };
  });
  return { project: { ...project, sentences }, undo };
}
export function canUndoTranslation(project: Project, snapshot: TranslationUndo | null) {
  return !!snapshot?.length && snapshot.every(row => project.sentences.some(s => s.id === row.id && s.text === row.text && s.translation === row.after));
}
export function undoTranslations(project: Project, snapshot: TranslationUndo) {
  if (!canUndoTranslation(project, snapshot)) throw Error("译文已继续编辑，无法整批撤销；可在逐句编辑区手动修改。");
  const before = new Map(snapshot.map(row => [row.id, row.before]));
  return { ...project, sentences: project.sentences.map(s => before.has(s.id) ? { ...s, translation: before.get(s.id)! } : s) };
}
