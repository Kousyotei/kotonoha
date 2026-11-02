import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LANGUAGE, LANGUAGE_KEY, readLanguage, writeLanguage, translate } from "../src/locale";
import { jaMessages } from "../src/ja-messages";
test("界面默认日语；记住中文选择；存储不可用时仍能打开", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(DEFAULT_LANGUAGE, "ja"); assert.equal(readLanguage(storage), "ja");
  writeLanguage("zh", storage); assert.equal(readLanguage(storage), "zh");
  writeLanguage("ja", storage); assert.equal(readLanguage(storage), "ja");
  values.set(LANGUAGE_KEY, "en"); assert.equal(readLanguage(storage), "ja");
  assert.equal(readLanguage({ getItem() { throw Error("disabled"); } }), "ja");
  assert.doesNotThrow(() => writeLanguage("zh", { setItem() { throw Error("disabled"); } }));
});
test("界面标签、动态状态与嵌套错误能切换，文件名与用户内容原样保留", () => {
  assert.equal(translate("ja", "文章与分页"), "本文とページ");
  assert.equal(translate("zh", "文章与分页"), "文章与分页");
  assert.equal(translate("ja", "正在导出 28%"), "書き出し中 28%");
  assert.equal(translate("ja", "第12句开始"), "12文目の開始時刻");
  assert.equal(translate("ja", "第{n}页 · 时间单位为秒", { n: 3 }), "3ページ・時間は秒単位");
  assert.equal(translate("zh", "第{n}页 · 时间单位为秒", { n: 3 }), "第3页 · 时间单位为秒");
  assert.match(translate("ja", "保存失败：本机存储空间不足，保存未完成。原保存版本保留，请导出项目备份。"), /^保存に失敗しました：保存容量/);
  const file = "中文录音（修订版）.m4a";
  const message = `无法恢复音频「${file}」。`;
  assert.equal(translate("ja", message), `音声「${file}」を復元できません。`);
  assert.equal(translate("ja", "夜空を見上げて、時々思う。"), "夜空を見上げて、時々思う。");
  assert.equal(translate("ja", "用户手工修改的完整译文。"), "用户手工修改的完整译文。");
});
test("日语文案的占位符与中文源文一致，不丢失数字和用户数据", () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [source, target] of Object.entries(jaMessages))
    assert.deepEqual(placeholders(target), placeholders(source), source);
});
