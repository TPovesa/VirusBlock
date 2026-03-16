#!/usr/bin/env sh
set -eu

BASE_URL="${NEURALV_BASE_URL:-https://sosiskibot.ru}"
MANIFEST_URL="${NEURALV_MANIFEST_URL:-$BASE_URL/basedata/api/releases/manifest}"
INSTALL_ROOT="${NV_INSTALL_ROOT:-$HOME/.local/bin}"
TARGET="$INSTALL_ROOT/nv"
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT INT TERM

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "не найдена команда: $1" >&2
    exit 1
  }
}

read_manifest_field() {
  manifest_json="$1"
  platform="$2"
  field="$3"
  python3 -c 'import json,sys
manifest=json.loads(sys.argv[1])
platform=sys.argv[2].lower(); field=sys.argv[3]
for item in manifest.get("artifacts", []):
    key=str(item.get("platform", "")).lower()
    if key == platform:
        value=item.get(field)
        if value is None:
            value=item.get(field.replace("_", ""))
        if isinstance(value, (dict, list)):
            print(json.dumps(value))
        else:
            print(value or "")
        break' "$manifest_json" "$platform" "$field"
}

fetch_manifest() {
  require_cmd curl
  require_cmd python3
  curl -fsSL "$MANIFEST_URL"
}

install_nv() {
  require_cmd tar
  require_cmd install
  mkdir -p "$INSTALL_ROOT"
  manifest="$(fetch_manifest)"
  nv_url="$(read_manifest_field "$manifest" nv download_url)"
  if [ -z "$nv_url" ]; then
    echo "артефакт nv не найден в manifest" >&2
    exit 1
  fi
  curl -fsSL "$nv_url" -o "$TMP_DIR/nv.tar.gz"
  tar -xzf "$TMP_DIR/nv.tar.gz" -C "$TMP_DIR"
  nv_bin="$(find "$TMP_DIR" -maxdepth 2 -type f -name 'nv' | head -n 1)"
  if [ -z "$nv_bin" ]; then
    echo "payload nv не найден внутри архива" >&2
    exit 1
  fi
  install -m 0755 "$nv_bin" "$TARGET"
  echo "Установлен nv в $TARGET"
  echo "Дальше:"
  echo "  nv install neuralv@latest"
  echo "  nv -v"
}

case "${1:-install}" in
  install|update)
    install_nv
    ;;
  uninstall)
    rm -f "$TARGET"
    echo "Удалён nv из $INSTALL_ROOT"
    ;;
  *)
    echo "Использование: $0 [install|update|uninstall]" >&2
    exit 1
    ;;
esac
