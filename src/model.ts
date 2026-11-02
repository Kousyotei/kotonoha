// Retain legacy saved recognition data when opening older projects. Recognition UI and service were removed.
import { validTranscription, type TranscriptionDraft } from "./transcription";
import { SAMPLE_TITLE, SAMPLE_TEXT, SAMPLE_FIRST_TRANSLATION } from "./sample";
import {
  validFurigana,
  isHiragana,
  type FuriganaRecord,
  type ReadingCorrection,
} from "./furigana";
import { rubyLayout } from "./ruby-layout";
import {
  isBilingual,
  bilingualLayout,
  paginateBilingual,
  BILINGUAL_BOX,
  BILINGUAL_LIMITS,
  type LayoutMode,
  type BilingualSettings,
} from "./bilingual-layout";
export const FPS = 30;
export type Sentence = {
  id: string;
  text: string;
  translation: string;
  note: string;
  start: number;
  end: number;
  timingLocked?: boolean;
  timingSource?: "estimate" | "manual" | "auto";
  alignmentNote?: string;
  furigana?: FuriganaRecord;
};
export type Page = { id: string; start: number; sentenceIds: string[] };
export type Media = { name: string; src: string; duration: number };
export type Project = {
  version: 1;
  title: string;
  text: string;
  sentences: Sentence[];
  pages: Page[];
  layoutPages?: Partial<Record<LayoutMode, Page[]>>;
  style: {
    background: string;
    ink: string;
    highlight: string;
    fontSize: number;
    lineHeight: number;
    fontFamily: string;
    showTranslation: boolean;
    showNotes: boolean;
    showFurigana?: boolean;
    layoutMode?: LayoutMode;
    bilingual?: Partial<BilingualSettings>;
  };
  furiganaCorrections?: ReadingCorrection[];
  transcription?: TranscriptionDraft;
  voice: Media | null;
  music: Media | null;
  voiceVolume: number;
  musicVolume: number;
};
export const id = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function splitSentences(text: string): string[] {
  return (text.match(/[^。！？!?\n]+[。！？!?]*[」』）)]*|[。！？!?]+/gu) || [])
    .map((s) => s.trim())
    .filter(Boolean);
}
export function geometry(style: Project["style"]) {
  const rows = Math.max(1, Math.floor(740 / style.fontSize));
  const columnPitch =
    style.fontSize * Math.max(style.lineHeight, style.showFurigana ? 1.65 : 1);
  const columns = Math.max(1, Math.floor(1600 / columnPitch));
  return { rows, columns, capacity: rows * columns, columnPitch };
}
// Explicit character cells keep preview, pagination and render identical, including Latin text.
export function layout(sentences: Sentence[], style: Project["style"]) {
  if (style.showFurigana) return rubyLayout(sentences, style).cells;
  const { rows } = geometry(style);
  const chars = sentences.flatMap((s) =>
    Array.from(s.text).map((char, i) => ({
      char,
      key: s.id + i,
      sentenceId: s.id,
    })),
  );
  const cells: typeof chars = [];
  const closing = /[、。，．！？!?」』）】〉》ー…]/u,
    opening = /[「『（【〈《]/u;
  for (let i = 0; i < chars.length; i++) {
    if (
      cells.length % rows === rows - 1 &&
      (opening.test(chars[i].char) ||
        (chars[i + 1] && closing.test(chars[i + 1].char)))
    )
      cells.push({ char: "", key: "blank" + i, sentenceId: "" });
    cells.push(chars[i]);
  }
  return cells;
}
export function paginate(
  sentences: Sentence[],
  style: Project["style"],
): Page[] {
  if (isBilingual(style)) return paginateBilingual(sentences, style, id);
  const { capacity } = geometry(style);
  const pages: Page[] = [];
  let group: Sentence[] = [];
  for (const s of sentences) {
    if (!pages.length || layout([...group, s], style).length > capacity) {
      pages.push({ id: id(), start: s.start, sentenceIds: [] });
      group = [];
    }
    pages.at(-1)!.sentenceIds.push(s.id);
    group.push(s);
  }
  if (pages[0]) pages[0].start = 0;
  return pages;
}
export function duration(p: Project) {
  return Math.max(1, p.voice?.duration || 0, ...p.sentences.map((s) => s.end));
}
export function rebuild(text: string, p: Project): Project {
  const pieces = splitSentences(text);
  const total =
    p.voice?.duration ||
    Math.max(12, pieces.reduce((n, s) => n + Array.from(s).length, 0) / 4);
  const count = pieces.reduce((n, s) => n + Array.from(s).length, 0) || 1;
  let t = 0;
  const previous = new Map<string, Sentence[]>();
  for (const s of p.sentences)
    previous.set(s.text, [...(previous.get(s.text) || []), s]);
  const sentences = pieces.map((text) => {
    const old = previous.get(text)?.shift();
    const start = t;
    t += (total * Array.from(text).length) / count;
    return {
      id: old?.id || id(),
      text,
      translation: "",
      note: "",
      start: Math.round(start * 100) / 100,
      end: Math.round(t * 100) / 100,
      timingSource: "estimate" as const,
      ...(old?.furigana ? { furigana: old.furigana } : {}),
    };
  });
  return { ...p, text, sentences, pages: paginate(sentences, p.style) };
}
export function validate(p: Project): string[] {
  const errors: string[] = [];
  if (!p.sentences.length) errors.push("请先输入日语正文。");
  let end = 0;
  for (const [i, s] of p.sentences.entries()) {
    if (
      !Number.isFinite(s.start) ||
      !Number.isFinite(s.end) ||
      s.start < end - 0.001 ||
      s.end <= s.start
    )
      errors.push(`第 ${i + 1} 句时间需递增、不重叠，且结束晚于开始。`);
    end = s.end;
  }
  const ids = p.pages.flatMap((p) => p.sentenceIds);
  if (
    ids.join("|") !== p.sentences.map((s) => s.id).join("|") ||
    p.pages.some((p) => !p.sentenceIds.length)
  )
    errors.push("分页必须按原文顺序包含每句话一次。");
  const { capacity } = geometry(p.style);
  if (p.style.showFurigana && !isBilingual(p.style))
    errors.push(...rubyLayout(p.sentences, p.style).errors);
  p.pages.forEach((page, i) => {
    if (isBilingual(p.style)) {
      const paired = bilingualLayout(
        page.sentenceIds
          .map((id) => p.sentences.find((s) => s.id === id)!)
          .filter(Boolean),
        p.style,
      );
      errors.push(...paired.errors);
      if (paired.height > BILINGUAL_BOX.height + 0.01)
        errors.push(
          `第 ${i + 1} 页双语文字超出容量，请重新分页；单对句子过长时请减小字号，或将原文与译文拆成较短句子。`,
        );
      return;
    }
    if (
      layout(
        page.sentenceIds
          .map((id) => p.sentences.find((s) => s.id === id)!)
          .filter(Boolean),
        p.style,
      ).length > capacity
    )
      errors.push(
        `第 ${i + 1} 页文字超出容量，请减小字号或拆分长句后重新分页。`,
      );
  });
  p.pages.forEach((page, i) => {
    const first = p.sentences.find((s) => s.id === page.sentenceIds[0]);
    const prev = p.pages[i - 1];
    const lastPrev = prev
      ? p.sentences.find((s) => s.id === prev.sentenceIds.at(-1))
      : null;
    if (
      !Number.isFinite(page.start) ||
      page.start < 0 ||
      (i === 0 && page.start !== 0) ||
      (prev && page.start <= prev.start) ||
      (first && page.start > first.start + 0.001) ||
      (lastPrev && page.start < lastPrev.end - 0.001)
    )
      errors.push(`第 ${i + 1} 页切换时间应在前页朗读结束与本页首句开始之间。`);
  });
  return [...new Set(errors)];
}
// Speech end times remain editable alignment data; display stays active through the pause.
export function activeSentenceAt(
  p: Project,
  time: number,
): Sentence | undefined {
  return p.sentences.find(
    (sentence, index) =>
      time >= sentence.start &&
      time < (p.sentences[index + 1]?.start ?? sentence.end),
  );
}
export function pageAt(p: Project, time: number) {
  let index = 0;
  for (let i = 0; i < p.pages.length; i++) {
    if (time >= p.pages[i].start) index = i;
  }
  return index;
}
export function parseProject(value: unknown, options: { allowEditingErrors?: boolean } = {}): Project {
  const p = value as Project;
  if (
    !p ||
    p.version !== 1 ||
    typeof p.title !== "string" ||
    typeof p.text !== "string" ||
    !Array.isArray(p.sentences) ||
    !Array.isArray(p.pages) ||
    !p.style
  )
    throw Error("不是有效的 v1 项目文件");
  if (
    !Number.isFinite(p.style.fontSize) ||
    p.style.fontSize < 24 ||
    p.style.fontSize > 96 ||
    !Number.isFinite(p.style.lineHeight) ||
    p.style.lineHeight < 1 ||
    p.style.lineHeight > 3
  )
    throw Error("排版参数无效");
  if (
    p.style.showFurigana !== undefined &&
    typeof p.style.showFurigana !== "boolean"
  )
    throw Error("注音显示设置无效");
  if (
    p.style.layoutMode !== undefined &&
    !["vertical", "bilingual"].includes(p.style.layoutMode)
  )
    throw Error("布局模式无效");
  if (p.style.bilingual !== undefined) {
    if (
      !p.style.bilingual ||
      typeof p.style.bilingual !== "object" ||
      Array.isArray(p.style.bilingual)
    )
      throw Error("双语横排参数无效");
    for (const [key, value] of Object.entries(p.style.bilingual)) {
      const limits = BILINGUAL_LIMITS[key as keyof BilingualSettings];
      if (
        !limits ||
        !Number.isFinite(value) ||
        value < limits[0] ||
        value > limits[1]
      )
        throw Error("双语横排参数超出可用范围");
    }
  }
  if (
    p.layoutPages !== undefined &&
    (!p.layoutPages ||
      typeof p.layoutPages !== "object" ||
      Array.isArray(p.layoutPages) ||
      Object.entries(p.layoutPages).some(
        ([mode, pages]) =>
          !["vertical", "bilingual"].includes(mode) ||
          !Array.isArray(pages) ||
          pages.some(
            (page) =>
              !page ||
              typeof page.id !== "string" ||
              !Number.isFinite(page.start) ||
              !Array.isArray(page.sentenceIds) ||
              !page.sentenceIds.every((id: unknown) => typeof id === "string"),
          ),
      ))
  )
    throw Error("布局分页记录无效");
  if (
    p.furiganaCorrections !== undefined &&
    (!Array.isArray(p.furiganaCorrections) ||
      !p.furiganaCorrections.every(
        (h) =>
          h &&
          typeof h.id === "string" &&
          typeof h.sentenceId === "string" &&
          typeof h.sentenceText === "string" &&
          Number.isInteger(h.start) &&
          Number.isInteger(h.end) &&
          h.start >= 0 &&
          h.end > h.start &&
          h.sentenceText.slice(h.start, h.end) === h.surface &&
          typeof h.before === "string" &&
          typeof h.reading === "string" &&
          h.reading.length <= 64 &&
          isHiragana(h.reading) &&
          typeof h.confirmedAt === "string",
      ))
  )
    throw Error("注音人工修正记录无效");
  if (p.transcription !== undefined && !validTranscription(p.transcription))
    throw Error("语音识别校对稿数据无效");
  for (const s of p.sentences)
    if (
      typeof s.id !== "string" ||
      typeof s.text !== "string" ||
      typeof s.translation !== "string" ||
      typeof s.note !== "string" ||
      !Number.isFinite(s.start) ||
      !Number.isFinite(s.end) ||
      (s.timingLocked !== undefined && typeof s.timingLocked !== "boolean") ||
      (s.timingSource !== undefined &&
        !["estimate", "manual", "auto"].includes(s.timingSource)) ||
      (s.alignmentNote !== undefined && typeof s.alignmentNote !== "string") ||
      (s.furigana !== undefined && !validFurigana(s.furigana, s.text))
    )
      throw Error("句子数据无效");
  for (const page of p.pages)
    if (!Array.isArray(page.sentenceIds)) throw Error("分页数据无效");
  if (new Set(p.sentences.map((s) => s.id)).size !== p.sentences.length)
    throw Error("句子 ID 重复");
  for (const m of [p.voice, p.music])
    if (
      m &&
      (typeof m.name !== "string" ||
        typeof m.src !== "string" ||
        !/^data:audio\/[\w.+-]+;base64,/.test(m.src) ||
        !Number.isFinite(m.duration) ||
        m.duration <= 0)
    )
      throw Error("音频数据无效");
  if (
    !Number.isFinite(p.voiceVolume) || p.voiceVolume < 0 || p.voiceVolume > 4 ||
    !Number.isFinite(p.musicVolume) || p.musicVolume < 0 || p.musicVolume > 1
  )
    throw Error("音量无效");
  const errors = validate(p);
  if (errors.length && !options.allowEditingErrors) throw Error(errors[0]);
  return p;
}
const base: Project = {
  version: 1,
  title: SAMPLE_TITLE,
  text: "",
  sentences: [],
  pages: [],
  style: {
    background: "#f3efe5",
    ink: "#343e38",
    highlight: "#a54935",
    fontSize: 52,
    lineHeight: 1.8,
    fontFamily: '"Yu Mincho", "Hiragino Mincho ProN", serif',
    showTranslation: true,
    showNotes: false,
  },
  voice: null,
  music: null,
  voiceVolume: 1,
  musicVolume: 0.15,
};
export const initialProject = rebuild(SAMPLE_TEXT, base);
initialProject.sentences[0].translation = SAMPLE_FIRST_TRANSLATION;
