import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AccountConfig } from './config.js';
import type { HistoryKind } from './provider-history.js';
import { createHistoryReconciliationService, type HistoryReconciliationDependencies } from './history-reconciliation-service.js';

export type HistoryReconciliationRouteParams = { id: string };
export type HistoryReconciliationRouteBody = { kind: HistoryKind; targetId: string | number; limit: number };
export type HistoryReconciliationRouteDependencies = Omit<HistoryReconciliationDependencies, 'store' | 'audit'> & {
  /** Resolve only accounts the authenticated administrator is allowed to inspect. */
  resolveAccount: (id: string, request: FastifyRequest) => Promise<AccountConfig | undefined>;
  /** The caller must supply its existing read-only local message listing adapter. */
  store: HistoryReconciliationDependencies['store'];
  audit: HistoryReconciliationDependencies['audit'];
  /** Authentication/authorization belongs to the host and is explicitly injected. */
  preHandler: (request: FastifyRequest, reply: FastifyReply) => void | Promise<unknown>;
};

/** Register a dry-run endpoint. This module deliberately has no server imports or write adapters. */
export function registerHistoryReconciliationRoute(app: FastifyInstance, deps: HistoryReconciliationRouteDependencies): void {
  const reconcile = createHistoryReconciliationService(deps);
  app.post<{ Params: HistoryReconciliationRouteParams; Body: HistoryReconciliationRouteBody }>(
    '/api/admin/accounts/:id/history/reconcile/preview',
    { preHandler: deps.preHandler },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;
      if (typeof id !== 'string' || !id.trim() || !body || (body.kind !== 'private' && body.kind !== 'group') ||
          (typeof body.targetId !== 'string' && typeof body.targetId !== 'number') ||
          (typeof body.targetId === 'string' ? !body.targetId.trim() : !Number.isSafeInteger(body.targetId)) ||
          !Number.isSafeInteger(body.limit) || body.limit < 1) {
        return reply.code(400).send({ error: 'Invalid history reconciliation request' });
      }
      const account = await deps.resolveAccount(id, request);
      if (!account) return reply.code(404).send({ error: 'Account not found' });
      try {
        return await reconcile({ account, accountId: id, kind: body.kind, targetId: body.targetId, count: body.limit, signal: request.signal });
      } catch (error) {
        request.log.error({ err: error, accountId: id }, 'History reconciliation preview failed');
        return reply.code(502).send({ error: 'History reconciliation failed' });
      }
    },
  );
}
