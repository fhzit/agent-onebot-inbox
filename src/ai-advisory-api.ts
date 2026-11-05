import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AiAdvisoryRecord } from './ai-advisory-store.js';

export interface AiAdvisoryStore {
  list(accountId: string, options: { before?: string; beforeMessageId?: string; limit: number }): Promise<AiAdvisoryRecord[]>;
}

export interface AiAdvisoryApiDependencies {
  /** Verify caller identity before any account lookup or store access. */
  isAuthenticated: (request: FastifyRequest) => boolean | Promise<boolean>;
  /** Confirm the authenticated caller may read this account. */
  isAuthorizedForAccount: (request: FastifyRequest, accountId: string) => boolean | Promise<boolean>;
  store: AiAdvisoryStore;
}

export const AI_ADVISORY_DEFAULT_LIMIT = 50;
export const AI_ADVISORY_MAX_LIMIT = 100;

/** Register a bounded, authenticated, account-scoped advisory read endpoint. */
export function registerAiAdvisoryApi(app: FastifyInstance, deps: AiAdvisoryApiDependencies): void {
  app.get<{ Params: { accountId: string }; Querystring: { limit?: string; before?: string; before_message_id?: string } }>(
    '/api/accounts/:accountId/ai-advisories', async (request, reply) => {
      const accountId = request.params.accountId;
      try {
        if (!await deps.isAuthenticated(request)) return reply.code(401).send({ error: 'Unauthorized' });
        if (!accountId.trim() || !await deps.isAuthorizedForAccount(request, accountId)) return reply.code(403).send({ error: 'Forbidden' });
        const limitValue = request.query.limit;
        const limit = limitValue === undefined ? AI_ADVISORY_DEFAULT_LIMIT : Number(limitValue);
        const before = request.query.before;
        const beforeMessageId = request.query.before_message_id;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > AI_ADVISORY_MAX_LIMIT ||
            ((before === undefined) !== (beforeMessageId === undefined)) ||
            (before !== undefined && (typeof before !== 'string' || !Number.isFinite(Date.parse(before)))) ||
            (beforeMessageId !== undefined && (typeof beforeMessageId !== 'string' || !beforeMessageId.trim()))) {
          return reply.code(400).send({ error: 'Invalid pagination parameters' });
        }
        const records = await deps.store.list(accountId, { limit, ...(before === undefined ? {} : { before: new Date(before).toISOString(), beforeMessageId }) });
        const advisories = records.slice(0, limit).map(record => ({
          messageId: record.messageId,
          label: record.label,
          confidence: record.confidence,
          model: record.model,
          policyVersion: record.policyVersion,
          createdAt: record.createdAt,
        }));
        // Composite cursor matches the store's (created_at, message_id) ordering.
        const last = advisories[advisories.length - 1];
        const nextCursor = advisories.length === limit && last ? { before: last.createdAt, before_message_id: last.messageId } : null;
        return reply.send({ advisories, nextCursor });
      } catch (error) {
        request.log.error({ err: error }, 'AI advisory read failed');
        return reply.code(503).send({ error: 'AI advisories unavailable' });
      }
    },
  );
}
