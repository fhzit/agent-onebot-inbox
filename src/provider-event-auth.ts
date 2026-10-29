import { timingSafeEqual } from 'node:crypto';

/** Verify an optional OneBot event token without leaking comparison timing. */
export function verifyProviderEventToken(expected: string | undefined, provided: string | undefined): boolean {
  // Undefined means the deployment intentionally has no event-token policy. An
  // explicitly configured empty token is invalid and must fail closed.
  if (expected === undefined) return true;
  if (expected.length === 0 || typeof provided !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
