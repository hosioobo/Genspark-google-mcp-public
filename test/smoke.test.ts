import test from 'node:test';
import assert from 'node:assert/strict';

function parseBearerToken(headerValue?: string | null): string | null {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
}

test('parseBearerToken parses valid bearer header', () => {
  assert.equal(parseBearerToken('Bearer abc123'), 'abc123');
});

test('parseBearerToken rejects invalid header', () => {
  assert.equal(parseBearerToken('Basic abc123'), null);
});
