import { useI18n } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { importAudio } from "./audio-import";
import type { Media } from "./model";

export function AudioImport({
  existing,
  previewSrc,
  previewVolume = 1,
  label,
  onImport,
}: {
  existing: Media | null;
  previewSrc?: string | null;
  previewVolume?: number;
  label: string;
  onImport: (media: Media) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const src = previewSrc === undefined ? existing?.src : previewSrc;
  useEffect(() => {
    if (audio.current) audio.current.volume = Math.min(1, Math.max(0, previewVolume));
  }, [src, previewVolume]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  return (
    <div>
      <button
        type="button"
        className="wide"
        disabled={loading}
        onClick={() => input.current?.click()}
      >
        <Plus size={15} />
        {t(loading ? "正在导入…" : existing ? "替换音频" : "导入音频")}
      </button>
      <input
        ref={input}
        type="file"
        aria-label={t(`导入${label}`)}
        accept="audio/*,.mp3,.wav,.wave,.m4a,.aac,.flac,.ogg,.oga,.opus,.webm,.aif,.aiff,.mp4"
        onChange={async (e) => {
          const element = e.currentTarget;
          const file = element.files?.[0];
          if (!file) return;
          setLoading(true);
          setError("");
          setStatus("准备读取…");
          try {
            const media = await importAudio(file, setStatus);
            onImport(media);
            setStatus(
              `已导入 · ${media.duration.toFixed(1)} 秒 · ${file.size < 1024 * 1024 ? `${Math.round(file.size / 1024)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}`,
            );
          } catch (err) {
            setStatus("");
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setLoading(false);
            element.value = "";
          }
        }}
      />
      {existing && (
        <>
          <p className="audio-details">{existing.duration.toFixed(1)} {t("秒")}</p>
          {src && <audio
            ref={audio}
            controls
            preload="metadata"
            src={src}
            aria-label={t(`试听${label}`)}
            onError={() =>
              setError("音频无法播放，请尝试将原文件转换为 MP3 或 WAV。")
            }
          />}
        </>
      )}
      {status && (
        <p className="audio-import-status" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="audio-import-error" role="alert">
          {t(error)}
        </p>
      )}
      <p className="hint">
        MP3 / WAV / M4A · ≤150 MB
      </p>
    </div>
  );
}
