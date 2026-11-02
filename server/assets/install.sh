#!/bin/sh
# wtow CLI 安装脚本，由服务端渲染。见 DESIGN 16.3。
# macOS 与 Linux 通用；Windows 用户请用 install.ps1 或去 /download 手动下载。
set -eu

SERVER_URL="__WTOW_BASE_URL__"
BASE_URL="${WTOW_BASE_URL:-$SERVER_URL}"
PUBKEY="__WTOW_MINISIGN_PUBKEY__"
BIN_DIR="${WTOW_BIN_DIR:-$HOME/.local/bin}"

die() { echo "wtow install: $*" >&2; exit 1; }

# HTTP 只允许三种情况：本机地址、服务端自己声明的对外地址（部署方已选择不上 TLS）、
# 显式设了 WTOW_ALLOW_HTTP=1。其它被改写过的 http 地址一律拒绝。
case "$BASE_URL" in
  https://*) CURL="curl -fsSL --proto =https --tlsv1.2" ;;
  http://127.0.0.1*|http://localhost*) CURL="curl -fsSL" ;;
  http://*)
    if [ "$BASE_URL" = "$SERVER_URL" ] || [ "${WTOW_ALLOW_HTTP:-0}" = "1" ]; then
      CURL="curl -fsSL"
      echo "wtow install: warning: installing over plain HTTP — tokens will be transmitted unencrypted" >&2
    else
      die "base url must be https (set WTOW_ALLOW_HTTP=1 to override for private networks): $BASE_URL"
    fi
    ;;
  *) die "unsupported base url scheme: $BASE_URL" ;;
esac

case "$(uname -s)" in
  Darwin) os=apple-darwin ;;
  Linux)  os=unknown-linux-musl ;;
  *)      die "unsupported OS: $(uname -s)" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=aarch64 ;;
  x86_64|amd64)  arch=x86_64 ;;
  *)             die "unsupported arch: $(uname -m)" ;;
esac
target="$arch-$os"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

$CURL "$BASE_URL/dl/latest.json" -o "$tmp/latest.json" || die "cannot fetch latest.json"

if [ -n "$PUBKEY" ]; then
  command -v minisign >/dev/null 2>&1 || die "minisign is required to verify the release"
  $CURL "$BASE_URL/dl/latest.json.minisig" -o "$tmp/latest.json.minisig" || die "missing signature"
  minisign -Vm "$tmp/latest.json" -x "$tmp/latest.json.minisig" -P "$PUBKEY" >/dev/null \
    || die "signature verification failed"
else
  echo "wtow install: note: server has no signing key configured; only sha256 is checked" >&2
fi

# latest.json 由发布流水线生成，格式固定为每个 artifact 一行，用 sed 解析以免依赖 jq。
line=$(grep "\"target\": *\"$target\"" "$tmp/latest.json" || true)
[ -n "$line" ] || die "no build for $target"
url=$(echo "$line" | sed -n 's/.*"url": *"\([^"]*\)".*/\1/p')
sum=$(echo "$line" | sed -n 's/.*"sha256": *"\([0-9a-f]*\)".*/\1/p')
[ -n "$url" ] && [ -n "$sum" ] || die "malformed latest.json"

$CURL "$url" -o "$tmp/wtow.tar.gz" || die "download failed"
if command -v sha256sum >/dev/null 2>&1; then
  got=$(sha256sum "$tmp/wtow.tar.gz" | cut -d' ' -f1)
else
  got=$(shasum -a 256 "$tmp/wtow.tar.gz" | cut -d' ' -f1)
fi
[ "$got" = "$sum" ] || die "sha256 mismatch (got $got, expected $sum)"

tar -xzf "$tmp/wtow.tar.gz" -C "$tmp"
mkdir -p "$BIN_DIR"
install -m 0755 "$tmp/wtow" "$BIN_DIR/wtow"
echo "installed $BIN_DIR/wtow ($("$BIN_DIR/wtow" --version))"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "note: add $BIN_DIR to your PATH" ;; esac
