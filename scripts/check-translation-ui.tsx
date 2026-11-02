import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { TranslationPanel } from "../src/TranslationPanel";
import { I18nProvider } from "../src/i18n";
import { initialProject, parseProject, type Project } from "../src/model";
import { applyTranslations, canUndoTranslation, undoTranslations, type TranslationUndo } from "../src/translation";
// Exercise the actual React component with the real local HTTP/model service.
// This is a component test; it does not automate the user's browser.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => originalFetch(typeof input === "string" && input.startsWith("/") ? `http://127.0.0.1:3001${input}` : input, options);
let current: Project = structuredClone(initialProject);
let update: React.Dispatch<React.SetStateAction<Project>>;
function Harness() {
  const [project, setProject] = useState(current), [undo, setUndo] = useState<TranslationUndo | null>(null);
  current = project; update = setProject;
  return <TranslationPanel project={project} canUndo={canUndoTranslation(project, undo)}
    onApply={(result, selected) => {
      const applied = applyTranslations(project, result, selected); setProject(applied.project); setUndo(applied.undo);
    }} onUndo={() => { if (undo) { setProject(undoTranslations(project, undo)); setUndo(null); } }} />;
}
let view: ReactTestRenderer;
const button = (name: string) => view.root.findAllByType("button").find(node => node.children.join("").includes(name))!;
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 30000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error("Translation component did not reach expected state");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
  }
}
try {
  await act(async () => { view = create(<I18nProvider initialLanguage="zh" persist={false}><Harness /></I18nProvider>); });
  await until(() => !!button("生成翻译初稿"));
  assert.equal(button("生成翻译初稿").props.disabled, false);
  await act(async () => { button("生成翻译初稿").props.onClick(); });
  await until(() => !!button("采用所选译文"));
  assert.equal(current.sentences[0].translation, initialProject.sentences[0].translation);
  await act(async () => {
    button("取消全选").props.onClick();
    view.root.findByProps({ "aria-label": "第2句翻译初稿" }).props.onChange({ target: { value: "人工校对：保留当前中文修改。" } });
  });
  await act(async () => { view.root.findByProps({ "aria-label": "采用第2句译文" }).props.onChange({ target: { checked: true } }); });
  await act(async () => { button("采用所选译文").props.onClick(); });
  assert.equal(current.sentences[1].translation, "人工校对：保留当前中文修改。");
  assert.deepEqual(current.sentences.filter((_, i) => i !== 1), initialProject.sentences.filter((_, i) => i !== 1));
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(current))), current);
  await writeFile(".qa/translation-component.kotonoha.json", JSON.stringify(current, null, 2));
  await act(async () => { button("撤销本次采用").props.onClick(); });
  assert.deepEqual(current, initialProject);
  await act(async () => { button("生成翻译初稿").props.onClick(); });
  await until(() => !!button("采用所选译文"));
  await act(async () => { update(project => ({ ...project, sentences: project.sentences.map((s, i) => i === 1 ? { ...s, translation: "生成后新修改的中文" } : s) })); });
  assert.equal(button("采用所选译文").props.disabled, true);
  console.log("Actual React component + real local translation: generate, preview, edit, select, adopt, save, undo and stale-result protection passed.");
} finally {
  await act(async () => { view?.unmount(); });
  globalThis.fetch = originalFetch;
}
