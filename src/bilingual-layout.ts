import type { Page, Project, Sentence } from "./model";
export type LayoutMode = "vertical" | "bilingual";
export type BilingualSettings = {
  japaneseWidth: number;
  japaneseFontSize: number;
  chineseFontSize: number;
  lineHeight: number;
  rubyScale: number;
};
export const BILINGUAL_DEFAULTS: BilingualSettings = {
  japaneseWidth: 0.54,
  japaneseFontSize: 42,
  chineseFontSize: 38,
  lineHeight: 1.6,
  rubyScale: 0.42,
};
export const BILINGUAL_LIMITS = {
  japaneseWidth: [0.35, 0.65],
  japaneseFontSize: [24, 72],
  chineseFontSize: [24, 72],
  lineHeight: [1.2, 2.4],
  rubyScale: [0.25, 0.65],
} as const;
export const BILINGUAL_BOX = {
  left: 120,
  top: 202,
  width: 1680,
  height: 710,
  gap: 96,
  labelTop: 140,
  rowGap: 28,
};
export const isBilingual = (style: Project["style"]) =>
  style.layoutMode === "bilingual";
export const bilingualSettings = (
  style: Project["style"],
): BilingualSettings => ({ ...BILINGUAL_DEFAULTS, ...style.bilingual });
export function bilingualGeometry(style: Project["style"]) {
  const settings = bilingualSettings(style),
    available = BILINGUAL_BOX.width - BILINGUAL_BOX.gap,
    japanese = available * settings.japaneseWidth;
  return {
    settings,
    japanese,
    chinese: available - japanese,
    divider: BILINGUAL_BOX.left + japanese + BILINGUAL_BOX.gap / 2,
    chineseLeft: japanese + BILINGUAL_BOX.gap,
  };
}
export type HorizontalRun = {
  text: string;
  reading?: string;
  tokenKey?: string;
  key: string;
  width: number;
  x: number;
};
export type HorizontalLine = {
  runs: HorizontalRun[];
  top: number;
  height: number;
  rubyReserve: number;
  width: number;
};
export type ParagraphLayout = {
  lines: HorizontalLine[];
  height: number;
  errors: string[];
};
export type BilingualRow = {
  sentence: Sentence;
  top: number;
  height: number;
  japanese: ParagraphLayout;
  chinese: ParagraphLayout;
  japaneseOffset: number;
  chineseOffset: number;
};
const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const graphemes = (text: string) =>
  Array.from(segmenter.segment(text), (s) => s.segment);
export const isWesternGlyph = (text: string) =>
  /^[\p{Script=Latin}\x20-\x7e]+$/u.test(text) &&
  !/[\u3000-\uffef]/u.test(text);
export function horizontalWidth(text: string, fontSize: number) {
  return graphemes(text).reduce(
    (n, c) =>
      n +
      (c === "\t" ? 2 : c === " " ? 0.5 : isWesternGlyph(c) ? 0.65 : 1) *
        fontSize,
    0,
  );
}
const opening = /^[「『（【〈《“‘(\[]$/u,
  closing = /^[、。，．！？!?」』）】〉》…，。；：、”’.,;:)\]]/u;
