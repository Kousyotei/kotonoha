import { Router } from "express";
import { getJmdict, updateJmdict } from "./jmdict";
import { generateFurigana } from "./furigana-engine";
export const furiganaRouter = Router();
let updating = false;
furiganaRouter.post("/", async (req, res) => {
  try {
    const sentences = req.body?.sentences;
    if (
      !Array.isArray(sentences) ||
      !sentences.length ||
      sentences.length > 1000 ||
      sentences.some(
        (s) => !s || typeof s.id !== "string" || typeof s.text !== "string",
      ) ||
      sentences.reduce((n, s) => n + s.text.length, 0) > 30000
    )
      throw Error("请提供 30000 字以内的有效日语正文。");
    const dictionary = await getJmdict();
    const results = [];
    for (const sentence of sentences)
      results.push({
        id: sentence.id,
        furigana: await generateFurigana(sentence.text, dictionary),
      });
    res.json({ sentences: results, dictionaryDate: dictionary.date });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});
furiganaRouter.post("/dictionary/update", async (_req, res) => {
  if (updating) {
    res.status(409).json({ error: "词典正在更新，请稍候。" });
    return;
  }
  updating = true;
  try {
    const value = await updateJmdict();
    res.json({ date: value.date });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  } finally {
    updating = false;
  }
});
