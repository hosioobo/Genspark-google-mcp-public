import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Firestore } from '@google-cloud/firestore';
import { KeyManagementServiceClient } from '@google-cloud/kms';

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { requestContext } from './middleware.js';
import { FirestoreUserRepository } from './repositories/firestoreUserRepository.js';
import { EncryptionService } from './services/encryptionService.js';
import { OAuthService } from './services/oauthService.js';
import { TokenService } from './services/tokenService.js';
import { GoogleWorkspaceClientFactory } from './clientFactory.js';
import { createAdminRouter } from './routes/admin.js';
import { MCPServerManager } from './mcp/server.js';
import { handleMcpHttpRequest } from './mcp/httpHandler.js';
import { McpTraceStore } from './mcp/traceStore.js';
import { requireAdminSession, requireSameOriginForSessionWrites, createAdminSessionRoutes } from './adminSession.js';
import { adminPageHtml } from './adminUi.js';
import { HEALTH_PATH, HEALTH_RESPONSE_BODY, isHealthRequest } from './health.js';
import type { HonoEnv, AppConfig } from './types.js';

const logger = createLogger();

// ── Helpers ──

function summarizeConfigPresence(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const required = [
    'PORT', 'BASE_URL', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_OAUTH_REDIRECT_URI', 'KMS_KEY_NAME', 'TOKEN_HASH_PEPPER', 'ADMIN_KEY',
    'ADMIN_SESSION_SECRET',
  ];
  return Object.fromEntries(required.map((key) => {
    const value = env[key];
    return [key, typeof value === 'string' ? { present: true, length: value.length } : { present: false }];
  }));
}

function getErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { error: error.message, name: error.name, stack: error.stack, issues: (error as any).issues };
  }
  return { error: String(error) };
}

// ── App Factory ──

function createApp(config: AppConfig, services: {
  repository: FirestoreUserRepository;
  oauthService: OAuthService;
  tokenService: TokenService;
  traceStore: McpTraceStore;
}) {
  logger.info('Bootstrap starting', {
    port: config.port,
    baseUrl: config.baseUrl,
    envPresence: summarizeConfigPresence(process.env),
  });

  const { repository, oauthService, tokenService, traceStore } = services;
  const sessionRoutes = createAdminSessionRoutes(config);

  const app = new Hono<HonoEnv>();
  app.use('*', requestContext(logger));

  app.onError((error, c) => {
    const log = c.get('logger') ?? logger;
    const status = error instanceof HTTPException ? error.status : 500;
    log.error('Unhandled request error', { status, error: error.message });
    return c.json({ error: status === 500 ? 'Internal Server Error' : error.message }, status);
  });

  // ── Public routes ──
  app.get('/', (c) => c.redirect('/admin/ui', 302));
  app.get(HEALTH_PATH, (c) => c.text(HEALTH_RESPONSE_BODY));

  // ── Admin session routes (no session required) ──
  app.post('/admin/session/login', sessionRoutes.login);
  app.use('/admin/session/logout', requireSameOriginForSessionWrites(config));
  app.post('/admin/session/logout', sessionRoutes.logout);
  app.get('/admin/session/me', sessionRoutes.me);

  // ── Admin UI ──
  app.get('/admin/ui', (c) => c.html(adminPageHtml(config.baseUrl, config.enableDebugUi)));

  // ── Protected admin routes (single middleware for all) ──
  const adminProtected = new Hono<HonoEnv>();
  adminProtected.use('*', requireAdminSession(config));
  adminProtected.use('*', requireSameOriginForSessionWrites(config));
  adminProtected.route('/', createAdminRouter(tokenService, repository, traceStore, config.baseUrl, config.enableDebugUi));
  app.route('/admin', adminProtected);

  // ── OAuth routes ──
  const oauthRouter = new Hono<HonoEnv>();
  oauthRouter.use('/link', requireAdminSession(config));
  oauthRouter.use('/link', requireSameOriginForSessionWrites(config));

  oauthRouter.post('/link', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const userId = typeof body.userId === 'string' ? body.userId : '';
    if (!/^[a-z]+$/.test(userId)) {
      return c.json({ error: 'userId must contain lowercase letters a-z only' }, 400);
    }

    const { ticket, expiresAt } = await oauthService.issueOAuthStartTicket(userId);
    const authUrl = new URL('/oauth/short', config.baseUrl);
    authUrl.searchParams.set('ticket', ticket);

    c.header('Cache-Control', 'no-store');
    return c.json({
      authUrl: authUrl.toString(),
      expiresAt: expiresAt.toISOString(),
    });
  });

  oauthRouter.get('/short', async (c) => {
    const ticket = c.req.query('ticket');
    if (!ticket) {
      return c.text('Missing ticket', 400);
    }

    const authUser = await oauthService.consumeOAuthStartTicket(ticket);
    if (!authUser) {
      return c.text('Invalid or expired OAuth start link', 410);
    }

    const { authUrl } = await oauthService.createAuthorizationUrl(authUser.userId);
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    return c.redirect(authUrl, 302);
  });

  oauthRouter.get('/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) {
      return c.json({ error: 'Missing code or state' }, 400);
    }

    const parsedState = oauthService.parseState(state);
    const tokens = await oauthService.exchangeCodeForTokens(code);
    await oauthService.saveUserTokens(parsedState.userId, tokens);

    c.header('Cache-Control', 'no-store');
    return c.html(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Google connection complete</title>
  </head>
  <body style="font-family: sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem;">
    <h1>Google connection complete</h1>
    <p>User <strong>${parsedState.userId}</strong> is now connected.</p>
    <p>You can close this window and return to GenSpark.</p>
  </body>
</html>`);
  });

  app.route('/oauth', oauthRouter);

  return app;
}

// ── Bootstrap ──

try {
  const config = loadConfig();

  logger.info('Initializing Firestore repository', {
    usersCollection: config.firestoreCollectionUsers,
    tokensCollection: config.firestoreCollectionTokens,
  });
  const repository = new FirestoreUserRepository(new Firestore(), config.firestoreCollectionUsers, config.firestoreCollectionTokens);

  logger.info('Initializing KMS encryption service', { kmsKeyName: config.kmsKeyName });
  const encryptionService = new EncryptionService(new KeyManagementServiceClient(), config.kmsKeyName);

  logger.info('Initializing OAuth and token services');
  const oauthService = new OAuthService(config, repository, encryptionService);
  const tokenService = new TokenService(repository, config, oauthService);
  const workspaceFactory = new GoogleWorkspaceClientFactory(oauthService);
  const traceStore = new McpTraceStore();
  const mcpServerManager = new MCPServerManager(logger, workspaceFactory, config.baseUrl, traceStore);

  const app = createApp(config, { repository, oauthService, tokenService, traceStore });
  const honoRequestListener = getRequestListener(app.fetch);

  const server = createServer((req, res) => {
    if (req.url?.startsWith('/mcp')) {
      handleMcpHttpRequest(req as any, res, tokenService, config.rateLimitPerMinute, mcpServerManager)
        .catch((error) => {
          logger.error('MCP request failed', getErrorDetails(error));
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
          } else {
            res.end();
          }
        });
      return;
    }

    if (isHealthRequest(req.url)) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(HEALTH_RESPONSE_BODY);
      return;
    }

    honoRequestListener(req, res);
  });

  server.listen(config.port);
  logger.info('Server started', { port: config.port, baseUrl: config.baseUrl });
} catch (error) {
  logger.error('Fatal bootstrap error', {
    ...getErrorDetails(error),
    envPresence: summarizeConfigPresence(process.env),
  });
  process.exit(1);
}
