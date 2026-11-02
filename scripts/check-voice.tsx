import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { initialProject, rebuild, parseProject, type Media } from "../src/model";
import { useVoicePreview } from "../src/use-voice-preview";
import { VoiceEnhance } from "../src/VoiceEnhance";
import { I18nProvider } from "../src/i18n";
const base = process.env.APP_URL || "http://127.0.0.1:3001", rate = 48000, seconds = 3.2;
const ffmpeg = process.env.KOTONOHA_FFMPEG || "ffmpeg";
const ffprobe = process.env.KOTONOHA_FFPROBE || "ffprobe";
function wav(amplitude: number, pulse = false) {
  const count = Math.round(rate * seconds), buffer = Buffer.alloc(44 + count * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(36 + count * 2, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const signal = pulse ? amplitude * Math.exp(-(((t - 1.234) / 0.001) ** 2)) : amplitude * Math.sin(t * Math.PI * 880);
    buffer.writeInt16LE(Math.round(signal * 32767), 44 + i * 2);
  }
  return buffer;
}
const media = (bytes: Buffer): Media => ({ name: "voice-test.wav", duration: seconds, src: `data:audio/wav;base64,${bytes.toString("base64")}` });
async function prepare(voice: Media, gain: number, name: string) {
  const response = await fetch(`${base}/api/voice/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice, gain }) });
  if (!response.ok) throw Error(await response.text());
  assert.match(response.headers.get("content-type")!, /audio/);
  const bytes = Buffer.from(await response.arrayBuffer()); await writeFile(name, bytes); return name;
}
function samples(file: string) {
  const output = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(rate), "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"], { maxBuffer: 100 * 1024 * 1024 });
  if (output.error) throw output.error;
  if (output.status !== 0) throw Error(output.stderr.toString());
  return Array.from({ length: output.stdout.length / 4 }, (_, i) => output.stdout.readFloatLE(i * 4));
}
function stats(values: number[]) {
  const inside = values.slice(rate / 4, -rate / 4);
  return { rms: Math.sqrt(inside.reduce((sum, value) => sum + value * value, 0) / inside.length),
    peak: values.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) };
}
const quiet = media(wav(0.025));
await mkdir(".qa", { recursive: true });
await writeFile(".qa/voice-original.wav", wav(0.025));
const boosted = await prepare(quiet, 2, ".qa/voice-200.m4a");
const originalStats = stats(samples(".qa/voice-original.wav")), boostedStats = stats(samples(boosted));
const gainRatio = boostedStats.rms / originalStats.rms;
assert.ok(gainRatio > 1.95 && gainRatio < 2.05, `Expected 2x, got ${gainRatio}`);
const limited = await prepare(media(wav(0.7)), 4, ".qa/voice-limited-400.m4a");
const limitedStats = stats(samples(limited));
assert.ok(limitedStats.peak < 0.96 && limitedStats.peak > 0.8);
const pulse = await prepare(media(wav(0.05, true)), 4, ".qa/voice-timing.m4a");
const pulseSamples = samples(pulse);
const peakIndex = pulseSamples.reduce((best, value, i) => Math.abs(value) > Math.abs(pulseSamples[best]) ? i : best, 0);
const timingError = Math.abs(peakIndex / rate - 1.234);
assert.ok(timingError < 0.002, `Unexpected limiter delay ${timingError}`);
const invalid = await fetch(`${base}/api/voice/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice: quiet, gain: 5 }) });
assert.equal(invalid.status, 400);

// Actual React hook and button use the real API. Node blob URLs model the
// browser's resource ownership; this is a component-level integration test.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => originalFetch(typeof input === "string" && input.startsWith("/") ? `${base}${input}` : input, options);
let preview!: ReturnType<typeof useVoicePreview>, gain!: number;
let setGain!: React.Dispatch<React.SetStateAction<number>>;
function Harness() {
  const [value, setValue] = useState(1); gain = value; setGain = setValue;
  preview = useVoicePreview(quiet, value);
  return <VoiceEnhance voice={quiet} gain={value} onGain={setValue} processing={preview.processing} error={preview.error} onRetry={preview.retry} />;
}
let view!: ReactTestRenderer;
async function until(check: () => boolean, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw Error(`Voice component timeout: ${preview?.error}`);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  }
}
try {
  await act(async () => { view = create(<I18nProvider initialLanguage="zh" persist={false}><Harness /></I18nProvider>); });
  assert.equal(preview.ready, true);
  await act(async () => { setGain(2); }); assert.equal(preview.ready, false);
  await until(() => preview.ready); assert.equal(preview.volume, 1);
  const oldURL = preview.media!.src;
  assert.ok((await (await fetch(oldURL)).blob()).size > 100);
  await act(async () => { setGain(1); }); assert.equal(preview.media!.src, quiet.src);
  await assert.rejects(fetch(oldURL));
  await act(async () => { setGain(2); }); assert.equal(preview.ready, false);
  await until(() => preview.ready); assert.notEqual(preview.media!.src, oldURL);
  await act(async () => { setGain(1); });
  const enhance = view.root.findAllByType("button").find(button => button.children.join("").includes("一键增强"))!;
  await act(async () => { enhance.props.onClick(); });
  await until(() => gain > 1 && preview.ready);
  assert.equal(gain, 4);
} finally { await act(async () => { view?.unmount(); }); globalThis.fetch = originalFetch; }

// Export through the application's actual route, which runs the same limiter.
const project = rebuild("朝です。夜です。", initialProject);
project.sentences[0].start = 0; project.sentences[0].end = 1.2;
project.sentences[1].start = 1.6; project.sentences[1].end = 3;
project.voice = quiet; project.voiceVolume = 2;
parseProject(project);
const response = await fetch(`${base}/api/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) });
const job = await response.json(); if (!response.ok) throw Error(JSON.stringify(job));
const deadline = Date.now() + 120000;
let exported = false;
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 500));
  const status = await (await fetch(`${base}/api/render/${job.id}`)).json();
  if (status.error) throw Error(status.error);
  if (status.status !== "done") continue;
  const video = await fetch(`${base}/api/render/${job.id}/video`);
  await writeFile(".qa/voice-export.mp4", Buffer.from(await video.arrayBuffer())); exported = true; break;
}
assert.equal(exported, true);
const exportStats = stats(samples(".qa/voice-export.mp4"));
assert.ok(Math.abs(exportStats.rms / boostedStats.rms - 1) < 0.03);
const probe = spawnSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate:format=duration", "-of", "json", ".qa/voice-export.mp4"], { encoding: "utf8" });
if (probe.error) throw probe.error;
assert.equal(probe.status, 0);
const info = JSON.parse(probe.stdout);
assert.ok(info.streams.some((stream: any) => stream.width === 1920 && stream.height === 1080 && stream.codec_name === "h264"));
await writeFile(".qa/voice-check.json", JSON.stringify({ passed: true, gainRatio,
  gainDb: 20 * Math.log10(gainRatio), limitedPeak: limitedStats.peak,
  limiterTimingErrorSeconds: timingError, previewAndExportRmsRatio: exportStats.rms / boostedStats.rms,
  reactPreview: true, autoEnhance: true, revokedUrlsNeverReused: true, export: info,
  environment: "Real FFmpeg/API/MP4 export; React component in Node, not desktop automation" }, null, 2));
console.log("Real 200% gain, 400% limiting, unchanged timing, one-click enhancement, preview resource cleanup and 1080p MP4 loudness match passed.");
