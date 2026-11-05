import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerProviderQualificationApi } from '../src/provider-qualification-api.js';
import { ProviderQualificationStore } from '../src/provider-qualification-store.js';

function setup() {
  const app = Fastify();
  const store = new ProviderQualificationStore();
  registerProviderQualificationApi(app, {
    preHandler: async (request, reply) => {
      if (request.headers.authorization !== 'Bearer operator') return reply.code(401).send({ error: 'Unauthorized' });
    },
    store,
  });
  return { app, store };
}

test('qualification endpoints require injected authorization before reading or writing', async () => {
  const { app, store } = setup();
  try {
    const denied = await app.inject({ method: 'PUT', url: '/api/admin/provider-qualification', payload: {
      provider: 'napcat', version: '4.2.1', checks: [{ id: 'outbound.private-text', status: 'pass', evidence: 'Observed' }],
    } });
    assert.equal(denied.statusCode, 401);
    assert.equal(store.get('napcat', '4.2.1'), undefined);
    const deniedRead = await app.inject({ method: 'GET', url: '/api/admin/provider-qualification/napcat/4.2.1' });
    assert.equal(deniedRead.statusCode, 401);
  } finally { await app.close(); }
});

test('writes validated evidence-backed result and reads exact provider version', async () => {
  const { app } = setup();
  try {
    const response = await app.inject({ method: 'PUT', url: '/api/admin/provider-qualification', headers: { authorization: 'Bearer operator' }, payload: {
      provider: ' NapCat ', version: '4.2.1', checks: [{ id: 'outbound.private-text', status: 'pass', evidence: 'Controlled send observed' }],
    } });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().record.provider, 'napcat');
    assert.equal(response.json().record.checks[0].providerTested, true);
    assert.equal(response.json().qualified, false);
    assert.equal(response.json().lifecycle, 'unverified');

    const read = await app.inject({ method: 'GET', url: '/api/admin/provider-qualification/napcat/4.2.1', headers: { authorization: 'Bearer operator' } });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json().record, response.json().record);
    assert.equal(read.json().qualified, false);
    assert.equal(read.json().lifecycle, 'unverified');
    const otherVersion = await app.inject({ method: 'GET', url: '/api/admin/provider-qualification/napcat/4.2.2', headers: { authorization: 'Bearer operator' } });
    assert.equal(otherVersion.statusCode, 404);
  } finally { await app.close(); }
});

test('failed evidence and expired records never advertise qualification', async () => {
  const { app, store } = setup();
  try {
    for (const [version, status] of [['4.2.3', 'fail'], ['4.2.4', 'unverified']] as const) {
      const payload = { provider: 'napcat', version, checks: [{ id: 'outbound.private-text', status, ...(status === 'fail' ? { evidence: 'Failed observation' } : {}) }] };
      const result = await app.inject({ method: 'PUT', url: '/api/admin/provider-qualification', headers: { authorization: 'Bearer operator' }, payload });
      assert.equal(result.statusCode, 201);
      assert.equal(result.json().qualified, false);
      assert.equal(result.json().lifecycle, 'unverified');
    }
    const current = store.get('napcat', '4.2.3')!;
    store.get = () => ({ ...current, recordedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z' });
    const expired = await app.inject({ method: 'GET', url: '/api/admin/provider-qualification/napcat/4.2.3', headers: { authorization: 'Bearer operator' } });
    assert.equal(expired.json().lifecycle, 'expired');
    assert.equal(expired.json().qualified, false);
  } finally { await app.close(); }
});

test('rejects invalid qualification input and exposes the static checklist read-only', async () => {
  const { app } = setup();
  try {
    const invalid = await app.inject({ method: 'PUT', url: '/api/admin/provider-qualification', headers: { authorization: 'Bearer operator' }, payload: {
      provider: 'napcat', version: '4.2.1', checks: [{ id: 'outbound.private-text', status: 'pass' }],
    } });
    assert.equal(invalid.statusCode, 400);
    const checklist = await app.inject({ method: 'GET', url: '/api/admin/provider-qualification/checklist', headers: { authorization: 'Bearer operator' } });
    assert.equal(checklist.statusCode, 200);
    assert.ok(checklist.json().checklist.napcat.some((check: { id: string; verification: string }) => check.id === 'outbound.private-text' && check.verification === 'unverified'));
  } finally { await app.close(); }
});
