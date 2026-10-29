import { safeActionFetch } from './action-url-http.js';
import {
  MAX_CLASSIFICATION_REASON_CHARS,
  type ClassificationInput,
  type MessageClassifier,
} from './ai-classification.js';

export const DEFAULT_CLASSIFICATION_HTTP_TIMEOUT_MS = 5_000;
export const DEFAULT_CLASSIFICATION_HTTP_MAX_RESPONSE_BYTES = 16_384;

export type HttpClassificationOptions = Readonly<{
  /** Full OAI-compatible chat-completions endpoint. No query, fragment or userinfo allowed. */
  endpoint: string;
  /** Optional bearer credential; never included in errors or logs. */
  apiKey?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetch?: typeof globalThis.fetch;
}>;

/** Explicitly constructed, opt-in OAI-compatible classifier; no ingress wiring or defaults. */
export function createHttpMessageClassifier(options: HttpClassificationOptions): MessageClassifier {
  const endpoint = validateEndpoint(options.endpoint);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLASSIFICATION_HTTP_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_CLASSIFICATION_HTTP_MAX_RESPONSE_BYTES;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new RangeError('timeoutMs must be between 1 and 120000');
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 1_048_576) throw new RangeError('maxResponseBytes must be between 1 and 1048576');
  if (options.apiKey !== undefined && (typeof options.apiKey !== 'string' || !options.apiKey.trim())) throw new TypeError('apiKey must be a non-empty string');
  const fetchImpl = options.fetch ?? safeActionFetch as unknown as typeof globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is unavailable');

  return {
    async classify(input: Readonly<ClassificationInput>): Promise<unknown> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }),
          },
          body: JSON.stringify({
            model: 'classification',
            temperature: 0,
            messages: [
              { role: 'system', content: `Classify the message using exactly one supplied label. Return only JSON with label, confidence (0 to 1), and optional reason (at most ${MAX_CLASSIFICATION_REASON_CHARS} characters).` },
              { role: 'user', content: JSON.stringify({ messageId: input.messageId, text: input.text, labels: input.labels }) },
            ],
            response_format: { type: 'json_object' },
          }),
          signal: controller.signal,
          redirect: 'error',
        });
        if (!response.ok) throw new Error(`classification HTTP request failed (status ${response.status})`);
        const raw = await readBounded(response, maxResponseBytes);
        let envelope: unknown;
        try { envelope = JSON.parse(raw); } catch { throw new Error('classification HTTP response was not valid JSON'); }
        const content = getMessageContent(envelope);
        let result: unknown;
        try { result = JSON.parse(content); } catch { throw new Error('classification model response was not valid JSON'); }
        return result;
      } catch (error) {
        if (controller.signal.aborted) throw new Error('classification HTTP request timed out');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function validateEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('endpoint must be an absolute HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash)
    throw new TypeError('endpoint must use HTTP(S) and contain no credentials, query, or fragment');
  return url.toString();
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > maxBytes) throw new RangeError('classification HTTP response exceeded size limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RangeError('classification HTTP response exceeded size limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function getMessageContent(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('classification HTTP response had invalid structure');
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') throw new Error('classification HTTP response had invalid structure');
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== 'object') throw new Error('classification HTTP response had invalid structure');
  const content = (message as { content?: unknown }).content;
  if (typeof content !== 'string') throw new Error('classification HTTP response had invalid structure');
  return content;
}
