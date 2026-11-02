# Third-party notices

The repository distributes application source and an original text demo. Downloaded models, dictionary caches, Python environments and personal media are excluded from Git. Dependencies and downloaded data retain their own licenses.

## Application libraries

- React, TypeScript, Vite, Express and lucide-react: MIT. Versions are locked in `package-lock.json`.
- Remotion: [Remotion License](https://www.remotion.dev/docs/terms), a separate source-available license. Eligibility for free use and company use follows Remotion's terms.
- [Kuroshiro](https://github.com/hexenq/kuroshiro) 1.2.1 and kuroshiro-analyzer-kuromoji 1.1.0: MIT.
- [Kuromoji.js](https://github.com/takuyaa/kuromoji.js): Apache-2.0. Its bundled IPADic dictionary has separate notices under the installed package.
- htmlparser2 10.0.0 and saxes 6.0.0: MIT.
- fake-indexeddb 6.2.7: Apache-2.0, development/testing only. The application uses the browser's native IndexedDB.

## JMdict

JMdict is the property of the Electronic Dictionary Research and Development Group (EDRDG), and is used in accordance with its licence provisions.

Copyright: Electronic Dictionary Research and Development Group (EDRDG).

- [Data](https://www.edrdg.org/pub/Nihongo/JMdict_e.gz)
- [Documentation](https://www.edrdg.org/jmdict/j_jmdict.html)
- [EDRDG licence](https://www.edrdg.org/edrdg/licence.html): [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

The local derivative `.dictionaries/jmdict-readings.json.gz` extracts written forms, permissible readings (respecting re_restr and re_nokanji), entry IDs and dictionary date; readings are normalized to hiragana and merged. The derivative remains under CC BY-SA 4.0. It is generated/downloaded locally, not committed. These terms do not replace licenses of application code or dependencies. Attribution links remain accessible in the editor's license disclosure.

## Translation

- Original model: [tencent/Hy-MT2-1.8B](https://huggingface.co/tencent/Hy-MT2-1.8B), Apache-2.0.
- Quantized model: [mlx-community/Hy-MT2-1.8B-4bit](https://huggingface.co/mlx-community/Hy-MT2-1.8B-4bit), fixed revision `e5c6fe56c7b3bc77fae5ae92db31f2178f1e6912`. Downloaded files retain LICENSE.txt; per-file sizes and SHA-256 are in `server/translation-runtime.ts`.
- MLX / MLX-LM: MIT. Transformers and SentencePiece: Apache-2.0. NumPy: BSD-3-Clause. Full runtime versions are pinned in `python/translation-requirements.lock`.

## Forced alignment

- [Qwen3-ASR / Qwen3-ForcedAligner](https://github.com/QwenLM/Qwen3-ASR), Apache-2.0.
- [MLX Audio](https://github.com/Blaizzy/mlx-audio), MIT.
- [mlx-community/Qwen3-ForcedAligner-0.6B-8bit](https://huggingface.co/mlx-community/Qwen3-ForcedAligner-0.6B-8bit). Download details are in the setup script and `python/download_model.py`.
- Runtime versions are recorded in `python/requirements.lock`.

## FFmpeg

Voice enhancement invokes the user's installed [FFmpeg](https://ffmpeg.org/) command. The repository does not redistribute the complete FFmpeg executable. The applicable license depends on its build options; see [FFmpeg legal information](https://ffmpeg.org/legal.html).

Rendering uses the Remotion-managed compositor/FFmpeg packages installed through npm. Their own license files remain in the dependency packages. Voice processing uses the documented volume, alimiter and loudnorm filters locally.

## Demo content

`samples/demo.*` and the source default in `src/sample.ts` were created for this project. Chinese demo translations are hand-edited examples. The images under `docs/assets/` are rendered from this demo, not imported personal projects. No narration or model weights are bundled.
