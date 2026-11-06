import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Admin console authentication.
 *
 * The console password is deliberately separate from the API token: the panel is
 * authenticated with a stateless, HMAC-signed HttpOnly cookie, while API clients
 * keep using bearer keys that the panel can create and revoke.
 */
export const ADMIN_COOKIE = 'aoi_admin_session';

export type AdminSessionOptions = {
  password?: string | undefined;
  /** Defaults to a value derived from the password so restarts keep sessions valid. */
  secret?: string | undefined;
  ttlMs?: number | undefined;
  maxAttempts?: number | undefined;
  windowMs?: number | undefined;
};

export type LoginResult =
  | { ok: true; cookie: string; expiresAt: number }
  | { ok: false; reason: 'disabled' | 'invalid' | 'throttled'; retryAfterSeconds?: number };

const equal = (a: string, b: string): boolean => {
  const left = Buffer.from(createHmac('sha256', 'aoi-admin-session').update(a).digest());
  const right = Buffer.from(createHmac('sha256', 'aoi-admin-session').update(b).digest());
  return timingSafeEqual(left, right);
};

const readCookie = (header: string | undefined, name: string): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
};

export function createAdminSession(options: AdminSessionOptions = {}) {
  const password = (options.password ?? '').trim();
  const enabled = password.length > 0;
  const secret = options.secret?.trim() || createHmac('sha256', 'aoi-admin-password').update(password).digest('hex');
  const ttlMs = Math.max(60_000, options.ttlMs ?? 12 * 60 * 60 * 1000);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 10);
  const windowMs = Math.max(1_000, options.windowMs ?? 5 * 60 * 1000);
  const attempts = new Map<string, { count: number; resetAt: number }>();

  const sign = (payload: string): string => createHmac('sha256', secret).update(payload).digest('hex');

  const cookieValue = (expiresAt: number): string => {
    const payload = String(expiresAt);
    return `${payload}.${sign(payload)}`;
  };

  const cookieAttrs = (secure: boolean): string =>
    `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;

  function throttled(key: string): number {
    const entry = attempts.get(key);
    if (!entry) return 0;
    if (entry.resetAt <= Date.now()) { attempts.delete(key); return 0; }
    return entry.count >= maxAttempts ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0;
  }

  function recordFailure(key: string): void {
    const entry = attempts.get(key);
    if (!entry || entry.resetAt <= Date.now()) attempts.set(key, { count: 1, resetAt: Date.now() + windowMs });
    else entry.count += 1;
  }

  return {
    enabled,
    cookieName: ADMIN_COOKIE,
    ttlMs,
    /** Verifies the console password and returns the Set-Cookie value. */
    login(candidate: string, opts: { secure: boolean; clientKey?: string }): LoginResult {
      if (!enabled) return { ok: false, reason: 'disabled' };
      const key = opts.clientKey ?? 'global';
      const wait = throttled(key);
      if (wait > 0) return { ok: false, reason: 'throttled', retryAfterSeconds: wait };
      if (typeof candidate !== 'string' || candidate.length === 0 || !equal(candidate, password)) {
        recordFailure(key);
        return { ok: false, reason: 'invalid' };
      }
      attempts.delete(key);
      const expiresAt = Date.now() + ttlMs;
      return {
        ok: true,
        expiresAt,
        cookie: `${ADMIN_COOKIE}=${cookieValue(expiresAt)}; Max-Age=${Math.floor(ttlMs / 1000)}; ${cookieAttrs(opts.secure)}`,
      };
    },
    logoutCookie(opts: { secure: boolean }): string {
      return `${ADMIN_COOKIE}=; Max-Age=0; ${cookieAttrs(opts.secure)}`;
    },
    /** True only for a signed, unexpired console cookie. */
    isAuthenticated(req: Pick<IncomingMessage, 'headers'>): boolean {
      if (!enabled) return false;
      const raw = readCookie(req.headers.cookie, ADMIN_COOKIE);
      if (!raw) return false;
      const dot = raw.lastIndexOf('.');
      if (dot <= 0) return false;
      const payload = raw.slice(0, dot);
      const signature = raw.slice(dot + 1);
      if (!/^\d{10,16}$/.test(payload)) return false;
      if (!equal(signature, sign(payload))) return false;
      const expiresAt = Number(payload);
      return Number.isFinite(expiresAt) && expiresAt > Date.now();
    },
  };
}

export type AdminSession = ReturnType<typeof createAdminSession>;
