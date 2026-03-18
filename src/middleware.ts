import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { randomUUID } from 'crypto';
import type { Logger } from './logger.js';
import type { TokenService } from './services/tokenService.js';
import { parseBearerToken } from './http.js';
import type { HonoEnv } from './types.js';

const USER_ID_PATTERN = /^[a-z]+$/;

// ── Request Context ──

export function requestContext(logger: Logger): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.set('requestId', requestId);
    c.set('logger', logger.child({ requestId, path: c.req.path, method: c.req.method }));
    await next();
  };
}

// ── User Auth ──

export function requireUserAuth(tokenService: TokenService): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const token = parseBearerToken(c.req.header('authorization'));
    const userId = c.req.header('x-user-id') ?? null;

    if (!token || !userId) {
      throw new HTTPException(401, { message: 'Unauthorized: Authorization bearer token and x-user-id header are required' });
    }
    if (!USER_ID_PATTERN.test(userId)) {
      throw new HTTPException(400, { message: 'Invalid x-user-id header: only lowercase letters a-z are allowed' });
    }

    const authUser = await tokenService.authenticate(token, userId);
    if (!authUser) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }

    c.set('authUser', authUser);
    await next();
  };
}

// ── Admin Auth ──

export function requireAdminAuth(adminKey: string): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const token = parseBearerToken(c.req.header('authorization'));
    if (!token || token !== adminKey) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }
    await next();
  };
}

// ── Rate Limit ──

export interface Counter { count: number; windowStart: number; }
export const rateLimitStore = new Map<string, Counter>();

export function userRateLimit(limitPerMinute: number): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const userId = c.get('authUser')?.userId ?? c.req.header('x-user-id') ?? 'anonymous';
    const now = Date.now();
    const counter = rateLimitStore.get(userId);

    if (!counter || now - counter.windowStart >= 60_000) {
      rateLimitStore.set(userId, { count: 1, windowStart: now });
      await next();
      return;
    }
    if (counter.count >= limitPerMinute) {
      throw new HTTPException(429, { message: 'Rate limit exceeded' });
    }
    counter.count += 1;
    await next();
  };
}
