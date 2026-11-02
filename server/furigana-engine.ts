import KuroshiroPackage from "kuroshiro";
import AnalyzerPackage from "kuroshiro-analyzer-kuromoji";
import { parseDocument } from "htmlparser2";
import { getJmdict, type Jmdict } from "./jmdict";
import {
  hasKanji,
  hiragana,
  isHiragana,
  type FuriganaRecord,
  type FuriganaToken,
  type RubyPart,
} from "../src/furigana";
const Kuroshiro = KuroshiroPackage.default || KuroshiroPackage,
  Analyzer = AnalyzerPackage.default || AnalyzerPackage;
type MorphToken = {
  surface_form: string;
  reading?: string;
  basic_form?: string;
  pos?: string;
  pos_detail_1?: string;
  verbose?: { word_type?: string };
  [key: string]: unknown;
};
let analyzerPromise: Promise<any> | undefined;
function getAnalyzer() {
  return (analyzerPromise ??= (async () => {
    const analyzer = new Analyzer();
    await analyzer.init();
    return analyzer;
  })().catch((error) => {
    analyzerPromise = undefined;
    throw error;
  }));
}
function textOf(node: any): string {
  return node.type === "text"
    ? node.data
    : (node.children || []).map(textOf).join("");
}
async function rubyParts(
  token: MorphToken,
  reading: string,
): Promise<RubyPart[]> {
  if (!reading) return [{ text: token.surface_form }];
  const converter = new Kuroshiro();
  await converter.init({
    init: async () => {},
    parse: async () => [
      {
        ...token,
        reading: reading.replace(/[ぁ-ゖ]/g, (c) =>
          String.fromCharCode(c.charCodeAt(0) + 0x60),
        ),
      },
    ],
  });
  const html = await converter.convert(token.surface_form, {
    mode: "furigana",
    to: "hiragana",
  });
  const parts: RubyPart[] = [];
  for (const node of parseDocument(html).children as any[]) {
    if (node.name === "ruby") {
      const children = node.children || [];
      parts.push({
        text: children
          .filter((n: any) => !["rp", "rt"].includes(n.name))
          .map(textOf)
          .join(""),
        reading: children
          .filter((n: any) => n.name === "rt")
          .map(textOf)
          .join(""),
      });
    } else parts.push({ text: textOf(node) });
  }
  if (
    parts.map((p) => p.text).join("") !== token.surface_form ||
    parts.some((p) => p.reading && !isHiragana(p.reading))
  )
    return [{ text: token.surface_form, reading }];
  return parts;
}
export function readingEvidence(token: MorphToken, dictionary: Jmdict) {
  const surface = token.surface_form,
    lemma =
      token.basic_form && token.basic_form !== "*" ? token.basic_form : surface;
  const exact = dictionary.entries[surface],
    base = dictionary.entries[lemma];
  const known = token.verbose?.word_type === "KNOWN";
  const analyzed =
    known && token.reading && token.reading !== "*"
      ? hiragana(token.reading)
      : "";
  const valid = isHiragana(analyzed) ? analyzed : "";
  let reading = valid,
    status: "dictionary" | "inferred" = "inferred",
    needsReview = true,
    reason =
      "整句形态分析得到的活用读音，JMdict 只核对到基本形；需要人工确认。";
  const candidates = exact?.readings || [],
    lemmaReadings = base?.readings || [];
  if (!reading && candidates.length === 1) reading = candidates[0];
  if (token.pos_detail_1 === "固有名詞") {
    needsReview = true;
    reason = "人名或专名存在特殊读法，需要人工确认。";
  } else if (!known) {
    needsReview = true;
    reason = "形态词典未识别该词；即使存在词典候选也需要人工确认。";
  } else if (candidates.length > 1 || lemmaReadings.length > 1) {
    needsReview = true;
    reason = "JMdict 收录多个候选；当前读音为整句形态分析建议，需要人工确认。";
  } else if (candidates.length === 1 && reading === candidates[0]) {
    status = "dictionary";
    needsReview = false;
    reason = "JMdict 的该词形只有一个读音，与当前建议一致；不代表语境零歧义。";
  } else if (candidates.length === 1 && reading !== candidates[0]) {
    needsReview = true;
    reason = "形态分析与 JMdict 读音不一致，需要人工确认。";
  } else if (!base) {
    needsReview = true;
    reason = "JMdict 未收录该词形或基本形，需要人工确认。";
  } else if (!known) {
    needsReview = true;
    reason = "形态词典未识别该词，需要人工确认。";
  }
  if (!reading) {
    needsReview = true;
    reason = "未获得可核实的读音，未生成假名；需要人工确认。";
  }
  return {
    reading,
    status,
    needsReview,
    reason,
    candidates,
    lemma,
    lemmaReadings,
    entryIds: exact?.entryIds || base?.entryIds || [],
  };
}
// Only exact dictionary headwords can confirm a compound. Kana-omission
// variants are references for a human, never an automatically invented reading.
const referenceIndexes = new WeakMap<
  Jmdict,
  Map<string, { surface: string; readings: string[] }[]>
