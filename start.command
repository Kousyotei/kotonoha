#!/bin/zsh
cd "${0:A:h}"
if [[ -d "$PWD/.tools/node-v22.21.1-darwin-arm64/bin" ]]; then
  export PATH="$PWD/.tools/node-v22.21.1-darwin-arm64/bin:$PATH"
fi
export PATH="$HOME/.local/bin:$PATH"
if ! command -v node >/dev/null; then
  echo '请先安装 Node.js 22 或更新的 LTS 版本：https://nodejs.org/'
  read 'reply?按回车关闭'; exit 1
fi
if (( $(node -p 'Number(process.versions.node.split(".")[0])') < 22 )); then
  echo 'Node.js 版本过旧，请使用 Node.js 22 或更新版本。'
  read 'reply?按回车关闭'; exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci || exit 1
fi
echo "Node.js $(node --version) · npm $(npm --version)"
echo '编辑器地址：http://127.0.0.1:5173'
echo '请保持此窗口运行；按 Ctrl+C 停止。'
npm run dev
