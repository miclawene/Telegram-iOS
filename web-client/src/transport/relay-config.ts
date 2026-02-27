/**
 * relay-config.ts
 *
 * Relay server list and configuration for the Telegram Web relay transport.
 *
 * Priority order:
 *  1. Runtime config injected via __RELAY_CONFIG__ global (set at build time or by a
 *     config-update fetch)
 *  2. DNS TXT record lookup (async, updates the live list)
 *  3. Hardcoded built-in list (last resort)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RelayServer {
  /** WSS base URL, e.g. "wss://relay.example.com" */
  url: string;
  /** Optional shared secret passed as ?token=XXX */
  token?: string;
  /** Human-readable label for logging (never sent over the wire) */
  label?: string;
}

export interface RelayConfig {
  servers: RelayServer[];
  /**
   * DNS TXT hostname to query for live config updates.
   * The TXT record value must be a JSON string:
   *   '{"servers":[{"url":"wss://...","token":"..."}]}'
   */
  dnsTxtHost?: string;
  /** How often (ms) to re-fetch the DNS TXT config (default 3 600 000 = 1 h) */
  dnsPollIntervalMs?: number;
  /** Connection timeout per relay attempt (ms) */
  connectTimeoutMs?: number;
  /** How many times to retry a relay before moving to the next one */
  retriesPerRelay?: number;
}

// ─── Built-in defaults (edit before building) ────────────────────────────────

const BUILTIN_CONFIG: RelayConfig = {
  servers: [
    // Primary relay — replace with your domain
    { url: 'wss://relay1.example.com', label: 'relay1' },
    // Secondary relay — fallback
    { url: 'wss://relay2.example.com', label: 'relay2' },
    // Tertiary relay — last resort
    { url: 'wss://relay3.example.com', label: 'relay3' },
  ],
  dnsTxtHost:        '_relay.example.com',
  dnsPollIntervalMs: 60 * 60 * 1000, // 1 hour
  connectTimeoutMs:  8_000,
  retriesPerRelay:   2,
};

// ─── Runtime injection via build-time global ──────────────────────────────────

declare global {
  // Injected by the build script or a <script> tag in index.html
  var __RELAY_CONFIG__: Partial<RelayConfig> | undefined;
}

// ─── Config manager ───────────────────────────────────────────────────────────

class RelayConfigManager {
  private config: RelayConfig;
  private dnsTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Merge built-in defaults with any injected runtime config
    this.config = {
      ...BUILTIN_CONFIG,
      ...(typeof globalThis.__RELAY_CONFIG__ === 'object' ? globalThis.__RELAY_CONFIG__ : {}),
      servers: [
        ...((globalThis.__RELAY_CONFIG__?.servers) ?? []),
        ...BUILTIN_CONFIG.servers,
      ],
    };

    // Remove duplicates (same url)
    this.config.servers = this.dedup(this.config.servers);

    // Start background DNS TXT polling if a host is configured
    if (this.config.dnsTxtHost) {
      this.scheduleDnsPoll();
    }
  }

  /** Current server list (live copy, may change after DNS update) */
  get servers(): RelayServer[] {
    return this.config.servers;
  }

  get connectTimeoutMs(): number {
    return this.config.connectTimeoutMs ?? 8_000;
  }

  get retriesPerRelay(): number {
    return this.config.retriesPerRelay ?? 2;
  }

  // ── DNS TXT polling ──────────────────────────────────────────────────────

  private scheduleDnsPoll(): void {
    const interval = this.config.dnsPollIntervalMs ?? 60 * 60 * 1000;
    // Poll immediately, then on interval
    void this.fetchDnsConfig();
    this.dnsTimer = setInterval(() => void this.fetchDnsConfig(), interval);
  }

  private async fetchDnsConfig(): Promise<void> {
    const host = this.config.dnsTxtHost;
    if (!host) return;

    try {
      // Use the Cloudflare DoH JSON API — works in browsers without extra libs
      const res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=TXT`,
        { headers: { Accept: 'application/dns-json' } },
      );
      if (!res.ok) return;
      const data = await res.json() as { Answer?: { data: string }[] };
      const txt  = data.Answer?.[0]?.data?.replace(/^"|"$/g, '');
      if (!txt) return;

      const parsed = JSON.parse(txt) as Partial<RelayConfig>;
      if (Array.isArray(parsed.servers) && parsed.servers.length > 0) {
        // Prepend DNS servers (highest priority), keep built-in as fallback
        this.config.servers = this.dedup([
          ...parsed.servers,
          ...BUILTIN_CONFIG.servers,
        ]);
        console.info(`[RelayConfig] DNS update: ${this.config.servers.length} relay(s) loaded`);
      }
    } catch {
      // Silently ignore — built-in list is still active
    }
  }

  private dedup(servers: RelayServer[]): RelayServer[] {
    const seen = new Set<string>();
    return servers.filter(s => {
      if (seen.has(s.url)) return false;
      seen.add(s.url); return true;
    });
  }

  destroy(): void {
    if (this.dnsTimer !== null) clearInterval(this.dnsTimer);
  }
}

// Singleton
export const relayConfig = new RelayConfigManager();
