import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  initialProject,
  rebuild,
  paginate,
  parseProject,
  validate,
  activeSentenceAt,
  type Sentence,
} from "../src/model";
import {
  BILINGUAL_BOX,
  bilingualLayout,
  bilingualGeometry,
  bilingualRow,
  horizontalParagraph,
  bilingualSettings,
  type BilingualSettings,
} from "../src/bilingual-layout";
import { switchLayout, fitBilingualPages } from "../src/layout-mode";
import { BilingualText } from "../src/BilingualText";
const sample = () => {
  const p = rebuild(
    "学校へ行きます。今日は良い天気ですね。次の朝を待つ。",
    initialProject,
  );
  p.sentences.forEach(
    (s, i) =>
      (s.translation = [
        "我要去学校。",
        "今天的天气真好啊。".repeat(8),
        "等待下一天清晨。",
      ][i]),
  );
  return switchLayout(p, "bilingual");
};
function ruby(sentence: Sentence) {
  sentence.furigana = {
    text: sentence.text,
    generatedAt: "2026-11-01",
    dictionaryDate: "2026-11-01",
    engine: "fixture",
    tokens: [
      {
        key: "0:2:学校",
        start: 0,
        end: 2,
        surface: "学校",
        reading: "がっこう",
        parts: [{ text: "学校", reading: "がっこう" }],
        status: "dictionary",
        needsReview: false,
        reason: "fixture",
        candidates: ["がっこう"],
        lemma: "学校",
        lemmaReadings: ["がっこう"],
        entryIds: [],
        source: "fixture",
      },
    ],
  };
}
test("双语按句子成对布局，行高取左右较高者，翻译可独立换行", () => {
  const p = sample(),
    result = bilingualLayout(p.sentences, p.style);
  assert.deepEqual(
    result.rows.map((r) => r.sentence.id),
    p.sentences.map((s) => s.id),
  );
  const second = result.rows[1];
  assert.ok(second.chinese.height > second.japanese.height);
  assert.ok(second.height >= second.chinese.height);
  assert.ok(
    result.rows[2].top >= second.top + second.height + BILINGUAL_BOX.rowGap,
  );
  const cn = { ...p.sentences[0], text: "春天。\n夏天。", furigana: undefined };
  assert.equal(
    horizontalParagraph(cn, 500, 40, 1.6, 0.42, false).lines.length,
    2,
  );
});
test("横排自动分页同时考虑长译文与栏宽，句子只出现一次且不超出页面", () => {
  for (const ratio of [0.35, 0.5, 0.65]) {
    const p = sample();
    p.sentences = Array.from({ length: 24 }, (_, i) => ({
      ...p.sentences[i % 3],
      id: String(i),
      start: i * 2,
      end: i * 2 + 1,
    }));
    p.style.bilingual = { japaneseWidth: ratio };
    p.pages = paginate(p.sentences, p.style);
    assert.ok(p.pages.length > 1);
    assert.deepEqual(
      p.pages.flatMap((p) => p.sentenceIds),
      p.sentences.map((s) => s.id),
    );
    assert.deepEqual(validate(p), []);
    for (const page of p.pages) {
      const layout = bilingualLayout(
        page.sentenceIds.map((id) => p.sentences.find((s) => s.id === id)!),
        p.style,
      );
      assert.ok(layout.height <= BILINGUAL_BOX.height + 0.01);
      for (const row of layout.rows) {
        assert.ok(
          row.japanese.lines.every(
            (line) => line.width <= bilingualGeometry(p.style).japanese + 0.01,
          ),
        );
        assert.ok(
          row.chinese.lines.every(
            (line) => line.width <= bilingualGeometry(p.style).chinese + 0.01,
          ),
        );
      }
    }
  }
});
test("Ruby 不跨行且预留行高；调大注音后重新分页，人工点击入口保留", () => {
  const p = sample();
  ruby(p.sentences[0]);
  p.style.showFurigana = true;
  const withRuby = bilingualRow(p.sentences[0], p.style),
    hidden = bilingualRow(p.sentences[0], { ...p.style, showFurigana: false });
  assert.ok(withRuby.japanese.height > hidden.japanese.height);
  assert.ok(withRuby.japanese.lines[0].rubyReserve > 0);
  const run = withRuby.japanese.lines
    .flatMap((l) => l.runs)
    .find((r) => r.reading)!;
  assert.equal(run.text, "学校");
  assert.equal(run.reading, "がっこう");
  assert.equal(run.tokenKey, "0:2:学校");
  const larger = bilingualRow(p.sentences[0], {
    ...p.style,
    bilingual: { rubyScale: 0.65 },
  });
  assert.ok(
    larger.japanese.lines[0].rubyReserve >
      withRuby.japanese.lines[0].rubyReserve,
  );
});
test("每对句子包含日中两栏并继承同一高亮，句间停顿仍保持上一句", () => {
  const p = sample();
  p.sentences[0].start = 1;
  p.sentences[0].end = 2;
  p.sentences[1].start = 4;
  const active = activeSentenceAt(p, 3)!;
  assert.equal(active.id, p.sentences[0].id);
  const html = renderToStaticMarkup(
    React.createElement(BilingualText, {
      project: p,
      sentences: p.sentences,
      activeId: active.id,
    }),
  );
  assert.ok(html.includes('lang="ja"'));
  assert.ok(html.includes('lang="zh-CN"'));
  assert.ok(html.includes(p.style.highlight));
  assert.ok(html.includes("opacity:0.38"));
  assert.equal(
    (html.match(/data-sentence-id=/g) || []).length,
    p.sentences.length,
  );
});
test("模式切换保留竖排设置、人工分页和切换点，也保留双语独立分页", () => {
  const vertical = sample();
  vertical.style.layoutMode = "vertical";
  vertical.pages = [
    { id: "a", start: 0, sentenceIds: [vertical.sentences[0].id] },
    {
      id: "b",
      start: vertical.sentences[1].start,
      sentenceIds: vertical.sentences.slice(1).map((s) => s.id),
    },
  ];
  const before = structuredClone(vertical);
  const bilingual = switchLayout(vertical, "bilingual");
  bilingual.pages = [
    {
      id: "x",
      start: 0,
      sentenceIds: bilingual.sentences.slice(0, 2).map((s) => s.id),
    },
    {
      id: "y",
      start: bilingual.sentences[2].start,
      sentenceIds: [bilingual.sentences[2].id],
    },
  ];
  const back = switchLayout(bilingual, "vertical");
  assert.deepEqual(back.pages, before.pages);
  assert.equal(back.style.fontSize, before.style.fontSize);
  assert.equal(back.style.lineHeight, before.style.lineHeight);
  assert.deepEqual(back.sentences, before.sentences);
  assert.deepEqual(switchLayout(back, "bilingual").pages, bilingual.pages);
  assert.deepEqual(vertical, before);
});
test("译文编辑只拆装不下的页，保留已有边界，不更改时间与修正", () => {
  const p = sample();
  p.pages = [
    { id: "one", start: 0, sentenceIds: p.sentences.map((s) => s.id) },
  ];
  p.sentences[1].translation = "这是很长的一段中文翻译。".repeat(13);
  const before = structuredClone(p.sentences),
    fitted = fitBilingualPages(p);
  assert.ok(fitted.pages.length > 1);
  assert.equal(fitted.pages[0].id, "one");
  assert.deepEqual(fitted.sentences, before);
  assert.deepEqual(validate(fitted), []);
});
test("项目往返保存布局及参数，旧项目仍为竖排，拒绝坏参数与超长句对", () => {
  const p = sample();
  p.style.bilingual = { ...bilingualSettings(p.style), rubyScale: 0.6 };
  p.pages = paginate(p.sentences, p.style);
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))), p);
  assert.equal(initialProject.style.layoutMode, undefined);
  assert.deepEqual(
    parseProject(structuredClone(initialProject)),
    initialProject,
  );
  for (const [key, value] of [
    ["japaneseWidth", 0],
    ["lineHeight", NaN],
    ["rubyScale", 2],
    ["japaneseFontSize", 0],
  ] as const) {
    const bad = structuredClone(p);
    bad.style.bilingual![key] = value;
    assert.throws(() => parseProject(bad));
  }
  const long = sample();
  long.sentences[0].translation = "译".repeat(4000);
  long.pages = paginate(long.sentences, long.style);
  assert.ok(validate(long).some((e) => e.includes("双语文字超出容量")));
  assert.throws(() => parseProject(long));
});
test("可用参数边界与西文、标点、组合字符不会造成静默横向溢出", () => {
  const p = sample();
  p.sentences = [
    {
      ...p.sentences[0],
      text: "「日本語、ABC 2026。」Cafe\u0301。",
      translation: "中文，标点（测试）。",
    },
  ];
  for (const japaneseWidth of [0.35, 0.65])
    for (const font of [24, 72]) {
      p.style.bilingual = {
        japaneseWidth,
        japaneseFontSize: font,
        chineseFontSize: font,
        lineHeight: 1.2,
        rubyScale: 0.65,
      };
      const row = bilingualRow(p.sentences[0], p.style),
        g = bilingualGeometry(p.style);
      for (const [paragraph, width] of [
        [row.japanese, g.japanese],
        [row.chinese, g.chinese],
      ] as const) {
        assert.deepEqual(paragraph.errors, []);
        assert.ok(paragraph.lines.every((l) => l.width <= width + 0.01));
        assert.equal(
          paragraph.lines
            .flatMap((l) => l.runs)
            .map((r) => r.text)
            .join(""),
          paragraph === row.japanese
            ? p.sentences[0].text
            : p.sentences[0].translation,
        );
      }
    }
});
