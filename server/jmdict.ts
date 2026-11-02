import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createGunzip, gzipSync, gunzipSync } from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import { SaxesParser } from "saxes";
import { hasKanji, hiragana } from "../src/furigana";
export type DictionaryEntry = { readings: string[]; entryIds: string[] };
export type Jmdict = {
  date: string;
  source: string;
  entries: Record<string, DictionaryEntry>;
};
const dir = path.resolve(".dictionaries"),
  indexPath = path.join(dir, "jmdict-readings.json.gz");
export const JMDICT_SOURCE = "https://www.edrdg.org/pub/Nihongo/JMdict_e.gz";
let cache: Promise<Jmdict> | undefined;
export async function buildJmdict(
  filename: string,
  minEntries = 100000,
): Promise<Jmdict> {
  const result: Jmdict = {
    date: "",
    source: JMDICT_SOURCE,
    entries: Object.create(null),
  };
  const parser = new SaxesParser();
  let tag = "",
    text = "",
    id = "",
    kanji: string[] = [],
    readings: { text: string; restrictions: string[]; noKanji: boolean }[] = [],
    reading = { text: "", restrictions: [] as string[], noKanji: false };
  parser.on("doctype", (value) => {
    for (const match of value.matchAll(/<!ENTITY\s+([\w-]+)\s+"([^"]*)"\s*>/g))
      parser.ENTITIES[match[1]] = match[2];
  });
  parser.on("comment", (value) => {
    const date = value.match(/JMdict created:\s*(\d{4}-\d{2}-\d{2})/);
    if (date) result.date = date[1];
  });
  parser.on("opentag", (node) => {
    tag = node.name;
    text = "";
    if (tag === "entry") {
      kanji = [];
      readings = [];
      id = "";
    }
    if (tag === "r_ele")
      reading = { text: "", restrictions: [], noKanji: false };
    if (tag === "re_nokanji") reading.noKanji = true;
  });
  parser.on("text", (value) => {
    if (["ent_seq", "keb", "reb", "re_restr"].includes(tag)) text += value;
  });
  parser.on("closetag", (node) => {
    const name = node.name;
    if (name === "ent_seq") id = text.trim();
    if (name === "keb") kanji.push(text);
    if (name === "reb") reading.text = text;
    if (name === "re_restr") reading.restrictions.push(text);
    if (name === "r_ele") readings.push(reading);
    if (name === "entry")
      for (const word of kanji.filter(hasKanji)) {
        const allowed = readings
          .filter(
            (r) =>
              !r.noKanji &&
              (!r.restrictions.length || r.restrictions.includes(word)),
          )
          .map((r) => hiragana(r.text))
          .filter((r) => /^[\p{Script=Hiragana}ー]+$/u.test(r));
        if (!allowed.length) continue;
        const old = result.entries[word] || { readings: [], entryIds: [] };
        old.readings = Array.from(new Set([...old.readings, ...allowed]));
        if (!old.entryIds.includes(id)) old.entryIds.push(id);
        result.entries[word] = old;
      }
    tag = "";
    text = "";
  });
  parser.on("error", (error) => {
    throw error;
  });
  const decoder = new StringDecoder("utf8");
  for await (const chunk of createReadStream(filename).pipe(createGunzip()))
    parser.write(decoder.write(chunk));
  parser.write(decoder.end()).close();
  if (Object.keys(result.entries).length < minEntries || !result.date)
    throw Error("JMdict 数据不完整，未替换本地词典。");
  return result;
}
export async function updateJmdict(): Promise<Jmdict> {
  await mkdir(dir, { recursive: true });
  const response = await fetch(JMDICT_SOURCE, {
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw Error("无法下载 JMdict，请检查网络后重试。");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 40 * 1024 * 1024) throw Error("JMdict 文件大小异常。");
  const raw = path.join(dir, "JMdict_e.download.gz");
  await writeFile(raw, bytes);
  const result = await buildJmdict(raw);
  await writeFile(indexPath + ".tmp", gzipSync(JSON.stringify(result)));
  await rename(indexPath + ".tmp", indexPath);
  cache = Promise.resolve(result);
  return result;
}
export async function getJmdict() {
  if (!cache)
    cache = (async () => {
      try {
        const value = JSON.parse(
          gunzipSync(await readFile(indexPath)).toString("utf8"),
        ) as Jmdict;
        if (!value.date || !value.entries) throw Error("词典索引无效");
        return value;
      } catch {
        return updateJmdict();
      }
    })().catch((error) => {
      cache = undefined;
      throw error;
    });
  return cache;
}
