import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMessage } from '../src/ai-classification.js';
import { createHttpMessageClassifier } from '../src/ai-classification-http.js';

const input = { messageId: 'm-1', text: 'hello', labels: ['greeting', 'other'] };
const response = (content: string, status = 200, headers?: HeadersInit) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers });

test('OAI-compatible adapter sends bounded structured request and returns JSON result', async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const classifier = createHttpMessageClassifier({ endpoint: 'https://example.test/v1/chat/completions', apiKey: 'secret', fetch: async (url, init) => { seen = { url: String(url), init: init! }; return response('{"label":"greeting","confidence":0.9}'); } });
  assert.deepEqual(await classifyMessage(classifier, input), { label: 'greeting', confidence: 0.9 });
  assert.equal(seen?.url, 'https://example.test/v1/chat/completions');
  assert.equal(new Headers(seen?.init.headers).get('authorization'), 'Bearer secret');
  assert.match(String(seen?.init.body), /response_format/);
});

test('endpoint rejects unsafe URL forms and never echoes credentials', () => {
  for (const endpoint of ['ftp://example.test/path', 'https://u:p@example.test/path', 'https://example.test/path?token=x', 'https://example.test/path#frag', '/relative']) {
    assert.throws(() => createHttpMessageClassifier({ endpoint }), /endpoint/);
  }
});

test('rejects oversized responses and malformed structured envelopes', async () => {
  const oversized = createHttpMessageClassifier({ endpoint: 'https://example.test', maxResponseBytes: 8, fetch: async () => new Response('x'.repeat(100)) });
  await assert.rejects(oversized.classify(input), /size limit/);
  const invalid = createHttpMessageClassifier({ endpoint: 'https://example.test', fetch: async () => response('not json') });
  await assert.rejects(invalid.classify(input), /not valid JSON/);
  const malformed = createHttpMessageClassifier({ endpoint: 'https://example.test', fetch: async () => new Response('{"no_choices":true}') });
  await assert.rejects(malformed.classify(input), /invalid structure/);
});

test('enforces timeout and hides endpoint credential material from failures', async () => {
  const classifier = createHttpMessageClassifier({ endpoint: 'https://example.test', timeoutMs: 100, fetch: async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))) });
  await assert.rejects(classifier.classify(input), /timed out/);
  assert.throws(() => createHttpMessageClassifier({ endpoint: 'https://example.test', timeoutMs: -1 }), /timeoutMs must be between/);
  assert.throws(() => createHttpMessageClassifier({ endpoint: 'https://example.test', maxResponseBytes: 0 }), /maxResponseBytes must be between/);
});

test('HTTP failure does not expose credential', async () => {
  const classifier = createHttpMessageClassifier({ endpoint: 'https://example.test', apiKey: 'secret', fetch: async () => new Response('private', { status: 503 }) });
  await assert.rejects(classifier.classify(input), error => !String(error).includes('secret') && /status 503/.test(String(error)));
});


test('uses redirect:error so credentials cannot be forwarded to redirect targets', async () => {
  let redirectMode: RequestRedirect | undefined;
  const classifier = createHttpMessageClassifier({ endpoint: 'https://example.test/v1/chat/completions', apiKey: 'secret', fetch: async (_url, init) => {
    redirectMode = init?.redirect;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  } });
  await assert.rejects(classifier.classify(input), /status 302/);
  assert.equal(redirectMode, 'error');
});

test('default transport rejects private and loopback destinations before connecting', async () => {
  for (const endpoint of ['http://127.0.0.1/v1/chat/completions', 'http://10.0.0.4/v1/chat/completions']) {
    const classifier = createHttpMessageClassifier({ endpoint, apiKey: 'secret', timeoutMs: 500 });
    await assert.rejects(classifier.classify(input), /Unsafe OneBot action_url destination/);
  }
});
