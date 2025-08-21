import type { FastifyRequest, FastifyReply } from 'fastify';

type State = { failures: number; openedAt?: number };

export function createCircuit(getTenantCfg: (tenantId: string) => any) {
  const states = new Map<string, State>();

  return {
    pre: (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req.headers['x-tenant-id'] as string) || 'demo';
      const cfg = getTenantCfg(tenantId);
      const threshold = Number(cfg?.circuit_breaker?.failure_threshold || 5);
      const resetMs = Number(cfg?.circuit_breaker?.reset_ms || 10000);
      const st = states.get(tenantId) || { failures: 0 };
      if (st.openedAt && Date.now() - st.openedAt < resetMs) {
        reply.code(503).send({ error: { type: 'ProviderUnavailable', message: 'Circuit open' } });
        return false;
      }
      if (st.openedAt && Date.now() - st.openedAt >= resetMs) {
        // half-open
        st.failures = 0;
        st.openedAt = undefined;
      }
      states.set(tenantId, st);
      return true;
    },
    postSuccess: (tenantId: string) => {
      const st = states.get(tenantId) || { failures: 0 };
      st.failures = 0;
      st.openedAt = undefined;
      states.set(tenantId, st);
    },
    postFailure: (tenantId: string) => {
      const cfg = getTenantCfg(tenantId);
      const threshold = Number(cfg?.circuit_breaker?.failure_threshold || 5);
      const st = states.get(tenantId) || { failures: 0 };
      st.failures += 1;
      if (st.failures >= threshold) {
        st.openedAt = Date.now();
      }
      states.set(tenantId, st);
    }
  };
}


