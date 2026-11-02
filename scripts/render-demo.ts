import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { parseProject } from "../src/model";
import { switchLayout } from "../src/layout-mode";
import { browserExecutable } from "../server/browser";
const project = parseProject(JSON.parse(await readFile("samples/demo.kotonoha.json", "utf8")));
const serveUrl = await bundle({ entryPoint: path.resolve("src/video-entry.tsx") });
const executable = browserExecutable();
const browser = { browserExecutable: executable, chromeMode: executable ? "chrome-for-testing" as const : "headless-shell" as const };
await mkdir("docs/assets", { recursive: true });
for (const mode of ["vertical", "bilingual"] as const) {
  const inputProps = { project: switchLayout(project, mode) };
  const composition = await selectComposition({ serveUrl, id: "Reading", inputProps, ...browser });
  await renderStill({ serveUrl, composition, inputProps, frame: 0,
    output: path.resolve(`docs/assets/${mode}.png`), ...browser });
}
console.log("Rendered original demo video frames to docs/assets/.");
