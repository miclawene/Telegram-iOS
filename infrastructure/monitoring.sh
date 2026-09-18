#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# monitoring.sh — Relay + Telegram DC health checker
#
# Checks:
#   1. Relay HTTP health endpoint
#   2. Relay WebSocket connectivity (dc/1 through dc/5)
#   3. Direct TCP reachability of each Telegram DC
#   4. TLS certificate expiry
#   5. Docker container status
#
# Usage:
#   ./monitoring.sh [--domain relay.example.com] [--token secret] [--json]
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Parse args ────────────────────────────────────────────────────────────────

DOMAIN="${DOMAIN:-}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
JSON_OUTPUT=false
RELAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/relay-server"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2";     shift 2 ;;
    --token)  AUTH_TOKEN="$2"; shift 2 ;;
    --json)   JSON_OUTPUT=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Load from .env if not provided
if [[ -z "$DOMAIN" && -f "$RELAY_DIR/.env" ]]; then
  DOMAIN=$(grep -E '^DOMAIN=' "$RELAY_DIR/.env" | cut -d= -f2)
fi
if [[ -z "$AUTH_TOKEN" && -f "$RELAY_DIR/.env" ]]; then
  AUTH_TOKEN=$(grep -E '^AUTH_TOKEN=' "$RELAY_DIR/.env" | cut -d= -f2)
fi

# ── DC list ───────────────────────────────────────────────────────────────────

declare -A DC_HOSTS=(
  [1]="149.154.175.53"
  [2]="149.154.167.51"
  [3]="149.154.175.100"
  [4]="149.154.167.91"
  [5]="91.108.56.130"
)

# ── Result accumulator ────────────────────────────────────────────────────────

RESULTS=()
OVERALL_OK=true

pass() { RESULTS+=("PASS|$1"); }
fail() { RESULTS+=("FAIL|$1"); OVERALL_OK=false; }
warn_r() { RESULTS+=("WARN|$1"); }

# ── 1. Relay HTTP health ──────────────────────────────────────────────────────

check_relay_http() {
  local url
  if [[ -n "$DOMAIN" ]]; then
    url="https://${DOMAIN}/healthz"
  else
    url="http://localhost:3000/healthz"
  fi
  if curl -sf --max-time 5 "$url" >/dev/null 2>&1; then
    pass "Relay HTTP health: OK ($url)"
  else
    fail "Relay HTTP health: FAIL ($url)"
  fi
}

# ── 2. Relay WebSocket connectivity ──────────────────────────────────────────

check_relay_ws() {
  if ! command -v websocat &>/dev/null && ! command -v wscat &>/dev/null; then
    warn_r "WebSocket check: SKIP (install websocat or wscat for WS checks)"
    return
  fi
  [[ -z "$DOMAIN" ]] && { warn_r "WS check: SKIP (no domain set)"; return; }

  local qs=""
  [[ -n "$AUTH_TOKEN" ]] && qs="?token=${AUTH_TOKEN}"

  for dc in 1 2; do
    local url="wss://${DOMAIN}/dc/${dc}${qs}"
    # Send empty byte, expect connection to open within 5s
    if command -v websocat &>/dev/null; then
      if echo "" | timeout 5 websocat --binary "$url" >/dev/null 2>&1; then
        pass "Relay WS DC${dc}: OK"
      else
        fail "Relay WS DC${dc}: FAIL"
      fi
    fi
  done
}

# ── 3. Telegram DC TCP reachability ──────────────────────────────────────────

check_telegram_dcs() {
  for dc in "${!DC_HOSTS[@]}"; do
    local host="${DC_HOSTS[$dc]}"
    if timeout 5 bash -c ">/dev/tcp/${host}/443" 2>/dev/null; then
      pass "Telegram DC${dc} (${host}:443): reachable"
    else
      fail "Telegram DC${dc} (${host}:443): UNREACHABLE"
    fi
  done
}

# ── 4. TLS certificate expiry ─────────────────────────────────────────────────

