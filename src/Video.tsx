import React from "react";
import { RubyText, type FuriganaClick } from "./RubyText";
import { BilingualText } from "./BilingualText";
import { isBilingual } from "./bilingual-layout";
import { AbsoluteFill, Audio, useCurrentFrame } from "remotion";
import {
  FPS,
  geometry,
  layout,
  pageAt,
  activeSentenceAt,
  type Project,
} from "./model";
export function Video({
  project: p,
  onFuriganaClick,
}: {
  project: Project;
  onFuriganaClick?: FuriganaClick;
}) {
  const time = useCurrentFrame() / FPS;
  const index = pageAt(p, time);
  const page = p.pages[index];
  const sentences =
    page?.sentenceIds
      .map((id) => p.sentences.find((s) => s.id === id)!)
      .filter(Boolean) || [];
  const active = activeSentenceAt(p, time);
  const { rows, columnPitch } = geometry(p.style);
  const chars = layout(sentences, p.style).map((c) => ({
    ...c,
    active: active?.id === c.sentenceId,
  }));
  return (
    <AbsoluteFill
      style={{
        background: p.style.background,
        color: p.style.ink,
        fontFamily: p.style.fontFamily,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 64,
          fontFamily: "sans-serif",
          fontSize: 19,
          letterSpacing: 5,
          opacity: 0.55,
        }}
      >
        {p.title}
      </div>
      {isBilingual(p.style) ? (
        <BilingualText
          sentences={sentences}
          project={p}
          activeId={active?.id}
          onFuriganaClick={onFuriganaClick}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            right: 140,
            top: 150,
            height: 740,
            display: "grid",
            gridAutoFlow: "column",
            gridTemplateRows: `repeat(${rows}, ${p.style.fontSize}px)`,
            gridAutoColumns: columnPitch,
            direction: "rtl",
            fontSize: p.style.fontSize,
          }}
        >
          {p.style.showFurigana ? (
            <RubyText
              sentences={sentences}
              project={p}
              activeId={active?.id}
              onFuriganaClick={onFuriganaClick}
            />
          ) : (
            chars.map((c) => (
              <span
                key={c.key}
                style={{
                  width: p.style.fontSize * p.style.lineHeight,
                  height: p.style.fontSize,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  color: c.active ? p.style.highlight : p.style.ink,
                  writingMode: "vertical-rl",
                  textOrientation: "mixed",
                }}
              >
                {c.char}
              </span>
            ))
          )}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: 140,
          right: 140,
          bottom: 80,
          textAlign: "center",
          fontFamily: '"PingFang SC", sans-serif',
          fontSize: 27,
          lineHeight: 1.6,
        }}
      >
        {!isBilingual(p.style) && p.style.showTranslation && (
          <div>{active?.translation}</div>
        )}
        {p.style.showNotes && (
          <div style={{ fontSize: 21, opacity: 0.6 }}>{active?.note}</div>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 36,
          left: 120,
          right: 120,
          borderTop: "1px solid currentColor",
          opacity: 0.3,
          paddingTop: 16,
          fontFamily: "sans-serif",
          fontSize: 17,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>言の葉　/　朗読</span>
        <span>
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(p.pages.length).padStart(2, "0")}
        </span>
      </div>
      {p.voice && <Audio src={p.voice.src} volume={p.voiceVolume} />}
      {p.music && <Audio src={p.music.src} volume={p.musicVolume} loop />}
    </AbsoluteFill>
  );
}
