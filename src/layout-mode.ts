import { paginate, type Project, type Page } from "./model";
import { isBilingual, type LayoutMode } from "./bilingual-layout";
import { fitFuriganaPages } from "./furigana-pages";
// Translation or ruby edits may grow one pair. Preserve user boundaries and
// switch times, splitting only the page whose content no longer fits.
export function fitBilingualPages(project: Project): Project {
  if (!isBilingual(project.style)) return project;
  const byId = new Map(project.sentences.map((s) => [s.id, s]));
  const pages = project.pages.flatMap((page) =>
    paginate(
      page.sentenceIds.map((id) => byId.get(id)!).filter(Boolean),
      project.style,
    ).map((chunk, i) =>
      i
        ? { ...chunk, start: byId.get(chunk.sentenceIds[0])!.start }
        : { ...chunk, id: page.id, start: page.start },
    ),
  );
  return { ...project, pages };
}
export function switchLayout(project: Project, mode: LayoutMode): Project {
  const previous = project.style.layoutMode || "vertical";
  if (previous === mode) return project;
  const snapshots = {
    ...project.layoutPages,
    [previous]: project.pages.map((page) => ({
      ...page,
      sentenceIds: [...page.sentenceIds],
    })),
  };
  const style = { ...project.style, layoutMode: mode };
  const cached = snapshots[mode];
  let pages =
    cached?.flatMap((page) => page.sentenceIds).join("|") ===
      project.sentences.map((s) => s.id).join("|") && cached?.length
      ? cached.map((page) => ({ ...page, sentenceIds: [...page.sentenceIds] }))
      : paginate(project.sentences, style);
  // Other-mode timings may be older than a subsequent audio alignment.
  pages = pages.map((page, index) => {
    if (!index) return { ...page, start: 0 };
    const lower = project.sentences.find(
        (s) => s.id === pages[index - 1].sentenceIds.at(-1),
      )!.end,
      upper = project.sentences.find(
        (s) => s.id === page.sentenceIds[0],
      )!.start;
    return { ...page, start: Math.max(lower, Math.min(upper, page.start)) };
  });
  const next = { ...project, style, layoutPages: snapshots, pages };
  return mode === "bilingual"
    ? fitBilingualPages(next)
    : fitFuriganaPages(next);
}
