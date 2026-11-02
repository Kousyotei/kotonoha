import { test } from "node:test";
import assert from "node:assert/strict";
import { initialProject, parseProject } from "../src/model";
import { voiceFilter } from "../server/voice-processing";

test("人声支持 400% 并可项目往返；背景音乐保留原音量范围", () => {
  const project = { ...initialProject, voiceVolume: 4 };
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(project))), project);
  assert.throws(() => parseProject({ ...project, voiceVolume: 4.01 }), /音量/);
  assert.throws(() => parseProject({ ...project, voiceVolume: -1 }), /音量/);
  assert.throws(() => parseProject({ ...project, musicVolume: 1.1 }), /音量/);
});
test("增益处理禁用自动补偿音量、补偿限幅延迟并拒绝无效参数", () => {
  assert.match(voiceFilter(4), /volume=4,/);
  assert.match(voiceFilter(2), /level=false/);
  assert.match(voiceFilter(2), /latency=true/);
  for (const value of [NaN, Infinity, -1, 4.01]) assert.throws(() => voiceFilter(value));
});
