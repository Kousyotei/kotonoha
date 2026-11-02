import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { initialProject, parseProject } from "../src/model";
import {
  parseWhisperSegments,
  validTranscription,
  editTranscription,
  stageTranscription,
  transcriptionAudioId,
  sameTranscriptionAudio,
  TRANSCRIPTION_MAX_TEXT,
  type TranscriptionDraft,
} from "../src/transcription";
const audio = {
  name: "voice-fixture.m4a",
  src: `data:audio/mp4;base64,${Buffer.from("audio-fixture").toString("base64")}`,
  duration: 12,
};
const fixture = (): TranscriptionDraft => ({
  id: "asr-1",
  audioId: createHash("sha256").update(audio.src).digest("hex"),
  audioName: audio.name,
  duration: 12,
  language: "ja",
  model: "Whisper Base",
  originalText: "こんな夢を見た。\n女は静かに言った。",
  text: "こんな夢を見た。\n女は静かに言った。",
  segments: [
    { start: 0, end: 5, text: "こんな夢を見た。" },
    { start: 6, end: 12, text: "女は静かに言った。" },
  ],
  generatedAt: new Date().toISOString(),
});
test("解析 Whisper 原生 JSON，毫秒转秒并裁到真实音频末尾", () => {
  const result = parseWhisperSegments(
    {
      transcription: [
        { offsets: { from: 120, to: 2340 }, text: " 夢を見た。 " },
        { offsets: { from: 2400, to: 12030 }, text: "女が言った。" },
      ],
    },
    12,
  );
  assert.deepEqual(result, [
    { start: 0.12, end: 2.34, text: "夢を見た。" },
    { start: 2.4, end: 12, text: "女が言った。" },
  ]);
});
test("空白、坏格式、重叠片段和超长结果明确失败，不生成假的正文", () => {
  for (const value of [
    {},
    { transcription: [] },
    { transcription: [{ offsets: { from: 0, to: 1000 }, text: " " }] },
    { transcription: [{ text: "夢" }] },
    {
      transcription: [
        { offsets: { from: 0, to: 2000 }, text: "夢" },
        { offsets: { from: 1000, to: 3000 }, text: "次" },
      ],
    },
    {
      transcription: [
        {
          offsets: { from: 0, to: 1000 },
          text: "夢".repeat(TRANSCRIPTION_MAX_TEXT + 1),
        },
      ],
    },
  ])
    assert.throws(() => parseWhisperSegments(value, 12));
  assert.throws(() => parseWhisperSegments({ transcription: [] }, NaN));
});
test("纯静音或超出录音末尾的无效片段不能作为有效识别", () => {
  assert.throws(() =>
    parseWhisperSegments(
      {
        transcription: [{ offsets: { from: 12000, to: 14000 }, text: "虚构" }],
      },
      12,
    ),
  );
  assert.throws(() =>
    parseWhisperSegments(
      { transcription: [{ offsets: { from: 0, to: 0 }, text: "虚构" }] },
      12,
    ),
  );
});
test("人工修改保留原始识别文本、模型与片段，允许先清空再输入", () => {
  const draft = fixture(),
    before = structuredClone(draft),
    edited = editTranscription(draft, "こんな夢を見ました。");
  assert.ok(validTranscription(edited));
  assert.equal(edited.originalText, before.originalText);
  assert.deepEqual(edited.segments, before.segments);
  assert.ok(edited.editedAt);
  assert.deepEqual(draft, before);
  assert.ok(validTranscription(editTranscription(draft, "")));
  assert.throws(() =>
    editTranscription(draft, "あ".repeat(TRANSCRIPTION_MAX_TEXT + 1)),
  );
});
test("重新识别只产生候选，不覆盖已存在的人工校对稿", () => {
  const first = fixture(),
    manual = editTranscription(first, "人工校对完成。"),
    incoming = {
      ...fixture(),
      id: "asr-2",
      text: "新的识别文本。",
      originalText: "新的识别文本。",
    };
  assert.equal(stageTranscription(manual, incoming).draft, manual);
  assert.equal(stageTranscription(manual, incoming).candidate, incoming);
  assert.equal(stageTranscription(undefined, incoming).draft, incoming);
  assert.equal(stageTranscription(undefined, incoming).candidate, null);
});
test("录音摘要由内容计算，相同文件重开可匹配，更换录音后失效", async () => {
  assert.equal(await transcriptionAudioId(audio), fixture().audioId);
  assert.ok(sameTranscriptionAudio(audio, { ...audio }));
  assert.equal(
    sameTranscriptionAudio(audio, { ...audio, src: audio.src + "AAAA" }),
    false,
  );
  assert.equal(
    sameTranscriptionAudio(audio, { ...audio, duration: 13 }),
    false,
  );
  assert.equal(sameTranscriptionAudio(null, audio), false);
});
test("校对稿随项目往返，原正文、翻译、时间、布局和音频保留，旧项目兼容", () => {
  const p = {
    ...structuredClone(initialProject),
    voice: audio,
    transcription: editTranscription(fixture(), "人工修正原文。"),
  };
  const copy = parseProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(copy, p);
  assert.deepEqual(copy.sentences, initialProject.sentences);
  assert.deepEqual(copy.style, initialProject.style);
  assert.equal(copy.text, initialProject.text);
  assert.deepEqual(
    parseProject(structuredClone(initialProject)),
    initialProject,
  );
});
test("项目拒绝错位或损坏的校对稿，不误当成有效识别", () => {
  for (const patch of [
    { audioId: "bad" },
    { language: "en" },
    { duration: 700 },
    { originalText: "" },
    { text: 0 },
    { segments: [{ start: 0, end: 99, text: "夢" }] },
    { segments: null },
  ]) {
    const draft = { ...fixture(), ...patch } as unknown as TranscriptionDraft;
    assert.equal(validTranscription(draft), false);
    assert.throws(() =>
      parseProject({
        ...structuredClone(initialProject),
        transcription: draft,
      }),
    );
  }
});
