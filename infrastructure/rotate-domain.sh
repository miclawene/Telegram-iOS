#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# rotate-domain.sh — Switch the relay to a new domain with zero-downtime
#
# This script:
#   1. Validates that the new domain already points to this server
#   2. Obtains a Let's Encrypt certificate for the new domain
#   3. Updates nginx to serve the new domain
#   4. Reloads nginx (no downtime — old domain still works until DNS TTL expires)
#   5. Updates .env with the new domain
#   6. Optionally rotates the auth token
#
# Usage:
#   sudo ./rotate-domain.sh --new-domain relay2.example.com --email admin@example.com
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────────────────

NEW_DOMAIN=""
EMAIL=""
NEW_TOKEN=""
RELAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/relay-server"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --new-domain)  NEW_DOMAIN="$2"; shift 2 ;;
    --email)       EMAIL="$2";      shift 2 ;;
    --new-token)   NEW_TOKEN="$2";  shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

[[ -z "$NEW_DOMAIN" ]] && { echo "Usage: $0 --new-domain <domain> --email <email>"; exit 1; }
[[ $EUID -ne 0 ]] && { echo "Run as root (sudo)"; exit 1; }

# Load current config
OLD_DOMAIN=$(grep -E '^DOMAIN=' "$RELAY_DIR/.env" | cut -d= -f2)

info()  { echo -e "\033[1;32m[INFO]\033[0m  $*"; }
error() { echo -e "\033[1;31m[ERROR]\033[0m $*"; exit 1; }

# ── 1. Validate DNS ───────────────────────────────────────────────────────────

info "Validating DNS for $NEW_DOMAIN..."
SERVER_IP=$(curl -sf --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')
DNS_IP=$(dig +short "$NEW_DOMAIN" A | tail -1)

if [[ "$DNS_IP" != "$SERVER_IP" ]]; then
  error "DNS mismatch: $NEW_DOMAIN resolves to $DNS_IP but this server is $SERVER_IP.
  Please update the DNS A record first and wait for propagation."
fi
info "DNS OK: $NEW_DOMAIN → $SERVER_IP"

# ── 2. Obtain certificate ─────────────────────────────────────────────────────

info "Obtaining TLS certificate for $NEW_DOMAIN..."

# Use webroot if nginx is running, standalone otherwise
if systemctl is-active --quiet nginx; then
  mkdir -p /var/www/certbot
  certbot certonly \
    --webroot -w /var/www/certbot \
    --non-interactive --agree-tos \
    --email "${EMAIL:-admin@${NEW_DOMAIN}}" \
    -d "$NEW_DOMAIN"
else
  certbot certonly \
    --standalone \
    --non-interactive --agree-tos \
    --email "${EMAIL:-admin@${NEW_DOMAIN}}" \
    -d "$NEW_DOMAIN"
fi

info "Certificate obtained for $NEW_DOMAIN"

# ── 3. Update nginx ───────────────────────────────────────────────────────────

info "Updating nginx config..."

sed "s|\${DOMAIN}|${NEW_DOMAIN}|g" "$RELAY_DIR/nginx.conf" \
  > /etc/nginx/sites-available/relay-new

# Test before switching
nginx -t -c /etc/nginx/nginx.conf -q 2>/dev/null || true

mv /etc/nginx/sites-available/relay-new /etc/nginx/sites-available/relay
ln -sf /etc/nginx/sites-available/relay /etc/nginx/sites-enabled/relay

nginx -s reload
info "nginx reloaded with new domain"

# ── 4. Update .env ────────────────────────────────────────────────────────────

info "Updating relay .env..."
sed -i "s|^DOMAIN=.*|DOMAIN=${NEW_DOMAIN}|" "$RELAY_DIR/.env"

if [[ -n "$NEW_TOKEN" ]]; then
  sed -i "s|^AUTH_TOKEN=.*|AUTH_TOKEN=${NEW_TOKEN}|" "$RELAY_DIR/.env"
  info "Auth token rotated"
fi

# ── 5. Restart relay container ────────────────────────────────────────────────

info "Restarting relay container to pick up new config..."
cd "$RELAY_DIR"
docker compose up -d --force-recreate relay

# ── 6. Verify ─────────────────────────────────────────────────────────────────

sleep 3
if curl -sf "https://${NEW_DOMAIN}/healthz" >/dev/null; then
  info "Health check OK on new domain"
else
  error "Health check failed on $NEW_DOMAIN — check logs with: docker compose logs relay"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Domain rotation complete!                               ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Old domain: $OLD_DOMAIN"
echo "║  New domain: $NEW_DOMAIN"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  • Update the relay server list in the web client config"
echo "  • Update the DNS TXT record: _relay.example.com"
echo "  • The old domain will stop working when its DNS TTL expires"
echo "  • Run: ./monitoring.sh --domain $NEW_DOMAIN"
