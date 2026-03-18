import { randomUUID } from 'node:crypto';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { authorizationRequiredResult, errorResult, markdownTextResult, plainTextResult } from '../tools/helpers.js';
import { executeDriveTool, toolDefinitions } from '../tools/driveTools.js';
import { executeWorkspaceTool, workspaceToolDefinitions } from '../tools/workspaceTools.js';
import type { GoogleWorkspaceClientFactory } from '../clientFactory.js';
import type { Logger } from '../logger.js';
import type { McpRequestAuthContext, ToolContext, ToolResult } from '../types.js';
import type { McpTraceStore } from './traceStore.js';

const allToolDefinitions = [...toolDefinitions, ...workspaceToolDefinitions];
const canonicalToolNames = new Set(allToolDefinitions.map((tool) => tool.name));
const compactToolNameMap = new Map(allToolDefinitions.map((tool) => [compactToolName(tool.name), tool.name]));

export const MCP_SERVER_INSTRUCTIONS = [
  'Do not preflight google_auth.status unless the user explicitly asks to check authorization. Use google_auth.begin only when the user explicitly wants to start authorization or another tool reports that authorization is required.',
  'When drive.search or drive.list_folder_children returns file IDs, reuse those exact IDs directly instead of repeating the same search.',
  'For the create-search-read-append workflow, prefer drive.search to find files, drive.read or docs.read to inspect content, and docs.write to create or replace the destination document.',
  'sheets.read accepts Google Sheets links and uploaded Excel spreadsheets when a spreadsheet file is found.',
  'When updating an existing document with docs.write, send the full desired final content for the document.',
].join(' ');

interface ToolCallRequest {
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
}

interface ToolCallExtra {
  authInfo?: AuthInfo;
}

export function compactToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeToolName(name: string): string {
  if (canonicalToolNames.has(name)) return name;
  return compactToolNameMap.get(compactToolName(name)) ?? name;
}

export function extractAuthContext(authInfo?: AuthInfo): McpRequestAuthContext | null {
  const extra = authInfo?.extra;
  if (!extra || typeof extra.userId !== 'string' || typeof extra.bearerToken !== 'string') {
    return null;
  }
  return {
    userId: extra.userId,
    bearerToken: extra.bearerToken,
    traceId: typeof extra.traceId === 'string' ? extra.traceId : undefined,
    source: extra.source === 'synthetic' || extra.source === 'external' ? extra.source : undefined,
  };
}

export function buildShortAuthUrl(baseUrl: string, ticket: string): string {
  const params = new URLSearchParams({ ticket });
  if (!baseUrl) {
    return `/oauth/short?${params.toString()}`;
  }

  const url = new URL('/oauth/short', baseUrl);
  url.search = params.toString();
  return url.toString();
}

async function issueShortAuthUrl(
  baseUrl: string,
  userId: string,
  workspaceFactory: GoogleWorkspaceClientFactory,
): Promise<string> {
  const { ticket } = await workspaceFactory.issueOAuthStartTicket(userId);
  return buildShortAuthUrl(baseUrl, ticket);
}

export async function handleToolCall(
  request: ToolCallRequest,
  extra: ToolCallExtra,
  deps: {
    logger: Logger;
    workspaceFactory: GoogleWorkspaceClientFactory;
    baseUrl: string;
    traceStore: McpTraceStore;
  },
): Promise<ToolResult> {
  const authContext = extractAuthContext(extra.authInfo);
  if (!authContext) {
    return errorResult('Unauthorized');
  }

  const requestedToolName = request.params.name;
  const toolName = normalizeToolName(requestedToolName);
  const toolLogger = deps.logger.child({
    userId: authContext.userId,
    requestedTool: requestedToolName,
    tool: toolName,
  });

  if (requestedToolName !== toolName) {
    toolLogger.info('Normalized tool name', { requestedTool: requestedToolName, canonicalTool: toolName });
  }

  const recordTraceResult = (result: ToolResult): ToolResult => {
    if (authContext.traceId && authContext.source) {
      deps.traceStore.recordPreTool({
        traceId: authContext.traceId,
        source: authContext.source,
        userId: authContext.userId,
        requestedTool: requestedToolName,
        canonicalTool: toolName,
        arguments: request.params.arguments ?? {},
        result,
      });
    }
    return result;
  };

  if (toolName === 'google_auth.status') {
    try {
      await deps.workspaceFactory.createOAuthClient(authContext.userId);
      return recordTraceResult(markdownTextResult('Google account already connected.', {
        status: 'authorized',
        provider: 'google',
        userId: authContext.userId,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown authorization error';
      if (!message.includes('OAuth token not found for user')) {
        return recordTraceResult(errorResult(message));
      }

      return recordTraceResult(markdownTextResult('Google account is not connected yet. Run google_auth.begin only when the user explicitly wants to start authorization.', {
        status: 'not_authorized',
        provider: 'google',
        userId: authContext.userId,
      }));
    }
  }

  if (toolName === 'google_auth.begin') {
    const shortUrl = await issueShortAuthUrl(deps.baseUrl, authContext.userId, deps.workspaceFactory);
    toolLogger.info('Returning short OAuth URL');
    return recordTraceResult(plainTextResult(`Google authorization link:\n${shortUrl}`, {
      status: 'authorization_link_ready',
      provider: 'google',
      userId: authContext.userId,
      authUrl: shortUrl,
    }));
  }

  let context: ToolContext;
  try {
    const oauthClient = await deps.workspaceFactory.createOAuthClient(authContext.userId);
    const drive = await deps.workspaceFactory.createDriveClient(authContext.userId);
    context = {
      userId: authContext.userId,
      oauthClient,
      drive,
      logger: toolLogger,
      requestId: randomUUID(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown authorization error';
    toolLogger.warn('OAuth client initialization failed', { error: message });

    if (message.includes('OAuth token not found for user')) {
      const shortUrl = await issueShortAuthUrl(deps.baseUrl, authContext.userId, deps.workspaceFactory);
      return recordTraceResult(authorizationRequiredResult({
        status: 'authorization_required',
        provider: 'google',
        userId: authContext.userId,
        authUrl: shortUrl,
        actionLabel: 'Sign in with Google',
        message: 'Google authorization is required before using this tool.',
        retryInstruction: 'After sign-in, retry the previous request.',
        retryable: true,
      }));
    }

    return recordTraceResult(errorResult(message));
  }

  try {
    const driveResult = await executeDriveTool(toolName, request.params.arguments ?? {}, context);
    if (driveResult) return recordTraceResult(driveResult);

    const workspaceResult = await executeWorkspaceTool(toolName, request.params.arguments ?? {}, context);
    return recordTraceResult(workspaceResult ?? errorResult('Tool not found'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown tool error';
    context.logger.error('Tool execution failed', { error: message });
    return recordTraceResult(errorResult(message));
  }
}
