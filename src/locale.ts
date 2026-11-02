import { jaMessages } from "./ja-messages";
export type Language = "ja" | "zh";
export const LANGUAGE_KEY = "kotonoha.ui-language";
export const DEFAULT_LANGUAGE: Language = "ja";
export function readLanguage(storage?: Pick<Storage, "getItem">): Language {
  try { return storage?.getItem(LANGUAGE_KEY) === "zh" ? "zh" : DEFAULT_LANGUAGE; }
  catch { return DEFAULT_LANGUAGE; }
}
export function writeLanguage(language: Language, storage?: Pick<Storage, "setItem">) {
  try { storage?.setItem(LANGUAGE_KEY, language); } catch { /* Language remains usable without storage permission. */ }
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const templates = Object.entries(jaMessages).filter(([source]) => /\{\w+\}/.test(source))
  .map(([source, target]) => {
    const names: string[] = [];
    const parts = source.split(/(\{\w+\})/).map(part => {
      if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return "([\\s\\S]*?)"; }
      return escape(part);
    });
    return { source, target, names, regex: new RegExp(`^${parts.join("")}$`) };
  }).sort((a, b) => b.source.length - a.source.length);
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] === undefined ? match : String(values[key]));
export function translate(language: Language, source: string, values: Record<string, string | number> = {}, depth = 0): string {
  if (language === "zh") return fill(source, values);
  if (Object.hasOwn(jaMessages, source)) return fill(jaMessages[source], values);
  // Error prefixes may wrap another canonical application message. User text
  // and filenames in ordinary placeholder values are never translated.
  if (depth < 4) {
    for (const prefix of ["Error: ", "TypeError: "]) if (source.startsWith(prefix))
      return prefix + translate(language, source.slice(prefix.length), {}, depth + 1);
  }
  for (const template of templates) {
    const match = template.regex.exec(source);
    if (!match) continue;
    const parts = Object.fromEntries(template.names.map((name, i) => [name,
      depth < 4 && ["保存失败：{0}", "读取本机项目失败：{0} 原保存数据未改动。", "导出失败：{0}"].includes(template.source)
        ? translate(language, match[i + 1], {}, depth + 1) : match[i + 1]]));
    // Only these suffixes are UI copy; captured user text is preserved.
    if (template.source === "已根据整段录音响度设为 {0}%{1}。仍可手动调整。" ||
        template.source === "已生成，JMdict {0}。人工修正已保留{1}。")
      parts["1"] = translate(language, parts["1"] || "", {}, depth + 1);
    return fill(template.target, parts);
  }
  if (source.includes("；")) return source.split("；").map(part => translate(language, part, values, depth + 1)).join("；");
  return fill(source, values);
}
