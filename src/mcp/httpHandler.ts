import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { randomUUID } from 'node:crypto';
import type { TokenService } from '../services/tokenService.js';
import type { MCPServerManager } from './server.js';
import { parseBearerToken } from '../http.js';
import { rateLimitStore } from '../middleware.js';
import { classifyTraceSource } from './traceStore.js';
import type { McpHttpTraceContext } from '../types.js';

interface RequestLike extends IncomingMessage {
  auth?: AuthInfo;
  mcpTrace?: McpHttpTraceContext;
}

function setIncomingHeader(req: IncomingMessage, name: string, value: string): void {
  req.headers[name] = value;

  const canonicalName = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');

  let replaced = false;
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === name.toLowerCase()) {
      req.rawHeaders[index] = canonicalName;
      req.rawHeaders[index + 1] = value;
      replaced = true;
    }
  }

  if (!replaced) {
    req.rawHeaders.push(canonicalName, value);
  }
}

export function normalizeMcpAcceptHeader(req: IncomingMessage, method?: string): void {
  const accept = req.headers.accept ?? '';

  if (method === 'POST') {
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      setIncomingHeader(req, 'accept', 'application/json, text/event-stream');
    }
  } else if (method === 'GET') {
    if (!accept.includes('text/event-stream')) {
      setIncomingHeader(req, 'accept', 'text/event-stream');
    }
  }
}

/**
 * Handles all HTTP methods for the /mcp endpoint (POST, GET, DELETE).
 *
 * POST  - JSON-RPC requests (initialize, tool calls, notifications)
 * GET   - SSE stream subscription for server-initiated messages
 * DELETE - Session termination
 *
 * All methods require Bearer token + x-user-id authentication.
 */
export async function handleMcpHttpRequest(
  req: IncomingMessage & { auth?: unknown },
  res: ServerResponse,
  tokenService: TokenService,
  rateLimitPerMinute: number,
  mcpServerManager: MCPServerManager,
): Promise<void> {
  const method = req.method?.toUpperCase();

  // ── Authentication (all methods) ──
  const authorization = req.headers.authorization;
  const userIdHeader = req.headers['x-user-id'];
  const token = parseBearerToken(typeof authorization === 'string' ? authorization : undefined);
  const userId = typeof userIdHeader === 'string' ? userIdHeader : undefined;

  if (!token || !userId) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: Authorization bearer token and x-user-id header are required' }));
    return;
  }
  if (!/^[a-z]+$/.test(userId)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid x-user-id header: only lowercase letters a-z are allowed' }));
    return;
  }

  const authUser = await tokenService.authenticate(token, userId);
  if (!authUser) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // ── Rate Limiting (POST and GET only; DELETE is always allowed) ──
  if (method !== 'DELETE') {
    const now = Date.now();
    const counter = rateLimitStore.get(userId);
    if (!counter || now - counter.windowStart >= 60_000) {
      rateLimitStore.set(userId, { count: 1, windowStart: now });
    } else {
      if (counter.count >= rateLimitPerMinute) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        return;
      }
      counter.count += 1;
    }
  }

  // ── Normalize Accept header for MCP SDK compatibility ──
  // The MCP spec requires:
  //   POST: Accept must include both application/json and text/event-stream
  //   GET:  Accept must include text/event-stream
  // Some clients (e.g. GenSpark) may not send spec-compliant Accept headers,
  // causing the SDK to reject with 406 Not Acceptable.
  normalizeMcpAcceptHeader(req, method);
  // DELETE has no Accept requirement in the spec

  const traceContext: McpHttpTraceContext = {
    traceId: randomUUID(),
    requestId: randomUUID(),
    userId: authUser.userId,
    source: classifyTraceSource(req.headers['x-debug-client']),
  };

  (req as RequestLike).auth = {
    token,
    clientId: 'genspark-google-drive-mcp',
    scopes: [],
    extra: {
      userId: authUser.userId,
      bearerToken: token,
      traceId: traceContext.traceId,
      source: traceContext.source,
    },
  };
  (req as RequestLike).mcpTrace = traceContext;
  await mcpServerManager.handleHttpRequest(req as any, res);
}
