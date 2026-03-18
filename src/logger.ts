export interface Logger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
  debug: (message: string, data?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

const SENSITIVE_KEYS = new Set([
  'authorization', 'access_token', 'refresh_token', 'token',
  'code', 'ticket', 'client_secret', 'encryptedtoken', 'wrappeddek', 'blob', 'base64',
]);

function sanitize(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) { out[k] = '[REDACTED]'; continue; }
    if (typeof v === 'string') {
      if (v.startsWith('Bearer ')) { out[k] = 'Bearer [REDACTED]'; continue; }
      const redactedQuerySecrets = v.replace(/([?&](?:token|ticket|code|access_token|refresh_token)=)[^&\s"]+/gi, '$1[REDACTED]');
      if (redactedQuerySecrets !== v) { out[k] = redactedQuerySecrets; continue; }
      if (v.length > 128 && /^[A-Za-z0-9+/=]+$/.test(v)) { out[k] = '[REDACTED_BASE64]'; continue; }
    }
    if (Array.isArray(v)) { out[k] = v.map(i => (i && typeof i === 'object') ? sanitize(i as Record<string, unknown>) : i); continue; }
    if (v && typeof v === 'object') { out[k] = sanitize(v as Record<string, unknown>); continue; }
    out[k] = v;
  }
  return out;
}

class ConsoleLogger implements Logger {
  constructor(private readonly bindings: Record<string, unknown> = {}) {}
  info(message: string, data?: Record<string, unknown>) { this.log('INFO', message, data); }
  warn(message: string, data?: Record<string, unknown>) { this.log('WARN', message, data); }
  error(message: string, data?: Record<string, unknown>) { this.log('ERROR', message, data); }
  debug(message: string, data?: Record<string, unknown>) { this.log('DEBUG', message, data); }
  child(bindings: Record<string, unknown>): Logger { return new ConsoleLogger({ ...this.bindings, ...bindings }); }

  private log(level: string, message: string, data?: Record<string, unknown>) {
    console.log(JSON.stringify({ severity: level, message, ...sanitize(this.bindings), ...sanitize(data), timestamp: new Date().toISOString() }));
  }
}

export function createLogger(): Logger {
  return new ConsoleLogger();
}
