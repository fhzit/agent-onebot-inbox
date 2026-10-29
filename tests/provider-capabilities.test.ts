import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderCapabilities, providerSupportsAction } from '../src/provider-capabilities.js';
import { RuntimeOneBotService } from '../src/runtime-onebot-service.js';

test('registered OneBot providers expose only documented baseline actions', () => {
  for (const provider of ['napcat', 'snowluma']) {
    assert.equal(providerSupportsAction(provider, 'send_private_msg'), true);
    assert.equal(providerSupportsAction(provider, 'get_file'), true);
    assert.equal(providerSupportsAction(provider, 'upload_file'), false);
  }
});

test('unknown providers and action names are not optimistically supported', () => {
  assert.equal(getProviderCapabilities('future-provider').actions.size, 0);
  assert.equal(providerSupportsAction('future-provider', 'send_private_msg'), false);
  assert.equal(providerSupportsAction('napcat', 'Send_Private_Msg'), false);
  assert.equal(providerSupportsAction('napcat', 'toString'), false);
  assert.equal(providerSupportsAction('napcat', 'constructor'), false);
});

test('runtime refuses provider-specific actions absent from its declared capabilities', async () => {
  const account = { id: 'a', alias: 'A', self_id: '1', provider: 'future-provider', enabled: true, permission: 'direct' as const };
  const service = new RuntimeOneBotService(new Map(), { async list() { return []; } } as never);
  await assert.rejects(service.callApi(account, 'get_file', {}), { code: 'ACTION_UNSUPPORTED' });
});
