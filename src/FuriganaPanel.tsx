import { useI18n } from "./i18n";
import React, { useRef, useState } from "react";
import type { Project } from "./model";
import {
  confirmReading,
  mergeFurigana,
  readingLabel,
  type FuriganaRecord,
} from "./furigana";
import { fitFuriganaPages } from "./furigana-pages";
export type FuriganaSelection = { sentenceId: string; key: string } | null;
const signature = (p: Project) =>
  JSON.stringify(p.sentences.map((s) => [s.id, s.text]));
export function FuriganaPanel({
  project,
  onChange,
  selection,
  onSelect,
}: {
  project: Project;
  onChange: (p: Project) => void;
  selection: FuriganaSelection;
  onSelect: (selection: FuriganaSelection) => void;
}) {
  const { t } = useI18n();
  const current = useRef(project);
  current.current = project;
  const [busy, setBusy] = useState(false),
    [updating, setUpdating] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const tokens = project.sentences.flatMap((s) =>
      (s.furigana?.tokens || []).map((t) => ({ ...t, sentenceId: s.id })),
    ),
    counts = { dictionary: 0, inferred: 0, manual: 0 };
  tokens.forEach((t) => counts[t.status]++);
  async function generate() {
    const source = signature(current.current),
      sentences = current.current.sentences.map(({ id, text }) => ({
        id,
        text,
      }));
    setBusy(true);
    setError("");
    setMessage(
      "正在按整句分析并核对本地 JMdict；首次使用需下载约 11 MB 词典。",
    );
    try {
      const response = await fetch("/api/furigana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentences }),
        signal: AbortSignal.timeout(180000),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "注音生成失败");
      if (source !== signature(current.current))
        throw Error("生成期间原文已改变，结果未应用，请重新生成。");
      if (
        !Array.isArray(data.sentences) ||
        data.sentences.length !== sentences.length
      )
        throw Error("服务器返回的句子数量不一致，未应用结果。");
      const results = new Map<string, FuriganaRecord>(
        data.sentences.map((s: { id: string; furigana: FuriganaRecord }) => [
          s.id,
          s.furigana,
        ]),
      );
      const latest = current.current,
        first = !latest.sentences.some((s) => s.furigana);
      const next = fitFuriganaPages({
        ...latest,
        style: {
          ...latest.style,
          showFurigana: first ? true : latest.style.showFurigana,
        },
        sentences: latest.sentences.map((s) => {
          const result = results.get(s.id);
          if (!result) throw Error("注音与句子不一致，未应用结果。");
          return {
            ...s,
            furigana: mergeFurigana(s, result, latest.furiganaCorrections),
          };
        }),
      });
      onChange(next);
      setMessage(
        `已生成，JMdict ${data.dictionaryDate}。人工修正已保留${next.pages.length > latest.pages.length ? "；部分页面因注音空间增加已自动拆页" : ""}。`,
      );
    } catch (e) {
      setMessage("");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function update() {
    setUpdating(true);
    setError("");
    setMessage("正在更新本地 JMdict 词典…");
    try {
      const response = await fetch("/api/furigana/dictionary/update", {
        method: "POST",
        signal: AbortSignal.timeout(180000),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "更新失败");
      setMessage(
        `本地 JMdict 已更新至 ${data.date}，点击重新生成可使用新词典。`,
      );
    } catch (e) {
      setMessage("");
      setError(String(e));
    } finally {
      setUpdating(false);
    }
  }
  const selectedSentence = project.sentences.find(
      (s) => s.id === selection?.sentenceId,
    ),
    selectedToken = selectedSentence?.furigana?.tokens.find(
      (t) => t.key === selection?.key,
    );
  return (
    <section className="furigana-panel" aria-label={t("平假名注音")}>
      <div className="label-row">
        <h3 title={t("点击词语可修改")}>
          {t("平假名注音")}
        </h3>
        <label className="furigana-toggle">
          <input
            type="checkbox"
            checked={!!project.style.showFurigana}
            onChange={(e) =>
              onChange(
                fitFuriganaPages({
                  ...project,
                  style: { ...project.style, showFurigana: e.target.checked },
                }),
              )
            }
          />
          {t("显示注音")}</label>
      </div>
      <div className="furigana-actions">
        <button
          className="primary"
          disabled={busy || updating || !project.sentences.length}
          onClick={generate}
        >
          {t(busy ? "正在生成…" : tokens.length ? "重新生成注音" : "自动生成注音")}
        </button>
        <button disabled={busy || updating} onClick={update}>
          {t(updating ? "词典更新中…" : "更新本地词典")}
        </button>
      </div>
      {!!tokens.length && (
        <div className="furigana-legend">
          <span className="reading-state dictionary">
            {t("词典确认")}{counts.dictionary}
          </span>
          <span className="reading-state inferred">
            {t("自动推断")}{counts.inferred}
          </span>
          <span className="reading-state manual">{t("人工确认")}{counts.manual}</span>
          <span className="reading-state review">
            {t("需要人工确认")}{tokens.filter((t) => t.needsReview).length}
          </span>
        </div>
      )}
      {message && (
        <p className="alignment-message" role="status">
          {t(message)}
        </p>
      )}
      {error && (
        <p className="alignment-error" role="alert">
          {t(error)}</p>
      )}
      {selectedSentence && selectedToken && (
        <ReadingEditor
          key={`${selectedSentence.id}:${selectedToken.key}`}
          project={project}
          sentenceId={selectedSentence.id}
          tokenKey={selectedToken.key}
          onClose={() => onSelect(null)}
          onChange={onChange}
        />
      )}
    </section>
  );
}
function ReadingEditor({
  project,
  sentenceId,
  tokenKey,
  onClose,
  onChange,
}: {
  project: Project;
  sentenceId: string;
  tokenKey: string;
  onClose: () => void;
  onChange: (p: Project) => void;
}) {
  const { t } = useI18n();
  const sentence = project.sentences.find((s) => s.id === sentenceId)!,
    token = sentence.furigana!.tokens.find((t) => t.key === tokenKey)!;
  const [reading, setReading] = useState(token.reading),
    [error, setError] = useState("");
  const corrections = (project.furiganaCorrections || []).filter(
    (h) =>
      h.sentenceId === sentenceId &&
      h.sentenceText === sentence.text &&
      h.start === token.start &&
      h.end === token.end,
  );
  return (
    <div
      className="reading-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="reading-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t(`修改「${token.surface}」注音`)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="label-row">
          <h3>{t(`修改「${token.surface}」注音`)}</h3>
          <button onClick={onClose} aria-label={t("关闭注音编辑")}>
            {t("关闭")}</button>
        </div>
        <p className="reading-context" lang="ja">
          {sentence.text}
        </p>
        <p>
          <span className={`reading-state ${token.status}`}>
            {t(readingLabel(token.status))}
          </span>{" "}
          {token.needsReview && (
            <span className="reading-state review">{t("需要人工确认")}</span>
          )}
        </p>
        <p className="reading-reason">{t(token.reason)}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              onChange(
                fitFuriganaPages(
                  confirmReading(project, sentenceId, tokenKey, reading),
                ),
              );
              onClose();
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <label className="field">
            {t("平假名读音")}<input
              autoFocus
              aria-label={t("平假名读音")}
              lang="ja"
              value={reading}
              maxLength={64}
              onChange={(e) => {
                setReading(e.target.value);
                setError("");
              }}
              placeholder={t("输入平假名，例如：こころ")}
            />
          </label>
          {!!token.candidates.length && (
            <div className="reading-candidates">
              <p>{t("候选读音")}</p>
              {token.candidates.map((r) => (
                <button type="button" key={r} onClick={() => setReading(r)}>
                  {r}
                </button>
              ))}
            </div>
          )}
          {!!token.referenceForms?.length && (
            <div className="reading-candidates">
              <p>{t("近似词形参考")}</p>
              {token.referenceForms.map((form) => (
                <div key={form.surface}>
                  <span>{form.surface}：</span>
                  {form.readings.map((r) => (
                    <button type="button" key={r} onClick={() => setReading(r)}>
                      {r}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {token.lemma !== token.surface && !!token.lemmaReadings.length && (
            <p className="hint">
              {t("基本形「")}{token.lemma}」：{token.lemmaReadings.join(" / ")}
              {t("。基本形读音不能直接当作活用词的完整读音。")}</p>
          )}
          {error && (
            <p className="alignment-error" role="alert">
              {t(error)}
            </p>
          )}
          <button type="submit" className="primary">
            {t("保存并人工确认")}</button>
        </form>
        {!!corrections.length && (
          <details>
            <summary>{t("人工修正记录（{n}）", { n: corrections.length })}</summary>
            {corrections.map((h) => (
              <p className="hint" key={h.id}>
                {new Date(h.confirmedAt).toLocaleString()}：
                {t(h.before || "未注音")} → {h.reading}
              </p>
            ))}
          </details>
        )}
        <p className="hint">
          {token.source} · JMdict {sentence.furigana!.dictionaryDate}
          {t(token.entryIds.length ? ` · 条目 ${token.entryIds.join(", ")}` : "")}
        </p>
      </div>
    </div>
  );
}
