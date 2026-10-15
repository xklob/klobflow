#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -x .venv-motion/bin/python ]] || { echo 'Run ./motion/setup.sh first.'; exit 1; }
export TQDM_DISABLE=1
exec .venv-motion/bin/python -m motion.server "$@"
