const MAX_DEPTH = 4;
const MAX_KEYS = 50;
const MAX_ARRAY = 50;
const MAX_STRING = 512;
const MAX_OUTPUT = 4096;
const SECRET_KEY = /(?:token|secret|password|passwd|authorization|cookie|credential|api[_-]?key|private[_-]?key)/i;
const CONTENT_KEY = /^(?:message|content|text|body|prompt|transcript|raw[_-]?message)$/i;
const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Produce bounded, JSON-safe audit metadata; never pass raw message/content fields through. */
export function normalizeAuditMetadata(metadata: unknown): Record<string, JsonValue> {
  const seen = new WeakSet<object>();
  const clean = (value: unknown, depth: number, key?: string): JsonValue => {
    if (key && (SECRET_KEY.test(key) || CONTENT_KEY.test(key))) return REDACTED;
    if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}${TRUNCATED}` : value;
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : '[UNSUPPORTED]';
    if (typeof value !== 'object') return '[UNSUPPORTED]';
    if (seen.has(value)) return '[CIRCULAR]';
    if (depth >= MAX_DEPTH) return TRUNCATED;
    seen.add(value);
    let result: JsonValue;
    if (Array.isArray(value)) result = value.slice(0, MAX_ARRAY).map(item => clean(item, depth + 1));
    else {
      const out: Record<string, JsonValue> = {};
      const keys = Object.keys(value).sort();
      for (const name of keys.slice(0, MAX_KEYS)) {
        try { out[name] = clean((value as Record<string, unknown>)[name], depth + 1, name); }
        catch { out[name] = '[UNSUPPORTED]'; }
      }
      if (keys.length > MAX_KEYS) out.__truncated__ = TRUNCATED;
      result = out;
    }
    seen.delete(value);
    return result;
  };
  let normalized: JsonValue;
  try { normalized = clean(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}, 0); }
  catch { normalized = {}; }
  if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') normalized = {};
  const result = normalized as Record<string, JsonValue>;
  if (JSON.stringify(result).length > MAX_OUTPUT) return { __truncated__: TRUNCATED };
  return result;
}
