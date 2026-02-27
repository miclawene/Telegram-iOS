# Cloudflare Setup — Domain Fronting for the Telegram Relay

Routing the relay through Cloudflare makes the origin server IP invisible to DPI
systems — the censor sees only Cloudflare's IP ranges, which are typically not
blocked.

---

## Architecture

```
User → Cloudflare edge (IP: 104.x.x.x) → origin VPS (your relay)
```

DPI inspects the TLS SNI and IP.  With Cloudflare, both belong to Cloudflare.

---

## Step 1: Add the domain to Cloudflare

1. Sign up at <https://cloudflare.com> if you haven't already.
2. **Add site** → enter your relay domain (e.g. `relay.example.com`).
3. Choose the **Free** plan.
4. Cloudflare will scan your existing DNS records.  Add or confirm:
   - `A relay.example.com → <your VPS IP>` with **Proxy: ON** (orange cloud)

---

## Step 2: Configure SSL/TLS

1. Go to **SSL/TLS** → **Overview**.
2. Set encryption mode to **Full (strict)**.
   - "Full" alone allows invalid certs on the origin — we want strict.
   - Your origin must have a valid certificate (from Let's Encrypt or a
     Cloudflare Origin Certificate).
3. Go to **SSL/TLS** → **Edge Certificates**.
   - Enable **Always Use HTTPS**.
   - Enable **HTTP Strict Transport Security (HSTS)** (optional but good).

---

## Step 3: Enable WebSocket support

1. Go to **Network**.
2. Turn **WebSockets: ON**.

Without this, WebSocket upgrades will be rejected by Cloudflare.

---

## Step 4: Cloudflare Origin Certificate (alternative to Let's Encrypt)

If you want to avoid running certbot on the VPS, use a Cloudflare Origin Certificate:

1. **SSL/TLS** → **Origin Server** → **Create Certificate**.
2. Choose RSA 2048, 15-year validity (or shorter).
3. Cloudflare generates a cert + private key — copy both to the VPS:
   ```
   /etc/ssl/cloudflare/origin.crt
   /etc/ssl/cloudflare/origin.key
   ```
4. Update `nginx.conf` to point at these files:
   ```nginx
   ssl_certificate     /etc/ssl/cloudflare/origin.crt;
   ssl_certificate_key /etc/ssl/cloudflare/origin.key;
   ```
5. Install the **Cloudflare Origin CA root** so nginx can verify the chain:
   ```bash
   curl -o /etc/ssl/cloudflare/origin-ca-root.pem \
     https://developers.cloudflare.com/ssl/static/origin_ca_rsa_root.pem
   # Add to nginx.conf:
   # ssl_trusted_certificate /etc/ssl/cloudflare/origin-ca-root.pem;
   ```

> Note: Cloudflare Origin Certificates are **only trusted by Cloudflare**.
> They will fail if accessed directly (bypassing Cloudflare).  This is
> intentional — it prevents your VPS IP from being discovered.

---

## Step 5: (Optional) Restrict origin to Cloudflare IPs only

To prevent direct access to your VPS (which would reveal its IP):

```bash
# /etc/nginx/conf.d/cloudflare-ips.conf
# Generated from https://www.cloudflare.com/ips/

# IPv4
allow 173.245.48.0/20;
allow 103.21.244.0/22;
allow 103.22.200.0/22;
allow 103.31.4.0/22;
allow 141.101.64.0/18;
allow 108.162.192.0/18;
allow 190.93.240.0/20;
allow 188.114.96.0/20;
allow 197.234.240.0/22;
allow 198.41.128.0/17;
allow 162.158.0.0/15;
allow 104.16.0.0/13;
allow 104.24.0.0/14;
allow 172.64.0.0/13;
allow 131.0.72.0/22;

# IPv6
allow 2400:cb00::/32;
allow 2606:4700::/32;
allow 2803:f800::/32;
allow 2405:b500::/32;
allow 2405:8100::/32;
allow 2a06:98c0::/29;
allow 2c0f:f248::/32;

deny all;
```

Include this file from your `server { }` block:
```nginx
include /etc/nginx/conf.d/cloudflare-ips.conf;
```

Keep the IP list updated — Cloudflare publishes their current ranges at
<https://www.cloudflare.com/ips/>.

---

## Step 6: Rate limiting & Security Rules

In the Cloudflare dashboard:

1. **Security** → **WAF** → create a rule:
   - If: `not (http.request.uri.path matches "^/dc/[1-5]$")`
   - And: `http.request.method eq "GET"` and `not cf.bot_management.score ge 30`
   - Action: **Block** (or Challenge)
   - This blocks bots from hammering the decoy site.

2. **Security** → **Bots** → enable **Bot Fight Mode** (free tier).

3. **Speed** → **Optimization** → disable **Rocket Loader** for WebSocket paths.

---

## Verifying the setup

```bash
# Should return Cloudflare IP, not your VPS IP
dig relay.example.com

# Should show "cloudflare" in the Server header
curl -I https://relay.example.com/

# WebSocket should work through Cloudflare
wscat -c wss://relay.example.com/dc/2?token=YOUR_TOKEN
```

---

## Multiple domains for rotation

Create multiple A records (all proxied) pointing to the same VPS:

```
relay1.example.com  A  <VPS IP>  proxied
relay2.example.com  A  <VPS IP>  proxied
relay3.example.com  A  <VPS IP>  proxied
```

Update the `BUILTIN_CONFIG.servers` array in `relay-config.ts` with all
three domains.  The nginx config handles all of them via `server_name`:

```nginx
server_name relay1.example.com relay2.example.com relay3.example.com;
# Use a wildcard cert or separate certs for each
```

When one domain gets blocked, the client automatically falls back to the next.
