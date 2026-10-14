#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../companion"
if ! command -v node >/dev/null; then
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then source "$HOME/.nvm/nvm.sh"; fi
fi
if curl -fsS http://127.0.0.1:8788/api/status >/dev/null 2>&1; then
  echo 'Klobflow is running at http://localhost:8788'
  exit 0
fi
exec node server.mjs
