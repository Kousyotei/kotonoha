import React from "react";
import type { Project, Sentence } from "./model";
import type { FuriganaClick } from "./RubyText";
import {
  BILINGUAL_BOX,
  bilingualGeometry,
  bilingualLayout,
  isWesternGlyph,
  type ParagraphLayout,
} from "./bilingual-layout";
function Paragraph({
  layout,
  fontSize,
  rubyScale,
  offset,
  width,
  chinese,
  sentenceId,
  onFuriganaClick,
}: {
  layout: ParagraphLayout;
  fontSize: number;
  rubyScale: number;
  offset: number;
  width: number;
  chinese?: boolean;
  sentenceId: string;
  onFuriganaClick?: FuriganaClick;
}) {
  return (
    <div
      style={{ position: "absolute", inset: 0, width }}
      lang={chinese ? "zh-CN" : "ja"}
    >
      {layout.lines.map((line, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: offset + line.top,
            left: 0,
            width,
            height: line.height,
            fontSize,
            lineHeight: `${line.height}px`,
            whiteSpace: "nowrap",
          }}
        >
          {line.runs.map((run) => (
            <span
              key={run.key}
              style={{
                display: "inline-block",
                verticalAlign: "baseline",
                width: run.width,
                fontSize,
                height: line.height,
                lineHeight: `${line.height}px`,
                textAlign: "center",
                whiteSpace: "pre",
                fontFamily: isWesternGlyph(run.text)
                  ? '"SFMono-Regular", Menlo, monospace'
                  : undefined,
                fontVariantLigatures: "none",
                fontFeatureSettings: '"palt" 0, "pkna" 0',
                cursor: run.tokenKey && onFuriganaClick ? "pointer" : undefined,
              }}
              onClick={
                run.tokenKey && onFuriganaClick
                  ? (event) => {
                      event.stopPropagation();
                      onFuriganaClick(sentenceId, run.tokenKey!);
                    }
                  : undefined
              }
            >
              {run.reading ? (
                <ruby style={{ rubyPosition: "over", rubyAlign: "center" }}>
                  {run.text}
                  <rt style={{ fontSize: fontSize * rubyScale, lineHeight: 1 }}>
                    {run.reading}
                  </rt>
                </ruby>
              ) : (
                run.text
              )}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
export function BilingualText({
  sentences,
  project: p,
  activeId,
  onFuriganaClick,
}: {
  sentences: Sentence[];
  project: Project;
  activeId?: string;
  onFuriganaClick?: FuriganaClick;
}) {
  const { settings, japanese, chinese, divider, chineseLeft } =
      bilingualGeometry(p.style),
    paired = bilingualLayout(sentences, p.style);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: BILINGUAL_BOX.left,
          top: BILINGUAL_BOX.labelTop,
          fontSize: 17,
          fontFamily: "sans-serif",
          letterSpacing: 3,
          opacity: 0.48,
        }}
      >
        日本語
      </div>
      <div
        style={{
          position: "absolute",
          left: BILINGUAL_BOX.left + chineseLeft,
          top: BILINGUAL_BOX.labelTop,
          fontSize: 17,
          fontFamily: "sans-serif",
          letterSpacing: 3,
          opacity: 0.48,
        }}
      >
        中文译文
      </div>
      <div
        style={{
          position: "absolute",
          left: divider,
          top: BILINGUAL_BOX.labelTop,
          width: 1,
          height:
            BILINGUAL_BOX.top + BILINGUAL_BOX.height - BILINGUAL_BOX.labelTop,
          background: "currentColor",
          opacity: 0.18,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: BILINGUAL_BOX.left,
          top: BILINGUAL_BOX.top,
          width: BILINGUAL_BOX.width,
          height: BILINGUAL_BOX.height,
          writingMode: "horizontal-tb",
          direction: "ltr",
        }}
      >
        {paired.rows.map((row) => (
          <div
            key={row.sentence.id}
            data-sentence-id={row.sentence.id}
            style={{
              position: "absolute",
              top: row.top,
              left: 0,
              width: "100%",
              height: row.height,
              color:
                activeId === row.sentence.id ? p.style.highlight : p.style.ink,
              opacity: activeId
                ? activeId === row.sentence.id
                  ? 1
                  : 0.38
                : 0.72,
            }}
          >
            <Paragraph
              layout={row.japanese}
              fontSize={settings.japaneseFontSize}
              rubyScale={settings.rubyScale}
              offset={row.japaneseOffset}
              width={japanese}
              sentenceId={row.sentence.id}
              onFuriganaClick={onFuriganaClick}
            />
            <div
              style={{
                position: "absolute",
                left: chineseLeft,
                top: 0,
                width: chinese,
                height: row.height,
                fontFamily: p.style.fontFamily.includes("sans-serif")
                  ? '"PingFang SC", sans-serif'
                  : '"Songti SC", "Yu Mincho", serif',
              }}
            >
              <Paragraph
                layout={row.chinese}
                fontSize={settings.chineseFontSize}
                rubyScale={settings.rubyScale}
                offset={row.chineseOffset}
                width={chinese}
                chinese
                sentenceId={row.sentence.id}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
