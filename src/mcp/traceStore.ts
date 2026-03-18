import { createHash, randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import type { McpHttpTraceContext, McpTraceSource, ToolResult } from '../types.js';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'access_token',
  'refresh_token',
  'token',
  'ticket',
  'code',
  'client_secret',
  'bearertoken',
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sanitizeString(value: string): string {
  return value
    .replace(/Bearer\s+[^\s",]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|ticket|code|access_token|refresh_token)=)[^&\s"]+/gi, '$1[REDACTED]')
    .replace(/("(?:authorization|access_token|refresh_token|token|ticket|code|client_secret|bearerToken)"\s*:\s*")([^"]*)(")/gi, '$1[REDACTED]$3');
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizeValue(entry);
      }
    }
    return out;
  }
  return value;
}

function sanitizeBodyText(body: string): string {
  try {
    return JSON.stringify(sanitizeValue(JSON.parse(body)), null, 2);
  } catch {
    return sanitizeString(body);
  }
}

function sanitizeHeaders(headers: IncomingHttpHeaders | Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(headers) as Record<string, unknown>;
}

function parseJsonRpcDetails(parsedBody: unknown): {
  jsonRpcId: string | number | null;
  jsonRpcMethod: string | null;
  requestedTool: string | null;
  query: string | null;
  pageSize: number | null;
} {
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return {
      jsonRpcId: null,
      jsonRpcMethod: null,
      requestedTool: null,
      query: null,
      pageSize: null,
    };
  }

  const body = parsedBody as {
    id?: string | number;
    method?: string;
    params?: {
      name?: string;
      arguments?: {
        query?: string;
        pageSize?: number;
      };
    };
  };

  return {
    jsonRpcId: body.id ?? null,
    jsonRpcMethod: body.method ?? null,
    requestedTool: body.params?.name ?? null,
    query: body.params?.arguments?.query ?? null,
    pageSize: typeof body.params?.arguments?.pageSize === 'number' ? body.params.arguments.pageSize : null,
  };
}

function stringifyToolResult(result: ToolResult): string {
  return JSON.stringify(sanitizeValue(result), null, 2);
}

function countContentChars(result: ToolResult): number {
  return (result.content ?? [])
    .filter((entry) => entry.type === 'text')
    .reduce((sum, entry) => sum + (entry.type === 'text' ? entry.text.length : 0), 0);
}

export function classifyTraceSource(debugClientHeader?: string | string[]): McpTraceSource {
  const headerValue = Array.isArray(debugClientHeader) ? debugClientHeader[0] : debugClientHeader;
  return headerValue === 'synthetic-ui' ? 'synthetic' : 'external';
}

export interface McpTraceIngress {
  method: string;
  url: string;
  sessionId: string | null;
  headers: Record<string, unknown>;
  rawBody: string | null;
  bodyBytes: number;
  bodySha256: string | null;
  jsonRpcId: string | number | null;
  jsonRpcMethod: string | null;
  requestedTool: string | null;
  query: string | null;
  pageSize: number | null;
}

export interface McpTracePreTool {
  requestedTool: string;
  canonicalTool: string;
  arguments: Record<string, unknown>;
  rawToolResult: string;
  contentTextChars: number;
  structuredContentPresent: boolean;
  filesCount: number | null;
  nextPageTokenPresent: boolean;
}

export interface McpTraceEgress {
  statusCode: number;
  headers: Record<string, unknown>;
  rawBody: string;
  bodyBytes: number;
  bodySha256: string;
}

export interface McpTraceRecord {
  traceId: string;
  requestId: string;
  userId: string;
  source: McpTraceSource;
  createdAt: string;
  updatedAt: string;
  ingress?: McpTraceIngress;
  preTool?: McpTracePreTool;
  egress?: McpTraceEgress;
}

export interface McpTraceCapture {
  id: string;
  status: 'active' | 'stopped';
  startedAt: string;
  stoppedAt: string | null;
  records: McpTraceRecord[];
}

export interface McpTraceCaptureSummary {
  id: string;
  status: 'active' | 'stopped';
  startedAt: string;
  stoppedAt: string | null;
  recordCount: number;
}

function summarizeCapture(capture: McpTraceCapture): McpTraceCaptureSummary {
  return {
    id: capture.id,
    status: capture.status,
    startedAt: capture.startedAt,
    stoppedAt: capture.stoppedAt,
    recordCount: capture.records.length,
  };
}

export function attachResponseCapture(
  res: ServerResponse,
  onComplete: (payload: {
    statusCode: number;
    headers: Record<string, unknown>;
    rawBody: string;
    bodyBytes: number;
    bodySha256: string;
  }) => void,
): void {
  const chunks: Buffer[] = [];
  const originalWrite = res.write.bind(res) as (...args: any[]) => boolean;
  const originalEnd = res.end.bind(res) as (...args: any[]) => ServerResponse;
  let completed = false;

  function pushChunk(chunk?: unknown, encoding?: BufferEncoding) {
    if (chunk === undefined || chunk === null) return;
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      return;
    }
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk, encoding ?? 'utf8'));
      return;
    }
    chunks.push(Buffer.from(String(chunk), encoding ?? 'utf8'));
  }

  (res.write as unknown) = ((chunk: unknown, encoding?: BufferEncoding, callback?: () => void) => {
    pushChunk(chunk, encoding);
    return originalWrite(chunk, encoding, callback);
  }) as typeof res.write;

  (res.end as unknown) = ((chunk?: unknown, encoding?: BufferEncoding, callback?: () => void) => {
    pushChunk(chunk, encoding);
    const result = originalEnd(chunk, encoding, callback);
    if (!completed) {
      completed = true;
      const rawBody = Buffer.concat(chunks).toString('utf8');
      onComplete({
        statusCode: res.statusCode,
        headers: sanitizeHeaders(res.getHeaders()),
        rawBody: sanitizeBodyText(rawBody),
        bodyBytes: Buffer.byteLength(rawBody, 'utf8'),
        bodySha256: sha256(rawBody),
      });
    }
    return result;
  }) as typeof res.end;
}

