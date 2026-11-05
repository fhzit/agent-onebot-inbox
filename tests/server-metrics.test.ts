import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';

test('GET /metrics exposes operational counters without sensitive labels or values', async () => {
  const apiToken = 'metrics-test-api-secret';
  const accountSecret = 'metrics-test-account-secret';
  const runtime = await startServer({
    host: '127.0.0.1',
    port: 0,
    apiToken,
    maxMessageBytes: 100_000,
    logMessageContent: false,
    accounts: [{ id: 'private-account-id', alias: 'private-account-alias', self_id: 'private-self-id', provider: 'napcat', enabled: true, permission: 'direct', access_token: accountSecret }],
  });
  try {
    const address = runtime.address();
    assert.ok(address, 'server should be listening');
    const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; version=0.0.4; charset=utf-8');
    const body = await response.text();

    const expectedCounters = [
      'message_ingest_total',
      'duplicate_event_total',
      'send_success_total',
      'send_failure_total',
      'connected_transports',
    ];
    const metricLines = body.trim().split(String.fromCharCode(10));
    assert.equal(metricLines.length, expectedCounters.length, 'each counter should be separated by a newline');
    for (let index = 0; index < expectedCounters.length; index++) {
      assert.match(metricLines[index]!, new RegExp('^' + expectedCounters[index] + ' \\d+$'), 'expected numeric counter');
    }
    assert.deepEqual(metricLines.map(line => line.split(' ')[0]), expectedCounters, 'metrics should contain only known unlabeled counters');
    for (const sensitiveValue of [apiToken, accountSecret, 'private-account-id', 'private-account-alias', 'private-self-id']) {
      assert.equal(body.includes(sensitiveValue), false, `metrics must not expose ${sensitiveValue}`);
    }
    assert.doesNotMatch(body, /\{[^}]*\}/, 'metrics should not contain labels that could leak identifiers');
  } finally {
    await runtime.close();
  }
});
