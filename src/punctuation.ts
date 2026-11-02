import type { TranscriptionDraft } from "./transcription";
import { TRANSCRIPTION_MAX_TEXT } from "./transcription";

export type PunctuationInsertion = { after: number; mark: "、" | "。" };
export type PunctuationSuggestion = {
  sourceText: string;
  text: string;
  insertions: PunctuationInsertion[];
  model: string;
};
export type PunctuationEdit = {
  beforeText: string;
  afterText: string;
  model: string;
  appliedAt: string;
};
// Positions count Unicode code points, not UTF-16 units; preserve every original
// character (including spaces, line breaks, emoji and existing punctuation).
export function insertPunctuation(text: string, insertions: PunctuationInsertion[]) {
  const chars = Array.from(text);
  let previous = 0;
  const marks = new Map<number, string>();
  for (const item of insertions) {
    if (!item || !Number.isInteger(item.after) || item.after <= previous ||
        item.after > chars.length || !["、", "。"].includes(item.mark))
      throw Error("补标点位置无效，原稿保留。");
    previous = item.after;
    marks.set(item.after, item.mark);
  }
  return chars.map((char, i) => char + (marks.get(i + 1) || "")).join("");
}
export function validPunctuationEdit(value: PunctuationEdit) {
  return !!value && typeof value.beforeText === "string" &&
    typeof value.afterText === "string" &&
    value.beforeText.length <= TRANSCRIPTION_MAX_TEXT &&
    value.afterText.length <= TRANSCRIPTION_MAX_TEXT &&
    typeof value.model === "string" && typeof value.appliedAt === "string" &&
    onlyAddsPunctuation(value.beforeText, value.afterText);
}
export function onlyAddsPunctuation(before: string, after: string) {
  const source = Array.from(before);
  let index = 0;
  for (const char of after) {
    if (char === source[index]) index++;
    else if (char !== "、" && char !== "。") return false;
  }
  return index === source.length;
}
export function validatePunctuationSuggestion(value: PunctuationSuggestion) {
  if (!value || typeof value.sourceText !== "string" ||
      !value.sourceText.trim() || value.sourceText.length > TRANSCRIPTION_MAX_TEXT ||
      typeof value.text !== "string" || value.text.length > TRANSCRIPTION_MAX_TEXT ||
      typeof value.model !== "string" || !Array.isArray(value.insertions) ||
      value.insertions.length > TRANSCRIPTION_MAX_TEXT ||
      insertPunctuation(value.sourceText, value.insertions) !== value.text)
    throw Error("补标点结果未通过原文字保护检查，原稿保留。");
  return value;
}
export function applyPunctuation(draft: TranscriptionDraft, suggestion: PunctuationSuggestion) {
  validatePunctuationSuggestion(suggestion);
  if (draft.text !== suggestion.sourceText)
    throw Error("校对稿已修改，请针对最新文字重新补标点。");
  return { ...draft, text: suggestion.text, punctuation: {
    beforeText: draft.text, afterText: suggestion.text,
    model: suggestion.model, appliedAt: new Date().toISOString(),
  } };
}
export function undoPunctuation(draft: TranscriptionDraft): TranscriptionDraft {
  if (!draft.punctuation || draft.text !== draft.punctuation.afterText)
    throw Error("采用标点后文字已有修改，请手动调整，避免覆盖新的校对内容。");
  const { punctuation, ...rest } = draft;
  return { ...rest, text: punctuation.beforeText };
}
