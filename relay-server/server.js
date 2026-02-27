'use strict';

/**
 * Telegram Relay Server
 *
 * WebSocket (WSS) → TCP proxy for Telegram DC connections.
 * Traffic looks like ordinary HTTPS/WebSocket to DPI — the relay
 * connects to Telegram DCs directly over TCP on the server side.
 *
 * Usage:
 *   node server.js
 *
 * Env vars (see .env.example):
 *   PORT            - HTTP/WS listen port (default 3000)
 *   AUTH_TOKEN      - Optional shared secret; clients pass ?token=XXX
 *   MAX_CONNECTIONS - Soft cap on simultaneous relay connections (default 1000)
 *   LOG_LEVEL       - "info" | "warn" | "error" (default "info")
 */

const http    = require('http');
const net     = require('net');
const fs      = require('fs');
const path    = require('path');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

// ─── Configuration ────────────────────────────────────────────────────────────

require('dotenv').config();

const PORT            = parseInt(process.env.PORT || '3000', 10);
const AUTH_TOKEN      = process.env.AUTH_TOKEN || '';          // empty = no auth
const MAX_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS || '1000', 10);
const LOG_LEVEL       = (process.env.LOG_LEVEL || 'info').toLowerCase();

/** Known Telegram DC endpoints  (ip:port).
 *  Clients choose a DC by index: wss://relay.example.com/dc/2
 *  DC numbers are 1-based as in the MTProto spec.
 */
const DC_MAP = {
  1: { host: '149.154.175.53',  port: 443 },
  2: { host: '149.154.167.51',  port: 443 },
  3: { host: '149.154.175.100', port: 443 },
  4: { host: '149.154.167.91',  port: 443 },
  5: { host: '91.108.56.130',   port: 443 },
};

// Additional DC aliases from environment (DC_LIST="1=1.2.3.4:443,2=5.6.7.8:443")
if (process.env.DC_LIST) {
  for (const entry of process.env.DC_LIST.split(',')) {
    const m = entry.trim().match(/^(\d+)=(.+):(\d+)$/);
    if (m) DC_MAP[parseInt(m[1], 10)] = { host: m[2], port: parseInt(m[3], 10) };
  }
}

// ─── Logging ─────────────────────────────────────────────────────────────────

const LEVELS = { error: 0, warn: 1, info: 2 };
const currentLevel = LEVELS[LOG_LEVEL] ?? LEVELS.info;

function log(level, ...args) {
  if ((LEVELS[level] ?? 2) <= currentLevel) {
    const ts = new Date().toISOString();
    // Never log payload content — only metadata
    console[level === 'error' ? 'error' : 'log'](`[${ts}] [${level.toUpperCase()}]`, ...args);
  }
}

// ─── Metrics (in-memory, no sensitive data) ──────────────────────────────────

const metrics = {
  activeConnections: 0,
  totalConnections: 0,
  totalErrors: 0,
  startTime: Date.now(),
};

// ─── Decoy static site ────────────────────────────────────────────────────────

const DECOY_DIR = path.join(__dirname, 'decoy-site');

function serveDecoy(req, res) {
  const safePath = path.normalize(req.url.split('?')[0]);
  let filePath = path.join(DECOY_DIR, safePath === '/' ? 'index.html' : safePath);

  // Prevent directory traversal
  if (!filePath.startsWith(DECOY_DIR)) {
    res.writeHead(403); res.end(); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      filePath = path.join(DECOY_DIR, 'index.html');
    }
    fs.readFile(filePath, (err2, data) => {
      if (err2) { res.writeHead(404); res.end('Not found'); return; }
      const ext  = path.extname(filePath).toLowerCase();
      const mime = { '.html': 'text/html', '.css': 'text/css',
                     '.js': 'application/javascript', '.png': 'image/png',
                     '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
                     '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type':  mime,
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(data);
    });
  });
}

// ─── Metrics endpoint ─────────────────────────────────────────────────────────

