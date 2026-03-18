import { createHmac, timingSafeEqual } from 'crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv, AdminSessionPayload, AppConfig } from './types.js';

const ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE = 10;
const adminLoginRateLimitStore = new Map<string, { count: number; windowStart: number }>();

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function signAdminSession(payload: AdminSessionPayload, secret: string): string {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyAdminSession(token: string | undefined, secret: string): AdminSessionPayload | null {
  if (!token) return null;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }
  const valid = timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!valid) return null;

  let payload: AdminSessionPayload;
  try {
    payload = JSON.parse(decodeBase64Url(encodedPayload)) as AdminSessionPayload;
  } catch {
    return null;
  }
  if (payload.role !== 'admin' || !payload.exp || payload.exp * 1000 < Date.now()) {
    return null;
  }

  return payload;
}

/** Reusable middleware: require a valid admin session cookie. */
export function requireAdminSession(config: AppConfig): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const session = verifyAdminSession(getCookie(c, 'admin_session'), config.adminSessionSecret);
    if (!session) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }
    await next();
  };
}

export function requireSameOriginForSessionWrites(config: AppConfig): MiddlewareHandler<HonoEnv> {
  const allowedOrigin = new URL(config.baseUrl).origin;

  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }

    const origin = c.req.header('origin') ?? originFromReferer(c.req.header('referer'));
    if (!origin || origin !== allowedOrigin) {
      throw new HTTPException(403, { message: 'Forbidden' });
    }

    await next();
  };
}

/** Mount admin session routes (login / logout / me) onto a Hono app. */
export function createAdminSessionRoutes(config: AppConfig) {
  // Returns route handlers that can be registered on the app.
  return {
    login: async (c: any) => {
      if (!consumeAdminLoginAttempt(requesterKeyFromContext(c), ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE)) {
        return c.json({ error: 'Too many login attempts' }, 429);
      }

      const body = await c.req.json().catch(() => ({}));
      const adminKey = typeof body.adminKey === 'string' ? body.adminKey : '';
      if (adminKey !== config.adminKey) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const now = Math.floor(Date.now() / 1000);
      const token = signAdminSession({ role: 'admin', exp: now + config.adminSessionMaxAgeSeconds }, config.adminSessionSecret);
      setCookie(c, 'admin_session', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: config.adminSessionMaxAgeSeconds,
      });
      return c.json({ ok: true, expiresInSeconds: config.adminSessionMaxAgeSeconds });
    },

    logout: (c: any) => {
      deleteCookie(c, 'admin_session', { path: '/' });
      return c.json({ ok: true });
    },

    me: (c: any) => {
      const session = verifyAdminSession(getCookie(c, 'admin_session'), config.adminSessionSecret);
      return c.json({ authenticated: !!session, expiresAt: session?.exp ?? null });
    },
  };
}

function requesterKeyFromContext(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwardedFor = c.req.header('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]!.trim();
  }
  return c.req.header('cf-connecting-ip')
    ?? c.req.header('x-real-ip')
    ?? 'unknown';
}

function consumeAdminLoginAttempt(key: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const counter = adminLoginRateLimitStore.get(key);

  if (!counter || now - counter.windowStart >= 60_000) {
    adminLoginRateLimitStore.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (counter.count >= limitPerMinute) {
    return false;
  }

  counter.count += 1;
  return true;
}

function originFromReferer(referer?: string): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
