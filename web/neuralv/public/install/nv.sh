#!/usr/bin/env sh
set -eu

BASE_URL="${NEURALV_BASE_URL:-https://neuralvv.org}"
BASE_URL="${BASE_URL%/}"
DOWNLOAD_URL="${NV_DOWNLOAD_URL:-${BASE_URL}/basedata/api/releases/download?platform=nv-linux}"
INSTALL_ROOT="${NV_INSTALL_ROOT:-$HOME/.local/bin}"
TARGET="$INSTALL_ROOT/nv"
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT INT TERM

command -v curl >/dev/null 2>&1 || { echo "не найдена команда: curl" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "не найдена команда: tar" >&2; exit 1; }
command -v install >/dev/null 2>&1 || { echo "не найдена команда: install" >&2; exit 1; }

mkdir -p "$INSTALL_ROOT"
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/nv-linux.tar.gz"
tar -xzf "$TMP_DIR/nv-linux.tar.gz" -C "$TMP_DIR"
NV_BIN="$(find "$TMP_DIR" -maxdepth 2 -type f -name 'nv' | head -n 1)"
[ -n "$NV_BIN" ] || { echo "payload nv не найден" >&2; exit 1; }
install -m 0755 "$NV_BIN" "$TARGET"
echo "Установлен или обновлен nv в $TARGET"