function unitsFor(
  sentence: Sentence,
  fontSize: number,
  rubyScale: number,
  showRuby: boolean,
) {
  const units: Omit<HorizontalRun, "x">[] = [];
  let cursor = 0,
    serial = 0;
  const plain = (text: string, tokenKey?: string) => {
    for (const char of graphemes(text))
      units.push({
        text: char,
        tokenKey,
        key: `${sentence.id}:h${serial++}`,
        width: /[\r\n]/u.test(char) ? 0 : horizontalWidth(char, fontSize),
      });
  };
  for (const token of sentence.furigana?.text === sentence.text
    ? sentence.furigana.tokens
    : []) {
    plain(sentence.text.slice(cursor, token.start));
    for (const part of token.parts)
      if (showRuby && part.reading)
        units.push({
          text: part.text,
          reading: part.reading,
          tokenKey: token.key,
          key: `${sentence.id}:h${serial++}`,
          width:
            Math.max(
              horizontalWidth(part.text, fontSize),
              horizontalWidth(part.reading, fontSize * rubyScale),
            ) + 4,
        });
      else plain(part.text, token.key);
    cursor = token.end;
  }
  plain(sentence.text.slice(cursor));
  return units;
}
export function horizontalParagraph(
  sentence: Sentence,
  width: number,
  fontSize: number,
  lineHeight: number,
  rubyScale: number,
  showRuby: boolean,
): ParagraphLayout {
  const units = unitsFor(sentence, fontSize, rubyScale, showRuby),
    lines: HorizontalLine[] = [],
    errors: string[] = [];
  let runs: HorizontalRun[] = [],
    used = 0,
    height = 0;
  const flush = () => {
    const rubyReserve = runs.some((r) => r.reading)
      ? fontSize * rubyScale * 2 + 8
      : 0;
    const pitch = fontSize * Math.max(1.3, lineHeight) + rubyReserve;
    lines.push({ runs, top: height, height: pitch, rubyReserve, width: used });
    height += pitch;
    runs = [];
    used = 0;
  };
  for (const [i, unit] of units.entries()) {
    if (/[\r\n]/u.test(unit.text)) {
      flush();
      continue;
    }
    if (unit.width > width + 0.01)
      errors.push(
        `「${unit.text}」的注音组超出横排栏宽，请减小字号或注音大小，或加宽日文栏。`,
      );
    const next = units[i + 1],
      keepWithNext =
        next &&
        !/[\r\n]/u.test(next.text) &&
        (closing.test(next.text) || opening.test(unit.text));
    if (
      runs.length &&
      (used + unit.width > width + 0.01 ||
        (keepWithNext &&
          used + unit.width + next.width > width + 0.01 &&
          unit.width + next.width <= width))
    )
      flush();
    runs.push({ ...unit, x: used });
    used += unit.width;
  }
  if (runs.length || !lines.length) flush();
  return { lines, height, errors };
}
export function bilingualRow(
  sentence: Sentence,
  style: Project["style"],
): BilingualRow {
  const {
    settings: s,
    japanese: jpWidth,
    chinese: cnWidth,
  } = bilingualGeometry(style);
  const japanese = horizontalParagraph(
    sentence,
    jpWidth,
    s.japaneseFontSize,
    s.lineHeight,
    s.rubyScale,
    !!style.showFurigana,
  );
  const chinese = horizontalParagraph(
    { ...sentence, text: sentence.translation, furigana: undefined },
    cnWidth,
    s.chineseFontSize,
    s.lineHeight,
    s.rubyScale,
    false,
  );
  const jpBaseline = japanese.lines[0].height / 2 + s.japaneseFontSize * 0.35;
  const cnBaseline = chinese.lines[0].height / 2 + s.chineseFontSize * 0.35;
  const baseline = Math.max(jpBaseline, cnBaseline);
  const japaneseOffset = baseline - jpBaseline,
    chineseOffset = baseline - cnBaseline;
  return {
    sentence,
    top: 0,
    height: Math.max(
      japanese.height + japaneseOffset,
      chinese.height + chineseOffset,
    ),
    japanese,
    chinese,
    japaneseOffset,
    chineseOffset,
  };
}
export function bilingualLayout(
  sentences: Sentence[],
  style: Project["style"],
) {
  let height = 0;
  const rows = sentences.map((sentence, index) => {
    if (index) height += BILINGUAL_BOX.rowGap;
    const row = { ...bilingualRow(sentence, style), top: height };
    height += row.height;
    return row;
  });
  return {
    rows,
    height,
    errors: rows.flatMap((row) => [
      ...row.japanese.errors,
      ...row.chinese.errors,
    ]),
  };
}
export function paginateBilingual(
  sentences: Sentence[],
  style: Project["style"],
  makeId: () => string,
): Page[] {
  const pages: Page[] = [];
  let used = 0;
  for (const sentence of sentences) {
    const height = bilingualRow(sentence, style).height;
    if (
      !pages.length ||
      used + BILINGUAL_BOX.rowGap + height > BILINGUAL_BOX.height + 0.01
    ) {
      pages.push({ id: makeId(), start: sentence.start, sentenceIds: [] });
      used = 0;
    }
    const page = pages.at(-1)!;
    if (page.sentenceIds.length) used += BILINGUAL_BOX.rowGap;
    page.sentenceIds.push(sentence.id);
    used += height;
  }
  if (pages[0]) pages[0].start = 0;
  return pages;
}
