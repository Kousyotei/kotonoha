import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseProject, splitSentences } from "../src/model";
import { SAMPLE_TEXT, SAMPLE_TITLE, SAMPLE_TRANSLATIONS } from "../src/sample";
test("公开示例与默认原创正文一致，不依赖私人音频", () => {
  const project = parseProject(JSON.parse(readFileSync("samples/demo.kotonoha.json", "utf8")));
  assert.equal(project.title, SAMPLE_TITLE);
  assert.equal(project.text, SAMPLE_TEXT);
  assert.deepEqual(project.sentences.map(s => s.text), splitSentences(SAMPLE_TEXT));
  assert.deepEqual(project.sentences.map(s => s.translation), SAMPLE_TRANSLATIONS);
  assert.equal(project.voice, null); assert.equal(project.music, null);
});
