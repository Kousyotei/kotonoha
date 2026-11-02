import { paginate, type Project, type Page } from "./model";
// Retain every user page boundary and time; split only pages that no longer fit.
export function fitFuriganaPages(project: Project): Project {
  if (!project.style.showFurigana) return project;
  const pages: Page[] = [];
  for (const page of project.pages) {
    const sentences = page.sentenceIds
      .map((id) => project.sentences.find((s) => s.id === id)!)
      .filter(Boolean);
    const chunks = paginate(sentences, project.style);
    chunks.forEach((chunk, i) =>
      pages.push(
        i === 0
          ? { ...chunk, id: page.id, start: page.start }
          : {
              ...chunk,
              start: sentences.find((s) => s.id === chunk.sentenceIds[0])!
                .start,
            },
      ),
    );
  }
  return { ...project, pages };
}
