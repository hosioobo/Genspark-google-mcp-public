import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { toolDefinitions } from '../tools/driveTools.js';
import { workspaceToolDefinitions } from '../tools/workspaceTools.js';
import type { Logger } from '../logger.js';
import type { GoogleWorkspaceClientFactory } from '../clientFactory.js';
import type { McpHttpTraceContext } from '../types.js';
import { handleToolCall, MCP_SERVER_INSTRUCTIONS } from './toolCall.js';
import { attachResponseCapture, McpTraceStore } from './traceStore.js';

interface RequestLike extends IncomingMessage {
  auth?: AuthInfo;
  mcpTrace?: McpHttpTraceContext;
}

export class MCPServerManager {
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(
    private readonly logger: Logger,
    private readonly workspaceFactory: GoogleWorkspaceClientFactory,
    private readonly baseUrl: string,
    private readonly traceStore: McpTraceStore,
  ) {}

  async handleHttpRequest(req: RequestLike, res: ServerResponse): Promise<void> {
    const sessionId = req.headers['mcp-session-id'];
    const existingTransport = typeof sessionId === 'string' ? this.transports.get(sessionId) : undefined;
    const transport = existingTransport ?? this.createTransport();

    this.logger.info('MCP HTTP request received', {
      method: req.method,
      hasSessionId: typeof sessionId === 'string',
      transportFound: Boolean(existingTransport),
    });

    if (!existingTransport) {
      await this.connectServer(transport);
    }

    const parsedRequest = req.method === 'POST' ? await this.readJsonBody(req) : undefined;
    if (req.mcpTrace && this.traceStore.isCapturing()) {
      this.traceStore.recordIngress({
        traceContext: req.mcpTrace,
        method: req.method ?? 'UNKNOWN',
        url: req.url ?? '/mcp',
        sessionId: typeof sessionId === 'string' ? sessionId : null,
        headers: req.headers,
        rawBody: parsedRequest?.rawBody ?? null,
        parsedBody: parsedRequest?.parsedBody,
      });

      attachResponseCapture(res, (payload) => {
        this.traceStore.recordEgress({
          traceContext: req.mcpTrace!,
          statusCode: payload.statusCode,
          headers: payload.headers,
          rawBody: payload.rawBody,
          bodyBytes: payload.bodyBytes,
          bodySha256: payload.bodySha256,
        });
      });
    }

    await transport.handleRequest(req, res, parsedRequest?.parsedBody);

    // Initialization assigns the session ID during handleRequest, so store the
    // transport after the first successful initialize as a safety net.
    if (!existingTransport && transport.sessionId) {
      this.transports.set(transport.sessionId, transport);
    }
  }

  private createTransport(): StreamableHTTPServerTransport {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // Allow the SDK to return application/json instead of only text/event-stream.
      // Some MCP clients (e.g. GenSpark) may expect or prefer JSON responses.
      enableJsonResponse: true,
      onsessioninitialized: (sid) => {
        this.transports.set(sid, transport);
        this.logger.info('MCP session initialized', { sessionId: sid });
      },
      onsessionclosed: (sid) => { this.transports.delete(sid); this.logger.info('MCP session closed', { sessionId: sid }); },
    });
    return transport;
  }

  private async connectServer(transport: StreamableHTTPServerTransport): Promise<void> {
    const server = new Server(
      { name: 'genspark-google-drive-remote-mcp', version: '1.0.0' },
      {
        capabilities: { tools: {} },
        instructions: MCP_SERVER_INSTRUCTIONS,
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...toolDefinitions, ...workspaceToolDefinitions] }));

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => handleToolCall(request, extra, {
      logger: this.logger,
      workspaceFactory: this.workspaceFactory,
      baseUrl: this.baseUrl,
      traceStore: this.traceStore,
    }));

    await server.connect(transport);
  }

  private async readJsonBody(req: IncomingMessage): Promise<{ rawBody: string; parsedBody: unknown } | undefined> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.length === 0) return undefined;
    const rawBody = Buffer.concat(chunks).toString('utf8');
    return {
      rawBody,
      parsedBody: JSON.parse(rawBody),
    };
  }
}
