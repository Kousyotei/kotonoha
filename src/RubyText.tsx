import React from "react";
import type { Project, Sentence } from "./model";
import { geometry } from "./model";
import { rubyLayout } from "./ruby-layout";
export type FuriganaClick = (sentenceId: string, key: string) => void;
export function RubyText({
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
  const { rows, columnPitch } = geometry(p.style);
  return (
    <>
      {rubyLayout(sentences, p.style).runs.map((run) => (
        <span
          key={run.key}
          style={{
            gridColumn: Math.floor(run.index / rows) + 1,
            gridRow: `${(run.index % rows) + 1} / span ${run.span}`,
            width: columnPitch,
            height: p.style.fontSize * run.span,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            direction: "ltr",
            color:
              activeId === run.sentenceId ? p.style.highlight : p.style.ink,
            cursor: onFuriganaClick && run.tokenKey ? "pointer" : undefined,
          }}
          onClick={
            onFuriganaClick && run.tokenKey
              ? (event) => {
                  event.stopPropagation();
                  onFuriganaClick(run.sentenceId, run.tokenKey!);
                }
              : undefined
          }
        >
          {run.reading ? (
            <ruby style={{ rubyPosition: "over", rubyAlign: "center" }}>
              {run.text}
              <rt
                style={{
                  fontSize: Math.min(
                    p.style.fontSize * 0.42,
                    (p.style.fontSize * run.span * 0.9) /
                      Array.from(run.reading).length,
                  ),
                  lineHeight: 1,
                }}
              >
                {run.reading}
              </rt>
            </ruby>
          ) : (
            run.text
          )}
        </span>
      ))}
    </>
  );
}
