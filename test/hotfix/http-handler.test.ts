import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { normalizeMcpAcceptHeader } from '../../src/mcp/httpHandler.ts';

function createRequest(accept: string): IncomingMessage {
  return {
    headers: { accept },
    rawHeaders: ['Accept', accept],
  } as IncomingMessage;
}

test('normalizeMcpAcceptHeader upgrades POST Accept to MCP-compatible value in headers and rawHeaders', () => {
  const req = createRequest('application/json');

  normalizeMcpAcceptHeader(req, 'POST');

  assert.equal(req.headers.accept, 'application/json, text/event-stream');
  assert.deepEqual(req.rawHeaders, ['Accept', 'application/json, text/event-stream']);
});

test('normalizeMcpAcceptHeader upgrades GET Accept to SSE-compatible value in headers and rawHeaders', () => {
  const req = createRequest('application/json');

  normalizeMcpAcceptHeader(req, 'GET');

  assert.equal(req.headers.accept, 'text/event-stream');
  assert.deepEqual(req.rawHeaders, ['Accept', 'text/event-stream']);
});
