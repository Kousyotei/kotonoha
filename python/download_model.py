import argparse
import json
from pathlib import Path
from huggingface_hub import snapshot_download

MODEL = 'mlx-community/Qwen3-ForcedAligner-0.6B-8bit'
REVISION = '0e1a68e91d815300c7c9754b2a7639378b23db15'
parser = argparse.ArgumentParser()
parser.add_argument('--dest', required=True)
args = parser.parse_args()
print(json.dumps({'type':'progress','progress':.3,'message':'正在准备日语模型（首次下载约 1.3 GB），请保持联网…'},ensure_ascii=False),flush=True)
snapshot_download(MODEL, revision=REVISION, local_dir=args.dest, allow_patterns=['*.json','*.txt','*.safetensors'])
Path(args.dest, 'ready.json').write_text(json.dumps({'model':MODEL,'revision':REVISION}))
print(json.dumps({'type':'progress','progress':1,'message':'本地模型已准备完成'},ensure_ascii=False),flush=True)
