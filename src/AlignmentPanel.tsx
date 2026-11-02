import { useI18n } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { WandSparkles, Undo2, LockKeyhole } from "lucide-react";
import { sameAlignmentInput, type AlignmentResult } from "./alignment";
import type { Project } from "./model";

type Status = {
  supported: boolean;
  ready: boolean;
  activeJob?: string;
  model: string;
};
export function AlignmentPanel({
  project,
  onApply,
  onSeek,
  canUndo,
  onUndo,
}: {
  project: Project;
  onApply: (result: AlignmentResult) => void;
  onSeek: (time: number) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status | null>(null),
    [running, setRunning] = useState(false),
    [message, setMessage] = useState(""),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [candidate, setCandidate] = useState<{
      source: Project;
      result: AlignmentResult;
    } | null>(null),
    [applied, setApplied] = useState(false);
  const jobId = useRef<string | null>(null),
    alive = useRef(true);
  async function refresh() {
    try {
      const response = await fetch("/api/alignment/status");
      if (!response.ok) throw Error("无法连接本地模型服务");
      const value = await response.json();
      if (alive.current) {
        setStatus(value);
        setError("");
      }
    } catch (error) {
      if (alive.current) setError(String(error));
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(setup = false) {
    setError("");
    setMessage(setup ? "正在准备本地模型…" : "正在读取录音…");
    setProgress(0);
    setRunning(true);
    setCandidate(null);
    setApplied(false);
    const source = project;
    try {
      const response = await fetch(
        setup ? "/api/alignment/setup" : "/api/alignment",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: setup ? undefined : JSON.stringify({ ...project, music: null }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "无法创建任务");
      jobId.current = data.id;
      while (alive.current) {
        const response = await fetch(`/api/alignment/${data.id}`);
        const job = await response.json();
        if (!response.ok) throw Error(job.error || "无法读取任务");
        setMessage(job.message);
        setProgress(job.progress);
        if (job.status === "error") throw Error(job.error || "模型运行失败");
        if (job.status === "cancelled") {
          setMessage("已取消，现有时间未改变。");
          break;
        }
        if (job.status === "done") {
          if (job.result) {
            setCandidate({ source, result: job.result });
            setMessage("对齐完成。请试听建议，应用后仍可手动修改。");
          } else {
            setMessage("模型已准备完成，可以开始自动对齐。");
            await refresh();
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      jobId.current = null;
      if (alive.current) setRunning(false);
    }
  }
  const stale = candidate && !sameAlignmentInput(candidate.source, project);
  const locked = project.sentences.filter((s) => s.timingLocked).length;
  return (
    <section className="alignment-panel" aria-label={t("日语自动对齐")}>
      <div className="label-row">
        <h3>
          <WandSparkles size={16} />
          {t("日语自动对齐")}</h3>
        <span>
          <LockKeyhole size={12} />
          {t("已锁定")}{locked}/{project.sentences.length} {t("句")}</span>
      </div>
      <div className="alignment-actions">
        {status?.ready ? (
          <button
            className="primary"
            disabled={
              running ||
              !!status.activeJob ||
              !project.voice ||
              !project.sentences.length ||
              locked === project.sentences.length ||
              project.voice.duration > 300
            }
            onClick={() => void run()}
          >
            <WandSparkles size={15} />
            {t(running ? "正在对齐…" : "自动识别句子时间")}
          </button>
        ) : (
          <button
            disabled={running || !status?.supported || !!status.activeJob}
            className="primary"
            onClick={() => void run(true)}
          >
            {t("准备本地模型")}</button>
        )}
        {!running && status?.activeJob && (
          <button
            onClick={async () => {
              try {
                const response = await fetch(
                  `/api/alignment/${status.activeJob}/cancel`,
                  { method: "POST" },
                );
                if (!response.ok) throw Error("无法取消后台任务");
                setMessage("已请求取消后台任务，请稍后检查模型状态。");
                await refresh();
              } catch (error) {
                setError(String(error));
              }
            }}
          >
            {t("取消后台任务")}</button>
        )}
        {running && (
          <button
            onClick={async () => {
              if (jobId.current) {
                try {
                  const response = await fetch(
                    `/api/alignment/${jobId.current}/cancel`,
                    { method: "POST" },
                  );
                  if (!response.ok) setError("取消失败，请重试");
                } catch {
                  setError("无法连接本地服务，请重启后重试。");
                }
              }
            }}
          >
            {t("取消")}</button>
        )}
        <button
          disabled={!canUndo || running}
          onClick={() => {
            onUndo();
            setCandidate(null);
            setApplied(false);
            setMessage("已撤销自动对齐。");
          }}
        >
          <Undo2 size={14} />
          {t("撤销自动对齐")}</button>
        <button
          className="quiet"
          disabled={running}
          onClick={() => void refresh()}
        >
          {t("检查模型状态")}</button>
      </div>
      <p className="model-status">
        {t(status?.ready
          ? "本地模型已就绪"
          : status && !status.supported
            ? "自动对齐需要 Apple Silicon Mac 和 macOS 15+；手动编辑仍可使用。"
            : "首次准备需下载约 1.3 GB 模型；之后可离线运行。")}
      </p>
      {!project.voice && (
        <p className="hint">{t("先在「声音与配乐」中导入朗读人声。")}</p>
      )}
      {project.voice && project.voice.duration > 300 && (
        <p className="alignment-error">
          {t("录音超过 5 分钟，请分段后再自动对齐。手动编辑与导出不受此限制。")}</p>
      )}
      {running && (
        <progress max="1" value={progress} aria-label={t("自动对齐进度")} />
      )}
      {message && (
        <p className="alignment-message" role="status">
          {t(message)}
        </p>
      )}
      {error && (
        <p className="alignment-error" role="alert">
          {t(error)}
        </p>
      )}
      {candidate && !applied && (
        <>
          <div className="alignment-preview">
            <table>
              <thead>
                <tr>
                  <th>{t("句子")}</th>
                  <th>{t("现有时间")}</th>
                  <th>{t("模型建议")}</th>
                  <th>{t("复核")}</th>
                </tr>
              </thead>
              <tbody>
                {project.sentences.map((sentence, i) => {
                  const suggestion = candidate.result.sentences.find(
                    (s) => s.id === sentence.id,
                  );
                  return (
                    <tr key={sentence.id}>
                      <td>
                        {i + 1}. {sentence.text}
                      </td>
                      <td>
                        {sentence.start.toFixed(2)}–{sentence.end.toFixed(2)}
                      </td>
                      <td>
                        {t(sentence.timingLocked
                          ? "已锁定，保留"
                          : suggestion?.start !== undefined &&
                              suggestion?.end !== undefined
                            ? `${suggestion.start.toFixed(2)}–${suggestion.end.toFixed(2)}`
                            : "无法定位")}
                      </td>
                      <td>
                        {sentence.timingLocked ? (
                          "🔒"
                        ) : suggestion?.start !== undefined ? (
                          <button
                            title={t(suggestion.message || "跳到模型建议的开始时间")}
                            disabled={!!stale}
                            onClick={() => onSeek(suggestion.start!)}
                          >
                            {t(suggestion.status === "review" ? "需复核" : "定位")}
                          </button>
                        ) : (
                          t("需手动调整")
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {stale && (
            <p className="alignment-error">
              {t("录音、正文或时间已改变，请重新对齐。现有编辑已保留。")}</p>
          )}
          <button
            className="primary"
            disabled={!!stale || running}
            onClick={() => {
              try {
                onApply(candidate.result);
                setApplied(true);
                setMessage(
                  "已应用时间建议。手动修改起止时间会自动锁定该句，防止下次被覆盖。",
                );
              } catch (error) {
                setError(String(error));
              }
            }}
          >
            {t("应用时间建议")}</button>
        </>
      )}
    </section>
  );
}
