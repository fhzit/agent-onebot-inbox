import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export type IdempotencyReconciliationRecord = {
  accountId: string;
  requestId: string;
  messageType: 'private' | 'group';
  targetId: string;
  payload: unknown;
  state: 'pending' | 'complete';
  response: unknown | null;
};
export type IdempotencyAdjudication = { requestId: string; outcome: 'sent' | 'not-sent' | 'unresolved'; note: string };
export type IdempotencyReconciliationRouteDependencies = {
  /** Host-provided operator authentication/authorization; all route work is gated by it. */
  preHandler: (request: FastifyRequest, reply: FastifyReply) => void | Promise<unknown>;
  /** Read-only bounded listing of pending/uncertain ledger records. */
  listPending: () => Promise<IdempotencyReconciliationRecord[]>;
  /** Explicit operator adjudication only. This API has no send or retry dependency. */
  adjudicate: (input: IdempotencyAdjudication) => Promise<unknown>;
};

/** Register operator-only inspection/adjudication routes; never dispatches or retries sends. */
export function registerIdempotencyReconciliationRoute(app: FastifyInstance, deps: IdempotencyReconciliationRouteDependencies): void {
  app.get('/api/admin/idempotency/reconciliation', { preHandler: deps.preHandler }, async (_request, reply) => {
    try {
      const records = await deps.listPending();
      return reply.send({ records, automaticRetry: false });
    } catch {
      return reply.code(503).send({ error: 'Idempotency reconciliation unavailable', automaticRetry: false });
    }
  });

  app.post<{ Params: { requestId: string }; Body: { outcome?: unknown; note?: unknown } }>(
    '/api/admin/idempotency/reconciliation/:requestId/adjudicate',
    { preHandler: deps.preHandler },
    async (request, reply) => {
      const { requestId } = request.params;
      const { outcome, note } = request.body ?? {};
      if (typeof requestId !== 'string' || !requestId.trim() ||
          (outcome !== 'sent' && outcome !== 'not-sent' && outcome !== 'unresolved') ||
          typeof note !== 'string' || !note.trim() || note.length > 1000) {
        return reply.code(400).send({ error: 'Invalid idempotency adjudication' });
      }
      try {
        const result = await deps.adjudicate({ requestId, outcome, note });
        return reply.send({ ...asObject(result), automaticRetry: false });
      } catch {
        return reply.code(503).send({ error: 'Idempotency adjudication unavailable', automaticRetry: false });
      }
    },
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { result: value };
}
