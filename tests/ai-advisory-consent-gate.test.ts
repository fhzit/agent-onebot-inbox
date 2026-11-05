import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAiAdvisoryConsent } from '../src/ai-advisory-consent-gate.js';
import type { AiAdvisoryConsentService, AiAdvisoryConsentState } from '../src/ai-advisory-consent.js';

function service(query: AiAdvisoryConsentService['query']): Pick<AiAdvisoryConsentService, 'query'> {
  return { query };
}
const active: AiAdvisoryConsentState = { accountId: 'acct-a', enabled: true, grantedAt: '2026-01-01T00:00:00.000Z', grantedBy: 'user', revision: 1 };
const revoked: AiAdvisoryConsentState = { accountId: 'acct-a', enabled: false, revokedAt: '2026-01-01T00:00:00.000Z', revokedBy: 'user', revision: 2 };

test('does not invoke classifier or persistence when consent is absent, revoked, or query errors', async () => {
  for (const query of [async () => undefined, async () => revoked, async () => { throw new Error('repository offline'); }]) {
    let classified = false;
    let persisted = false;
    assert.equal(await withAiAdvisoryConsent('acct-a', service(query), async () => { classified = true; return 'result'; }, async () => { persisted = true; }), false);
    assert.equal(classified, false);
    assert.equal(persisted, false);
  }
});

test('persists after successful classification while consent remains active', async () => {
  let persisted: string | undefined;
  let checks = 0;
  const ok = await withAiAdvisoryConsent('acct-a', service(async () => { checks++; return active; }), async expectedRevision => { assert.equal(expectedRevision, 1); return 'classified'; }, async (value, revision) => { persisted = `${value}:${revision}`; });
  assert.equal(ok, true);
  assert.equal(checks, 2);
  assert.equal(persisted, 'classified:1');
});

test('rechecks consent after classification and blocks persistence after revocation', async () => {
  let checks = 0;
  let persisted = false;
  const ok = await withAiAdvisoryConsent('acct-a', service(async () => ++checks === 1 ? active : revoked), async expectedRevision => { assert.equal(expectedRevision, 1); return 'classified'; }, async (_value, revision) => { persisted = revision === 1; });
  assert.equal(ok, false);
  assert.equal(checks, 2);
  assert.equal(persisted, false);
});

test('blocks persistence when consent is revoked and re-granted during classification', async () => {
  let checks = 0;
  let persisted = false;
  const consent = service(async () => { checks++; return checks === 1 ? active : { ...active, revision: 3 }; });
  const ok = await withAiAdvisoryConsent('acct-a', consent, async expectedRevision => { assert.equal(expectedRevision, 1); return 'classified'; }, async (_value, revision) => { persisted = revision === 1; });
  assert.equal(ok, false);
  assert.equal(checks, 2);
  assert.equal(persisted, false);
});

test('fails closed if the second consent query errors or classification is undefined', async () => {
  let checks = 0;
  let persisted = false;
  assert.equal(await withAiAdvisoryConsent('acct-a', service(async () => { if (++checks === 2) throw new Error('offline'); return active; }), async () => 'classified', async () => { persisted = true; }), false);
  assert.equal(persisted, false);
  assert.equal(await withAiAdvisoryConsent('acct-a', service(async () => active), async () => undefined, async () => { persisted = true; }), false);
  assert.equal(persisted, false);
});
