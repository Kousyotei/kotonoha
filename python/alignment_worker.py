"""Local Japanese forced alignment. No audio or transcript is sent over the network."""
import argparse
import json
import math
import sys
import unicodedata
import wave
from pathlib import Path


def emit(**event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text) if unicodedata.category(c)[0] in 'LN' or c == "'")


def group_words(sentences, words, offset, region_end):
    """Map token spans to original sentence IDs without changing any displayed text."""
    texts = [normalized(s['text']) for s in sentences]
    expected = ''.join(texts)
    actual = ''.join(normalized(w.text) for w in words)
    if expected != actual:
        raise ValueError('日语分词结果与正文不一致，请检查特殊字符或拆分句子后重试。')
    spans = []
    cursor = 0
    for word in words:
        length = len(normalized(word.text))
        if length:
            spans.append((cursor, cursor + length, word.start_time + offset, word.end_time + offset))
            cursor += length
    results = []
    cursor = 0
    previous_end = offset
    for sentence, text in zip(sentences, texts):
        relevant = [w for w in spans if w[0] < cursor + len(text) and w[1] > cursor]
        cursor += len(text)
        if not relevant:
            results.append({'id': sentence['id'], 'status': 'review', 'message': '本句没有可对齐的发音文字，保留原时间。'})
            continue
        raw_start, raw_end = relevant[0][2], relevant[-1][3]
        if not all(math.isfinite(t) for t in (raw_start, raw_end)):
            results.append({'id': sentence['id'], 'status': 'review', 'message': '模型没有返回有效时间，保留原时间。'})
            continue
        start = max(offset, previous_end, raw_start)
        end = min(region_end, raw_end)
        notes = []
        if raw_end > region_end + .08 or raw_start < offset - .08:
            notes.append('模型时间超出音频范围')
        if end <= start + .015:
            results.append({'id': sentence['id'], 'status': 'review', 'message': '模型未能定位有效朗读区间，保留原时间。'})
            continue
        if len(text) / (end - start) > 25:
            notes.append('本句区间偏短，请试听复核')
        if end - start > max(10, len(text) * 1.5):
            notes.append('本句区间偏长，请试听复核')
        if raw_start < previous_end - .08:
            notes.append('模型时间有重叠，已裁到前句结束')
        results.append({'id': sentence['id'], 'start': round(start, 3), 'end': round(end, 3), 'status': 'review' if notes else 'aligned', 'message': '；'.join(notes)})
        previous_end = end
    return results


def regions(sentences, duration):
    """Locked timings are anchors. Do not infer across or alter a locked sentence."""
    pending = []
    start = 0.0
    result = []
    for sentence in sentences:
        if sentence.get('timingLocked'):
            if not 0 <= sentence['start'] < sentence['end'] <= duration + .05:
                raise ValueError('锁定句子的时间必须位于录音范围内。')
            if sentence['start'] < start:
                raise ValueError('锁定句子的时间不能重叠。')
            if pending:
                if sentence['start'] - start < .08:
                    raise ValueError('锁定时间之间没有足够音频，请调整锁定时间。')
                result.append((pending, start, sentence['start']))
                pending = []
            start = sentence['end']
        else:
            pending.append(sentence)
    if pending:
        if duration - start < .08:
            raise ValueError('末尾锁定时间之后没有足够音频。')
        result.append((pending, start, duration))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True)
    parser.add_argument('--audio', required=True)
    parser.add_argument('--model', required=True)
    args = parser.parse_args()
    import numpy as np
    from mlx_audio.stt import load
    with wave.open(args.audio, 'rb') as audio:
        if audio.getnchannels() != 1 or audio.getframerate() != 16000 or audio.getsampwidth() != 2:
            raise ValueError('模型需要 16kHz 单声道 PCM 音频。')
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype(np.float32) / 32768.0
    duration = len(samples) / 16000
    if not 0 < duration <= 300:
        raise ValueError('当前自动对齐支持 5 分钟以内录音，请将长录音分段处理。')
    request = json.loads(Path(args.request).read_text())
    sentences = request['sentences']
    groups = regions(sentences, duration)
    if not groups:
        raise ValueError('所有句子均已锁定，请先解锁需要自动对齐的句子。')
    emit(type='progress', progress=.15, message='正在载入本地日语对齐模型…')
    model = load(args.model)
    emit(type='progress', progress=.25, message='正在分析录音与日语原文…')
    output = []
    for index, (group, start, end) in enumerate(groups):
        clip = samples[round(start * 16000):round(end * 16000)]
        words = list(model.generate(audio=clip, text='\n'.join(s['text'] for s in group), language='Japanese'))
        output.extend(group_words(group, words, start, end))
        emit(type='progress', progress=.25 + .7 * (index + 1) / len(groups), message=f'已完成 {index + 1}/{len(groups)} 个对齐区间')
    emit(type='result', sentences=output, duration=duration, model='Qwen3-ForcedAligner-0.6B · MLX 8-bit')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit(type='error', message=str(error))
        print(str(error), file=sys.stderr)
        sys.exit(1)