export class McpTraceStore {
  private activeCaptureId: string | null = null;
  private readonly captures = new Map<string, McpTraceCapture>();

  isCapturing(): boolean {
    return this.activeCaptureId !== null;
  }

  startCapture(): McpTraceCaptureSummary {
    if (this.activeCaptureId) {
      const active = this.captures.get(this.activeCaptureId);
      if (active) return summarizeCapture(active);
    }

    const capture: McpTraceCapture = {
      id: randomUUID(),
      status: 'active',
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      records: [],
    };
    this.activeCaptureId = capture.id;
    this.captures.set(capture.id, capture);
    return summarizeCapture(capture);
  }

  stopCapture(): McpTraceCaptureSummary | null {
    if (!this.activeCaptureId) return null;
    const capture = this.captures.get(this.activeCaptureId);
    this.activeCaptureId = null;
    if (!capture) return null;
    capture.status = 'stopped';
    capture.stoppedAt = new Date().toISOString();
    return summarizeCapture(capture);
  }

  clearCaptures(): void {
    this.activeCaptureId = null;
    this.captures.clear();
  }

  listCaptures(): { activeCaptureId: string | null; captures: McpTraceCaptureSummary[] } {
    const captures = [...this.captures.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((capture) => summarizeCapture(capture));

    return {
      activeCaptureId: this.activeCaptureId,
      captures,
    };
  }

  getCapture(captureId: string): McpTraceCapture | null {
    const capture = this.captures.get(captureId);
    return capture ? JSON.parse(JSON.stringify(capture)) as McpTraceCapture : null;
  }

  recordIngress(input: {
    traceContext: McpHttpTraceContext;
    method: string;
    url: string;
    sessionId: string | null;
    headers: IncomingHttpHeaders;
    rawBody: string | null;
    parsedBody: unknown;
  }): void {
    const record = this.ensureRecord(input.traceContext);
    if (!record) return;

    const details = parseJsonRpcDetails(input.parsedBody);
    const rawBody = input.rawBody ?? '';

    record.ingress = {
      method: input.method,
      url: input.url,
      sessionId: input.sessionId,
      headers: sanitizeHeaders(input.headers),
      rawBody: input.rawBody ? sanitizeBodyText(input.rawBody) : null,
      bodyBytes: Buffer.byteLength(rawBody, 'utf8'),
      bodySha256: input.rawBody ? sha256(rawBody) : null,
      jsonRpcId: details.jsonRpcId,
      jsonRpcMethod: details.jsonRpcMethod,
      requestedTool: details.requestedTool,
      query: details.query,
      pageSize: details.pageSize,
    };
    record.updatedAt = new Date().toISOString();
  }

  recordPreTool(input: {
    traceId: string;
    source: McpTraceSource;
    userId: string;
    requestedTool: string;
    canonicalTool: string;
    arguments: Record<string, unknown>;
    result: ToolResult;
  }): void {
    const record = this.ensureRecord({
      traceId: input.traceId,
      requestId: input.traceId,
      source: input.source,
      userId: input.userId,
    });
    if (!record) return;

    const structuredContent = input.result.structuredContent as { files?: unknown[]; nextPageToken?: unknown } | undefined;
    record.preTool = {
      requestedTool: input.requestedTool,
      canonicalTool: input.canonicalTool,
      arguments: sanitizeValue(input.arguments) as Record<string, unknown>,
      rawToolResult: stringifyToolResult(input.result),
      contentTextChars: countContentChars(input.result),
      structuredContentPresent: Boolean(input.result.structuredContent),
      filesCount: Array.isArray(structuredContent?.files) ? structuredContent.files.length : null,
      nextPageTokenPresent: structuredContent?.nextPageToken !== undefined && structuredContent?.nextPageToken !== null,
    };
    record.updatedAt = new Date().toISOString();
  }

  recordEgress(input: {
    traceContext: McpHttpTraceContext;
    statusCode: number;
    headers: Record<string, unknown>;
    rawBody: string;
    bodyBytes: number;
    bodySha256: string;
  }): void {
    const record = this.ensureRecord(input.traceContext);
    if (!record) return;

    record.egress = {
      statusCode: input.statusCode,
      headers: sanitizeHeaders(input.headers),
      rawBody: sanitizeBodyText(input.rawBody),
      bodyBytes: input.bodyBytes,
      bodySha256: input.bodySha256,
    };
    record.updatedAt = new Date().toISOString();
  }

  private ensureRecord(traceContext: McpHttpTraceContext): McpTraceRecord | null {
    const capture = this.activeCaptureId ? this.captures.get(this.activeCaptureId) : null;
    if (!capture) return null;

    const existing = capture.records.find((record) => record.traceId === traceContext.traceId);
    if (existing) return existing;

    const record: McpTraceRecord = {
      traceId: traceContext.traceId,
      requestId: traceContext.requestId,
      userId: traceContext.userId,
      source: traceContext.source,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    capture.records.push(record);
    return record;
  }
}
