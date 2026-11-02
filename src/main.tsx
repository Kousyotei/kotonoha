import { I18nProvider, LanguageSelect, useI18n } from "./i18n";
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player, type PlayerRef } from "@remotion/player";
import {
  BookOpen,
  Upload,
  Download,
  Save,
  FolderOpen,
  Play,
  Pause,
  RotateCcw,
  Music2,
  Mic,
  ChevronRight,
  Scissors,
  Settings2,
} from "lucide-react";
import { Video } from "./Video";
import { Waveform } from "./Waveform";
import { AudioImport } from "./AudioImport";
import { VoiceEnhance } from "./VoiceEnhance";
import { useVoicePreview } from "./use-voice-preview";
import { usePlaybackPage } from "./use-playback-page";
import { useProjectPersistence } from "./use-project-persistence";
import { AlignmentPanel } from "./AlignmentPanel";
import { TranslationPanel } from "./TranslationPanel";
import { applyTranslations, canUndoTranslation, undoTranslations, type TranslationUndo } from "./translation";
import { BilingualControls } from "./BilingualControls";
import { isBilingual } from "./bilingual-layout";
import { switchLayout, fitBilingualPages } from "./layout-mode";
import { FuriganaPanel, type FuriganaSelection } from "./FuriganaPanel";
import {
  applyAlignment,
  captureTiming,
  restoreTiming,
  type TimingSnapshot,
} from "./alignment";
import {
  duration,
  activeSentenceAt,
  FPS,
  geometry,
  id,
  initialProject,
  paginate,
  parseProject,
  pageAt,
  rebuild,
  validate,
  type Project,
} from "./model";
import "./style.css";
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function App() {
  const { t } = useI18n();
  const [p, setP] = useState<Project>(initialProject),
    [draft, setDraft] = useState(p.text),
    [tab, setTab] = useState("text"),
    [selected, setSelected] = useState(0),
    [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(false),
    [message, setMessage] = useState(""),
    [job, setJob] = useState(""),
    [busy, setBusy] = useState(false);
  const player = useRef<PlayerRef>(null);
  const [furiganaSelection, setFuriganaSelection] =
    useState<FuriganaSelection>(null);
  const [timingUndo, setTimingUndo] = useState<TimingSnapshot | null>(null);
  const [translationUndo, setTranslationUndo] = useState<TranslationUndo | null>(null);
  const total = duration(p),
    time = frame / FPS;
  const activeSentence = activeSentenceAt(p, time);
  usePlaybackPage(p, frame, playing, selected, setSelected);
  const voicePreview = useVoicePreview(p.voice, p.voiceVolume);
  React.useEffect(() => { if (!voicePreview.ready) player.current?.pause(); }, [voicePreview.ready]);
  const errors = validate(p);
  const persistence = useProjectPersistence(p, draft, (workspace) => {
    setP(workspace.project);
    setDraft(workspace.draft);
    setSelected(0);
    setFrame(0);
    setTimingUndo(null);
    setTranslationUndo(null);
    setFuriganaSelection(null);
  });
  function change(next: Project) {
    next = fitBilingualPages(next);
    setTimingUndo(null);
    setP(next);
    setSelected((i) => Math.min(i, Math.max(0, next.pages.length - 1)));
  }
  function seek(t: number) {
    const target = Math.min(Math.ceil(total * FPS) - 1, Math.max(0, Math.round(t * FPS)));
    setSelected(pageAt(p, target / FPS));
    player.current?.seekTo(target);
  }
  function updateSentence(
    index: number,
    patch: Partial<Project["sentences"][number]>,
  ) {
    change({
      ...p,
      sentences: p.sentences.map((s, i) =>
        i === index
          ? {
              ...s,
              ...patch,
              ...(patch.start !== undefined || patch.end !== undefined
                ? {
                    timingLocked: true,
                    timingSource: "manual" as const,
                    alignmentNote: undefined,
                  }
                : {}),
            }
          : s,
      ),
    });
  }
  async function fileAction(
    e: React.ChangeEvent<HTMLInputElement>,
    fn: (f: File) => Promise<void>,
  ) {
    const element = e.currentTarget;
    const file = element.files?.[0];
    if (!file) return;
    try {
      await fn(file);
      setMessage("");
    } catch (err) {
      setMessage(String(err));
    }
    element.value = "";
  }
  function exportBackup() {
    download(
      new Blob([JSON.stringify(p)], { type: "application/json" }),
      `${p.title || t("朗读项目")}.kotonoha.json`,
    );
    setMessage("已导出项目备份。点击「保存」可将当前编辑和音频保存在本机，刷新后自动恢复。");
  }
  async function exportVideo() {
    if (errors.length) {
      setMessage(errors[0]);
      return;
    }
    setBusy(true);
    setMessage("");
    setJob("准备导出…");
    try {
      const r = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 1000));
        const progressResponse = await fetch(`/api/render/${data.id}`);
        const status = await progressResponse.json();
        if (!progressResponse.ok)
          throw Error(status.error || "无法读取导出进度");
        if (status.error) throw Error(status.error);
        setJob(
          status.status === "done"
            ? "导出完成"
            : `正在导出 ${Math.round(status.progress * 100)}%`,
        );
        if (status.status === "done") {
          const check = await fetch(`/api/render/${data.id}/video`, {
            method: "HEAD",
          });
          if (
            !check.ok ||
            !check.headers.get("content-type")?.startsWith("video/")
          )
            throw Error("视频生成后无法下载，请检查本地导出服务");
          done = true;
          const a = document.createElement("a");
          a.href = `/api/render/${data.id}/video`;
          a.download = `${p.title}.mp4`;
          a.click();
        }
      }
    } catch (e) {
      setMessage(`导出失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  function moveBoundary(pageIndex: number, direction: "earlier" | "later") {
    const pages = p.pages.map((page) => ({
      ...page,
      sentenceIds: [...page.sentenceIds],
    }));
    const left = pages[pageIndex],
      right = pages[pageIndex + 1];
    if (direction === "earlier" && left.sentenceIds.length > 1)
      right.sentenceIds.unshift(left.sentenceIds.pop()!);
    if (direction === "later" && right.sentenceIds.length > 1)
      left.sentenceIds.push(right.sentenceIds.shift()!);
    right.start = p.sentences.find((s) => s.id === right.sentenceIds[0])!.start;
    change({ ...p, pages });
  }
  if (persistence.loading)
    return <div className="restore-screen" role="status">{t("正在读取本机项目和音频…")}</div>;
  return (
    <>
      <header>
        <div className="brand">
          <span className="brand-icon">葉</span>
          <div>
            言の葉 <small>KOTONOHA STUDIO</small>
          </div>
        </div>
        <span className="project-name">
          {p.title}
          <span className="save-state" role="status">{t(persistence.status)}</span>
        </span>
        <div className="header-actions">
          <LanguageSelect />
          <label className="button quiet">
            <FolderOpen size={16} />
            {t("打开项目文件")}<input
              type="file"
              accept=".json"
              onChange={(e) =>
                fileAction(e, async (f) => {
                  const next = parseProject(JSON.parse(await f.text()));
                  change(next);
                  setDraft(next.text);
                  setSelected(0);
                  seek(0);
                })
              }
            />
          </label>
          <button className="quiet" disabled={persistence.saving} onClick={() => void persistence.save()}
            title={t("保存在本机，包含正文草稿、音频和设置；刷新后自动恢复（⌘S / Ctrl+S）")}>
            <Save size={16} />
            {t(persistence.saving ? "保存中…" : "保存")}
          </button>
          <button className="quiet" onClick={exportBackup} title={t("下载包含音频的项目文件，用于备份或搬到其他电脑")}>
            <Download size={16} />
            {t("导出项目备份")}</button>
          <button className="primary" disabled={busy || !voicePreview.ready} onClick={exportVideo}>
            <Download size={16} />
            {t(busy ? "导出中…" : "导出 MP4")}
          </button>
        </div>
      </header>
      {persistence.error && <div className="storage-error" role="alert">{t(persistence.error)}</div>}
      <div className="workspace">
        <aside>
          <div className="sidebar-heading">
            <span>{t("创作工作台")}</span>
            <small>01 — EDITOR</small>
          </div>
          <nav>
            <button
              className={tab === "text" ? "active" : ""}
              onClick={() => setTab("text")}
            >
              <BookOpen size={17} />
              {t("文章与分页")}</button>
            <button
              className={tab === "style" ? "active" : ""}
              onClick={() => setTab("style")}
            >
              <Settings2 size={17} />
              {t("画面排版")}</button>
            <button
              className={tab === "audio" ? "active" : ""}
              onClick={() => setTab("audio")}
            >
              <Music2 size={17} />
              {t("声音与配乐")}</button>
          </nav>
          <div className="panel-scroll">
            {tab === "text" && (
              <>
                <div className="section-title">
                  <h2>{t("让文字，慢慢被听见。")}</h2>
                </div>
                <label className="field">
                  {t("作品标题")}<input
                    value={p.title}
                    onChange={(e) => change({ ...p, title: e.target.value })}
                  />
                </label>
                <div className="label-row">
                  <label>{t("日语正文")}</label>
                  <label className="import-text">
                    <Upload size={13} />
                    {t("导入 TXT")}<input
                      type="file"
                      accept=".txt,text/plain"
                      onChange={(e) =>
                        fileAction(e, async (f) => setDraft(await f.text()))
                      }
                    />
                  </label>
                </div>
                <textarea
                  className="article"
                  lang="ja"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                />
                <div className="hint">
                  {Array.from(draft).length} {t("字")}</div>
                <button
                  className="wide primary"
                  onClick={() => {
                    change(rebuild(draft, p));
                    setSelected(0);
                    seek(0);
                    setMessage("已生成分页和估算时间；请根据录音校准。");
                  }}
                >
                  <RotateCcw size={15} />
                  {t("应用正文并重新分页")}</button>

                <div className="divider" />
                <div className="label-row">
                  <h3>{t("页面编排")}</h3>
                  <span>{p.pages.length} {t("页")}</span>
                </div>

                <div className="page-list">
                  {p.pages.map((page, i) => (
                    <React.Fragment key={page.id}>
                      <button
                        className={`page-card ${selected === i ? "selected" : ""}`}
                        onClick={() => {
                          setSelected(i);
                          seek(page.start);
                        }}
                      >
                        <span className="page-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <strong>
                            {p.sentences
                              .find((s) => s.id === page.sentenceIds[0])
                              ?.text.slice(0, 17)}
                          </strong>
                          <small>
                            {page.sentenceIds.length} {t("句 ·")}{" "}
                            {page.start.toFixed(1)} s
                          </small>
                        </div>
                        <ChevronRight size={16} />
                      </button>
                      <label className="page-switch">
                        {t("切换时间 / s")}<input
                          aria-label={t(`第${i + 1}页切换时间`)}
                          type="number"
                          min="0"
                          step=".01"
                          disabled={i === 0}
                          value={page.start}
                          onChange={(e) =>
                            change({
                              ...p,
                              pages: p.pages.map((x, j) =>
                                j === i
                                  ? { ...x, start: Number(e.target.value) }
                                  : x,
                              ),
                            })
                          }
                        />
                      </label>
                      {i < p.pages.length - 1 && (
                        <div className="boundary">
                          <button onClick={() => moveBoundary(i, "earlier")}>
                            {t("↑ 提前一条分页")}</button>
                          <button onClick={() => moveBoundary(i, "later")}>
                            {t("↓ 延后一条分页")}</button>
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
                <button
                  className="wide"
                  onClick={() =>
                    change({ ...p, pages: paginate(p.sentences, p.style) })
                  }
                >
                  <Scissors size={15} />
                  {t("按当前字号自动分页")}</button>
              </>
            )}
            {tab === "style" && (
              <>
                <div className="section-title">
                  <h2>{t("留白之间，自有声音。")}</h2>
                </div>
                <label className="field">
                  {t("布局模式")}<select
                    aria-label={t("布局模式")}
                    value={p.style.layoutMode || "vertical"}
                    onChange={(e) =>
                      change(
                        switchLayout(
                          p,
                          e.target.value as "vertical" | "bilingual",
                        ),
                      )
                    }
                  >
                    <option value="vertical">{t("日语文学竖排")}</option>
                    <option value="bilingual">{t("日中双语横排")}</option>
                  </select>
                </label>
                <label className="field">
                  {t("日文字体")}<select
                    value={p.style.fontFamily}
                    onChange={(e) =>
                      change({
                        ...p,
                        style: { ...p.style, fontFamily: e.target.value },
                      })
                    }
                  >
                    <option
                      value={'"Yu Mincho", "Hiragino Mincho ProN", serif'}
                    >
                      {t("游明朝 · 文学")}</option>
                    <option value={'"Hiragino Sans", sans-serif'}>
                      {t("冬青黑体 · 简洁")}</option>
                  </select>
                </label>
                {(
                  [
                    ["background", "纸张颜色"],
                    ["ink", "正文颜色"],
                    ["highlight", "高亮颜色"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="color-field" key={key}>
                    {t(label)}
                    <input
                      type="color"
                      value={p.style[key]}
                      onChange={(e) =>
                        change({
                          ...p,
                          style: { ...p.style, [key]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
                {isBilingual(p.style) ? (
                  <BilingualControls project={p} onChange={change} />
                ) : (
                  <>
                    {(
                      [
                        ["fontSize", "字号", 24, 96, 1],
                        ["lineHeight", "列间距", 1, 3, 0.1],
                      ] as const
                    ).map(([key, label, min, max, step]) => (
                      <label className="field" key={key}>
                        {t(label)}
                        <span className="value">{p.style[key]}</span>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          value={p.style[key]}
                          onChange={(e) =>
                            change({
                              ...p,
                              style: {
                                ...p.style,
                                [key]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    ))}

                  </>
                )}
                <button
                  className="wide"
                  onClick={() =>
                    change({ ...p, pages: paginate(p.sentences, p.style) })
                  }
                >
                  {t("重新自动分页")}</button>
                <div className="divider" />
                {(
                  [
                    ["showTranslation", "显示中文翻译"],
                    ["showNotes", "显示语法注释"],
                  ] as const
                ).map(([key, label]) =>
                  key === "showTranslation" && isBilingual(p.style) ? null : (
                    <label className="checkbox" key={key}>
                      <input
                        type="checkbox"
                        checked={p.style[key]}
                        onChange={(e) =>
                          change({
                            ...p,
                            style: { ...p.style, [key]: e.target.checked },
                          })
                        }
                      />
                      {t(label)}
                    </label>
                  ),
                )}

              </>
            )}
            {tab === "audio" && (
              <>
                <div className="section-title">
                  <h2>{t("把声音交给时间。")}</h2>
                </div>
                {(["voice", "music"] as const).map((key) => (
                  <div className="audio-card" key={key}>
                    <h3>
                      {key === "voice" ? (
                        <Mic size={17} />
                      ) : (
                        <Music2 size={17} />
                      )}{" "}
                      {t(key === "voice" ? "朗读人声" : "背景音乐")}
                    </h3>
                    <p>{p[key]?.name || t("尚未添加音频")}</p>
                    <AudioImport
                      existing={p[key]}
                      previewSrc={key === "voice" ? voicePreview.media?.src ?? null : p.music?.src}
                      previewVolume={key === "voice" ? voicePreview.volume : p.musicVolume}
                      label={key === "voice" ? "朗读人声" : "背景音乐"}
                      onImport={(media) => {
                        setTimingUndo(null);
                        setP((current) => ({ ...current, [key]: media }));
                      }}
                    />
                    <label className="field">
                      {t(key === "voice" ? "人声增益" : "音量")}{" "}
                      {Math.round(
                        p[key === "voice" ? "voiceVolume" : "musicVolume"] *
                          100,
                      )}
                      %
                      <input
                        type="range"
                        min="0"
                        max={key === "voice" ? "4" : "1"}
                        aria-label={t(key === "voice" ? "人声增益" : "背景音乐音量")}
                        step=".01"
                        value={
                          p[key === "voice" ? "voiceVolume" : "musicVolume"]
                        }
                        onChange={(e) =>
                          change({
                            ...p,
                            [key === "voice" ? "voiceVolume" : "musicVolume"]:
                              Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    {key === "voice" && <VoiceEnhance voice={p.voice} gain={p.voiceVolume}
                      onGain={gain => setP(current => ({ ...current, voiceVolume: gain }))}
                      processing={voicePreview.processing} error={voicePreview.error} onRetry={voicePreview.retry} />}
                    {p[key] && (
                      <button
                        className="text-button"
                        onClick={() => change({ ...p, [key]: null })}
                      >
                        {t("移除音频")}</button>
                    )}
                  </div>
                ))}

              </>
            )}
          </div>
          <div className="sidebar-footer">
            <span className="status-dot" />
            {t("本地工作空间")}<span>1920 × 1080 · 30 FPS</span>
          </div>
        </aside>
        <main>
          <div className="preview-heading">
            <div>
              <span className="eyebrow">THE READING ROOM</span>
              <h1>{t("把一页文字，读成一段时光。")}</h1>
            </div>
            <span className="format-chip">
              16:9 <span>FULL HD</span>
            </span>
          </div>
          <div className="preview-shell">
            <Player
              ref={player}
              component={Video}
              inputProps={{
                project: { ...p, voice: voicePreview.media, voiceVolume: voicePreview.volume },
                onFuriganaClick: (sentenceId: string, key: string) => {
                  player.current?.pause();
                  setFuriganaSelection({ sentenceId, key });
                },
              }}
              durationInFrames={Math.ceil(total * FPS)}
              fps={FPS}
              compositionWidth={1920}
              compositionHeight={1080}
              style={{ width: "100%" }}
              controls={false}
              clickToPlay={voicePreview.ready}
            />
          </div>
          {(voicePreview.processing || voicePreview.error) && <p className={voicePreview.error ? "audio-import-error" : "audio-import-status"} role="status">
            {t(voicePreview.error || "正在准备增强人声，完成后可播放和导出…")}
          </p>}
          <PlayerEvents
            player={player}
            setFrame={setFrame}
            setPlaying={setPlaying}
          />
          <div className="transport">
            <span className="preview-label">
              <span className="status-dot" />
              {t("实时预览")}</span>
            <div>
              <button
                className="play"
                aria-label={t(playing ? "暂停" : "播放")}
                disabled={!voicePreview.ready}
                onClick={() => player.current?.toggle()}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <span className="time">
                {time.toFixed(1)} <span>/ {total.toFixed(1)} s</span>
              </span>
            </div>
            <button className="quiet" onClick={() => seek(0)}>
              <RotateCcw size={14} />
              {t("回到开头")}</button>
          </div>
          <FuriganaPanel
            project={p}
            onChange={change}
            selection={furiganaSelection}
            onSelect={setFuriganaSelection}
          />
          <section className="timeline">
            <div className="label-row">
              <h3>
                {t("声音时间轴")}<small>AUDIO TIMELINE</small>
              </h3>
              <span>{t("点击波形定位")}</span>
            </div>
            <div className="ruler">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i}>{((total * i) / 6).toFixed(1)}s</span>
              ))}
            </div>
            <Waveform
              src={p.voice?.src}
              duration={total}
              current={time}
              onSeek={seek}
            />
            <input
              className="seek-slider"
              aria-label={t("视频播放位置")}
              type="range"
              min="0"
              max={total}
              step={1 / FPS}
              value={Math.min(time, total)}
              onChange={(e) => seek(Number(e.target.value))}
            />
            <div className="page-track">
              {p.pages.map((page, i) => {
                const next = p.pages[i + 1];
                const end = next ? next.start : total;
                const start = page.start;
                return (
                  <button
                    key={page.id}
                    style={{
                      left: `${(start / total) * 100}%`,
                      width: `${(Math.max(0, end - start) / total) * 100}%`,
                    }}
                    onClick={() => {
                      setSelected(i);
                      seek(start);
                    }}
                  >
                    PAGE {String(i + 1).padStart(2, "0")}
                  </button>
                );
              })}
            </div>
          </section>
          <TranslationPanel
            project={p}
            canUndo={canUndoTranslation(p, translationUndo)}
            onApply={(result, selectedIds) => {
              const applied = applyTranslations(p, result, selectedIds);
              change(applied.project);
              setTranslationUndo(applied.undo);
            }}
            onUndo={() => {
              if (translationUndo) { change(undoTranslations(p, translationUndo)); setTranslationUndo(null); }
            }}
          />
          <AlignmentPanel
            project={p}
            onSeek={seek}
            canUndo={!!timingUndo}
            onApply={(result) => {
              const before = captureTiming(p);
              const next = applyAlignment(p, result);
              change(next);
              setTimingUndo(before);
            }}
            onUndo={() => {
              if (timingUndo) {
                const previous = restoreTiming(p, timingUndo);
                change(previous);
              }
            }}
          />
          <section className="sentences">
            <div className="label-row">
              <h3>
                {t("逐句同步")}<small>SENTENCE SYNC</small>
              </h3>
              <span>{t("第{n}页 · 时间单位为秒", { n: selected + 1 })}</span>
            </div>
            <div className="sentence-head">
              <span>{t("句子 / 翻译 / 注释")}</span>
              <span>{t("开始 → 结束")}</span>
            </div>
            {p.sentences.map(
              (s, i) =>
                p.pages[selected]?.sentenceIds.includes(s.id) && (
                  <div
                    className={`sentence-row ${activeSentence?.id === s.id ? "current" : ""}`}
                    key={s.id}
                  >
                    <div className="sentence-index">
                      <button
                        onClick={() => seek(s.start)}
                        aria-label={t(`定位第${i + 1}句`)}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </button>
                    </div>
                    <div className="sentence-content">
                      <div className="sentence-jp" lang="ja">{s.text}</div>
                      {isBilingual(p.style) ? (
                        <textarea
                          className="sentence-translation"
                          lang="zh-CN"
                          rows={2}
                          aria-label={t(`第${i + 1}句中文翻译`)}
                          placeholder={t("添加这句话的中文翻译…")}
                          value={s.translation}
                          onChange={(e) =>
                            updateSentence(i, { translation: e.target.value })
                          }
                        />
                      ) : (
                        <input
                          placeholder={t("添加中文翻译…")}
                          lang="zh-CN"
                          value={s.translation}
                          onChange={(e) =>
                            updateSentence(i, { translation: e.target.value })
                          }
                        />
                      )}
                      <input
                        placeholder={t("添加语法注释…")}
                        value={s.note}
                        onChange={(e) =>
                          updateSentence(i, { note: e.target.value })
                        }
                      />
                      <button
                        className="text-button"
                        onClick={() => {
                          const pages = p.pages.flatMap((page) => {
                            const pos = page.sentenceIds.indexOf(s.id);
                            return pos > 0
                              ? [
                                  {
                                    ...page,
                                    sentenceIds: page.sentenceIds.slice(0, pos),
                                  },
                                  {
                                    id: id(),
                                    start: s.start,
                                    sentenceIds: page.sentenceIds.slice(pos),
                                  },
                                ]
                              : [page];
                          });
                          change({ ...p, pages });
                        }}
                      >
                        {t("从此句开始新页")}</button>
                    </div>
                    <div className="sentence-time">
                      <label className="timing-lock">
                        <input
                          type="checkbox"
                          aria-label={t(`锁定第${i + 1}句时间`)}
                          checked={!!s.timingLocked}
                          onChange={(event) =>
                            updateSentence(i, {
                              timingLocked: event.target.checked,
                            })
                          }
                        />
                        {t("锁定时间")}</label>
                      {s.timingSource && (
                        <span className="timing-source">
                          {t(s.timingSource === "auto"
                            ? "模型建议"
                            : s.timingSource === "manual"
                              ? "人工调整"
                              : "估算时间")}
                        </span>
                      )}
                      {s.alignmentNote && (
                        <p className="alignment-error">{t(s.alignmentNote)}</p>
                      )}
                      <div>
                        <input
                          aria-label={t(`第${i + 1}句开始`)}
                          type="number"
                          min="0"
                          step=".01"
                          value={s.start}
                          onChange={(e) =>
                            updateSentence(i, { start: Number(e.target.value) })
                          }
                        />
                        <span>→</span>
                        <input
                          aria-label={t(`第${i + 1}句结束`)}
                          type="number"
                          min="0"
                          step=".01"
                          value={s.end}
                          onChange={(e) =>
                            updateSentence(i, { end: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div>
                        <button
                          onClick={() =>
                            updateSentence(i, {
                              start: Math.round(time * 100) / 100,
                            })
                          }
                        >
                          {t("当前为起点")}</button>
                        <button
                          onClick={() =>
                            updateSentence(i, {
                              end: Math.round(time * 100) / 100,
                            })
                          }
                        >
                          {t("当前为终点")}</button>
                      </div>
                    </div>
                  </div>
                ),
            )}
          </section>
          {(message || job || errors.length > 0) && (
            <div
              className={`notice ${errors.length ? "error" : ""}`}
              role="status"
            >
              {errors.length ? errors.map(error => t(error)).join(" ") : t(message || job)}
              {message && <button onClick={() => setMessage("")}>×</button>}
            </div>
          )}
          <footer>
            {t("言の葉 · 让每一句，都有被听见的时刻。")}
            <details className="license-disclosure">
              <summary>{t("许可")}</summary>
              <div><a href="https://www.edrdg.org/jmdict/j_jmdict.html" target="_blank" rel="noreferrer">JMdict © EDRDG</a>
                {" · "}<a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">CC BY-SA 4.0</a></div>
            </details>
          </footer>
        </main>
      </div>
    </>
  );
}
function PlayerEvents({
  player,
  setFrame,
  setPlaying,
}: {
  player: React.RefObject<PlayerRef | null>;
  setFrame: (n: number) => void;
  setPlaying: (v: boolean) => void;
}) {
  React.useEffect(() => {
    const p = player.current;
    if (!p) return;
    const frame = ({ detail }: { detail: { frame: number } }) =>
      setFrame(detail.frame);
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    p.addEventListener("frameupdate", frame);
    p.addEventListener("play", play);
    p.addEventListener("pause", pause);
    p.addEventListener("ended", pause);
    return () => {
      p.removeEventListener("frameupdate", frame);
      p.removeEventListener("play", play);
      p.removeEventListener("pause", pause);
      p.removeEventListener("ended", pause);
    };
  }, [player, setFrame, setPlaying]);
  return null;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><App /></I18nProvider>);
