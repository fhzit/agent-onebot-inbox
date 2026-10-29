import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';

const config = { host: '127.0.0.1', port: 0, apiToken: 'secret', maxMessageBytes: 1024, logMessageContent: false, accounts: [] };

test('startup rejects an attachment size limit that is zero, malformed, or above the hard cap', async () => {
  const previous = process.env.ATTACHMENT_MAX_BYTES;
  try {
    for (const value of ['0', '-1', '1.5', 'NaN', '104857601']) {
      process.env.ATTACHMENT_MAX_BYTES = value;
      await assert.rejects(startServer(config), /ATTACHMENT_MAX_BYTES/);
    }
  } finally {
    if (previous === undefined) delete process.env.ATTACHMENT_MAX_BYTES; else process.env.ATTACHMENT_MAX_BYTES = previous;
  }
});

test('startup rejects attachment action URL hosts unless explicitly allowlisted', async () => {
  const previous = process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS;
  try {
    delete process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS;
    await assert.rejects(startServer({ ...config, accounts: [{ id: 'x', alias: 'x', self_id: '1', provider: 'napcat', enabled: true, permission: 'direct', access_token: 'secret', action_url: 'http://127.0.0.1:1' }] }), /ATTACHMENT_ACTION_URL_ALLOWED_HOSTS/);
  } finally {
    if (previous === undefined) delete process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS; else process.env.ATTACHMENT_ACTION_URL_ALLOWED_HOSTS = previous;
  }
});
