import type { Project, Sentence } from "./model";
export type ReadingStatus = "dictionary" | "inferred" | "manual";
export type RubyPart = { text: string; reading?: string };
export type FuriganaToken = {
  key: string;
  start: number;
  end: number;
  surface: string;
  reading: string;
  parts: RubyPart[];
  status: ReadingStatus;
  needsReview: boolean;
  reason: string;
  candidates: string[];
  lemma: string;
  lemmaReadings: string[];
  entryIds: string[];
  source: string;
  referenceForms?: { surface: string; readings: string[] }[];
};
export type FuriganaRecord = {
  text: string;
  tokens: FuriganaToken[];
  generatedAt: string;
  dictionaryDate: string;
  engine: string;
};
export type ReadingCorrection = {
  id: string;
  sentenceId: string;
  sentenceText: string;
  start: number;
  end: number;
  surface: string;
  before: string;
  reading: string;
  confirmedAt: string;
};
export const hasKanji = (text: string) => /[\p{Script=Han}々〆]/u.test(text);
export const isHiragana = (text: string) =>
  /^[\p{Script=Hiragana}ー]+$/u.test(text);
export const readingLabel = (status: ReadingStatus) =>
  ({ dictionary: "词典确认", inferred: "自动推断", manual: "人工确认" })[
    status
  ];
