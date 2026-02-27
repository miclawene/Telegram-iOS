#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build.sh — Build the relay-patched Telegram WebK
#
# Usage:
#   ./build.sh [--relay-url wss://relay.example.com] [--token secret]
#              [--clone-dir /path/to/tweb] [--output-dir /path/to/dist]
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

TWEB_REPO="https://github.com/morethanwords/tweb.git"
CLONE_DIR="${CLONE_DIR:-/tmp/tweb}"
OUTPUT_DIR="${OUTPUT_DIR:-$(pwd)/dist}"
RELAY_URL="${RELAY_URL:-wss://relay.example.com}"
RELAY_TOKEN="${RELAY_TOKEN:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Argument parsing ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --relay-url)   RELAY_URL="$2";   shift 2 ;;
    --token)       RELAY_TOKEN="$2"; shift 2 ;;
    --clone-dir)   CLONE_DIR="$2";   shift 2 ;;
    --output-dir)  OUTPUT_DIR="$2";  shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "═══════════════════════════════════════════════"
echo "  Telegram WebK + Relay Transport Build"
echo "  Relay URL : $RELAY_URL"
echo "  Clone dir : $CLONE_DIR"
echo "  Output dir: $OUTPUT_DIR"
echo "═══════════════════════════════════════════════"

# ── 1. Clone WebK ─────────────────────────────────────────────────────────────

if [[ ! -d "$CLONE_DIR/.git" ]]; then
  echo "[1/5] Cloning Telegram WebK..."
  git clone --depth 1 "$TWEB_REPO" "$CLONE_DIR"
else
  echo "[1/5] Updating Telegram WebK..."
  git -C "$CLONE_DIR" pull --ff-only
fi

# ── 2. Copy relay transport sources ──────────────────────────────────────────

echo "[2/5] Copying relay transport files..."
RELAY_TARGET="$CLONE_DIR/src/lib/mtproto/transports/relay"
mkdir -p "$RELAY_TARGET"
cp "$SCRIPT_DIR/src/transport/relay-transport.ts" "$RELAY_TARGET/"
cp "$SCRIPT_DIR/src/transport/relay-config.ts"    "$RELAY_TARGET/"

# ── 3. Patch relay-config with actual server URLs ────────────────────────────

echo "[3/5] Injecting relay server config..."

# Escape special chars for sed
RELAY_URL_ESC=$(printf '%s\n' "$RELAY_URL" | sed 's/[\/&]/\\&/g')
TOKEN_LINE=""
if [[ -n "$RELAY_TOKEN" ]]; then
  TOKEN_LINE=", token: '${RELAY_TOKEN}'"
fi

sed -i "s|wss://relay1.example.com|${RELAY_URL_ESC}|g" "$RELAY_TARGET/relay-config.ts"

# ── 4. Patch the WebSocket transport ─────────────────────────────────────────

echo "[4/5] Patching WebSocket transport..."

WS_FILE="$CLONE_DIR/src/lib/mtproto/transports/websocket.ts"
if [[ ! -f "$WS_FILE" ]]; then
  # Try alternate path
  WS_FILE=$(find "$CLONE_DIR/src" -name "websocket.ts" -path "*/mtproto/*" | head -1)
fi

if [[ -z "$WS_FILE" || ! -f "$WS_FILE" ]]; then
  echo "WARNING: Could not locate WebSocket transport file."
  echo "  Apply the patch manually — see src/patch-instructions.md"
else
  # Check if already patched
  if grep -q "relay-transport" "$WS_FILE" 2>/dev/null; then
    echo "  Already patched, skipping."
  else
    # Prepend the import
    IMPORT_LINE="import { createRelayWebSocket } from './relay/relay-transport';"
    sed -i "1s/^/${IMPORT_LINE}\n/" "$WS_FILE"

    # Replace the WebSocket constructor call
    # Pattern: new WebSocket(`wss://${...}`, ...)
    # This is a best-effort sed; for complex cases see patch-instructions.md
    sed -i \
      "s/new WebSocket(\`wss:\/\/\${[^}]*}\(:[0-9]*\)\?\/apiws\`[^)]*)/createRelayWebSocket(this.dcId)/g" \
      "$WS_FILE"

    echo "  Patched: $WS_FILE"
  fi
fi

# ── 5. Build ──────────────────────────────────────────────────────────────────

echo "[5/5] Installing dependencies and building..."
cd "$CLONE_DIR"
npm ci
npm run build

echo ""
echo "✓ Build complete! Output: $CLONE_DIR/public/"

# Copy to output dir
mkdir -p "$OUTPUT_DIR"
cp -r "$CLONE_DIR/public/." "$OUTPUT_DIR/"
echo "✓ Copied to: $OUTPUT_DIR"
