import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerAiAdvisoryConsentApi } from '../src/ai-advisory-consent-api.js';
import { createAiAdvisoryConsentService, InMemoryAiAdvisoryConsentRepository } from '../src/ai-advisory-consent.js';

function setup(options: { authenticated?: boolean; authorized?: boolean; queryFailure?: boolean; principal?: string | null } = {}) {
  const calls: unknown[][] = [];
  const principal = options.principal ?? 'verified-owner';
  const service = createAiAdvisoryConsentService({
    get: async accountId => { calls.push(['get', accountId]); if (options.queryFailure) throw Error('sensitive'); return repository.get(accountId); },
    put: async state => { calls.push(['put', state.accountId, state.enabled]); await repository.put(state); },
    update: async (accountId, build) => { calls.push(['update', accountId]); if (options.queryFailure) throw Error('sensitive'); return repository.update(accountId, build); },
  });
  const repository = new InMemoryAiAdvisoryConsentRepository();
  const app = Fastify();
  registerAiAdvisoryConsentApi(app, {
    isAuthenticated: async () => { calls.push(['auth']); return options.authenticated ?? true; },
    getPrincipalIdentity: async () => { calls.push(['identity']); return options.principal === null ? null : principal; },
    approvedDisclosureVersion: 'disclosure-2026-01',
    isAuthorizedForAccount: async (_request, id) => { calls.push(['authorize', id]); return options.authorized ?? true; },
    consent: service,
  });
  return { app, calls };
}

test('authentication is required before entitlement and consent storage', async () => {
  const { app, calls } = setup({ authenticated: false });
  const response = await app.inject({ method: 'POST', url: '/api/accounts/a/ai-advisory-consent', payload: { actor: 'owner', disclosureVersion: 'disclosure-2026-01' } });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(calls, [['auth']]);
  await app.close();
});

test('denies unauthorized account without accessing consent state', async () => {
  const { app, calls } = setup({ authorized: false });
  const response = await app.inject('/api/accounts/other/ai-advisory-consent');
  assert.equal(response.statusCode, 403);
  assert.deepEqual(calls, [['auth'], ['authorize', 'other']]);
  await app.close();
});

test('grant, query and revoke are scoped to exact account', async () => {
  const { app, calls } = setup();
  const grant = await app.inject({ method: 'POST', url: '/api/accounts/acct-a/ai-advisory-consent', payload: { actor: 'owner-a', disclosureVersion: 'disclosure-2026-01' } });
  assert.equal(grant.statusCode, 200);
  assert.equal(grant.json().consent.accountId, 'acct-a');
  assert.equal(grant.json().enabled, true);
  const other = await app.inject('/api/accounts/acct-b/ai-advisory-consent');
  assert.equal(other.statusCode, 200);
  assert.deepEqual(other.json(), { accountId: 'acct-b', enabled: false, consent: null });
  const query = await app.inject('/api/accounts/acct-a/ai-advisory-consent');
  assert.equal(query.json().consent.grantedBy, 'verified-owner');
  assert.equal(query.json().consent.disclosureVersion, 'disclosure-2026-01');
  const revoke = await app.inject({ method: 'DELETE', url: '/api/accounts/acct-a/ai-advisory-consent', payload: { actor: 'owner-a', disclosureVersion: 'disclosure-2026-01' } });
  assert.equal(revoke.statusCode, 200);
  assert.equal(revoke.json().enabled, false);
  assert.deepEqual(calls.filter(c => c[0] === 'update').map(c => c[1]), ['acct-a', 'acct-a']);
  assert(calls.every(c => c[0] !== 'get' || c[1] === 'acct-a' || c[1] === 'acct-b'));
  await app.close();
});

test('invalid consent actor and malformed account fail closed', async () => {
  const { app, calls } = setup();
  assert.equal((await app.inject({ method: 'POST', url: '/api/accounts/a/ai-advisory-consent', payload: { actor: ' ', disclosureVersion: 'disclosure-2026-01' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/accounts/a/ai-advisory-consent', payload: {} })).statusCode, 200);
  assert.equal(calls.some(c => c[0] === 'put'), false);
  await app.close();
});

test('grant requires explicit approved disclosure version; body actor is ignored', async () => {
  const { app, calls } = setup();
  const missing = await app.inject({ method: 'POST', url: '/api/accounts/a/ai-advisory-consent', payload: { actor: 'attacker' } });
  assert.equal(missing.statusCode, 400);
  const wrong = await app.inject({ method: 'POST', url: '/api/accounts/a/ai-advisory-consent', payload: { actor: 'attacker', disclosureVersion: 'v1' } });
  assert.equal(wrong.statusCode, 400);
  const grant = await app.inject({ method: 'POST', url: '/api/accounts/a/ai-advisory-consent', payload: { actor: 'attacker', disclosureVersion: 'disclosure-2026-01' } });
  assert.equal(grant.statusCode, 200);
  const query = await app.inject('/api/accounts/a/ai-advisory-consent');
  assert.equal(query.json().consent.grantedBy, 'verified-owner');
  assert.equal(calls.filter(c => c[0] === 'update').length, 1);
  await app.close();
});

test('missing verified principal denies mutation before storage', async () => {
  const { app, calls } = setup({ principal: null });
  const response = await app.inject({ method: 'DELETE', url: '/api/accounts/a/ai-advisory-consent', payload: { actor: 'forged' } });
  assert.equal(response.statusCode, 401);
  assert.equal(calls.some(c => c[0] === 'update'), false);
  await app.close();
});
test('consent storage failure returns generic unavailable and does not enable', async () => {
  const { app } = setup({ queryFailure: true });
  const response = await app.inject({ method: 'POST', url: '/api/accounts/a/ai-advisory-consent', payload: { actor: 'owner', disclosureVersion: 'disclosure-2026-01' } });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: 'Consent unavailable' });
  await app.close();
});
