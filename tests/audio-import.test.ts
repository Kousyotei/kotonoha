import { test } from "node:test";
import assert from "node:assert/strict";
import { audioMime, importAudio, metadataDuration } from "../src/audio-import";

class MockAudio extends EventTarget {
  duration = NaN;
  preload = "";
  url = "";
  loads = 0;
  constructor(private outcome: "instant" | "error" | "silent") {
    super();
  }
  set src(value: string) {
    this.url = value;
    if (this.outcome === "instant") {
      this.duration = 12.5;
      this.dispatchEvent(new Event("loadedmetadata"));
    } else if (this.outcome === "error") this.dispatchEvent(new Event("error"));
  }
  removeAttribute() {
    this.url = "";
  }
  load() {
    this.loads++;
  }
}
test("缓存音频在设置 src 时立即返回元信息也能完成导入", async () => {
  const audio = new MockAudio("instant");
  assert.equal(
    await metadataDuration(audio as unknown as HTMLAudioElement, "blob:test"),
    12.5,
  );
  assert.equal(audio.url, "");
});
test("浏览器不返回元信息时会超时，而不是无限等待", async () => {
  const audio = new MockAudio("silent");
  await assert.rejects(
    metadataDuration(audio as unknown as HTMLAudioElement, "blob:test", 5),
    /超时/,
  );
  assert.equal(audio.url, "");
});
test("解码错误会明确返回失败", async () => {
  const audio = new MockAudio("error");
  await assert.rejects(
    metadataDuration(audio as unknown as HTMLAudioElement, "blob:test"),
    /解码/,
  );
});
test("操作系统未报告 MIME 时，M4A/WAV/MP3 仍能正确识别并保存", () => {
  assert.equal(audioMime("録音.M4A", ""), "audio/mp4");
  assert.equal(audioMime("test.wav", "application/octet-stream"), "audio/wav");
  assert.equal(audioMime("test.mp3", ""), "audio/mpeg");
  assert.equal(audioMime("test.txt", "text/plain"), "");
});
test("空音频和过大的文件会在解码前被拒绝", async () => {
  await assert.rejects(
    importAudio(new File([], "empty.wav"), () => {}),
    /空的/,
  );
  const file = { size: 151 * 1024 * 1024, name: "large.wav" } as File;
  await assert.rejects(
    importAudio(file, () => {}),
    /150 MB/,
  );
});

test("短音频的波形以真实秒数定位，后方保持静音", async () => {
  const { waveformBar } = await import("../src/waveform-layout");
  const bar = waveformBar(50, 100, 3, 30, 1000);
  assert.equal(bar.time, 1.5);
  assert.equal(bar.x, 50);
  assert.ok(waveformBar(99, 100, 3, 30, 1000).x < 100);
});
