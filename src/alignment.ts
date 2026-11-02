import { type Page, type Project, type Sentence } from "./model";
export type AlignmentSuggestion = {
  id: string;
  start?: number;
  end?: number;
  status: "aligned" | "review";
  message: string;
};
export type AlignmentResult = {
  sentences: AlignmentSuggestion[];
  duration: number;
  model: string;
};
export type TimingSnapshot = {
  audio: Project["voice"];
  sentences: Sentence[];
  pages: Page[];
};
export function sameAlignmentInput(a: Project, b: Project) {
  return (
    a.voice?.src === b.voice?.src &&
    a.sentences.length === b.sentences.length &&
    a.sentences.every((s, i) => {
      const other = b.sentences[i];
      return (
        s.id === other.id &&
        s.text === other.text &&
        s.start === other.start &&
        s.end === other.end &&
        !!s.timingLocked === !!other.timingLocked
      );
    })
  );
}
export function captureTiming(p: Project): TimingSnapshot {
  return {
    audio: p.voice,
    sentences: p.sentences.map((s) => ({ ...s })),
    pages: p.pages.map((page) => ({
      ...page,
      sentenceIds: [...page.sentenceIds],
    })),
  };
}
export function applyAlignment(p: Project, result: AlignmentResult): Project {
  if (!p.voice) throw Error("请先导入朗读录音。");
  if (Math.abs(result.duration - p.voice.duration) > 0.15)
    throw Error("录音时长已改变，请重新对齐。");
  const byId = new Map(result.sentences.map((s) => [s.id, s]));
  const sentences = p.sentences.map((s, i) => {
    if (s.timingLocked) return s;
    const suggestion = byId.get(s.id);
    if (
      !suggestion ||
      !Number.isFinite(suggestion.start) ||
      !Number.isFinite(suggestion.end) ||
      suggestion.start! < 0 ||
      suggestion.end! <= suggestion.start! ||
      suggestion.end! > p.voice!.duration + 0.05
    )
      throw Error(
        `第 ${i + 1} 句未获得有效时间。请手动校准并锁定该句，再重新对齐。`,
      );
    return {
      ...s,
      start: suggestion.start!,
      end: suggestion.end!,
      timingSource: "auto" as const,
      alignmentNote: suggestion.message || undefined,
    };
  });
  for (let i = 1; i < sentences.length; i++)
    if (sentences[i].start < sentences[i - 1].end - 0.001)
      throw Error(
        `第 ${i + 1} 句与前一句或锁定时间冲突，请调整锁定边界后重试。`,
      );
  const pages = p.pages.map((page, i) => {
    if (i === 0) return { ...page, start: 0 };
    const previous = p.pages[i - 1];
    const lower = sentences.find(
      (s) => s.id === previous.sentenceIds.at(-1),
    )!.end;
    const upper = sentences.find((s) => s.id === page.sentenceIds[0])!.start;
    return { ...page, start: Math.max(lower, Math.min(upper, page.start)) };
  });
  return { ...p, sentences, pages };
}
export function restoreTiming(p: Project, snapshot: TimingSnapshot): Project {
  if (
    p.voice?.src !== snapshot.audio?.src ||
    p.sentences.map((s) => s.id).join("|") !==
      snapshot.sentences.map((s) => s.id).join("|")
  )
    throw Error("正文或录音已改变，无法撤销旧对齐。");
  const old = new Map(snapshot.sentences.map((s) => [s.id, s]));
  return {
    ...p,
    sentences: p.sentences.map((s) => {
      const previous = old.get(s.id)!;
      return {
        ...s,
        start: previous.start,
        end: previous.end,
        timingLocked: previous.timingLocked,
        timingSource: previous.timingSource,
        alignmentNote: previous.alignmentNote,
      };
    }),
    pages: snapshot.pages.map((page) => ({
      ...page,
      sentenceIds: [...page.sentenceIds],
    })),
  };
}
