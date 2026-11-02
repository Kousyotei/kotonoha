import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { initialProject, rebuild, type Project } from "../src/model";
import { usePlaybackPage } from "../src/use-playback-page";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const sample = rebuild("朝です。昼です。夜です。", initialProject);
sample.sentences.forEach((sentence, i) => { sentence.start = i * 2; sentence.end = i * 2 + 1; });
sample.pages = sample.sentences.map((sentence, i) => ({ id: `page-${i}`, start: i ? i * 2 - 0.5 : 0, sentenceIds: [sentence.id] }));
const snapshot = structuredClone(sample);
let selected!: number;
let frame!: React.Dispatch<React.SetStateAction<number>>;
let playing!: React.Dispatch<React.SetStateAction<boolean>>;
let select!: React.Dispatch<React.SetStateAction<number>>;
let edit!: React.Dispatch<React.SetStateAction<Project>>;
function Harness() {
  const [project, setProject] = useState(sample), [f, setFrame] = useState(0);
  const [run, setRun] = useState(false), [page, setPage] = useState(0);
  usePlaybackPage(project, f, run, page, setPage);
  selected = page; frame = setFrame; playing = setRun; select = setPage; edit = setProject;
  return <p>{project.pages[page].sentenceIds.join(",")}</p>;
}
let view!: ReactTestRenderer;
try {
  await act(async () => { view = create(<Harness />); });
  await act(async () => { playing(true); frame(44); });
  assert.equal(selected, 0);
  await act(async () => { frame(45); });
  assert.equal(selected, 1); // Page turns during the pause, before sentence 2.
  assert.equal(view.root.findByType("p").children[0], sample.sentences[1].id);
  await act(async () => { frame(120); }); assert.equal(selected, 2);
  await act(async () => { frame(0); }); assert.equal(selected, 0);
  await act(async () => { playing(false); select(2); }); assert.equal(selected, 2);
  await act(async () => { edit(p => ({ ...p, pages: p.pages.map((page, i) => i === 1 ? { ...page, start: 1.2 } : page) })); });
  assert.equal(selected, 2); // Timing edits while paused do not close the form.
  await act(async () => { playing(true); }); assert.equal(selected, 0);
  await act(async () => { playing(false); frame(100); }); assert.equal(selected, 1);
  assert.deepEqual(sample, snapshot);
  await mkdir(".qa", { recursive: true });
  await writeFile(".qa/playback-page-check.json", JSON.stringify({ passed: true,
    forward: true, backward: true, earlyPageSwitch: true, pausedSeek: true,
    pausedEditingPreserved: true, resumeFollows: true, projectDataUnchanged: true,
    environment: "Actual React playback-page hook, not desktop browser automation" }, null, 2));
  console.log("Playback follows actual page boundaries, including backward/paused seeking and resume; paused manual editing stays selected.");
} finally { await act(async () => { view?.unmount(); }); }
