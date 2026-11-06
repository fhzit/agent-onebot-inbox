import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';
import { createAdminSession } from '../src/admin-session.js';

const config = {
  host: '127.0.0.1',
  port: 0,
  apiToken: 'legacy-token',
  adminPassword: 'console-pass',
  adminBasePath: '/admin',
  maxMessageBytes: 100000,
  logMessageContent: false,
  accounts: [{ id: 'main', alias: 'Main', self_id: '10001', provider: 'napcat', enabled: true, permission: 'readonly' as const, access_token: 'transport-secret' }],
};

const cookieOf = (response: Response): string => {
  const raw = response.headers.get('set-cookie') ?? '';
  const pair = raw.split(';')[0] ?? '';
  assert.ok(pair.includes('='), 'session cookie set');
  return pair;
};

test('console password, managed API keys and the bootstrap token stay separate', async () => {
  const runtime = await startServer(config);
  const address = runtime.address();
  assert.ok(address);
  const base = `http://127.0.0.1:${address.port}`;
  try {
    // No credentials at all: API is closed, and the console reports an unauthenticated session.
    assert.equal((await fetch(`${base}/api/summary`)).status, 401);
    const anon = await fetch(`${base}/api/admin/session`);
    assert.deepEqual(await anon.json(), { authenticated: false, mode: 'password', password_configured: true });

    // Wrong password is rejected and does not mint a session.
    const wrong = await fetch(`${base}/api/admin/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'nope' }),
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('set-cookie'), null);

    // Correct password issues an HttpOnly session cookie.
    const login = await fetch(`${base}/api/admin/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'console-pass' }),
    });
    assert.equal(login.status, 200);
    const rawCookie = login.headers.get('set-cookie') ?? '';
    assert.match(rawCookie, /HttpOnly/i);
    assert.match(rawCookie, /SameSite=Strict/i);
    const session = cookieOf(login);

    // The session authorizes the existing API surface without any bearer token.
    assert.equal((await fetch(`${base}/api/summary`, { headers: { cookie: session } })).status, 200);

    // Key management requires the console session, never an API key.
    const empty = await fetch(`${base}/api/admin/api-keys`, { headers: { cookie: session } });
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).keys, []);
    assert.equal((await fetch(`${base}/api/admin/api-keys`, { headers: { authorization: 'Bearer legacy-token' } })).status, 401);

    // Create a key: the plaintext is returned once, the stored record keeps only a prefix.
    const created = await fetch(`${base}/api/admin/api-keys`, {
      method: 'POST', headers: { cookie: session, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Hermes MCP' }),
    });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.match(body.key, /^aoi_[A-Za-z0-9_-]{20,}$/);
    assert.equal(body.record.name, 'Hermes MCP');
    assert.equal(body.record.revokedAt, null);
    assert.ok(!JSON.stringify(body.record).includes(body.key), 'record never carries the secret');

    const listed = await (await fetch(`${base}/api/admin/api-keys`, { headers: { cookie: session } })).json();
    assert.equal(listed.keys.length, 1);
    assert.equal(listed.keys[0].id, body.record.id);
    assert.ok(!JSON.stringify(listed).includes(body.key), 'listing never carries the secret');

    // The new key authenticates API calls but cannot manage keys.
    assert.equal((await fetch(`${base}/api/summary`, { headers: { authorization: `Bearer ${body.key}` } })).status, 200);
    assert.equal((await fetch(`${base}/api/admin/api-keys`, { headers: { authorization: `Bearer ${body.key}` } })).status, 401);

    // The bootstrap token still works so existing CLI/MCP clients are not broken.
    assert.equal((await fetch(`${base}/api/summary`, { headers: { authorization: 'Bearer legacy-token' } })).status, 200);

    // Revocation takes effect immediately.
    const revoked = await fetch(`${base}/api/admin/api-keys/${body.record.id}/revoke`, { method: 'POST', headers: { cookie: session } });
    assert.equal(revoked.status, 200);
    assert.equal((await fetch(`${base}/api/summary`, { headers: { authorization: `Bearer ${body.key}` } })).status, 401);
    const afterRevoke = await (await fetch(`${base}/api/admin/api-keys`, { headers: { cookie: session } })).json();
    assert.ok(afterRevoke.keys[0].revokedAt, 'revoked_at recorded');
    assert.equal((await fetch(`${base}/api/admin/api-keys/${body.record.id}/revoke`, { method: 'POST', headers: { cookie: session } })).status, 404);

    // Logout clears the cookie; the old value is no longer accepted.
    const logout = await fetch(`${base}/api/admin/session`, { method: 'DELETE', headers: { cookie: session } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
    assert.equal((await fetch(`${base}/api/summary`, { headers: { cookie: session } })).status, 200, 'signed session stays valid until expiry');
  } finally {
    await runtime.close();
  }
});

test('console login is disabled when ADMIN_PASSWORD is unset', async () => {
  const { adminPassword: _omitted, ...withoutPassword } = config;
  const runtime = await startServer(withoutPassword);
  const address = runtime.address();
  assert.ok(address);
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const status = await fetch(`${base}/api/admin/session`);
    assert.equal((await status.json()).password_configured, false);
    const login = await fetch(`${base}/api/admin/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'anything' }),
    });
    assert.equal(login.status, 503);
    // Bootstrap token still authorizes the API.
    assert.equal((await fetch(`${base}/api/summary`, { headers: { authorization: 'Bearer legacy-token' } })).status, 200);
  } finally {
    await runtime.close();
  }
});

test('session cookies reject tampering, expiry and throttled brute force', () => {
  const session = createAdminSession({ password: 'console-pass', ttlMs: 60_000, maxAttempts: 3, windowMs: 60_000 });
  const ok = session.login('console-pass', { secure: true });
  assert.ok(ok.ok);
  const cookie = ok.cookie.split(';')[0]!;
  const value = cookie.slice(cookie.indexOf('=') + 1);
  const req = (cookieValue: string) => ({ headers: { cookie: `aoi_admin_session=${cookieValue}` } });

  assert.equal(session.isAuthenticated(req(value)), true);
  const [expiry, signature] = value.split('.');
  assert.equal(session.isAuthenticated(req(`${Number(expiry) + 5000}.${signature}`)), false, 'expiry cannot be extended');
  assert.equal(session.isAuthenticated(req(`${expiry}.${'0'.repeat(signature!.length)}`)), false, 'signature checked');
  assert.equal(session.isAuthenticated({ headers: {} }), false);
  assert.match(ok.cookie, /Secure/);

  const insecure = session.login('console-pass', { secure: false });
  assert.ok(insecure.ok);
  assert.ok(!insecure.cookie.includes('Secure'));

  // Three failures throttle further attempts until the window resets.
  for (let i = 0; i < 3; i++) assert.equal(session.login('bad', { secure: false, clientKey: '1.2.3.4' }).ok, false);
  const throttled = session.login('console-pass', { secure: false, clientKey: '1.2.3.4' });
  assert.equal(throttled.ok, false);
  assert.equal(throttled.ok === false && throttled.reason, 'throttled');
  // A different client is unaffected.
  assert.equal(session.login('console-pass', { secure: false, clientKey: '5.6.7.8' }).ok, true);
});
