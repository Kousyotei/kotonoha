import { useI18n } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";
import type { Project } from "./model";
import { translationInputs, translationIsCurrent, validateTranslationInputs, validateTranslationResult,
  TRANSLATION_MAX_TARGET, type TranslationResult } from "./translation";

type Status = { ready: boolean; supported: boolean; activeJob?: string; model: string; modelMB: number };
export function TranslationPanel({ project, onApply, onUndo, canUndo }: {
  project: Project;
  onApply: (result: TranslationResult, selected: string[]) => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const { t } = useI18n();
  const current = useRef(project); current.current = project;
  const alive = useRef(true), jobId = useRef<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null), [running, setRunning] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(true), [progress, setProgress] = useState(0);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [result, setResult] = useState<TranslationResult | null>(null), [selected, setSelected] = useState<string[]>([]);
  async function refresh() {
    try {
      const response = await fetch("/api/translation/status");
      if (!response.ok) throw Error("无法连接本地翻译服务，请检查 App 启动终端。");
      const data = await response.json(); if (alive.current) setStatus(data);
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : String(error)); }
  }
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, []);
  async function run(setup = false) {
    let inputs;
    try { inputs = setup ? [] : validateTranslationInputs(translationInputs(current.current, onlyMissing)); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return; }
    setRunning(true); setError(""); setResult(null); setSelected([]); setProgress(0);
    setMessage(setup ? "正在准备本地翻译模型…" : "正在生成中文翻译初稿…");
    try {
      const response = await fetch(setup ? "/api/translation/setup" : "/api/translation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: setup ? undefined : JSON.stringify({ sentences: inputs }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "无法创建翻译任务。");
      jobId.current = data.id;
      while (alive.current) {
        const response = await fetch(`/api/translation/${data.id}`), job = await response.json();
        if (!response.ok) throw Error(job.error || "无法读取翻译进度。");
        if (!alive.current) break;
        setProgress(job.progress); setMessage(job.message);
        if (job.status === "error") throw Error(job.error || "翻译失败，已有译文保留。");
        if (job.status === "cancelled") break;
        if (job.status === "done") {
          if (!setup) {
            const candidate = validateTranslationResult(job.result, inputs);
            setResult(candidate); setSelected(candidate.items.map(item => item.id));
            setMessage("翻译初稿已生成，请逐句核对。点击「采用所选译文」后才会写入项目。");
          }
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : String(error));
    } finally { jobId.current = null; if (alive.current) { setRunning(false); void refresh(); } }
  }
  async function cancel() {
    const id = jobId.current || status?.activeJob;
    if (!id) return;
    try {
      const response = await fetch(`/api/translation/${id}/cancel`, { method: "POST" });
      if (!response.ok) throw Error("无法取消本地翻译任务。");
      setMessage("已请求取消，已有译文保留。"); void refresh();
    } catch (error) { setError(String(error)); }
  }
  const count = translationInputs(project, onlyMissing).length;
  const stale = !!result && !translationIsCurrent(project, result);
  const modelSize = status ? `${(status.modelMB / 1000).toFixed(2)} GB` : "1.02 GB";
  return <section className="translation-panel" aria-label={t("文字自动翻译")}>
    <div className="label-row">
      <h3><Languages size={17} />{t("文字自动翻译")}</h3><span>{t("日语 → 简体中文 · 本地离线")}</span>
    </div>
    <div className="translation-actions">
      {status?.ready ? <button className="primary" disabled={running || !!status.activeJob || !count} onClick={() => void run()}>
        {t(running ? "正在处理…" : `生成翻译初稿 · ${count} 句`)}
      </button> : <button className="primary" disabled={running || !status?.supported || !!status.activeJob} onClick={() => void run(true)}>
        {t("准备 Hy-MT2 翻译模型（约")}{modelSize}）
      </button>}
      {(running || status?.activeJob) && <button onClick={() => void cancel()}>{t("取消翻译任务")}</button>}
      <button className="quiet" disabled={running} onClick={() => void refresh()}>{t("检查翻译状态")}</button>
      <button disabled={!canUndo || running} onClick={() => {
        try { onUndo(); setResult(null); setMessage("已撤销本次采用的译文。"); }
        catch (error) { setError(String(error)); }
      }}>{t("撤销本次采用")}</button>
    </div>
    <label className="translation-scope"><input type="checkbox" checked={onlyMissing} disabled={running}
      onChange={e => setOnlyMissing(e.target.checked)} />{t("仅翻译没有中文译文的句子")}</label>
    <p className="model-status">{t(status?.ready ? "本地翻译已就绪" :
      status && !status.supported ? "本地 Hy-MT2 需要 Apple Silicon Mac；仍可手动填写中文。" :
      "本地翻译未准备")}</p>
    {!count && <p className="model-status">{t("没有待翻译的句子")}</p>}
    {running && <progress max={1} value={progress} aria-label={t("文字翻译进度")} />}
    {message && <p className="alignment-message" role="status">{t(message)}</p>}
    {error && <p className="alignment-error" role="alert">{t(error)}</p>}
    {result && <div className="translation-result">
      <div className="label-row"><h3>{t("翻译预览 · 可直接修改中文")}</h3><span>{selected.length}/{result.items.length} {t("句已选择")}</span></div>
      {stale && <p className="alignment-error">{t("正文或已有译文在生成后发生了修改，请重新生成，避免覆盖新的编辑内容。")}</p>}
      <div className="translation-actions">
        <button className="quiet" onClick={() => setSelected(result.items.map(item => item.id))}>{t("全选译文")}</button>
        <button className="quiet" onClick={() => setSelected([])}>{t("取消全选")}</button>
      </div>
      <div className="translation-preview-list">
        {result.items.map(item => {
          const number = project.sentences.findIndex(s => s.id === item.id) + 1;
          return <div className="translation-preview-row" key={item.id}>
            <label className="translation-pick"><input type="checkbox" checked={selected.includes(item.id)} aria-label={t(`采用第${number}句译文`)}
              onChange={e => setSelected(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />{String(number).padStart(2, "0")}</label>
            <div><p className="translation-source" lang="ja">{item.sourceText}</p>
              {item.previousTranslation && <p className="hint">{t("原译文：")}{item.previousTranslation}</p>}
              <textarea rows={2} aria-label={t(`第${number}句翻译初稿`)} lang="zh-CN" maxLength={TRANSLATION_MAX_TARGET} value={item.translation}
                onChange={e => setResult(previous => previous ? { ...previous, items: previous.items.map(row => row.id === item.id ? { ...row, translation: e.target.value } : row) } : null)} />
            </div>
          </div>;
        })}
      </div>
      <div className="translation-actions">
        <button className="primary" disabled={running || stale || !selected.length || result.items.some(item => selected.includes(item.id) && !item.translation.trim())}
          onClick={() => {
            try { onApply(result, selected); setResult(null); setSelected([]); setMessage("已采用所选译文，仍可在逐句编辑区修改。请保存项目。"); }
            catch (error) { setError(error instanceof Error ? error.message : String(error)); }
          }}>{t("采用所选译文")}</button>
        <button onClick={() => { setResult(null); setMessage("已保留原有译文。"); }}>{t("保留原译文")}</button>
      </div>
    </div>}
  </section>;
}