check_tls_expiry() {
  [[ -z "$DOMAIN" ]] && { warn_r "TLS expiry: SKIP (no domain set)"; return; }

  local expiry days
  expiry=$(echo | timeout 5 openssl s_client -servername "$DOMAIN" \
    -connect "${DOMAIN}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null \
    | cut -d= -f2) || { warn_r "TLS expiry: SKIP (openssl failed)"; return; }

  days=$(( ( $(date -d "$expiry" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$expiry" +%s) \
             - $(date +%s) ) / 86400 ))

  if (( days > 14 )); then
    pass "TLS cert expires in ${days} days"
  elif (( days > 0 )); then
    warn_r "TLS cert expires in ${days} days — renew soon!"
  else
    fail "TLS cert EXPIRED"
  fi
}

# ── 5. Docker containers ──────────────────────────────────────────────────────

check_docker() {
  if ! command -v docker &>/dev/null; then
    warn_r "Docker check: SKIP (docker not installed)"
    return
  fi
  for name in telegram-relay telegram-relay-nginx; do
    local status
    status=$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || echo "missing")
    if [[ "$status" == "running" ]]; then
      pass "Docker $name: running"
    else
      fail "Docker $name: $status"
    fi
  done
}

# ── 6. Relay metrics ──────────────────────────────────────────────────────────

check_metrics() {
  local url header=""
  if [[ -n "$DOMAIN" ]]; then
    url="https://${DOMAIN}/metrics"
    [[ -n "$AUTH_TOKEN" ]] && header="-H X-Auth-Token:${AUTH_TOKEN}"
  else
    url="http://localhost:3000/metrics"
  fi

  local metrics
  # shellcheck disable=SC2086
  metrics=$(curl -sf --max-time 5 $header "$url" 2>/dev/null) || { warn_r "Metrics: unavailable"; return; }

  local active total errors
  active=$(echo "$metrics" | grep -oP '"active_connections":\s*\K\d+' || echo "?")
  total=$(echo "$metrics"  | grep -oP '"total_connections":\s*\K\d+'  || echo "?")
  errors=$(echo "$metrics" | grep -oP '"total_errors":\s*\K\d+'       || echo "?")

  pass "Metrics: active=${active} total=${total} errors=${errors}"
}

# ── Run all checks ────────────────────────────────────────────────────────────

check_relay_http
check_relay_ws
check_telegram_dcs
check_tls_expiry
check_docker
check_metrics

# ── Output ────────────────────────────────────────────────────────────────────

if $JSON_OUTPUT; then
  echo "{"
  echo "  \"overall\": \"$( $OVERALL_OK && echo ok || echo fail)\","
  echo "  \"checks\": ["
  for i in "${!RESULTS[@]}"; do
    IFS='|' read -r status msg <<< "${RESULTS[$i]}"
    comma=$( (( i < ${#RESULTS[@]} - 1 )) && echo "," || echo "" )
    echo "    {\"status\": \"${status}\", \"message\": \"${msg}\"}${comma}"
  done
  echo "  ]"
  echo "}"
else
  echo ""
  echo "══════════════════════════════════════════════════"
  echo "  Relay Health Check — $(date -u '+%Y-%m-%d %H:%M UTC')"
  echo "══════════════════════════════════════════════════"
  for result in "${RESULTS[@]}"; do
    IFS='|' read -r status msg <<< "$result"
    case "$status" in
      PASS) echo -e "  \033[1;32m✓ PASS\033[0m  $msg" ;;
      FAIL) echo -e "  \033[1;31m✗ FAIL\033[0m  $msg" ;;
      WARN) echo -e "  \033[1;33m⚠ WARN\033[0m  $msg" ;;
    esac
  done
  echo ""
  if $OVERALL_OK; then
    echo -e "  \033[1;32mOverall: OK\033[0m"
  else
    echo -e "  \033[1;31mOverall: DEGRADED\033[0m"
  fi
  echo ""
fi

$OVERALL_OK && exit 0 || exit 1
