import test from 'node:test';
import assert from 'node:assert/strict';
import { HEALTH_PATH, HEALTH_RESPONSE_BODY, isHealthRequest } from '../../src/health.ts';

test('health constants match the public health check contract', () => {
  assert.equal(HEALTH_PATH, '/health');
  assert.equal(HEALTH_RESPONSE_BODY, 'OK');
});

test('isHealthRequest accepts /health with or without query string', () => {
  assert.equal(isHealthRequest('/health'), true);
  assert.equal(isHealthRequest('/health?probe=1'), true);
});

test('isHealthRequest rejects legacy /healthz requests', () => {
  assert.equal(isHealthRequest('/healthz'), false);
  assert.equal(isHealthRequest('/healthz?probe=1'), false);
});
