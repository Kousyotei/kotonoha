import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAlignment,
  captureTiming,
  restoreTiming,
  sameAlignmentInput,
  type AlignmentResult,
} from "../src/alignment";
import { initialProject, parseProject, rebuild, validate } from "../src/model";
function fixture() {
  const p = rebuild("朝が来た。窓を開けた。風が吹いた。空を見上げた。鳥が鳴いた。外へ出た。", initialProject);
  p.voice = { name: "a.wav", src: "data:audio/wav;base64,AAAA", duration: 60 };
  return p;
}
function result(p = fixture()): AlignmentResult {
  return {
    duration: 60,
    model: "test",
    sentences: p.sentences.map((s, i) => ({
      id: s.id,
      start: 5 + i * 8,
      end: 7 + i * 8,
      status: "aligned" as const,
      message: "",
    })),
  };
}
test("自动对齐保留正文、翻译、分页，并更新句子与页面时间", () => {
  const p = fixture();
  p.pages = [
    {
      id: "p1",
      start: 0,
      sentenceIds: p.sentences.slice(0, 2).map((s) => s.id),
    },
    { id: "p2", start: 12, sentenceIds: p.sentences.slice(2).map((s) => s.id) },
  ];
  const next = applyAlignment(p, result(p));
  assert.equal(next.sentences[0].start, 5);
  assert.equal(next.sentences[0].translation, p.sentences[0].translation);
  assert.equal(next.text, p.text);
  assert.deepEqual(
    next.pages.map((p) => p.sentenceIds),
    p.pages.map((p) => p.sentenceIds),
  );
  assert.ok(
    next.pages[1].start >= next.sentences[1].end &&
      next.pages[1].start <= next.sentences[2].start,
  );
  assert.deepEqual(validate(next), []);
});
test("锁定句子不被建议覆盖，解锁后可更新", () => {
  const p = fixture();
  p.sentences[0] = {
    ...p.sentences[0],
    start: 1,
    end: 2,
    timingLocked: true,
    timingSource: "manual",
  };
  const next = applyAlignment(p, result(p));
  assert.deepEqual(next.sentences[0], p.sentences[0]);
  p.sentences[0].timingLocked = false;
  assert.equal(applyAlignment(p, result(p)).sentences[0].start, 5);
});
test("不应用缺失、越界或重叠的时间，也不修改原数据", () => {
  const p = fixture(),
    before = JSON.stringify(p);
  const r = result(p);
  r.sentences[0].end = 70;
  assert.throws(() => applyAlignment(p, r));
  assert.equal(JSON.stringify(p), before);
  r.sentences[0].end = 15;
  assert.throws(() => applyAlignment(p, r), /冲突/);
  r.sentences = [];
  assert.throws(() => applyAlignment(p, r), /有效时间/);
});
test("撤销还原时间和页面，保留其后编辑的翻译", () => {
  const p = fixture();
  const snapshot = captureTiming(p),
    next = applyAlignment(p, result(p));
  next.sentences[0].translation = "修改后的翻译";
  const restored = restoreTiming(next, snapshot);
  assert.equal(restored.sentences[0].start, p.sentences[0].start);
  assert.equal(restored.sentences[0].translation, "修改后的翻译");
  assert.deepEqual(restored.pages, p.pages);
});
test("旧建议在修改正文、锁定状态、录音或时间后失效", () => {
  const p = fixture(),
    changed = structuredClone(p);
  assert.equal(sameAlignmentInput(p, changed), true);
  changed.sentences[0].start += 0.1;
  assert.equal(sameAlignmentInput(p, changed), false);
  changed.sentences[0].start = p.sentences[0].start;
  changed.sentences[0].timingLocked = true;
  assert.equal(sameAlignmentInput(p, changed), false);
});
test("项目保存恢复包含自动时间、锁定标记和复核说明", () => {
  const source = fixture();
  const p = applyAlignment(source, result(source));
  p.sentences[0].timingLocked = true;
  p.sentences[0].alignmentNote = "请试听";
  const loaded = parseProject(JSON.parse(JSON.stringify(p)));
  assert.equal(loaded.sentences[0].timingSource, "auto");
  assert.equal(loaded.sentences[0].timingLocked, true);
  assert.equal(loaded.sentences[0].alignmentNote, "请试听");
});
