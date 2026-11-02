import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseProject, validate } from "../src/model";
import { applyAlignment, type AlignmentResult } from "../src/alignment";
const filename = process.argv[2];
if (!filename)
  throw Error(
    "用法：npm run verify:alignment -- <项目文件.json>（请先启动应用）",
  );
const project = parseProject(JSON.parse(await readFile(filename, "utf8")));
const base =
  (process.env.APP_URL || "http://127.0.0.1:5173") + "/api/alignment";
const response = await fetch(base, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...project, music: null }),
});
const job = await response.json();
if (!response.ok) throw Error(job.error || `HTTP ${response.status}`);
const deadline = Date.now() + 10 * 60 * 1000;
while (Date.now() < deadline) {
  const response = await fetch(`${base}/${job.id}`);
  const status = await response.json();
  if (!response.ok || status.status === "error")
    throw Error(status.error || "任务失败");
  if (status.status === "cancelled") throw Error("任务已取消");
  if (status.status === "done") {
    const result = status.result as AlignmentResult;
    const aligned = applyAlignment(project, result);
    const errors = validate(aligned);
    if (errors.length) throw Error(errors.join(" "));
    project.sentences.forEach((s, i) => {
      if (
        s.timingLocked &&
        (aligned.sentences[i].start !== s.start ||
          aligned.sentences[i].end !== s.end)
      )
        throw Error("锁定时间被覆盖");
    });
    await mkdir(".qa", { recursive: true });
    await writeFile(
      ".qa/aligned-project.kotonoha.json",
      JSON.stringify(aligned),
    );
    await writeFile(
      ".qa/alignment-result.json",
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          passed: true,
          output: ".qa/aligned-project.kotonoha.json",
          aligned: result.sentences.length,
          locked: project.sentences.filter((s) => s.timingLocked).length,
          timings: aligned.sentences.map((s) => ({
            start: s.start,
            end: s.end,
            locked: !!s.timingLocked,
          })),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
}
throw Error("自动对齐验证超时");
