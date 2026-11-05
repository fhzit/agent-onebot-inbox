import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AiAdvisoryConsentService, AiAdvisoryConsentState } from './ai-advisory-consent.js';

export interface AiAdvisoryConsentApiDependencies {
  /** Verified identity check; must deny on errors or missing authentication. */
  isAuthenticated: (request: FastifyRequest) => boolean | Promise<boolean>;
  /** Resolve a verified principal identity; missing/invalid identity denies writes. */
  getPrincipalIdentity: (request: FastifyRequest) => string | null | undefined | Promise<string | null | undefined>;
  /** Current server-approved disclosure version; grants must explicitly match it. */
  approvedDisclosureVersion: string;
  /** Account entitlement check for the authenticated principal. */
  isAuthorizedForAccount: (request: FastifyRequest, accountId: string) => boolean | Promise<boolean>;
  consent: Pick<AiAdvisoryConsentService, 'enable' | 'revoke' | 'query'>;
}

/** Registers standalone endpoints; callers own server wiring and auth semantics. */
export function registerAiAdvisoryConsentApi(app: FastifyInstance, deps: AiAdvisoryConsentApiDependencies): void {
  app.get<{ Params: { accountId: string } }>('/api/accounts/:accountId/ai-advisory-consent', async (request, reply) => {
    const accountId = request.params.accountId;
    try {
      if (!await deps.isAuthenticated(request)) return reply.code(401).send({ error: 'Unauthorized' });
      if (!validAccountId(accountId) || !await deps.isAuthorizedForAccount(request, accountId)) return reply.code(403).send({ error: 'Forbidden' });
      const state = await deps.consent.query(accountId);
      return reply.send({ accountId, enabled: state?.enabled ?? false, consent: state ?? null });
    } catch (error) {
      request.log.error({ err: error }, 'AI advisory consent query failed');
      return reply.code(503).send({ error: 'Consent unavailable' });
    }
  });

  app.post<{ Params: { accountId: string }; Body: unknown }>('/api/accounts/:accountId/ai-advisory-consent', async (request, reply) => {
    return changeConsent(request, reply, deps, 'enable');
  });

  app.delete<{ Params: { accountId: string } }>('/api/accounts/:accountId/ai-advisory-consent', async (request, reply) => {
    return changeConsent(request, reply, deps, 'revoke');
  });
}

async function changeConsent(
  request: FastifyRequest<{ Params: { accountId: string }; Body?: unknown }>,
  reply: import('fastify').FastifyReply,
  deps: AiAdvisoryConsentApiDependencies,
  action: 'enable' | 'revoke',
) {
  const accountId = request.params.accountId;
  try {
    if (!await deps.isAuthenticated(request)) return reply.code(401).send({ error: 'Unauthorized' });
    if (!validAccountId(accountId) || !await deps.isAuthorizedForAccount(request, accountId)) return reply.code(403).send({ error: 'Forbidden' });
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Invalid consent request' });
    }
    const actor = await deps.getPrincipalIdentity(request);
    if (!validActor(actor)) return reply.code(401).send({ error: 'Unauthorized' });
    const disclosureVersionValue = (body as Record<string, unknown>).disclosureVersion;
    if (action === 'enable' && (typeof disclosureVersionValue !== 'string' || disclosureVersionValue !== deps.approvedDisclosureVersion)) {
      return reply.code(400).send({ error: 'Invalid disclosure version' });
    }
    const state: AiAdvisoryConsentState = action === 'enable'
      ? await deps.consent.enable({ accountId, actor, disclosureVersion: disclosureVersionValue as string })
      : await deps.consent.revoke({ accountId, actor });
    // Defend against a mis-scoped adapter; never report another account's state.
    if (state.accountId !== accountId || state.enabled !== (action === 'enable')) return reply.code(503).send({ error: 'Consent unavailable' });
    return reply.send({ accountId, enabled: state.enabled, consent: state });
  } catch (error) {
    request.log.error({ err: error }, `AI advisory consent ${action} failed`);
    return reply.code(503).send({ error: 'Consent unavailable' });
  }
}

function validAccountId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && value.length <= 128;
}
function validActor(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && value.length <= 128;
}