function serveMetrics(res) {
  const uptime = Math.floor((Date.now() - metrics.startTime) / 1000);
  const body = JSON.stringify({
    uptime_seconds:      uptime,
    active_connections:  metrics.activeConnections,
    total_connections:   metrics.totalConnections,
    total_errors:        metrics.totalErrors,
  }, null, 2);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const httpServer = http.createServer((req, res) => {
  // Internal health / metrics probe (guarded by auth token when set)
  if (req.url === '/healthz') {
    res.writeHead(200); res.end('ok'); return;
  }
  if (req.url === '/metrics') {
    if (AUTH_TOKEN && req.headers['x-auth-token'] !== AUTH_TOKEN) {
      res.writeHead(401); res.end(); return;
    }
    serveMetrics(res); return;
  }
  serveDecoy(req, res);
});

// ─── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

/**
 * Parse the DC index from the WebSocket request URL.
 * Accepted patterns:
 *   /dc/2            → DC 2
 *   /dc/2?token=XXX  → DC 2 with auth
 */
function parseDcFromUrl(rawUrl) {
  const url  = new URL(rawUrl, 'http://localhost');
  const m    = url.pathname.match(/^\/dc\/(\d+)$/);
  if (!m) return null;
  const dc = parseInt(m[1], 10);
  return DC_MAP[dc] ? { dc, token: url.searchParams.get('token') } : null;
}

wss.on('connection', (ws, req) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const parsed = parseDcFromUrl(req.url);
  if (!parsed) {
    log('warn', 'Unknown path, closing:', req.url);
    ws.close(4400, 'Bad Request'); return;
  }
  if (AUTH_TOKEN && parsed.token !== AUTH_TOKEN) {
    log('warn', 'Auth failed from', req.socket.remoteAddress);
    ws.close(4401, 'Unauthorized'); return;
  }

  // ── Connection cap ────────────────────────────────────────────────────────
  if (metrics.activeConnections >= MAX_CONNECTIONS) {
    log('warn', 'Max connections reached, rejecting');
    ws.close(4503, 'Service Unavailable'); return;
  }

  const dcInfo = DC_MAP[parsed.dc];
  metrics.activeConnections++;
  metrics.totalConnections++;

  log('info', `WS open → DC${parsed.dc} (${dcInfo.host}:${dcInfo.port}) active=${metrics.activeConnections}`);

  // ── Open TCP connection to Telegram DC ────────────────────────────────────
  const tcpSocket = net.createConnection({ host: dcInfo.host, port: dcInfo.port });

  // ── Pipe: WS → TCP ────────────────────────────────────────────────────────
  ws.on('message', (data, isBinary) => {
    if (!tcpSocket.destroyed) {
      // data is always a Buffer when binaryType='arraybuffer' or binary frames
      tcpSocket.write(data);
    }
  });

  // ── Pipe: TCP → WS ────────────────────────────────────────────────────────
  tcpSocket.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(chunk, { binary: true });
    }
  });

  // ── Teardown helpers ──────────────────────────────────────────────────────
  function cleanup(reason) {
    metrics.activeConnections = Math.max(0, metrics.activeConnections - 1);
    log('info', `Closed (${reason}) DC${parsed.dc} active=${metrics.activeConnections}`);
    if (!tcpSocket.destroyed) tcpSocket.destroy();
    if (ws.readyState < 2) ws.close(); // CONNECTING or OPEN
  }

  ws.on('close',  ()    => cleanup('ws-close'));
  ws.on('error',  (err) => { metrics.totalErrors++; cleanup(`ws-error: ${err.message}`); });
  tcpSocket.on('close', ()    => cleanup('tcp-close'));
  tcpSocket.on('error', (err) => { metrics.totalErrors++; cleanup(`tcp-error: ${err.message}`); });

  // ── TCP connect timeout ───────────────────────────────────────────────────
  tcpSocket.setTimeout(15000, () => {
    log('warn', `TCP connect timeout to DC${parsed.dc}`);
    cleanup('tcp-timeout');
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  log('info', `Relay server listening on port ${PORT}`);
  log('info', `Auth: ${AUTH_TOKEN ? 'enabled' : 'disabled'}`);
  log('info', `Max connections: ${MAX_CONNECTIONS}`);
  log('info', `Known DCs: ${Object.keys(DC_MAP).join(', ')}`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal) {
  log('info', `Received ${signal}, shutting down...`);
  wss.close(() => {
    httpServer.close(() => {
      log('info', 'Server stopped.');
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