>();
function referenceIndex(dictionary: Jmdict) {
  let index = referenceIndexes.get(dictionary);
  if (index) return index;
  index = new Map();
  for (const [surface, entry] of Object.entries(dictionary.entries)) {
    if (!/^[\p{Script=Han}々〆\p{Script=Hiragana}ー]+$/u.test(surface))
      continue;
    const key = surface.replace(/[\p{Script=Hiragana}ー]/gu, "");
    if (
      key !== surface &&
      Array.from(key).length >= 2 &&
      Array.from(key).length <= 8
    )
      index.set(key, [
        ...(index.get(key) || []),
        { surface, readings: entry.readings },
      ]);
  }
  referenceIndexes.set(dictionary, index);
  return index;
}
export async function generateFurigana(
  text: string,
  dictionary?: Jmdict,
): Promise<FuriganaRecord> {
  dictionary ??= await getJmdict();
  const analyzer = await getAnalyzer();
  const words = (await analyzer.parse(text)) as MorphToken[];
  const tokens: FuriganaToken[] = [];
  let cursor = 0;
  const references = referenceIndex(dictionary);
  for (let i = 0; i < words.length; i++) {
    let token = words[i];
    const start = text.indexOf(token.surface_form, cursor);
    if (start < 0) throw Error("形态分析与原文不一致，请检查特殊字符。");
    let compound:
      | {
          surface: string;
          last: number;
          referenceForms?: { surface: string; readings: string[] }[];
        }
      | undefined;
    let surface = token.surface_form;
    for (let j = i + 1; j < Math.min(words.length, i + 8); j++) {
      if (
        ["助詞", "助動詞", "記号"].includes(words[j].pos || "") ||
        ["助詞", "助動詞", "記号"].includes(words[i].pos || "")
      )
        break;
      surface += words[j].surface_form;
      if (
        surface.length > 24 ||
        text.slice(start, start + surface.length) !== surface
      )
        break;
      if (dictionary.entries[surface]) compound = { surface, last: j };
      else if (
        !compound &&
        /^[\p{Script=Han}々〆]+$/u.test(surface) &&
        references.has(surface)
      )
        compound = {
          surface,
          last: j,
          referenceForms: references.get(surface),
        };
    }
    let override: Partial<FuriganaToken> = {};
    if (compound) {
      const group = words.slice(i, compound.last + 1),
        analyzed = group.map((w) => w.reading || "").join(""),
        entry = dictionary.entries[compound.surface];
      token = {
        surface_form: compound.surface,
        basic_form: compound.surface,
        reading: analyzed,
        pos: group[0].pos,
        pos_detail_1: group.some((w) => w.pos_detail_1 === "固有名詞")
          ? "固有名詞"
          : undefined,
        verbose: {
          word_type: group.every((w) => w.verbose?.word_type === "KNOWN")
            ? "KNOWN"
            : "UNKNOWN",
        },
      };
      if (compound.referenceForms)
        override = {
          reading: "",
          status: "inferred",
          needsReview: true,
          reason:
            "原词形未在 JMdict 收录，可能省略送假名或分词有误；未自动填入读音，请根据参考词形人工确认。",
          referenceForms: compound.referenceForms,
        };
      else if (entry && !entry.readings.includes(hiragana(analyzed)))
        override = {
          reading: entry.readings.length === 1 ? entry.readings[0] : "",
          status: "inferred",
          needsReview: true,
          reason:
            "JMdict 找到完整复合词，但与形态分析的分词读音不一致；当前采用唯一词典候选（若有），需要人工确认。",
        };
      i = compound.last;
    }
    const end = start + token.surface_form.length;
    cursor = end;
    if (!hasKanji(token.surface_form)) continue;
    const evidence = { ...readingEvidence(token, dictionary), ...override };
    tokens.push({
      key: `${start}:${end}:${token.surface_form}`,
      start,
      end,
      surface: token.surface_form,
      ...evidence,
      parts: await rubyParts(token, evidence.reading),
      source: "Kuromoji/IPADic + JMdict + Kuroshiro 1.2.1",
    });
  }
  return {
    text,
    tokens,
    generatedAt: new Date().toISOString(),
    dictionaryDate: dictionary.date,
    engine: "Kuroshiro 1.2.1 / Kuromoji 1.1.0 / JMdict",
  };
}
