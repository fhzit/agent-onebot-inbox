import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditProviderCapabilities } from '../scripts/provider-capability-audit.mjs';

const source = await readFile(new URL('../src/provider-capabilities.ts', import.meta.url), 'utf8');

test('audit marks declarations unverified and lists providers/actions deterministically', () => {
  const report = auditProviderCapabilities(source);
  assert.equal(report.verification, 'unverified');
  assert.deepEqual(report.providers.map(provider => provider.provider), ['napcat', 'snowluma']);
  assert.ok(report.providers.every(provider => provider.verification === 'unverified'));
  assert.ok(report.providers.every(provider => provider.actions.includes('send_private_msg')));
  assert.deepEqual(report.aliases, [
    ['get_group_member_info', 'get_group_member_info_v2'],
    ['get_group_member_list', 'get_group_member_list_v2'],
  ]);
  assert.deepEqual(report.duplicateActions, []);
});

test('audit detects duplicate actions without hiding declared alias groups', () => {
  const modified = source.replace("'send_private_msg', 'send_group_msg'", "'send_private_msg', 'send_private_msg', 'send_group_msg'");
  const report = auditProviderCapabilities(modified);
  assert.deepEqual(report.duplicateActions, ['send_private_msg']);
  assert.deepEqual(report.providers[0].duplicateActions, ['send_private_msg']);
});

test('audit rejects source whose declarations cannot be parsed', () => {
  assert.throws(() => auditProviderCapabilities('export const empty = true'), /Could not locate/);
});
