#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — Full VPS setup for the Telegram relay
#
# Tested on: Ubuntu 22.04 / 24.04
#
# What this script does:
#   1. Installs Docker, Docker Compose, certbot, nginx
#   2. Opens firewall ports 80 and 443
#   3. Obtains a Let's Encrypt TLS certificate for the relay domain
#   4. Starts the relay stack with docker-compose
#
# Usage:
#   chmod +x setup.sh
#   sudo ./setup.sh --domain relay.example.com --email admin@example.com [--token secret]
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Parse arguments ───────────────────────────────────────────────────────────

DOMAIN=""
EMAIL=""
AUTH_TOKEN=""
RELAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/relay-server"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2";     shift 2 ;;
    --email)  EMAIL="$2";      shift 2 ;;
    --token)  AUTH_TOKEN="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: sudo $0 --domain <domain> --email <email> [--token <auth_token>]"
  exit 1
fi

# ── Helper functions ──────────────────────────────────────────────────────────

info()  { echo -e "\033[1;32m[INFO]\033[0m  $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m  $*"; }
error() { echo -e "\033[1;31m[ERROR]\033[0m $*"; exit 1; }

require_root() {
  [[ $EUID -eq 0 ]] || error "This script must be run as root (use sudo)"
}

# ── 1. System prerequisites ───────────────────────────────────────────────────

require_root
info "Updating package list..."
apt-get update -qq

info "Installing prerequisites..."
apt-get install -y -qq \
  ca-certificates curl gnupg lsb-release ufw nginx certbot python3-certbot-nginx

# ── 2. Docker ─────────────────────────────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | tee /etc/apt/sources.list.d/docker.list >/dev/null

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable docker --now
  info "Docker installed: $(docker --version)"
else
  info "Docker already installed: $(docker --version)"
fi

# ── 3. Firewall ───────────────────────────────────────────────────────────────

info "Configuring UFW firewall..."
ufw allow ssh    >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp>/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true
info "Firewall: SSH, HTTP, HTTPS allowed"

# ── 4. Stop nginx (certbot needs port 80) ────────────────────────────────────

systemctl stop nginx 2>/dev/null || true

# ── 5. Obtain TLS certificate ─────────────────────────────────────────────────

info "Obtaining Let's Encrypt certificate for $DOMAIN..."
certbot certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  --email "$EMAIL" \
  -d "$DOMAIN" || error "certbot failed — is the domain pointing to this server's IP?"

info "Certificate obtained: /etc/letsencrypt/live/$DOMAIN/"

# ── 6. Configure relay server ─────────────────────────────────────────────────

info "Configuring relay server..."

cd "$RELAY_DIR"
cp -n .env.example .env

# Update .env with actual values
sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|"              .env
sed -i "s|^AUTH_TOKEN=.*|AUTH_TOKEN=${AUTH_TOKEN}|"  .env

# Substitute domain in nginx.conf
sed "s|\${DOMAIN}|${DOMAIN}|g" nginx.conf > /tmp/relay-nginx.conf
cp /tmp/relay-nginx.conf /etc/nginx/sites-available/relay
ln -sf /etc/nginx/sites-available/relay /etc/nginx/sites-enabled/relay
rm -f /etc/nginx/sites-enabled/default

# ── 7. Start the stack ────────────────────────────────────────────────────────

info "Starting relay stack..."
docker compose up -d --build

# ── 8. Start nginx ────────────────────────────────────────────────────────────

systemctl start nginx
systemctl enable nginx

# Wait for the relay to become healthy
info "Waiting for relay to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

nginx -t && nginx -s reload

# ── 9. Verify ─────────────────────────────────────────────────────────────────

info "Verifying setup..."
if curl -sf "https://${DOMAIN}/healthz" >/dev/null; then
  info "Health check OK"
else
  warn "Health check failed — check nginx and relay logs"
fi

# ── 10. Auto-renewal cron ─────────────────────────────────────────────────────

CRON_JOB="0 3 * * * certbot renew --quiet --post-hook 'nginx -s reload'"
(crontab -l 2>/dev/null | grep -qF "certbot renew") || \
  (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
info "Certificate auto-renewal cron installed"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Relay setup complete!                                   ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Domain  : https://${DOMAIN}"
echo "║  WS URL  : wss://${DOMAIN}/dc/2"
echo "║  Auth    : ${AUTH_TOKEN:-<none — set AUTH_TOKEN in .env>}"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  • Add your domain behind Cloudflare for domain fronting"
echo "  • Run ./monitoring.sh to check relay health"
echo "  • Run ./rotate-domain.sh when you need a new domain"
