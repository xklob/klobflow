#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v uv >/dev/null || { echo 'Install uv (https://docs.astral.sh/uv/getting-started/installation/), then rerun this script.'; exit 1; }
command -v node >/dev/null || { echo 'Install Node.js 22 or newer for phone USB/Wi-Fi transport.'; exit 1; }
uv venv .venv-motion --python 3.12 --allow-existing
torch_index=${KLOBFLOW_TORCH_INDEX:-https://download.pytorch.org/whl/cu128}
uv pip install --python .venv-motion/bin/python torch==2.8.0 torchvision==0.23.0 --index-url "$torch_index"
uv pip install --python .venv-motion/bin/python -r motion/requirements.txt
model_cache=${KLOBFLOW_MODEL_DIR:-$HOME/.cache/klobflow/models}
framework_dir=${KLOBFLOW_EDGETAM_SOURCE:-$HOME/.cache/klobflow/edgetam}
revision=7711e012a30a2402c4eaab637bdb00a521302c91
mkdir -p "$model_cache"
if [[ ! -e "$framework_dir" ]]; then
  git init "$framework_dir"
  git -C "$framework_dir" remote add origin https://github.com/facebookresearch/EdgeTAM.git
  git -C "$framework_dir" fetch --depth 1 origin "$revision"
  git -C "$framework_dir" checkout --detach FETCH_HEAD
fi
[[ $(git -C "$framework_dir" rev-parse HEAD) == "$revision" ]] || { echo "EdgeTAM source has a different revision: $framework_dir"; exit 1; }
git -C "$framework_dir" diff --quiet HEAD -- || { echo "EdgeTAM source has local modifications: $framework_dir"; exit 1; }
model_file="$model_cache/edgetam.pt"
expected=ed2d4850b8792c239689b043c47046ec239b6e808a3d9b6ae676c803fd8780df
actual=$(sha256sum "$framework_dir/checkpoints/edgetam.pt" | cut -d' ' -f1)
[[ "$actual" == "$expected" ]] || { echo 'EdgeTAM checkpoint checksum mismatch'; exit 1; }
cp "$framework_dir/checkpoints/edgetam.pt" "$model_file"
echo 'Motion Lab is installed. Run ./motion/run.sh and open http://localhost:8789'
