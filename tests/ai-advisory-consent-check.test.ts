import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAiAdvisoryConsentActive } from '../src/ai-advisory-consent-check.js';
import type { AiAdvisoryConsentService, AiAdvisoryConsentState } from '../src/ai-advisory-consent.js';

const active: AiAdvisoryConsentState = {
  accountId: 'acct-a', enabled: true, grantedAt: '2026-01-01T00:00:00.000Z', grantedBy: 'user', revision: 1,
};
const revoked: AiAdvisoryConsentState = {
  accountId: 'acct-a', enabled: false, revokedAt: '2026-01-01T00:00:00.000Z', revokedBy: 'user', revision: 2,
};
function service(query: AiAdvisoryConsentService['query']): Pick<AiAdvisoryConsentService, 'query'> {
  return { query };
}

test('allows only latest enabled consent for the requested account', async () => {
  let reads = 0;
  assert.equal(await isAiAdvisoryConsentActive(service(async id => {
    reads++;
    assert.equal(id, 'acct-a');
    return active;
  }), 'acct-a'), true);
  assert.equal(reads, 1);
  assert.equal(await isAiAdvisoryConsentActive(service(async () => revoked), 'acct-a'), false);
  assert.equal(await isAiAdvisoryConsentActive(service(async () => undefined), 'acct-a'), false);
  assert.equal(await isAiAdvisoryConsentActive(service(async () => ({ ...active, accountId: 'acct-b' })), 'acct-a'), false);
});

test('fails closed on query errors and does not cache state', async () => {
  assert.equal(await isAiAdvisoryConsentActive(service(async () => { throw new Error('offline'); }), 'acct-a'), false);
  let latest: AiAdvisoryConsentState | undefined = active;
  const consent = service(async () => latest);
  assert.equal(await isAiAdvisoryConsentActive(consent, 'acct-a'), true);
  latest = revoked;
  assert.equal(await isAiAdvisoryConsentActive(consent, 'acct-a'), false);
});
