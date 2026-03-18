import test from 'node:test';
import assert from 'node:assert/strict';
import { McpTraceStore, classifyTraceSource } from '../../src/mcp/traceStore.ts';

test('inactive trace store ignores records', () => {
  const store = new McpTraceStore();
  store.recordIngress({
    traceContext: {
      traceId: 'trace-1',
      requestId: 'req-1',
      userId: 'alice',
      source: 'external',
    },
    method: 'POST',
    url: '/mcp',
    sessionId: null,
    headers: {},
    rawBody: '{"jsonrpc":"2.0"}',
    parsedBody: { jsonrpc: '2.0' },
  });

  assert.equal(store.listCaptures().captures.length, 0);
});

test('capture groups ingress pre-tool and egress under the same trace id', () => {
  const store = new McpTraceStore();
  const started = store.startCapture();

  store.recordIngress({
    traceContext: {
      traceId: 'trace-1',
      requestId: 'req-1',
      userId: 'alice',
      source: 'synthetic',
    },
    method: 'POST',
    url: '/mcp',
    sessionId: 'session-1',
    headers: {
      accept: 'application/json',
      'x-debug-client': 'synthetic-ui',
    },
    rawBody: JSON.stringify({
      jsonrpc: '2.0',
      id: 'rpc-1',
      method: 'tools/call',
      params: {
        name: 'drive.search',
        arguments: {
          query: '조직 운영',
          pageSize: 20,
        },
      },
    }),
    parsedBody: {
      jsonrpc: '2.0',
      id: 'rpc-1',
      method: 'tools/call',
      params: {
        name: 'drive.search',
        arguments: {
          query: '조직 운영',
          pageSize: 20,
        },
      },
    },
  });

  store.recordPreTool({
    traceId: 'trace-1',
    source: 'synthetic',
    userId: 'alice',
    requestedTool: 'drivesearch',
    canonicalTool: 'drive.search',
    arguments: {
      query: '조직 운영',
      pageSize: 20,
    },
    result: {
      content: [{ type: 'text', text: 'Found 1 file(s).' }],
      structuredContent: {
        files: [{ id: 'file-1', name: '조직 운영 노트' }],
        nextPageToken: null,
      },
      isError: false,
    },
  });

  store.recordEgress({
    traceContext: {
      traceId: 'trace-1',
      requestId: 'req-1',
      userId: 'alice',
      source: 'synthetic',
    },
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    rawBody: '{"jsonrpc":"2.0","id":"rpc-1","result":{"content":[{"type":"text","text":"Found 1 file(s)."}]}}',
    bodyBytes: 95,
    bodySha256: 'abc123',
  });

  const capture = store.getCapture(started.id);
  assert.ok(capture);
  assert.equal(capture!.records.length, 1);
  assert.equal(capture!.records[0].traceId, 'trace-1');
  assert.equal(capture!.records[0].ingress?.requestedTool, 'drive.search');
  assert.equal(capture!.records[0].preTool?.requestedTool, 'drivesearch');
  assert.equal(capture!.records[0].preTool?.canonicalTool, 'drive.search');
  assert.equal(capture!.records[0].egress?.statusCode, 200);
});

test('trace store masks token and ticket values in raw bodies and headers', () => {
  const store = new McpTraceStore();
  const started = store.startCapture();

  store.recordIngress({
    traceContext: {
      traceId: 'trace-2',
      requestId: 'req-2',
      userId: 'alice',
      source: 'external',
    },
    method: 'POST',
    url: '/mcp',
    sessionId: null,
    headers: {
      authorization: 'Bearer super-secret-token',
    },
    rawBody: '{"token":"very-secret","ticket":"one-time-ticket","authUrl":"https://example.com/oauth/short?ticket=ultra-secret"}',
    parsedBody: {
      token: 'very-secret',
      ticket: 'one-time-ticket',
      authUrl: 'https://example.com/oauth/short?ticket=ultra-secret',
    },
  });

  store.recordEgress({
    traceContext: {
      traceId: 'trace-2',
      requestId: 'req-2',
      userId: 'alice',
      source: 'external',
    },
    statusCode: 200,
    headers: {
      authorization: 'Bearer response-secret',
    },
    rawBody: '{"result":{"authUrl":"https://example.com/oauth/short?ticket=response-secret"}}',
    bodyBytes: 96,
    bodySha256: 'def456',
  });

  const capture = store.getCapture(started.id);
  assert.ok(capture);
  const serialized = JSON.stringify(capture);
  assert.doesNotMatch(serialized, /super-secret-token/);
  assert.doesNotMatch(serialized, /very-secret/);
  assert.doesNotMatch(serialized, /one-time-ticket/);
  assert.doesNotMatch(serialized, /ultra-secret/);
  assert.doesNotMatch(serialized, /response-secret/);
  assert.match(serialized, /\[REDACTED\]/);
});

test('synthetic header is classified separately from external traffic', () => {
  assert.equal(classifyTraceSource('synthetic-ui'), 'synthetic');
  assert.equal(classifyTraceSource('genspark'), 'external');
  assert.equal(classifyTraceSource(undefined), 'external');
});
