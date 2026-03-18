import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../types.js';
import { ActiveUserExistsError } from '../services/tokenService.js';
import type { TokenService } from '../services/tokenService.js';
import type { FirestoreUserRepository } from '../repositories/firestoreUserRepository.js';
import { debugPageHtml } from '../debugUi.js';
import type { McpTraceStore } from '../mcp/traceStore.js';

const issueSchema = z.object({ userId: z.string().regex(/^[a-z]+$/, 'userId must contain lowercase letters a-z only') });

export function createAdminRouter(
  tokenService: TokenService,
  repository: FirestoreUserRepository,
  traceStore: McpTraceStore,
  baseUrl: string,
  enableDebugUi = false,
) {
  const app = new Hono<HonoEnv>();

  if (enableDebugUi) {
    app.get('/debug/ui', (c) => c.html(debugPageHtml(baseUrl)));

    app.get('/debug/captures', (c) => c.json(traceStore.listCaptures()));

    app.post('/debug/captures/start', (c) => c.json(traceStore.startCapture()));

    app.post('/debug/captures/stop', (c) => {
      const stopped = traceStore.stopCapture();
      if (!stopped) {
        return c.json({ error: 'No active capture' }, 409);
      }
      return c.json(stopped);
    });

    app.get('/debug/captures/:captureId', (c) => {
      const capture = traceStore.getCapture(c.req.param('captureId'));
      if (!capture) {
        return c.json({ error: 'Capture not found' }, 404);
      }
      return c.json(capture);
    });

    app.delete('/debug/captures', (c) => {
      traceStore.clearCaptures();
      return c.json({ ok: true });
    });
  }

  app.post('/issue-token', async (c) => {
    const { userId } = issueSchema.parse(await c.req.json());
    try {
      const result = await tokenService.issueUserToken(userId);
      c.header('Cache-Control', 'no-store');
      return c.json(result);
    } catch (error) {
      if (error instanceof ActiveUserExistsError) {
        return c.json({ error: '이미 active 상태인 사용자명입니다. reissue 또는 revoke 후 다시 issue 하세요.' }, 409);
      }
      throw error;
    }
  });

  app.post('/rotate-token', async (c) => {
    const { userId } = issueSchema.parse(await c.req.json());
    const result = await tokenService.rotateUserToken(userId);
    c.header('Cache-Control', 'no-store');
    return c.json(result);
  });

  app.post('/revoke', async (c) => {
    const { userId } = issueSchema.parse(await c.req.json());
    const { googleRevokeStatus } = await tokenService.revokeUserAccess(userId);
    return c.json({ userId, status: 'revoked', googleRevokeStatus });
  });

  app.get('/users', async (c) => {
    const users = await repository.listUsers();
    return c.json({ users });
  });

  return app;
}
