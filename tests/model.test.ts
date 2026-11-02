import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geometry,
  initialProject,
  paginate,
  parseProject,
  rebuild,
  validate,
  pageAt,
  activeSentenceAt,
  type Sentence,
} from "../src/model";
test("分句保留标点、引号和全文顺序", () => {
  const p = rebuild("「春ですね。」\nそうだ！次の朝？終わり", initialProject);
  assert.deepEqual(
    p.sentences.map((s) => s.text),
    ["「春ですね。」", "そうだ！", "次の朝？", "終わり"],
  );
});
test("分页保持顺序且不超过字格容量", () => {
  const style = { ...initialProject.style, fontSize: 96 };
  const sentences = Array.from(
    { length: 30 },
    (_, i): Sentence => ({
      id: String(i),
      text: "風が静かに吹いている。",
      start: i,
      end: i + 1,
      translation: "",
      note: "",
    }),
  );
  const pages = paginate(sentences, style);
  assert.ok(pages.length > 1);
  assert.deepEqual(
    pages.flatMap((p) => p.sentenceIds),
    sentences.map((s) => s.id),
  );
  for (const page of pages)
    assert.ok(
      page.sentenceIds.reduce(
        (n, id) =>
          n + Array.from(sentences.find((s) => s.id === id)!.text).length,
        0,
      ) <= geometry(style).capacity,
    );
});
test("页面提前显示整页，高亮由独立句子时间确定", () => {
  const p = structuredClone(initialProject);
  p.pages = [
    { id: "a", start: 0, sentenceIds: [p.sentences[0].id] },
    {
      id: "b",
      start: p.sentences[1].start,
      sentenceIds: p.sentences.slice(1).map((s) => s.id),
    },
  ];
  assert.equal(pageAt(p, 0), 0);
  assert.equal(pageAt(p, p.sentences[1].start - 0.01), 0);
  assert.equal(pageAt(p, p.sentences[1].start), 1);
});
test("拒绝重叠时间和丢失句子", () => {
  const p = structuredClone(initialProject);
  p.sentences[1].start = 0;
  p.pages[0].sentenceIds.pop();
  assert.ok(validate(p).some((x) => x.includes("时间")));
  assert.ok(validate(p).some((x) => x.includes("顺序")));
});
test("保存后打开保留项目且拒绝坏数据", () => {
  assert.deepEqual(
    parseProject(JSON.parse(JSON.stringify(initialProject))),
    initialProject,
  );
  assert.throws(() => parseProject({ version: 7 }));
  const p = structuredClone(initialProject);
  p.voice = { name: "bad", src: "https://example.org/a.mp3", duration: 10 };
  assert.throws(() => parseProject(p));
});
test("单句过长明确报错而非静默裁掉", () => {
  const p = rebuild("あ".repeat(2000), initialProject);
  assert.ok(validate(p).some((x) => x.includes("超出容量")));
  assert.equal(p.sentences[0].text.length, 2000);
});

test("独立页面切换点可在朗读停顿内调整", () => {
  const p = rebuild("朝です。夜です。", initialProject);
  p.sentences[0].start = 0;
  p.sentences[0].end = 2;
  p.sentences[1].start = 4;
  p.sentences[1].end = 6;
  p.pages = [
    { id: "one", start: 0, sentenceIds: [p.sentences[0].id] },
    { id: "two", start: 3, sentenceIds: [p.sentences[1].id] },
  ];
  assert.deepEqual(validate(p), []);
  assert.equal(pageAt(p, 2.9), 0);
  assert.equal(pageAt(p, 3), 1);
  p.pages[1].start = 1;
  assert.ok(validate(p).some((e) => e.includes("切换时间")));
});

test("句间停顿保持上一句高亮，在下句开始瞬间切换", () => {
  const p = rebuild("朝です。夜です。", initialProject);
  p.sentences[0].start = 1;
  p.sentences[0].end = 2;
  p.sentences[1].start = 4;
  p.sentences[1].end = 6;
  const before = JSON.stringify(p);
  assert.equal(activeSentenceAt(p, 0.99), undefined);
  for (const time of [1, 1.99, 2, 3, 3.999])
    assert.equal(activeSentenceAt(p, time)?.id, p.sentences[0].id);
  for (const time of [4, 5.99])
    assert.equal(activeSentenceAt(p, time)?.id, p.sentences[1].id);
  assert.equal(activeSentenceAt(p, 6), undefined);
  assert.equal(JSON.stringify(p), before);
});

test("连续句子与单句仍使用准确开始时间，空文章不高亮", () => {
  const p = rebuild("朝です。夜です。", initialProject);
  assert.equal(
    activeSentenceAt(p, p.sentences[1].start)?.id,
    p.sentences[1].id,
  );
  const one = rebuild("朝です。", initialProject);
  assert.equal(
    activeSentenceAt(one, one.sentences[0].start)?.id,
    one.sentences[0].id,
  );
  assert.equal(activeSentenceAt(one, one.sentences[0].end), undefined);
  assert.equal(activeSentenceAt(rebuild("", initialProject), 0), undefined);
});
