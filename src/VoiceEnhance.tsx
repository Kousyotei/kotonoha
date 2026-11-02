import { useI18n } from "./i18n";
import { useEffect, useRef, useState } from "react";
import type { Media } from "./model";
export function VoiceEnhance({ voice, gain, onGain, processing, error, onRetry }: {
  voice: Media | null; gain: number; onGain: (gain: number) => void; processing: boolean; error: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const [analyzing, setAnalyzing] = useState(false), [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const current = useRef(voice?.src); current.current = voice?.src;
  const currentGain = useRef(gain); currentGain.current = gain;
  const applyGain = useRef(onGain); applyGain.current = onGain;
  const request = useRef<AbortController | null>(null);
  useEffect(() => { setMessage(""); setFailure(""); setAnalyzing(false); return () => request.current?.abort(); }, [voice?.src]);
  async function enhance() {
    if (!voice) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setAnalyzing(true); setMessage(""); setFailure("");
    try {
      const response = await fetch("/api/voice/analyze", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "无法分析录音响度。");
      if (controller.signal.aborted || current.current !== voice.src) return;
      if (!Number.isFinite(result.gain) || result.gain < 1 || result.gain > 4) throw Error("响度分析结果无效。");
      if (currentGain.current !== gain) { setMessage("分析期间音量已手动调整，保留你的设置。"); return; }
      applyGain.current(result.gain);
      setMessage(result.gain === 1 ? "录音响度已足够，无需额外放大。" :
        `已根据整段录音响度设为 ${Math.round(result.gain * 100)}%${result.capped ? "（已达放大上限）" : ""}。仍可手动调整。`);
    } catch (error) { if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error)); }
    finally { if (request.current === controller && !controller.signal.aborted) setAnalyzing(false); }
  }
  return <div className="voice-enhance">
    <div className="voice-actions"><button disabled={!voice || analyzing || processing} onClick={() => void enhance()}>
      {t(analyzing ? "正在分析响度…" : "一键增强人声")}</button>
      <button className="quiet" disabled={analyzing || gain === 1} onClick={() => { onGain(1); setMessage(""); }}>{t("恢复 100%")}</button></div>
    {processing && <p className="audio-import-status" role="status">{t("正在处理增强人声，请稍候…")}</p>}
    {message && <p className="audio-import-status" role="status">{t(message)}</p>}
    {(error || failure) && <p className="audio-import-error" role="alert">{t(error || failure)}</p>}
    {error && <button onClick={onRetry}>{t("重试声音处理")}</button>}
  </div>;
}
