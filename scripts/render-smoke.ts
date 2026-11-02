import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { browserExecutable } from "../server/browser";
import { initialProject } from "../src/model";
import path from "node:path";
import { mkdir } from "node:fs/promises";
const serveUrl = await bundle({
  entryPoint: path.resolve("src/video-entry.tsx"),
});
const project = structuredClone(initialProject);
// Tiny synthesized WAV verifies actual audio muxing without an external recording.
const rate = 48000,
  length = rate * 2;
const wav = Buffer.alloc(44 + length * 2);
wav.write("RIFF");
wav.writeUInt32LE(36 + length * 2, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(length * 2, 40);
for (let i = 0; i < length; i++)
  wav.writeInt16LE(
    Math.round(Math.sin((i / rate) * Math.PI * 440 * 2) * 1500),
    44 + i * 2,
  );
project.voice = {
  name: "test.wav",
  src: `data:audio/wav;base64,${wav.toString("base64")}`,
  duration: 2,
};
project.music = { ...project.voice };
const inputProps = { project };
const composition = await selectComposition({
  serveUrl,
  id: "Reading",
  inputProps,
  browserExecutable: browserExecutable(),
  chromeMode: browserExecutable() ? "chrome-for-testing" : "headless-shell",
});
await mkdir(".renders", { recursive: true });
await renderMedia({
  serveUrl,
  composition,
  inputProps,
  codec: "h264",
  audioCodec: "aac",
  outputLocation: ".renders/smoke.mp4",
  frameRange: [0, 59],
  concurrency: 2,
  browserExecutable: browserExecutable(),
  chromeMode: browserExecutable() ? "chrome-for-testing" : "headless-shell",
});
console.log("Rendered .renders/smoke.mp4 (1080p / 2 seconds / mixed audio)");
