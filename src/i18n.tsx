import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LANGUAGE, readLanguage, writeLanguage, translate, type Language } from "./locale";
type I18n = { language: Language; setLanguage: (value: Language) => void; t: (source: string, values?: Record<string, string | number>) => string };
const Context = createContext<I18n>({ language: DEFAULT_LANGUAGE, setLanguage: () => {}, t: (source, values) => translate(DEFAULT_LANGUAGE, source, values) });
const browserStorage = () => { try { return globalThis.localStorage; } catch { return undefined; } };
export function I18nProvider({ children, initialLanguage, persist = true }: {
  children: ReactNode; initialLanguage?: Language; persist?: boolean;
}) {
  const [language, setLanguage] = useState<Language>(() => initialLanguage || readLanguage(browserStorage()));
  useEffect(() => {
    if (persist) writeLanguage(language, browserStorage());
    if (typeof document !== "undefined") {
      document.documentElement.lang = language === "ja" ? "ja" : "zh-CN";
      document.title = translate(language, "言の葉 · 日语朗读工作室");
    }
  }, [language, persist]);
  const value = useMemo<I18n>(() => ({ language, setLanguage, t: (source, values) => translate(language, source, values) }), [language]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useI18n = () => useContext(Context);
export function LanguageSelect() {
  const { language, setLanguage, t } = useI18n();
  return <select className="language-select" aria-label={t("界面语言")} value={language}
    onChange={event => setLanguage(event.target.value === "zh" ? "zh" : "ja")}>
    <option value="ja" lang="ja">日本語</option><option value="zh" lang="zh-CN">中文</option>
  </select>;
}
