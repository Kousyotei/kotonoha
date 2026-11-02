import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { browserExecutable } from "../server/browser";
import { initialProject, parseProject, activeSentenceAt } from "../src/model";
import {
  mergeFurigana,
  confirmReading,
  type FuriganaRecord,
} from "../src/furigana";
import { fitFuriganaPages } from "../src/furigana-pages";
const source = process.argv[2];
let project = source
  ? parseProject(JSON.parse(await readFile(source, "utf8")))
  : structuredClone(initialProject);
const original = structuredClone(project),
  base = process.env.APP_URL || "http://127.0.0.1:5173";
async function generate() {
  const response = await fetch(`${base}/api/furigana`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sentences: project.sentences.map(({ id, text }) => ({ id, text })),
    }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result.sentences as { id: string; furigana: FuriganaRecord }[];
}
const generated = await generate();
project = fitFuriganaPages({
  ...project,
  style: { ...project.style, showFurigana: true },
  sentences: project.sentences.map((s) => ({
    ...s,
    furigana: mergeFurigana(
      s,
      generated.find((r) => r.id === s.id)!.furigana,
      project.furiganaCorrections,
    ),
  })),
});
const first = project.sentences.find((s) =>
    s.furigana!.tokens.some((t) => t.reading),
  )!,
  token = first.furigana!.tokens.find((t) => t.reading)!;
// Confirm the existing candidate; never change the recording's pronunciation for QA.
project = confirmReading(project, first.id, token.key, token.reading);
const regenerated = await generate();
project = {
  ...project,
  sentences: project.sentences.map((s) => ({
    ...s,
    furigana: mergeFurigana(
      s,
      regenerated.find((r) => r.id === s.id)!.furigana,
      project.furiganaCorrections,
    ),
  })),
};
assert.equal(
  project.sentences
    .find((s) => s.id === first.id)!
    .furigana!.tokens.find((t) => t.key === token.key)!.status,
  "manual",
);
project = parseProject(JSON.parse(JSON.stringify(project)));
assert.deepEqual(project.voice, original.voice);
assert.deepEqual(project.music, original.music);
assert.deepEqual(
  project.sentences.map(({ furigana, ...s }) => s),
  original.sentences.map(({ furigana, ...s }) => s),
);
await mkdir(".qa", { recursive: true });
await writeFile(
  ".qa/furigana-project.kotonoha.json",
  JSON.stringify(project, null, 2),
);
const tokens = project.sentences.flatMap((s) => s.furigana!.tokens);
console.log(
  JSON.stringify(
    {
      passed: true,
      words: tokens.length,
      dictionary: tokens.filter((t) => t.status === "dictionary").length,
      inferred: tokens.filter((t) => t.status === "inferred").length,
      manual: tokens.filter((t) => t.status === "manual").length,
      needsReview: tokens
        .filter((t) => t.needsReview)
        .map((t) => ({
          word: t.surface,
          reading: t.reading,
          reason: t.reason,
        })),
      sample: tokens
        .slice(0, 12)
        .map((t) => ({ word: t.surface, parts: t.parts, status: t.status })),
      pages: project.pages.length,
    },
    null,
    2,
  ),
);
const serveUrl = await bundle({
    entryPoint: path.resolve("src/video-entry.tsx"),
  }),
  executable = browserExecutable();
const renderer = {
  serveUrl,
  id: "Reading",
  browserExecutable: executable,
  chromeMode: executable
    ? ("chrome-for-testing" as const)
    : ("headless-shell" as const),
};
const composition = await selectComposition({
  ...renderer,
  inputProps: { project },
});
for (const [name, frame, p] of [
  ["furigana", Math.ceil(first.start * 30), project],
  [
    "furigana-hidden",
    Math.ceil(first.start * 30),
    { ...project, style: { ...project.style, showFurigana: false } },
  ],
  [
    "furigana-large",
    Math.ceil(first.start * 30),
    fitFuriganaPages({
      ...project,
      style: { ...project.style, fontSize: 96, lineHeight: 1 },
    }),
  ],
] as const) {
  const variant = await selectComposition({
    ...renderer,
    inputProps: { project: p },
  });
  await renderStill({
    ...renderer,
    composition: variant,
    inputProps: { project: p },
    frame,
    output: path.resolve(`.qa/${name}.png`),
  });
}
if (project.sentences.length > 1) {
  const previous = project.sentences[0],
    next = project.sentences[1];
  if (next.start > previous.end) {
    const time = (next.start + previous.end) / 2;
    assert.equal(activeSentenceAt(project, time)?.id, previous.id);
    await renderStill({
      ...renderer,
      composition,
      inputProps: { project },
      frame: Math.floor(time * 30),
      output: path.resolve(".qa/furigana-pause.png"),
    });
  }
}
console.log(
  "Rendered ruby on/off, 96px tight-spacing and pause frames in .qa/",
);
