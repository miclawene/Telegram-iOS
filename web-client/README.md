# Telegram WebK — Relay Transport Patch

Patches the official [Telegram WebK](https://github.com/morethanwords/tweb) client
to route all Telegram DC connections through a relay server instead of connecting
directly.  From the browser's (and DPI's) perspective, traffic goes to a normal
HTTPS/WebSocket endpoint.

## Components

| File | Purpose |
|------|---------|
| `src/transport/relay-config.ts` | Relay server list, DNS TXT updates, fallback logic |
| `src/transport/relay-transport.ts` | WSS→relay transport with retry / failover |
| `src/patch-instructions.md` | Manual patching guide for WebK |
| `build.sh` | Automated build script |

## Quick start

### 1. Configure relay servers

Edit `src/transport/relay-config.ts`:

```ts
const BUILTIN_CONFIG: RelayConfig = {
  servers: [
    { url: 'wss://relay.example.com', token: 'secret', label: 'primary' },
  ],
  ...
};
```

### 2. Build

```bash
chmod +x build.sh

# Simple build
./build.sh --relay-url wss://relay.example.com --token secret

# Custom output directory
./build.sh \
  --relay-url wss://relay.example.com \
  --token secret \
  --output-dir /var/www/html/tg
```

The script will:
1. Clone Telegram WebK from GitHub
2. Copy the relay transport files into the right location
3. Patch the WebSocket transport to use the relay
4. Run the WebK production build
5. Copy the output to your target directory

### 3. Serve

Serve the output directory with any static file server (nginx, Caddy, S3, etc.):

```nginx
server {
    listen 443 ssl http2;
    server_name web.example.com;
    root /var/www/html/tg;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Failover behaviour

`RelayTransport` implements automatic failover:

1. Tries the first relay server up to `retriesPerRelay` times
2. On failure, moves to the next server in the list
3. After exhausting all servers, reports error to the MTProto layer and restarts
4. Uses exponential backoff: 500ms → 1s → 2s → 4s (cap 30s)
5. DNS TXT polling updates the live server list every hour

## Dynamic config update

You can update the relay list without rebuilding by:

**DNS TXT record** (automatic — checked every hour):
```
_relay.example.com  TXT  '{"servers":[{"url":"wss://new-relay.com","token":"s3cr3t"}]}'
```

**Runtime injection** (set before app bundle loads):
```html
<script>
window.__RELAY_CONFIG__ = {
  servers: [{ url: 'wss://new-relay.com', token: 's3cr3t' }]
};
</script>
```

## Security

- The relay is a **transparent pipe** — it never sees decrypted content
- Telegram's MTProto encryption is end-to-end and unaffected
- Auth tokens are passed in the WSS query string (encrypted by TLS)
- Do not commit tokens — use build-time environment variables or runtime injection
