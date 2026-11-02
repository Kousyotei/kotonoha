import type { Media } from "./model";
import { validPunctuationEdit, type PunctuationEdit } from "./punctuation";
export type TranscriptSegment = { start: number; end: number; text: string };
export type TranscriptionDraft = {
  id: string;
  audioId: string;
  audioName: string;
  duration: number;
  language: "ja";
  model: string;
  originalText: string;
  text: string;
  segments: TranscriptSegment[];
  generatedAt: string;
  editedAt?: string;
  punctuation?: PunctuationEdit;
};
export const TRANSCRIPTION_MAX_SECONDS = 600;
export const TRANSCRIPTION_MAX_TEXT = 30000;
export function validTranscription(value: TranscriptionDraft) {
  if (
    !value ||
    typeof value.id !== "string" ||
    typeof value.audioId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.audioId) ||
    typeof value.audioName !== "string" ||
    !Number.isFinite(value.duration) ||
    value.duration <= 0 ||
    value.duration > TRANSCRIPTION_MAX_SECONDS + 0.1 ||
    value.language !== "ja" ||
    typeof value.model !== "string" ||
    typeof value.generatedAt !== "string" ||
    (value.editedAt !== undefined && typeof value.editedAt !== "string") ||
    (value.punctuation !== undefined && !validPunctuationEdit(value.punctuation)) ||
    typeof value.originalText !== "string" ||
    !value.originalText.trim() ||
    value.originalText.length > TRANSCRIPTION_MAX_TEXT ||
    typeof value.text !== "string" ||
    value.text.length > TRANSCRIPTION_MAX_TEXT ||
    !Array.isArray(value.segments) ||
    !value.segments.length ||
    value.segments.length > 2000
  )
    return false;
  let end = 0;
  for (const segment of value.segments) {
    if (
      !segment ||
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.start < end - 0.01 ||
      segment.end <= segment.start ||
      segment.end > value.duration + 0.05 ||
      typeof segment.text !== "string" ||
      !segment.text.trim() ||
      segment.text.length > TRANSCRIPTION_MAX_TEXT
    )
      return false;
    end = segment.end;
  }
  return true;
}
export function editTranscription(
  draft: TranscriptionDraft,
  text: string,
): TranscriptionDraft {
  if (text.length > TRANSCRIPTION_MAX_TEXT)
    throw Error("校对文字请控制在 30000 字以内。");
  return { ...draft, text, editedAt: new Date().toISOString() };
}
export function sameTranscriptionAudio(a: Media | null, b: Media | null) {
  return !!a && !!b && a.src === b.src && a.duration === b.duration;
}
export async function transcriptionAudioId(media: Media) {
  const bytes = new TextEncoder().encode(media.src),
    digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function parseWhisperSegments(
  value: unknown,
  duration: number,
): TranscriptSegment[] {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > TRANSCRIPTION_MAX_SECONDS + 0.1
  )
    throw Error("录音时长无效。");
  const rows = (value as { transcription?: unknown })?.transcription;
  if (!Array.isArray(rows)) throw Error("识别器未返回有效的文字片段。");
  const result: TranscriptSegment[] = [];
  let end = 0;
  for (const raw of rows) {
    if (
      !raw ||
      typeof raw.text !== "string" ||
      !raw.offsets ||
      !Number.isFinite(raw.offsets.from) ||
      !Number.isFinite(raw.offsets.to)
    )
      throw Error("识别器返回的片段格式无效。");
    const text = raw.text.normalize("NFC").trim();
    if (!text) continue;
    const start = Math.max(0, raw.offsets.from / 1000),
      finish = Math.min(duration, raw.offsets.to / 1000);
    if (start >= duration || finish <= start) continue;
    if (start < end - 0.01) throw Error("识别片段时间发生重叠，请重新识别。");
    result.push({ start, end: finish, text });
    end = finish;
  }
  const total = result.reduce((n, s) => n + s.text.length, 0);
  if (!result.length || !total)
    throw Error("未识别到可用文字，请检查朗读人声；也可以手动输入正文。");
  if (total > TRANSCRIPTION_MAX_TEXT || result.length > 2000)
    throw Error("识别文字过长，请将录音分成较短片段。");
  return result;
}
export function stageTranscription(
  existing: TranscriptionDraft | undefined,
  incoming: TranscriptionDraft,
) {
  if (!validTranscription(incoming))
    throw Error("识别结果格式无效，校对稿未改变。");
  return existing
    ? { draft: existing, candidate: incoming }
    : { draft: incoming, candidate: null };
}
