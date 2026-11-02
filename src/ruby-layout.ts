import type { Project, Sentence } from "./model";
export type RubyRun = {
  text: string;
  reading?: string;
  sentenceId: string;
  tokenKey?: string;
  key: string;
  index: number;
  span: number;
};
const closing = /^[、。，．！？!?」』）】〉》ー…]/u,
  opening = /[「『（【〈《]$/u;
// One shared set of occupied cells drives pagination and the Remotion composition.
export function rubyLayout(sentences: Sentence[], style: Project["style"]) {
  const rows = Math.max(1, Math.floor(740 / style.fontSize));
  const units: Omit<RubyRun, "index" | "span">[] = [];
  for (const sentence of sentences) {
    let cursor = 0,
      serial = 0;
    const plain = (text: string, tokenKey?: string) => {
      for (const char of text)
        units.push({
          text: char,
          sentenceId: sentence.id,
          tokenKey,
          key: `${sentence.id}:r${serial++}`,
        });
    };
    for (const token of sentence.furigana?.text === sentence.text
      ? sentence.furigana.tokens
      : []) {
      plain(sentence.text.slice(cursor, token.start));
      for (const part of token.parts)
        if (part.reading)
          units.push({
            text: part.text,
            reading: part.reading,
            sentenceId: sentence.id,
            tokenKey: token.key,
            key: `${sentence.id}:r${serial++}`,
          });
        else plain(part.text, token.key);
      cursor = token.end;
    }
    plain(sentence.text.slice(cursor));
  }
  const errors: string[] = [],
    runs: RubyRun[] = [],
    cells: { char: string; key: string; sentenceId: string }[] = [];
  const blank = () =>
    cells.push({ char: "", key: `ruby-blank:${cells.length}`, sentenceId: "" });
  const place = (unit: (typeof units)[number], span: number) => {
    const index = cells.length;
    runs.push({ ...unit, index, span });
    for (const [i, char] of Array.from(unit.text).entries())
      cells.push({
        char,
        key: `${unit.key}:${i}`,
        sentenceId: unit.sentenceId,
      });
  };
  for (const [i, unit] of units.entries()) {
    const span = Array.from(unit.text).length,
      remaining = rows - (cells.length % rows);
    if (span > rows) {
      errors.push(
        `「${unit.text}」的注音组超过一列，请减小字号或缩短人工注音组。`,
      );
      for (const [j, char] of Array.from(unit.text).entries())
        place(
          {
            ...unit,
            text: char,
            reading: undefined,
            key: `${unit.key}:overflow${j}`,
          },
          1,
        );
      continue;
    }
    const nextClosing = closing.test(units[i + 1]?.text || "");
    if (
      span > remaining ||
      (span === remaining &&
        ((nextClosing && span < rows) || opening.test(unit.text)))
    )
      for (let j = 0; j < remaining; j++) blank();
    if (span === rows && nextClosing)
      errors.push(`「${unit.text}」与后面的标点无法放在同一列，请减小字号。`);
    place(unit, span);
  }
  return { runs, cells, errors };
}
