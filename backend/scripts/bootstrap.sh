#!/usr/bin/env bash
set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools_dir="$backend_dir/.tools"
uv_bin="$tools_dir/uv"
python_dir="$backend_dir/.python"

mkdir -p "$tools_dir" "$python_dir"

if [[ ! -x "$uv_bin" ]]; then
  curl -LsSf https://astral.sh/uv/install.sh |
    env UV_UNMANAGED_INSTALL="$tools_dir" sh
fi

UV_PYTHON_INSTALL_DIR="$python_dir" "$uv_bin" python install 3.14.6
python_bin="$(
  UV_PYTHON_INSTALL_DIR="$python_dir" \
    "$uv_bin" python find 3.14.6
)"

if [[ ! -x "$backend_dir/.venv/bin/python" ]]; then
  "$python_bin" -m venv "$backend_dir/.venv"
fi

"$backend_dir/.venv/bin/python" -m pip install --upgrade pip
"$backend_dir/.venv/bin/python" -m pip install \
  -r "$backend_dir/requirements-dev.txt"
"$backend_dir/.venv/bin/python" -c \
  'import sys; assert sys.version_info[:3] == (3, 14, 6), sys.version'
