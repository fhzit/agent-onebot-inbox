import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiAdvisoryConsentService, InMemoryAiAdvisoryConsentRepository } from '../src/ai-advisory-consent.js';

test('in-memory repository serializes concurrent revisions when using atomic update', async () => {
  const repository = new InMemoryAiAdvisoryConsentRepository();
  const service = createAiAdvisoryConsentService(repository, () => new Date('2026-01-02T03:04:05.000Z'));

  const [grant, revoke] = await Promise.all([
    service.enable({ accountId: 'acct-a', actor: 'grant-actor' }),
    service.revoke({ accountId: 'acct-a', actor: 'revoke-actor' }),
  ]);

  assert.deepEqual([grant.revision, revoke.revision].sort((a, b) => a - b), [1, 2]);
  assert.equal((await service.query('acct-a'))?.revision, 2);
});
