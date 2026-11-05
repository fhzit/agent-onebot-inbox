import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConsentValidationError,
  createAiAdvisoryConsentService,
  InMemoryAiAdvisoryConsentRepository,
} from '../src/ai-advisory-consent.js';

test('consent is disabled until explicitly enabled and can be queried by account', async () => {
  const service = createAiAdvisoryConsentService(new InMemoryAiAdvisoryConsentRepository(), () => new Date('2026-01-02T03:04:05.000Z'));
  assert.equal(await service.query('acct-a'), undefined);
  const grant = await service.enable({ accountId: 'acct-a', actor: 'operator-7' });
  assert.deepEqual(grant, {
    accountId: 'acct-a', enabled: true, grantedAt: '2026-01-02T03:04:05.000Z', grantedBy: 'operator-7', disclosureVersion: 'v1', revision: 1,
  });
  assert.deepEqual(await service.query('acct-a'), grant);
  assert.equal(await service.query('acct-b'), undefined);
});

test('revocation is explicit, auditable, and can be followed by a new grant', async () => {
  const repository = new InMemoryAiAdvisoryConsentRepository();
  let instant = '2026-01-02T03:04:05.000Z';
  const service = createAiAdvisoryConsentService(repository, () => new Date(instant));
  await service.enable({ accountId: 'acct-a', actor: 'user-1' });
  instant = '2026-01-03T03:04:05.000Z';
  const revoked = await service.revoke({ accountId: 'acct-a', actor: 'operator-9' });
  assert.deepEqual(revoked, {
    accountId: 'acct-a', enabled: false, revokedAt: instant, revokedBy: 'operator-9', disclosureVersion: 'v1', revision: 2,
  });
  assert.deepEqual(await service.query('acct-a'), revoked);
  instant = '2026-01-04T03:04:05.000Z';
  const renewed = await service.enable({ accountId: 'acct-a', actor: 'user-1' });
  assert.equal(renewed.revision, 3);
  assert.equal(renewed.enabled, true);
});

test('re-enabling and re-revoking advances revision rather than hiding lifecycle transitions', async () => {
  const service = createAiAdvisoryConsentService(new InMemoryAiAdvisoryConsentRepository());
  assert.equal((await service.enable({ accountId: 'acct-a', actor: 'a' })).revision, 1);
  assert.equal((await service.enable({ accountId: 'acct-a', actor: 'b' })).revision, 2);
  assert.equal((await service.revoke({ accountId: 'acct-a', actor: 'c' })).revision, 3);
  assert.equal((await service.revoke({ accountId: 'acct-a', actor: 'd' })).revision, 4);
});

test('invalid identifiers, actors, and clocks fail closed before state changes', async () => {
  const repository = new InMemoryAiAdvisoryConsentRepository();
  const service = createAiAdvisoryConsentService(repository, () => new Date(Number.NaN));
  await assert.rejects(service.enable({ accountId: ' ', actor: 'person' }), ConsentValidationError);
  await assert.rejects(service.revoke({ accountId: 'acct-a', actor: ' person' }), ConsentValidationError);
  await assert.rejects(service.enable({ accountId: 'acct-a', actor: 'person' }), ConsentValidationError);
  assert.equal(await service.query('acct-a'), undefined);
  await assert.rejects(service.query('  '), ConsentValidationError);
});

test('concurrent enable and revoke transitions are serialized with distinct revisions', async () => {
  const service = createAiAdvisoryConsentService(new InMemoryAiAdvisoryConsentRepository());
  const results = await Promise.all([
    service.enable({ accountId: 'acct-race', actor: 'enable-a' }),
    service.revoke({ accountId: 'acct-race', actor: 'revoke-b' }),
    service.enable({ accountId: 'acct-race', actor: 'enable-c' }),
  ]);
  assert.deepEqual(results.map(result => result.revision).sort((a, b) => a - b), [1, 2, 3]);
  assert.equal((await service.query('acct-race'))?.revision, 3);
});
test('stored state is returned defensively and includes no provider message content fields', async () => {
  const repository = new InMemoryAiAdvisoryConsentRepository();
  const service = createAiAdvisoryConsentService(repository);
  const grant = await service.enable({ accountId: 'acct-a', actor: 'operator' });
  assert.throws(() => { (grant as { accountId: string }).accountId = 'acct-b'; }, TypeError);
  assert.equal((await service.query('acct-a'))?.accountId, 'acct-a');
  assert.deepEqual(Object.keys((await service.query('acct-a'))!).sort(), ['accountId', 'disclosureVersion', 'enabled', 'grantedAt', 'grantedBy', 'revision']);
});
