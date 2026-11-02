import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  initialProject,
  rebuild,
  parseProject,
  geometry,
  layout,
  paginate,
  validate,
  activeSentenceAt,
} from "../src/model";
import {
  confirmReading,
  mergeFurigana,
  validFurigana,
  type FuriganaToken,
  type FuriganaRecord,
} from "../src/furigana";
import { rubyLayout } from "../src/ruby-layout";
import { fitFuriganaPages } from "../src/furigana-pages";
import { buildJmdict, type Jmdict } from "../server/jmdict";
import { generateFurigana, readingEvidence } from "../server/furigana-engine";
const dictionary: Jmdict = {
  date: "2026-11-01",
  source: "fixture",
  entries: {
    学校: { readings: ["がっこう"], entryIds: ["1"] },
    生物: { readings: ["せいぶつ", "なまもの"], entryIds: ["2"] },
    食べる: { readings: ["たべる"], entryIds: ["3"] },
    先生: { readings: ["せんせい"], entryIds: ["4"] },
    仰向け: { readings: ["あおむけ"], entryIds: ["5"] },
  },
};
function record(
  text: string,
  surface: string,
  reading: string,
  start = text.indexOf(surface),
): FuriganaRecord {
  const end = start + surface.length,
    token: FuriganaToken = {
      key: `${start}:${end}:${surface}`,
      start,
      end,
      surface,
      reading,
      parts: [{ text: surface, reading }],
      status: "inferred",
      needsReview: true,
      reason: "fixture",
      candidates: [reading],
      lemma: surface,
      lemmaReadings: [reading],
      entryIds: [],
      source: "fixture",
    };
  return {
    text,
    tokens: [token],
    generatedAt: new Date().toISOString(),
    dictionaryDate: dictionary.date,
    engine: "fixture",
  };
}
test("词典唯一匹配、歧义、活用和未知词采用不同证据，未知词不杜撰读音", () => {
  const known = { verbose: { word_type: "KNOWN" } };
  const exact = readingEvidence(
    { ...known, surface_form: "学校", reading: "ガッコウ" },
    dictionary,
  );
  assert.equal(exact.status, "dictionary");
  assert.equal(exact.needsReview, false);
  const ambiguous = readingEvidence(
    { ...known, surface_form: "生物", reading: "セイブツ" },
    dictionary,
  );
  assert.equal(ambiguous.status, "inferred");
  assert.equal(ambiguous.needsReview, true);
  assert.equal(ambiguous.candidates.length, 2);
  const inflected = readingEvidence(
    { ...known, surface_form: "食べ", basic_form: "食べる", reading: "タベ" },
    dictionary,
  );
  assert.equal(inflected.status, "inferred");
  assert.equal(inflected.needsReview, true);
  assert.equal(inflected.reading, "たべ");
  const unknown = readingEvidence(
    {
      surface_form: "龘",
      reading: "テキトウ",
      verbose: { word_type: "UNKNOWN" },
    },
    dictionary,
  );
  assert.equal(unknown.reading, "");
  assert.equal(unknown.needsReview, true);
  const name = readingEvidence(
    {
      ...known,
      surface_form: "学校",
      reading: "ガッコウ",
      pos_detail_1: "固有名詞",
    },
    dictionary,
  );
  assert.equal(name.status, "inferred");
  assert.equal(name.needsReview, true);
});
test("JMdict 严格遵守词形读音限制，忽略 re_nokanji 读音", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kotonoha-dict-"));
  try {
    const filename = join(dir, "fixture.gz");
    await writeFile(
      filename,
      gzipSync(
        '<?xml version="1.0"?><JMdict><!-- JMdict created: 2026-11-01 --><entry><ent_seq>1</ent_seq><k_ele><keb>生物</keb></k_ele><k_ele><keb>生もの</keb></k_ele><r_ele><reb>せいぶつ</reb><re_restr>生物</re_restr></r_ele><r_ele><reb>なまもの</reb><re_restr>生もの</re_restr></r_ele><r_ele><reb>むかんけい</reb><re_nokanji/></r_ele></entry></JMdict>',
      ),
    );
    const result = await buildJmdict(filename, 1);
    assert.deepEqual(result.entries["生物"].readings, ["せいぶつ"]);
    assert.deepEqual(result.entries["生もの"].readings, ["なまもの"]);
    assert.equal(result.date, "2026-11-01");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("人工修改按句子身份与原文位置保存，重新生成和项目往返不覆盖", () => {
  let p = rebuild("生物です。生物です。", initialProject);
  p.sentences = p.sentences.map((s) => ({
    ...s,
    furigana: record(s.text, "生物", "せいぶつ"),
  }));
  const sid = p.sentences[0].id,
    key = p.sentences[0].furigana!.tokens[0].key;
  p = confirmReading(p, sid, key, "なまもの");
  assert.equal(p.furiganaCorrections?.length, 1);
  p.sentences = p.sentences.map((s) => ({
    ...s,
    furigana: mergeFurigana(
      s,
      record(s.text, "生物", "せいぶつ"),
      p.furiganaCorrections,
    ),
  }));
  assert.equal(p.sentences[0].furigana!.tokens[0].reading, "なまもの");
  assert.equal(p.sentences[0].furigana!.tokens[0].status, "manual");
  assert.equal(p.sentences[1].furigana!.tokens[0].reading, "せいぶつ");
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))), p);
  const rebuilt = rebuild(p.text, p);
  assert.equal(rebuilt.sentences[0].furigana!.tokens[0].reading, "なまもの");
  const changed = rebuild("生物でした。", p);
  assert.equal(changed.sentences[0].furigana, undefined);
  assert.throws(() => confirmReading(p, sid, key, "ナマモノ"));
  assert.throws(() => confirmReading(p, sid, key, ""));
});
test("分词边界改变时保留人工范围，其余汉字标为待确认", () => {
  let p = rebuild("先生です。", initialProject);
  p.sentences[0].furigana = record("先生です。", "先", "さき");
  p = confirmReading(p, p.sentences[0].id, "0:1:先", "さき");
  const merged = mergeFurigana(
    p.sentences[0],
    record("先生です。", "先生", "せんせい"),
    p.furiganaCorrections,
  );
  assert.equal(merged.tokens[0].reading, "さき");
  assert.equal(merged.tokens[1].surface, "生");
  assert.equal(merged.tokens[1].reading, "");
  assert.equal(merged.tokens[1].needsReview, true);
  assert.ok(validFurigana(merged, "先生です。"));
});
test("Ruby 注音组不跨列，标点与全文顺序、共享分页容量一致", () => {
  const p = rebuild("あいうえおか学校。", initialProject);
  p.style = { ...p.style, fontSize: 96, lineHeight: 1, showFurigana: true };
  p.sentences[0].furigana = record(p.sentences[0].text, "学校", "がっこう");
  const result = rubyLayout(p.sentences, p.style),
    run = result.runs.find((r) => r.reading)!;
  assert.equal(run.index, 7);
  assert.equal(run.span, 2);
  assert.equal(result.cells.map((c) => c.char).join(""), p.sentences[0].text);
  assert.deepEqual(result.cells, layout(p.sentences, p.style));
  assert.equal(geometry(p.style).columnPitch, 158.39999999999998);
  const hidden = { ...p.style, showFurigana: false };
  assert.equal(geometry(hidden).columnPitch, 96);
  assert.equal(
    layout(p.sentences, hidden)
      .map((c) => c.char)
      .join(""),
    p.text,
  );
});
test("注音拆页只拆容量不足的页，保留原边界、时间、音频与持续高亮", () => {
  const p = rebuild(
    Array.from({ length: 15 }, () => "学校へ行きます。").join(""),
    initialProject,
  );
  p.style = { ...p.style, fontSize: 96, lineHeight: 1, showFurigana: true };
  p.sentences.forEach((s) => (s.furigana = record(s.text, "学校", "がっこう")));
  p.pages = [
    {
      id: "first",
      start: 0,
      sentenceIds: p.sentences.slice(0, 2).map((s) => s.id),
    },
    {
      id: "rest",
      start: p.sentences[2].start,
      sentenceIds: p.sentences.slice(2).map((s) => s.id),
    },
  ];
  const fitted = fitFuriganaPages(p);
  assert.equal(fitted.pages[0].id, "first");
  assert.equal(fitted.pages[1].id, "rest");
  assert.equal(fitted.pages[1].start, p.pages[1].start);
  assert.ok(fitted.pages.length > 2);
  assert.deepEqual(fitted.sentences, p.sentences);
  assert.deepEqual(validate(fitted), []);
  for (const page of fitted.pages)
    assert.ok(
      layout(
        page.sentenceIds.map(
          (id) => fitted.sentences.find((s) => s.id === id)!,
        ),
        p.style,
      ).length <= geometry(p.style).capacity,
    );
  fitted.sentences[0].end = 1;
  fitted.sentences[1].start = 3;
  assert.equal(activeSentenceAt(fitted, 2)?.id, fitted.sentences[0].id);
  const noChange = fitFuriganaPages({
    ...fitted,
    style: { ...fitted.style, showFurigana: false },
  });
  assert.deepEqual(noChange.pages, fitted.pages);
});
test("拒绝与原文错位的注音和超过一列的整组注音，旧项目仍可打开", () => {
  const p = rebuild("学校です。", initialProject);
  p.sentences[0].furigana = record("学校です。", "学校", "がっこう");
  p.sentences[0].furigana.tokens[0].start = 1;
  assert.throws(() => parseProject(p));
  assert.deepEqual(
    parseProject(structuredClone(initialProject)),
    initialProject,
  );
  const long = rebuild("漢".repeat(10), initialProject);
  long.style = { ...long.style, fontSize: 96, showFurigana: true };
  long.sentences[0].furigana = record(long.text, long.text, "かん");
  assert.ok(validate(long).some((e) => e.includes("一列")));
});
test("实际 Kuroshiro + Kuromoji 整句分析保留原文和 Ruby 片段，歧义不假称词典确认", async () => {
  const text = "学校で生物を食べる。龘。";
  const result = await generateFurigana(text, dictionary);
  assert.ok(validFurigana(result, text));
  assert.ok(
    result.tokens.some((t) => t.surface === "学校" && t.reading === "がっこう"),
  );
  const ambiguous = result.tokens.find((t) => t.surface === "生物")!;
  assert.equal(ambiguous.needsReview, true);
  assert.equal(ambiguous.status, "inferred");
  assert.ok(result.tokens.some((t) => t.surface === "龘" && t.reading === ""));
  for (const t of result.tokens)
    assert.equal(
      t.parts.map((p) => p.text).join(""),
      text.slice(t.start, t.end),
    );
});

test("历史省略送假名的复合词只展示词典参考，不拼接错误读音", async () => {
  const result = await generateFurigana("仰向に寝る。", dictionary);
  const word = result.tokens.find((t) => t.surface === "仰向")!;
  assert.ok(word);
  assert.equal(word.reading, "");
  assert.equal(word.needsReview, true);
  assert.equal(word.status, "inferred");
  assert.deepEqual(word.referenceForms, [
    { surface: "仰向け", readings: ["あおむけ"] },
  ]);
});
