/**
 * relay-transport.ts
 *
 * Drop-in WebSocket transport for Telegram WebK that routes connections
 * through a relay server instead of connecting directly to Telegram DCs.
 *
 * Usage (patch WebK's MTProto transport layer):
 *
 *   import { RelayTransport } from './relay-transport';
 *
 *   // Replace the WebSocket constructor used by the MTProto layer:
 *   const transport = new RelayTransport(dcId, {
 *     onMessage: (data) => { ... },   // called with each binary frame from Telegram
 *     onOpen:    ()     => { ... },
 *     onClose:   (code, reason) => { ... },
 *     onError:   (err)  => { ... },
 *   });
 *
 *   transport.send(buffer);    // send bytes toward Telegram
 *   transport.close();         // gracefully close
 */

import { relayConfig, type RelayServer } from './relay-config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransportCallbacks {
  onMessage: (data: ArrayBuffer) => void;
  onOpen:    () => void;
  onClose:   (code: number, reason: string) => void;
  onError:   (err: Error) => void;
}

export interface RelayTransportOptions {
  /** Override the timeout for a single connection attempt (ms) */
  connectTimeoutMs?: number;
}

type TransportState = 'connecting' | 'open' | 'closing' | 'closed';

// ─── RelayTransport ───────────────────────────────────────────────────────────

export class RelayTransport {
  private state: TransportState = 'connecting';
  private ws: WebSocket | null = null;
  private sendQueue: ArrayBuffer[] = [];

  /** Index into relayConfig.servers for the current connection attempt */
  private serverIndex   = 0;
  private retryCount    = 0;
  private destroyed     = false;

  constructor(
    private readonly dcId: number,
    private readonly callbacks: TransportCallbacks,
    private readonly options: RelayTransportOptions = {},
  ) {
    this.connect();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Send binary data toward Telegram.  Queued until the connection is open. */
  send(data: ArrayBuffer | Uint8Array): void {
    if (this.state === 'closed' || this.state === 'closing') return;
    const buffer = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (this.state === 'open' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    } else {
      this.sendQueue.push(buffer as ArrayBuffer);
    }
  }

  /** Gracefully close the transport. */
  close(code = 1000, reason = 'closed'): void {
    this.destroyed = true;
    this.state = 'closing';
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) {
      this.ws.close(code, reason);
    }
  }

  get currentState(): TransportState {
    return this.state;
  }

  // ── Internal connection logic ──────────────────────────────────────────────

  private connect(): void {
    if (this.destroyed) return;

    const servers = relayConfig.servers;
    if (servers.length === 0) {
      this.fail(new Error('No relay servers configured'));
      return;
    }

    // Rotate through servers: try each retriesPerRelay times before moving on
    const server = servers[this.serverIndex % servers.length];
    const url    = this.buildUrl(server);

    console.info(
      `[RelayTransport] Connecting to DC${this.dcId} via ${server.label ?? server.url} (attempt ${this.retryCount + 1})`,
    );

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.scheduleRetry(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    ws.binaryType = 'arraybuffer';

    const timeout = setTimeout(() => {
      console.warn(`[RelayTransport] Connect timeout to ${server.label ?? server.url}`);
      ws.close();
      this.scheduleRetry(new Error('Connect timeout'));
    }, this.options.connectTimeoutMs ?? relayConfig.connectTimeoutMs);

    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      if (this.destroyed) { ws.close(); return; }

      this.ws    = ws;
      this.state = 'open';
      this.retryCount  = 0;

      // Flush queued sends
      for (const buf of this.sendQueue) ws.send(buf);
      this.sendQueue = [];

      console.info(`[RelayTransport] Connected to DC${this.dcId} via ${server.label ?? server.url}`);
      this.callbacks.onOpen();
    });

    ws.addEventListener('message', (ev: MessageEvent<ArrayBuffer>) => {
      if (this.state === 'open') {
        this.callbacks.onMessage(ev.data);
      }
    });

