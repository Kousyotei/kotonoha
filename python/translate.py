"""Offline Hy-MT2 translation on Apple Silicon. One output per input ID."""
import argparse
import json
import pathlib
import sys


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def translate(rows, model_root):
    import mlx.core as mx
    from mlx_lm import load, stream_generate
    from mlx_lm.sample_utils import make_sampler, make_logits_processors

    model, tokenizer = load(str(model_root), tokenizer_config={
        "trust_remote_code": False, "local_files_only": True,
    })
    prompts = []
    for index, row in enumerate(rows):
        prompt = tokenizer.apply_chat_template([{
            "role": "user",
            "content": "将以下文本翻译为简体中文，注意只需要输出翻译后的结果，不要额外解释：\n\n" + row["text"],
        }], tokenize=False, add_generation_prompt=True)
        if len(tokenizer.encode(prompt)) > 4096:
            raise ValueError(f"第 {index + 1} 句超出模型容量，请拆句后再翻译。")
        prompts.append(prompt)

    output = []
    for index, (row, prompt) in enumerate(zip(rows, prompts)):
        mx.random.seed(42)
        text = ""
        final = None
        for part in stream_generate(
            model, tokenizer, prompt=prompt, max_tokens=1536,
            sampler=make_sampler(temp=0.7, top_p=0.6, top_k=20),
            logits_processors=make_logits_processors(repetition_penalty=1.05),
        ):
            text += part.text
            final = part
        if final is None or final.finish_reason != "stop":
            raise ValueError(f"第 {index + 1} 句译文达到生成上限，未采用，请拆句后重试。")
        text = text.strip()
        if not text or len(text) > 2000:
            raise ValueError(f"第 {index + 1} 句译文为空或过长，已有译文保留。")
        output.append({"id": row["id"], "translation": text})
        emit({"type": "progress", "progress": (index + 1) / len(rows),
              "message": f"Hy-MT2 正在翻译 {index + 1}/{len(rows)} 句…"})
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=pathlib.Path, required=True)
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    try:
        rows = [{"id": "probe", "text": "今日は学校へ行きます。"}] if args.probe else json.load(sys.stdin)["sentences"]
        result = translate(rows, args.model)
        if args.probe and not any("\u4e00" <= c <= "\u9fff" for c in result[0]["translation"]):
            raise ValueError("翻译组件自检没有生成有效中文，请重新准备。")
        emit({"type": "result", "items": result})
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
