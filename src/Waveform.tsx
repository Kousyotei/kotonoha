import { useI18n } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { waveformBar } from "./waveform-layout";
export function Waveform({
  src,
  duration,
  current,
  onSeek,
}: {
  src?: string;
  duration: number;
  current: number;
  onSeek: (n: number) => void;
}) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [audioDuration, setAudioDuration] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setPeaks([]);
    setAudioDuration(0);
    setError("");
    if (!src) return;
    const ctx = new AudioContext();
    (async () => {
      try {
        const buffer = await ctx.decodeAudioData(
          await (await fetch(src)).arrayBuffer(),
        );
        const data = buffer.getChannelData(0);
        const count = 700;
        const values = Array.from({ length: count }, (_, i) => {
          let max = 0;
          for (
            let j = Math.floor((i * data.length) / count);
            j < Math.floor(((i + 1) * data.length) / count);
            j++
          )
            max = Math.max(max, Math.abs(data[j]));
          return max;
        });
        if (alive) {
          setPeaks(values);
          setAudioDuration(buffer.duration);
        }
      } catch {
        if (alive) setError("波形解码失败，请尝试 WAV 或 MP3。");
      } finally {
        await ctx.close();
      }
    })();
    return () => {
      alive = false;
    };
  }, [src]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    peaks.forEach((v, i) => {
      const bar = waveformBar(
        i,
        peaks.length,
        audioDuration,
        duration,
        c.width,
      );
      ctx.fillStyle = bar.time < current ? "#668778" : "#a3b4a8";
      ctx.fillRect(bar.x, 40 - v * 34, bar.width, Math.max(2, v * 68));
    });
  }, [peaks, audioDuration, current, duration]);
  return (
    <div
      className="wave"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(
          Math.max(
            0,
            Math.min(
              duration,
              ((e.clientX - rect.left) / rect.width) * duration,
            ),
          ),
        );
      }}
    >
      <canvas ref={canvas} width={1400} height={80} />
      {!peaks.length && (
        <span>
          {t(error || (src ? "正在分析波形…" : "导入朗读录音，显示真实波形"))}
        </span>
      )}
      <i style={{ left: `${(current / duration) * 100}%` }} />
    </div>
  );
}
