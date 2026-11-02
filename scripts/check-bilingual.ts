import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { browserExecutable } from "../server/browser";
import {
  parseProject,
  paginate,
  validate,
  activeSentenceAt,
} from "../src/model";
import { switchLayout } from "../src/layout-mode";
import { BILINGUAL_BOX, bilingualLayout } from "../src/bilingual-layout";
const filename = process.argv[2] || "samples/demo.kotonoha.json";
const original = parseProject(JSON.parse(await readFile(filename, "utf8")));
let project = switchLayout(
  {
    ...original,
    sentences: original.sentences.map((s, i) => ({
      ...s,
      translation: s.translation || "测试译文。",
    })),
  },
  "bilingual",
);
assert.deepEqual(validate(project), []);
assert.deepEqual(project.voice, original.voice);
assert.deepEqual(
  project.sentences.map((s) => [s.id, s.start, s.end, s.furigana]),
  original.sentences.map((s) => [s.id, s.start, s.end, s.furigana]),
);
assert.deepEqual(switchLayout(project, "vertical").pages, original.pages);
project = parseProject(JSON.parse(JSON.stringify(project)));
await mkdir(".qa", { recursive: true });
await writeFile(
  ".qa/bilingual-project.kotonoha.json",
  JSON.stringify(project, null, 2),
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
const first = project.sentences[0],
  second = project.sentences[1],
  activeFrame = Math.ceil(second.start * 30);
const extremeStyle = {
  ...project.style,
  bilingual: {
    japaneseWidth: 0.4,
    japaneseFontSize: 52,
    chineseFontSize: 44,
    lineHeight: 1.3,
    rubyScale: 0.5,
  },
};
const extreme = {
  ...project,
  style: extremeStyle,
  pages: paginate(project.sentences, extremeStyle),
};
const hiddenStyle = { ...project.style, showFurigana: false };
const hidden = {
  ...project,
  style: hiddenStyle,
  pages: paginate(project.sentences, hiddenStyle),
};
const variants = [
  ["bilingual", activeFrame, project],
  ["bilingual-no-ruby", activeFrame, hidden],
  ["bilingual-large", activeFrame, extreme],
  ["bilingual-vertical", activeFrame, switchLayout(project, "vertical")],
] as const;
for (const [name, frame, p] of variants) {
  assert.deepEqual(validate(p), [], name);
  const composition = await selectComposition({
    ...renderer,
    inputProps: { project: p },
  });
  await renderStill({
    ...renderer,
    composition,
    inputProps: { project: p },
    frame,
    output: path.resolve(`.qa/${name}.png`),
  });
}
if (project.pages[1]) {
  const composition = await selectComposition({
    ...renderer,
    inputProps: { project },
  });
  await renderStill({
    ...renderer,
    composition,
    inputProps: { project },
    frame: Math.ceil(project.pages[1].start * 30),
    output: path.resolve(".qa/bilingual-next-page.png"),
  });
}
if (first.end < second.start) {
  const time = (first.end + second.start) / 2;
  assert.equal(activeSentenceAt(project, time)?.id, first.id);
  const composition = await selectComposition({
    ...renderer,
    inputProps: { project },
  });
  await renderStill({
    ...renderer,
    composition,
    inputProps: { project },
    frame: Math.floor(time * 30),
    output: path.resolve(".qa/bilingual-pause.png"),
  });
}
for (const page of project.pages) {
  const layout = bilingualLayout(
    page.sentenceIds.map((id) => project.sentences.find((s) => s.id === id)!),
    project.style,
  );
  assert.ok(layout.height <= BILINGUAL_BOX.height + 0.01);
}
console.log(
  JSON.stringify(
    {
      passed: true,
      pages: project.pages.map((p) => ({
        start: p.start,
        sentences: p.sentenceIds.length,
      })),
      audioPreserved: true,
      timesAndCorrectionsPreserved: true,
      verticalPagesRestored: true,
      frames: variants.map(([name]) => name),
    },
    null,
    2,
  ),
);
