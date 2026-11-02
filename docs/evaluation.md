# Model choices and evaluation boundaries

The application uses existing models and dictionaries. No model training or fine-tuning is claimed.

| Task | Implementation | Selection / limitation |
| --- | --- | --- |
| Japanese → Chinese translation | Hy-MT2 1.8B, MLX 4-bit, about 1.02 GB | Direct translation on Apple Silicon. Pronouns, names, tense and literary language still require review. |
| Known-text audio alignment | Qwen3-ForcedAligner 0.6B, MLX 8-bit | Aligns supplied Japanese text to speech. Missing or repeated words can require manual adjustment. |
| Furigana | Kuroshiro + Kuromoji + local JMdict | Dictionary match, morphological inference and manual confirmation are separate states. Unresolved readings are marked for review. |

Translation model revision and per-file hashes are fixed in `server/translation-runtime.ts`. Setup verifies files and runs a real inference probe. Worker inference is configured offline after setup.

## Development observations

Small OPUS-MT INT8 pivot translation (Japanese → English → Chinese, about 163 MB) produced semantic errors in literary expressions. A general Qwen 2B 4-bit experiment produced source copying and neighboring-sentence leakage in some runs. Hy-MT2 1.8B improved some examples but also made semantic errors. Context-based generation was therefore not enabled; requests are handled per sentence to preserve the editing structure.

These are qualitative development observations from a small, nonstandardized comparison, not benchmark rankings. The repository does not publish a measured accuracy, BLEU/COMET score, or confidence percentage. The included demo translations are hand-edited examples, not model outputs or evaluation references.

## Reproducible evaluation

1. Prepare a set of original or redistributable Japanese sentences and record the test environment, model revision and prompts.
2. Save raw model output separately from human corrections.
3. Review missing content, additions, names, polarity and tense against a human reference.
4. Report test-set size and individual failures together with time and model size.
5. Test stale-result rejection, selective application, undo and preservation of manual edits independently of language quality.

For forced alignment, use a real narration of the supplied text and inspect sentence boundaries by listening. Generated sine-wave test fixtures validate storage, mixing and gain; they are not speech-alignment evaluation data.

## Engineering checks

`npm test` covers project validation, timing/highlight boundaries, ruby/bilingual pagination, editable AI results, storage rollback and localization. `verify:locale`, `verify:playback-page` and `verify:storage` exercise React components with documented Node/browser API shims. The real-model and MP4 verification scripts are separate integration checks requiring their stated runtime prerequisites.