export function hiragana(text: string) {
  return Array.from(text.normalize("NFKC"))
    .map((c) => {
      const cp = c.codePointAt(0)!;
      return cp >= 0x30a1 && cp <= 0x30f6 ? String.fromCodePoint(cp - 0x60) : c;
    })
    .join("");
}
export function validFurigana(value: FuriganaRecord, text: string) {
  if (
    !value ||
    value.text !== text ||
    !Array.isArray(value.tokens) ||
    typeof value.generatedAt !== "string" ||
    typeof value.dictionaryDate !== "string" ||
    typeof value.engine !== "string"
  )
    return false;
  let end = 0;
  for (const t of value.tokens) {
    if (
      !t ||
      !Number.isInteger(t.start) ||
      !Number.isInteger(t.end) ||
      t.start < end ||
      t.end <= t.start ||
      t.end > text.length ||
      text.slice(t.start, t.end) !== t.surface ||
      t.key !== `${t.start}:${t.end}:${t.surface}` ||
      typeof t.reading !== "string" ||
      (t.reading !== "" && !isHiragana(t.reading)) ||
      !["dictionary", "inferred", "manual"].includes(t.status) ||
      typeof t.needsReview !== "boolean" ||
      !Array.isArray(t.parts) ||
      !t.parts.every(
        (p) =>
          p &&
          typeof p.text === "string" &&
          (p.reading === undefined ||
            (typeof p.reading === "string" && isHiragana(p.reading))),
      ) ||
      t.parts.map((p) => p.text).join("") !== t.surface ||
      !Array.isArray(t.candidates) ||
      !t.candidates.every(isHiragana) ||
      !Array.isArray(t.lemmaReadings) ||
      !t.lemmaReadings.every(isHiragana) ||
      !Array.isArray(t.entryIds) ||
      !t.entryIds.every((x) => typeof x === "string") ||
      typeof t.reason !== "string" ||
      typeof t.lemma !== "string" ||
      typeof t.source !== "string" ||
      (t.referenceForms !== undefined &&
        (!Array.isArray(t.referenceForms) ||
          !t.referenceForms.every(
            (r) =>
              r &&
              typeof r.surface === "string" &&
              Array.isArray(r.readings) &&
              r.readings.every(isHiragana),
          )))
    )
      return false;
    end = t.end;
  }
  return true;
}
export function mergeFurigana(
  sentence: Sentence,
  incoming: FuriganaRecord,
  history: ReadingCorrection[] = [],
): FuriganaRecord {
  if (!validFurigana(incoming, sentence.text))
    throw Error("注音数据与原文不一致，请重新生成。");
  const manual = new Map<string, FuriganaToken>();
  for (const t of sentence.furigana?.text === sentence.text
    ? sentence.furigana.tokens
    : [])
    if (t.status === "manual") manual.set(t.key, t);
  for (const h of history)
    if (
      h.sentenceId === sentence.id &&
      h.sentenceText === sentence.text &&
      sentence.text.slice(h.start, h.end) === h.surface
    ) {
      const key = `${h.start}:${h.end}:${h.surface}`;
      const evidence =
        manual.get(key) || incoming.tokens.find((t) => t.key === key);
      for (const [oldKey, old] of manual)
        if (old.start < h.end && h.start < old.end) manual.delete(oldKey);
      manual.set(key, {
        key,
        start: h.start,
        end: h.end,
        surface: h.surface,
        reading: h.reading,
        parts: [{ text: h.surface, reading: h.reading }],
        status: "manual",
        needsReview: false,
        reason: "用户已人工确认；重新生成保留此修正。",
        candidates: evidence?.candidates || [],
        lemma: evidence?.lemma || h.surface,
        lemmaReadings: evidence?.lemmaReadings || [],
        entryIds: evidence?.entryIds || [],
        ...(evidence?.referenceForms
          ? { referenceForms: evidence.referenceForms }
          : {}),
        source: "人工修正记录",
      });
    }
  const retained = Array.from(manual.values());
  let tokens = incoming.tokens.filter(
    (t) => !retained.some((m) => m.start < t.end && t.start < m.end),
  );
  tokens.push(...retained);
  // If a future dictionary changes token boundaries around a manual edit, keep
  // that edit and mark uncovered kanji instead of inventing a partial reading.
  for (const match of sentence.text.matchAll(/[\p{Script=Han}々〆]+/gu)) {
    let start = match.index!,
      finish = start + match[0].length;
    while (start < finish) {
      const covered = tokens.find((t) => t.start <= start && t.end > start);
      if (covered) {
        start = covered.end;
        continue;
      }
      let end =
        start + String.fromCodePoint(sentence.text.codePointAt(start)!).length;
      while (end < finish && !tokens.some((t) => t.start <= end && t.end > end))
        end += String.fromCodePoint(sentence.text.codePointAt(end)!).length;
      const surface = sentence.text.slice(start, end);
      tokens.push({
        key: `${start}:${end}:${surface}`,
        start,
        end,
        surface,
        reading: "",
        parts: [{ text: surface }],
        status: "inferred",
        needsReview: true,
        reason: retained.length
          ? "人工修正附近的分词边界已改变，需要人工确认。"
          : "形态分析未覆盖该处汉字，需要人工确认。",
        candidates: [],
        lemma: surface,
        lemmaReadings: [],
        entryIds: [],
        source: incoming.engine,
      });
      start = end;
    }
  }
  tokens.sort((a, b) => a.start - b.start);
  const result = { ...incoming, tokens };
  if (!validFurigana(result, sentence.text))
    throw Error("人工修正记录有重叠，请检查原文。");
  return result;
}
export function confirmReading(
  project: Project,
  sentenceId: string,
  key: string,
  reading: string,
): Project {
  reading = reading.trim().normalize("NFC");
  if (!isHiragana(reading) || reading.length > 64)
    throw Error("请输入 1–64 个平假名字符，可包含长音符「ー」。");
  const sentence = project.sentences.find((s) => s.id === sentenceId),
    token = sentence?.furigana?.tokens.find((t) => t.key === key);
  if (!sentence || !token) throw Error("原文或注音已改变，请重新选择。");
  const correction: ReadingCorrection = {
    id: crypto.randomUUID(),
    sentenceId,
    sentenceText: sentence.text,
    start: token.start,
    end: token.end,
    surface: token.surface,
    before: token.reading,
    reading,
    confirmedAt: new Date().toISOString(),
  };
  return {
    ...project,
    furiganaCorrections: [...(project.furiganaCorrections || []), correction],
    sentences: project.sentences.map((s) =>
      s.id !== sentenceId
        ? s
        : {
            ...s,
            furigana: {
              ...s.furigana!,
              tokens: s.furigana!.tokens.map((t) =>
                t.key !== key
                  ? t
                  : {
                      ...t,
                      reading,
                      parts: [{ text: t.surface, reading }],
                      status: "manual",
                      needsReview: false,
                      reason: "用户已人工确认；重新生成保留此修正。",
                      source: "人工确认",
                    },
              ),
            },
          },
    ),
  };
}
