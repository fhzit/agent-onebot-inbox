import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PROVIDER_QUALIFICATION_CHECKLIST } from './provider-qualification.js';
import type { ProviderQualificationRecord, ProviderQualificationRecordInput, ProviderQualificationResultStore } from './provider-qualification-store.js';

export interface ProviderQualificationApiDependencies {
  /** Host-provided operator authentication/authorization; all routes are gated by it. */
  preHandler: (request: FastifyRequest, reply: FastifyReply) => void | Promise<unknown>;
  store: ProviderQualificationResultStore;
}

/** Register read/write endpoints for version-specific, evidence-backed operator qualification results. */
export function registerProviderQualificationApi(app: FastifyInstance, deps: ProviderQualificationApiDependencies): void {
  app.get('/api/admin/provider-qualification/checklist', { preHandler: deps.preHandler }, async (_request, reply) => {
    return reply.send({ checklist: PROVIDER_QUALIFICATION_CHECKLIST });
  });

  app.get<{ Params: { provider: string; version: string } }>(
    '/api/admin/provider-qualification/:provider/:version',
    { preHandler: deps.preHandler },
    async (request, reply) => {
      const { provider, version } = request.params;
      const record = deps.store.get(provider, version);
      return record ? reply.send({ record }) : reply.code(404).send({ error: 'Qualification record not found' });
    },
  );

  app.put<{ Body: ProviderQualificationRecordInput }>(
    '/api/admin/provider-qualification',
    { preHandler: deps.preHandler },
    async (request, reply) => {
      try {
        const record = deps.store.record(request.body);
        return reply.code(201).send({ record });
      } catch (error) {
        if (error instanceof TypeError) return reply.code(400).send({ error: error.message });
        request.log.error({ err: error }, 'Provider qualification write failed');
        return reply.code(503).send({ error: 'Provider qualification unavailable' });
      }
    },
  );
}
