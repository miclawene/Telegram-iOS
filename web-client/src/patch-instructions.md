# Patching Telegram WebK to use the relay transport

This guide explains how to integrate `relay-transport.ts` and `relay-config.ts`
into the official [Telegram WebK](https://github.com/morethanwords/tweb) source.

> **Note**: WebK updates frequently.  The exact file paths and class names may
> change between releases.  Always check the git log of the upstream repo when
> upgrading.

---

## 1. Prerequisites

```bash
git clone https://github.com/morethanwords/tweb.git
cd tweb
npm ci

# Copy our transport files into the project
cp -r /path/to/web-client/src/transport ./src/lib/mtproto/transports/relay/
```

---

## 2. Configure relay servers

Edit `src/lib/mtproto/transports/relay/relay-config.ts` and update the
`BUILTIN_CONFIG.servers` array with your relay domains and auth tokens:

```ts
const BUILTIN_CONFIG: RelayConfig = {
  servers: [
    { url: 'wss://relay1.example.com', token: 'your-token-here', label: 'primary' },
    { url: 'wss://relay2.example.com', token: 'your-token-here', label: 'secondary' },
  ],
  dnsTxtHost: '_relay.example.com',
  ...
};
```

---

## 3. Patch the WebSocket transport

WebK abstracts its MTProto transport behind `MTTransport`.  The WebSocket
variant lives in:

```
src/lib/mtproto/transports/websocket.ts   (or webSocket.ts — check the repo)
```

Find the line where a native `WebSocket` is constructed:

```ts
// BEFORE (connects directly to Telegram DC)
this.ws = new WebSocket(`wss://${ip}:${port}/apiws`, 'binary');
```

Replace it with:

```ts
// AFTER (connects via relay)
import { createRelayWebSocket } from './relay/relay-transport';

this.ws = createRelayWebSocket(this.dcId);
// The shim routes the connection through the best available relay server.
// The MTProto layer above sees a normal WebSocket-compatible object.
```

If the codebase uses a `webSocketConstructor` dependency-injection pattern,
you can instead pass `createRelayWebSocket` as the constructor:

```ts
// In the transport factory / DI container
import { createRelayWebSocket } from './relay/relay-transport';

const transportOptions = {
  webSocketConstructor: (url: string) => {
    // Extract dcId from the URL (Telegram puts dc<N> in the hostname or path)
    const dcMatch = url.match(/dc(\d)/i);
    const dcId    = dcMatch ? parseInt(dcMatch[1], 10) : 2;
    return createRelayWebSocket(dcId);
  },
};
```

---

## 4. Inject runtime config (optional)

To allow relay-server domains to be updated without a new build, inject the
config via a `<script>` tag in `public/index.html` **before** the app bundle:

```html
<script>
  window.__RELAY_CONFIG__ = {
    servers: [
      { url: 'wss://relay1.example.com', token: 'secret', label: 'primary' },
      { url: 'wss://relay2.example.com', token: 'secret', label: 'secondary' },
    ]
  };
</script>
<script src="./twebapp.js"></script>
```

Or fetch the config from a known-good endpoint at startup:

```ts
// In your app bootstrap:
const cfg = await fetch('https://config.example.com/relay.json').then(r => r.json());
window.__RELAY_CONFIG__ = cfg;
// Then initialize Telegram Web normally
```

---

## 5. Build

```bash
npm run build          # production build
# or
npm run dev            # dev server (HMR)
```

The compiled app in `public/` now routes all Telegram DC connections through
the relay servers.

---

## 6. Verify

Open DevTools → Network → filter by WS.  You should see connections to
`wss://relay1.example.com/dc/N` instead of direct Telegram IP addresses.

Telegram should work normally: auth, messages, files, calls.

---

## Fallback behaviour

`RelayTransport` tries each relay server in order.  If a server fails or times
out, it automatically moves to the next one.  After exhausting all servers it
reports an error to the MTProto layer (which will retry at its own cadence)
and simultaneously restarts the relay-server loop.

Relay list updates arrive within 1 hour via the DNS TXT mechanism described in
`relay-config.ts`.

---

## Security notes

- The relay is a **blind pipe** — it never decrypts or inspects MTProto payload.
- End-to-end encryption for Secret Chats is unaffected.
- Cloud chat data is encrypted by Telegram's servers with your session keys as usual.
- Do **not** hardcode tokens in public repositories — use environment variables
  or `window.__RELAY_CONFIG__` injected at deploy time.
