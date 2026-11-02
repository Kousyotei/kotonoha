import { useI18n } from "./i18n";
import React from "react";
import { paginate, type Project } from "./model";
import { bilingualSettings, type BilingualSettings } from "./bilingual-layout";
export function BilingualControls({
  project,
  onChange,
}: {
  project: Project;
  onChange: (p: Project) => void;
}) {
  const { t } = useI18n();
  const settings = bilingualSettings(project.style);
  const update = (key: keyof BilingualSettings, value: number) => {
    const style = {
      ...project.style,
      bilingual: { ...settings, [key]: value },
    };
    onChange({ ...project, style, pages: paginate(project.sentences, style) });
  };
  return (
    <div className="bilingual-controls">
      <label className="field">
        {t("两栏宽度")}<span className="value">
          {t("日")}{Math.round(settings.japaneseWidth * 100)}{t("% / 中")}{" "}
          {100 - Math.round(settings.japaneseWidth * 100)}%
        </span>
        <input
          aria-label={t("日文栏宽度")}
          type="range"
          min="35"
          max="65"
          step="1"
          value={Math.round(settings.japaneseWidth * 100)}
          onChange={(e) =>
            update("japaneseWidth", Number(e.target.value) / 100)
          }
        />
      </label>
      {(
        [
          ["japaneseFontSize", "日文字号", 24, 72, 1, "px"],
          ["chineseFontSize", "中文字号", 24, 72, 1, "px"],
          ["lineHeight", "横排行距", 1.2, 2.4, 0.1, "倍"],
          ["rubyScale", "注音大小", 0.25, 0.65, 0.01, "倍"],
        ] as const
      ).map(([key, label, min, max, step, unit]) => (
        <label className="field" key={key}>
          {t(label)}
          <span className="value">
            {Number(settings[key].toFixed(2))} {t(unit)}
            {t(key === "rubyScale"
              ? `（约 ${Math.round(settings.japaneseFontSize * settings.rubyScale)} px）`
              : "")}
          </span>
          <input
            aria-label={t(label)}
            type="range"
            min={min}
            max={max}
            step={step}
            value={settings[key]}
            onChange={(e) => update(key, Number(e.target.value))}
          />
        </label>
      ))}
    </div>
  );
}
