# Testing and reproduction

Use Node.js 22 or newer. From a fresh clone:

```sh
npm ci
npm test
npm run verify:locale
npm run verify:playback-page
npm run verify:storage
npm run build
```

These commands do not download ML models or require personal recordings. The storage check uses a generated test tone by default. Its optional argument is a saved project file containing your own audio:

```sh
npm run verify:storage -- path/to/project.kotonoha.json
```

The Node component checks use react-test-renderer, fake-indexeddb and explicit I/O fixtures. They do not claim desktop-browser coverage. `react-test-renderer` currently emits a deprecation notice.

## Media and AI checks

On the supported Mac, start `npm run dev` in another terminal:

| Command | Requirements | Check |
| --- | --- | --- |
| `npm run render:smoke` | Chrome or Remotion browser download | Two-second 1080p MP4 with generated mixed test tones |
| `npm run verify:voice` | Complete FFmpeg; local API | Gain, limiting, timing and actual MP4 audio |
| `npm run verify:bilingual` | Chrome | Paired layout and page-capacity images from the original demo |
| `npm run verify:furigana` | Local API; first dictionary download | Generation, manual correction preservation and ruby images |
| `npm run verify:translation` | Prepared translation model; API | Real inference, sentence mapping, apply/save/undo/cancel |
| `npm run verify:translation-ui` | Prepared translation model; API | Actual React translation panel with real inference |
| `npm run verify:alignment -- path/to/project.kotonoha.json` | Prepared alignment model; real matching narration | Forced-alignment output and locked-time preservation |
| `npm run verify:export -- path/to/project.kotonoha.json` | Chrome; API | Full render/download, dimensions, duration and non-silent audio |

Verification outputs are generated under `.qa/` or `.renders/`, excluded from Git. Use `.models/` setup scripts for weights; no model weights, personal audio or personal project exports are distributed.

The GitHub Actions workflow runs the model-free checks on Ubuntu. That verifies portable core logic and the frontend build; it does not establish MLX support on Linux or validate Mac rendering performance.