    ws.addEventListener('close', (ev: CloseEvent) => {
      clearTimeout(timeout);
      if (this.destroyed) {
        this.state = 'closed';
        this.callbacks.onClose(ev.code, ev.reason);
        return;
      }

      // Unexpected close — try to reconnect
      console.warn(
        `[RelayTransport] WS closed (code=${ev.code}) to ${server.label ?? server.url} — retrying`,
      );
      this.scheduleRetry(new Error(`WS closed: ${ev.code}`));
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      // The actual error info is rarely available in browsers; the 'close' event fires next
      console.warn(`[RelayTransport] WS error on ${server.label ?? server.url}`);
    });
  }

  private buildUrl(server: RelayServer): string {
    const base = server.url.replace(/\/$/, '');
    const path = `/dc/${this.dcId}`;
    const qs   = server.token ? `?token=${encodeURIComponent(server.token)}` : '';
    return `${base}${path}${qs}`;
  }

  private scheduleRetry(err: Error): void {
    if (this.destroyed) return;

    this.ws    = null;
    this.state = 'connecting';
    this.retryCount++;

    const maxRetries  = relayConfig.retriesPerRelay;
    const serverCount = relayConfig.servers.length;

    if (this.retryCount >= maxRetries) {
      // Exhausted retries for current server — move to next
      this.serverIndex = (this.serverIndex + 1) % serverCount;
      this.retryCount  = 0;

      if (this.serverIndex === 0) {
        // We've cycled through all servers — report error but keep trying
        console.error('[RelayTransport] All relay servers failed:', err.message);
        this.callbacks.onError(err);
      }
    }

    // Exponential backoff: 500ms, 1s, 2s, 4s, cap at 30s
    const delayMs = Math.min(500 * Math.pow(2, this.retryCount), 30_000);
    console.info(`[RelayTransport] Retry in ${delayMs}ms (server ${this.serverIndex})`);
    setTimeout(() => this.connect(), delayMs);
  }

  private fail(err: Error): void {
    this.state    = 'closed';
    this.destroyed = true;
    this.callbacks.onError(err);
    this.callbacks.onClose(4000, err.message);
  }
}

// ─── WebSocket factory (monkey-patch helper) ──────────────────────────────────

/**
 * Returns a WebSocket-compatible factory that transparently routes connections
 * through the relay.  You can pass this as the `webSocketConstructor` option
 * to mtproto-core or similar libraries.
 *
 * The factory wraps RelayTransport in a minimal WebSocket-like interface so
 * it can be used as a drop-in replacement with minimal code changes.
 */
export function createRelayWebSocket(dcId: number): WebSocket {
  // We create a MessageChannel pair and expose the external port as a fake WS
  // object.  This avoids importing Node.js streams in browser context.
  //
  // For production, prefer wiring RelayTransport directly into WebK's
  // connection layer — see patch-instructions.md for the recommended approach.

  const listeners: Record<string, EventListenerOrEventListenerObject[]> = {};

  function emit(type: string, event: Event) {
    (listeners[type] ?? []).forEach(l =>
      typeof l === 'function' ? l(event) : l.handleEvent(event),
    );
  }

  let _readyState = WebSocket.CONNECTING;
  const sendQueue: ArrayBuffer[] = [];

  const transport = new RelayTransport(dcId, {
    onOpen: () => {
      _readyState = WebSocket.OPEN;
      emit('open', new Event('open'));
    },
    onMessage: (data) => {
      const ev = new MessageEvent('message', { data });
      emit('message', ev);
    },
    onClose: (code, reason) => {
      _readyState = WebSocket.CLOSED;
      emit('close', new CloseEvent('close', { code, reason, wasClean: code === 1000 }));
    },
    onError: () => {
      emit('error', new Event('error'));
    },
  });

  // Minimal WebSocket-compatible shim
  const fakeWs = {
    get readyState()  { return _readyState; },
    binaryType: 'arraybuffer' as BinaryType,
    send(data: ArrayBuffer | Uint8Array) { transport.send(data); },
    close(code?: number, reason?: string) { transport.close(code, reason); },
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      (listeners[type] ??= []).push(listener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners[type] = (listeners[type] ?? []).filter(l => l !== listener);
    },
    dispatchEvent(event: Event): boolean {
      emit(event.type, event); return true;
    },
    // WebSocket constants
    CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
    onopen:    null, onmessage: null, onclose: null, onerror: null,
    url: '',
    protocol: '',
    extensions: '',
    bufferedAmount: 0,
  } as unknown as WebSocket;

  return fakeWs;
}
