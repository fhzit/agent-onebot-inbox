import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeTarget, isLoopbackUrl, validateMetrics } from '../scripts/deployment-smoke.mjs';

describe('deployment smoke validation', () => {
  it('accepts loopback IPv4, IPv6 and localhost targets', () => {
    for (const url of ['http://127.0.0.1:3000', 'http://127.2.3.4/path', 'http://[::1]:3000', 'http://localhost:8080']) assert.equal(isLoopbackUrl(url), true);
  });
  it('rejects non-loopback by default and allows explicit opt-in', () => {
    assert.equal(isLoopbackUrl('https://example.com'), false);
    assert.throws(() => assertSafeTarget('https://example.com'), /Refusing non-loopback/);
    assert.equal(assertSafeTarget('https://example.com', true), 'https://example.com');
  });
  it('rejects malformed URLs, credentials, query strings and unsupported schemes', () => {
    for (const url of ['not a url', 'ftp://localhost', 'http://user:pass@localhost', 'http://localhost/?token=x', 'http://localhost/#frag']) assert.throws(() => assertSafeTarget(url));
  });
  it('requires expected metric names and valid exposition lines', () => {
    assert.equal(validateMetrics('message_ingest_total 0\nconnected_transports 1\n'), true);
    assert.equal(validateMetrics('# HELP message_ingest_total test\nmessage_ingest_total{label="x"} 3.5\nconnected_transports NaN\n'), true);
    assert.throws(() => validateMetrics('message_ingest_total 1\n'), /missing connected_transports/);
    assert.throws(() => validateMetrics('not metrics'), /invalid exposition/);
    assert.throws(() => validateMetrics(''), /empty/);
  });
});
