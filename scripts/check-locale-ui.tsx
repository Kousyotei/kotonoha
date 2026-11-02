import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { I18nProvider, LanguageSelect, useI18n } from "../src/i18n";
import { LANGUAGE_KEY } from "../src/locale";
import { TranslationPanel } from "../src/TranslationPanel";
import { FuriganaPanel } from "../src/FuriganaPanel";
import { AlignmentPanel } from "../src/AlignmentPanel";
import { BilingualControls } from "../src/BilingualControls";
import { VoiceEnhance } from "../src/VoiceEnhance";
import { AudioImport } from "../src/AudioImport";
import { initialProject, rebuild } from "../src/model";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const values = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) },
  document: { documentElement: { lang: "" }, title: "" },
});
const project = rebuild("夜空を見上げる。星が流れる。", { ...initialProject, title: "保留用户作品标题" });
project.sentences[0].translation = "保留人工修改的中文。";
project.sentences[0].note = "保留用户语法注释。";
const before = structuredClone(project);
const draftText = "尚未应用的正文草稿，不应被切换语言覆盖。";
const originalFetch = globalThis.fetch;
let posted: any;
// Network fixtures exercise UI localization without running/downloading models.
// They are not a translation-quality test and never write the user's project.
globalThis.fetch = async (input, options) => {
  const url = String(input);
  if (url.endsWith("/status")) return Response.json({ ready: true, supported: true, model: "fixture", modelMB: 1018 });
  if (url === "/api/translation") { posted = JSON.parse(String(options?.body)); return Response.json({ id: "fixture-job" }); }
  if (url.endsWith("/fixture-job")) return Response.json({ status: "done", progress: 1, message: "已完成", result: {
    model: "UI test fixture", items: posted.sentences.map((s: any) => ({ id: s.id, sourceText: s.text, previousTranslation: s.translation, translation: "测试夹具译文：保留中文候选。" })),
  } });
  throw Error(`Unexpected UI test request: ${url}`);
};
function Harness() {
  const { t } = useI18n();
  const [draft, setDraft] = useState(draftText);
  return <><LanguageSelect /><h1>{t("文章与分页")}</h1>
    <input aria-label="fixture-title" value={project.title} readOnly />
    <textarea aria-label="fixture-draft" value={draft} onChange={e => setDraft(e.target.value)} />
    <TranslationPanel project={project} canUndo={false} onApply={() => {}} onUndo={() => {}} />
    <FuriganaPanel project={project} onChange={() => {}} selection={null} onSelect={() => {}} />
    <AlignmentPanel project={project} onApply={() => {}} onUndo={() => {}} onSeek={() => {}} canUndo={false} />
    <BilingualControls project={project} onChange={() => {}} />
    <VoiceEnhance voice={null} gain={1} onGain={() => {}} processing={false} error="" onRetry={() => {}} />
    <AudioImport existing={null} label={t("朗读人声")} onImport={() => {}} />
  </>;
}
let view!: ReactTestRenderer;
const text = () => JSON.stringify(view.toJSON());
const button = (label: string) => view.root.findAllByType("button").find(node => node.children.join("").includes(label));
async function until(test: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!test()) {
    if (Date.now() > deadline) throw Error("Locale component did not reach expected state");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
}
const switchTo = async (language: "ja" | "zh") => {
  await act(async () => { view.root.findByProps({ className: "language-select" }).props.onChange({ target: { value: language } }); });
};
try {
  await act(async () => { view = create(<I18nProvider><Harness /></I18nProvider>); });
  await until(() => !!button("訳文を生成"));
  assert.equal(document.documentElement.lang, "ja");
  assert.equal(document.title, "言の葉 · 日本語朗読スタジオ");
  assert.match(text(), /本文とページ/); assert.match(text(), /ふりがなを生成/);
  assert.match(text(), /音声を自動増幅/); assert.match(text(), /音声と本文の同期/);
  await act(async () => { button("訳文を生成")!.props.onClick(); });
  await until(() => !!button("選択した訳文を反映"));
  assert.equal(posted.sentences.length, 1);
  assert.equal(posted.sentences[0].text, project.sentences[1].text);
  assert.equal(view.root.findByProps({ "aria-label": "2文目の訳文案" }).props.value, "测试夹具译文：保留中文候选。");
  await switchTo("zh");
  assert.equal(document.documentElement.lang, "zh-CN");
  assert.match(text(), /文章与分页/); assert.match(text(), /自动生成注音/);
  assert.ok(button("采用所选译文")); assert.equal(values.get(LANGUAGE_KEY), "zh");
  assert.equal(view.root.findByProps({ "aria-label": "第2句翻译初稿" }).props.value, "测试夹具译文：保留中文候选。");
  assert.equal(view.root.findByProps({ "aria-label": "fixture-draft" }).props.value, draftText);
  assert.equal(view.root.findByProps({ "aria-label": "fixture-title" }).props.value, project.title);
  assert.deepEqual(project, before);
  const removed = ["开启「显示注音」后", "无法保证所有语义歧义", "翻译当前已应用的日文正文", "每行显示同一句的日文与中文", "100% 为原音量"];
  for (const phrase of removed) assert.ok(!text().includes(phrase), phrase);
  await act(async () => { view.unmount(); });
  await act(async () => { view = create(<I18nProvider><Harness /></I18nProvider>); });
  await until(() => !!button("生成翻译初稿"));
  assert.equal(document.documentElement.lang, "zh-CN");
  await switchTo("ja"); assert.equal(values.get(LANGUAGE_KEY), "ja");
  assert.deepEqual(project, before);
  await writeFile(".qa/locale-ui-check.json", JSON.stringify({ passed: true, defaultJapanese: true,
    chineseSwitch: true, rememberedAfterRemount: true, documentLanguageAndTitle: true,
    draftAndProjectUnchanged: true, translationPreviewPreserved: true, redundantCopyRemoved: true,
    environment: "Actual React components with network/storage/document fixtures; not desktop browser automation" }, null, 2));
  console.log("Default Japanese, live Chinese switch, remembered preference, preserved draft/project/translation preview and removed helper text passed.");
} finally {
  globalThis.fetch = originalFetch;
  await act(async () => { view?.unmount(); });
}
