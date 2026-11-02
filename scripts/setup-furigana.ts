import { getJmdict, updateJmdict } from "../server/jmdict";
const dictionary = process.argv.includes("--update")
  ? await updateJmdict()
  : await getJmdict();
console.log(
  JSON.stringify({
    ready: true,
    date: dictionary.date,
    words: Object.keys(dictionary.entries).length,
    source: dictionary.source,
  }),
);
