import { useEffect, useMemo, useState } from "react";
import type { Media } from "./model";

export function useVoicePreview(voice: Media | null, gain: number) {
  const source = voice?.src;
  const [attempt, setAttempt] = useState(0);
  const key = useMemo(() => ({}), [source, gain, attempt]);
  const [prepared, setPrepared] = useState<{ key: object; url: string } | null>(null);
  const [failure, setFailure] = useState<{ key: object; message: string } | null>(null);
  useEffect(() => {
    if (!voice || gain <= 1) return;
    const controller = new AbortController();
    let url: string | undefined;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/voice/prepare", { method: "POST", signal: controller.signal,
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice, gain }) });
          if (!response.ok) throw Error((await response.json()).error || "无法增强人声。");
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          if (!blob.type.startsWith("audio/") || !blob.size) throw Error("人声处理结果无效。");
          url = URL.createObjectURL(blob);
          setPrepared({ key, url }); setFailure(null);
        } catch (error) {
          if (!controller.signal.aborted) setFailure({ key,
            message: error instanceof Error ? error.message : String(error) });
        }
      })();
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [key]);
  const needsProcessing = !!voice && gain > 1;
  const ready = !needsProcessing || prepared?.key === key;
  const error = needsProcessing && failure?.key === key ? failure.message : "";
  return { ready, processing: !ready && !error, error,
    retry: () => setAttempt(value => value + 1),
    media: needsProcessing ? ready ? { ...voice!, src: prepared!.url } : null : voice,
    volume: needsProcessing ? 1 : gain };
}
