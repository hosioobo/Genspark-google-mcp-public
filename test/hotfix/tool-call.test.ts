import test from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '../../src/logger.js';
import { buildShortAuthUrl, handleToolCall, MCP_SERVER_INSTRUCTIONS, normalizeToolName } from '../../src/mcp/toolCall.ts';

function createLoggerStub(): Logger {
  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => logger,
  };
  return logger;
}

function createExtra(userId = 'alice', bearerToken = 'secret-token') {
  return {
    authInfo: {
      token: bearerToken,
      clientId: 'test-client',
      scopes: [],
      extra: { userId, bearerToken },
    },
  };
}

function createTraceStoreStub() {
  return {
    recordPreTool: () => undefined,
  } as any;
}

test('normalizeToolName resolves collapsed GenSpark aliases', () => {
  assert.equal(normalizeToolName('drivesearch'), 'drive.search');
  assert.equal(normalizeToolName('drivelistfolderchildren'), 'drive.list_folder_children');
  assert.equal(normalizeToolName('googleauthbegin'), 'google_auth.begin');
  assert.equal(normalizeToolName('docswrite'), 'docs.write');
});

test('buildShortAuthUrl uses one-time ticket query instead of bearer token', () => {
  const url = buildShortAuthUrl('https://mcp.example.com/base', 'ticket-123');
  assert.equal(url, 'https://mcp.example.com/oauth/short?ticket=ticket-123');
});

test('google_auth.begin returns a short auth url without throwing', async () => {
  const result = await handleToolCall(
    { params: { name: 'googleauthbegin', arguments: {} } },
    createExtra(),
    {
      logger: createLoggerStub(),
      workspaceFactory: {
        issueOAuthStartTicket: async () => ({ ticket: 'ticket-123' }),
        createOAuthClient: async () => ({}),
        createDriveClient: async () => ({}),
      } as any,
      baseUrl: 'https://mcp.example.com',
      traceStore: createTraceStoreStub(),
    },
  );

  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /https:\/\/mcp\.example\.com\/oauth\/short\?ticket=ticket-123/);
  assert.equal((result.structuredContent as any).authUrl, 'https://mcp.example.com/oauth/short?ticket=ticket-123');
});

test('missing OAuth token branch returns a short auth url', async () => {
  const result = await handleToolCall(
    { params: { name: 'drive.search', arguments: { query: '조직' } } },
    createExtra(),
    {
      logger: createLoggerStub(),
      workspaceFactory: {
        issueOAuthStartTicket: async () => ({ ticket: 'ticket-123' }),
        createOAuthClient: async () => { throw new Error('OAuth token not found for user'); },
        createDriveClient: async () => ({}),
      } as any,
      baseUrl: 'https://mcp.example.com',
      traceStore: createTraceStoreStub(),
    },
  );

  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /Google authorization required\./);
  assert.match(result.content[0].text, /https:\/\/mcp\.example\.com\/oauth\/short\?ticket=ticket-123/);
});

test('server instructions explicitly tell GenSpark not to repeat search', () => {
  assert.match(MCP_SERVER_INSTRUCTIONS, /instead of repeating the same search/i);
  assert.match(MCP_SERVER_INSTRUCTIONS, /google_auth\.status/i);
});

test('handleToolCall forwards trace metadata to pre-tool capture', async () => {
  const preToolCalls: any[] = [];
  await handleToolCall(
    { params: { name: 'google_auth.status', arguments: {} } },
    {
      authInfo: {
        token: 'secret-token',
        clientId: 'test-client',
        scopes: [],
        extra: {
          userId: 'alice',
          bearerToken: 'secret-token',
          traceId: 'trace-1',
          source: 'external',
        },
      },
    },
    {
      logger: createLoggerStub(),
      workspaceFactory: {
        issueOAuthStartTicket: async () => ({ ticket: 'ticket-123' }),
        createOAuthClient: async () => ({}),
        createDriveClient: async () => ({}),
      } as any,
      baseUrl: 'https://mcp.example.com',
      traceStore: {
        recordPreTool: (entry: unknown) => preToolCalls.push(entry),
      } as any,
    },
  );

  assert.equal(preToolCalls.length, 1);
  assert.equal(preToolCalls[0].traceId, 'trace-1');
  assert.equal(preToolCalls[0].source, 'external');
  assert.equal(preToolCalls[0].canonicalTool, 'google_auth.status');
});
