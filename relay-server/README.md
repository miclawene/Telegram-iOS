# Telegram Relay Server

A **WebSocket → TCP relay** that makes Telegram traffic look like ordinary HTTPS/WebSocket connections to Deep Packet Inspection systems.

## Architecture

```
Client (WSS)  ──►  nginx (TLS)  ──►  Node.js relay  ──►  Telegram DC (TCP 443)
```

- Clients connect via `wss://your-domain.com/dc/<1-5>`
- nginx terminates TLS and proxies the WebSocket upgrade
- Node.js opens a raw TCP socket to the chosen Telegram DC and pipes bytes in both directions
- Any non-WebSocket HTTP request receives the **decoy website** instead

## Quick Start

### Prerequisites

- Ubuntu/Debian VPS with Docker + Docker Compose installed
- A domain pointing at the VPS IP (A record)
- Ports 80 and 443 open in the firewall

### 1. Clone & configure

```bash
git clone https://github.com/your-org/telegram-relay.git
cd relay-server
cp .env.example .env
nano .env   # set DOMAIN, AUTH_TOKEN, etc.
```

### 2. Obtain TLS certificate

```bash
# First-time only: get a Let's Encrypt certificate
docker-compose run --rm certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d your-domain.com \
  --email admin@your-domain.com \
  --agree-tos --non-interactive
```

### 3. Start the stack

```bash
docker-compose up -d
```

### 4. Verify

```bash
# Health check
curl https://your-domain.com/healthz

# WebSocket test (requires wscat: npm i -g wscat)
wscat -c "wss://your-domain.com/dc/2?token=YOUR_TOKEN"

# Decoy site
curl https://your-domain.com/
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Internal Node.js port |
| `AUTH_TOKEN` | _(empty)_ | Shared secret; empty = no auth |
| `MAX_CONNECTIONS` | `1000` | Soft cap on simultaneous relays |
| `LOG_LEVEL` | `info` | `info` / `warn` / `error` |
| `DC_LIST` | _(empty)_ | Override DC endpoints `1=host:port,...` |
| `DOMAIN` | — | Your domain (used by nginx template) |

## DC Endpoints

| DC | IP | Port |
|---|---|---|
| 1 | 149.154.175.53 | 443 |
| 2 | 149.154.167.51 | 443 |
| 3 | 149.154.175.100 | 443 |
| 4 | 149.154.167.91 | 443 |
| 5 | 91.108.56.130 | 443 |

## WebSocket URL format

```
wss://relay.example.com/dc/<DC_NUMBER>?token=<AUTH_TOKEN>
```

Example: `wss://relay.example.com/dc/2?token=s3cr3t`

## Security

- **No traffic logging** — the relay is a blind pipe; payload bytes are never inspected or stored
- MTProto provides end-to-end encryption; the relay only sees ciphertext
- `AUTH_TOKEN` prevents use as an open proxy
- nginx rate-limits WebSocket upgrades (10 r/s per IP)
- Docker container runs as non-root user with read-only filesystem

## Metrics

```bash
# Requires X-Auth-Token header when AUTH_TOKEN is set
curl -H "X-Auth-Token: $AUTH_TOKEN" https://your-domain.com/metrics
```

Response:
```json
{
  "uptime_seconds": 3600,
  "active_connections": 42,
  "total_connections": 1500,
  "total_errors": 3
}
```

## Updating

```bash
docker-compose pull
docker-compose build --no-cache relay
docker-compose up -d
```

## Capacity

One relay instance comfortably handles **~1000 concurrent connections** at ~30 MB RSS.
Each connection uses two sockets (WS + TCP) and two Node.js stream objects.
