// Redact list for structured logs (ТЗ §34: never log telegram session, login code,
// 2FA password, api hash, or private message contents in debug logs).
export const LOG_REDACT_PATHS = [
  "*.encryptedSession",
  "*.session",
  "*.password",
  "*.code",
  "*.apiHash",
  "*.api_hash",
  "*.TELEGRAM_API_HASH",
  "*.SESSION_ENCRYPTION_KEY",
  "*.API_INTERNAL_SECRET",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.phoneCode",
  "*.twoFactorPassword",
];

// Keys that must never appear in logs, even nested. Used by the redaction helper.
export const SENSITIVE_KEYS = new Set([
  "session",
  "encryptedSession",
  "encrypted_session",
  "password",
  "twoFactorPassword",
  "code",
  "phoneCode",
  "apiHash",
  "api_hash",
  "authorization",
  "cookie",
]);
