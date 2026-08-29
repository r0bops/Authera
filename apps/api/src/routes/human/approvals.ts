import { Hono } from 'hono';
import {
  ApprovalDecisionRequestSchema,
  CreateDisputeRequestSchema,
  EvidenceRoleSchema,
} from '@agentcerta/contracts';
import { verifyAuditChain, type Database } from '@agentcerta/db';
import { canonicalJson } from '@agentcerta/domain';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem, formatZodIssues } from '../../http/problem.js';
import { idempotent } from '../../middleware/idempotency.js';
import { requireHuman } from '../../middleware/session.js';
import type { ApprovalService } from '../../services/approval-service.js';
import type { Ap2EvidenceService } from '../../services/ap2-evidence.js';
import type { DisputeService } from '../../services/dispute-service.js';
import type { EvidenceService } from '../../services/evidence-service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function parse<T>(
  c: { req: { json: () => Promise<unknown> } },
  schema: {
    safeParse: (
      v: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiProblem(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
  return parsed.data;
}

function uuidParam(value: string, what: string): string {
  if (!UUID.test(value)) throw ApiProblem.notFound(what);
  return value;
}

/** Approvals, disputes, evidence bundles, and chain verification (human console session). */
export function ugliesRoutes(deps: {
  db: Database;
  approvals: ApprovalService;
  disputes: DisputeService;
  evidence: EvidenceService;
  ap2Evidence: Ap2EvidenceService;
}) {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireHuman());

  routes.get('/approvals', async (c) => ok(c, await deps.approvals.list(c.get('user')!)));
  routes.get('/approvals/:id', async (c) =>
    ok(
      c,
      await deps.approvals.get(c.get('user')!, uuidParam(c.req.param('id'), 'approval request')),
    ),
  );
  routes.post('/approvals/:id/decision', idempotent('approvals.decision', deps.db), async (c) => {
    const input = await parse(c, ApprovalDecisionRequestSchema);
    return ok(
      c,
      await deps.approvals.decide(
        c.get('user')!,
        uuidParam(c.req.param('id'), 'approval request'),
        input,
      ),
    );
  });

  routes.get('/disputes', async (c) => ok(c, await deps.disputes.list(c.get('user')!)));
  routes.post('/disputes', idempotent('disputes.create', deps.db), async (c) => {
    const input = await parse(c, CreateDisputeRequestSchema);
    return ok(c, await deps.disputes.open(c.get('user')!, input), 201);
  });
  routes.get('/disputes/:id', async (c) =>
    ok(c, await deps.disputes.get(c.get('user')!, uuidParam(c.req.param('id'), 'dispute'))),
  );

  routes.get('/evidence/:executionId', async (c) => {
    const role = EvidenceRoleSchema.safeParse(c.req.query('role') ?? 'auditor');
    if (!role.success) throw ApiProblem.validation(formatZodIssues(role.error.issues));
    return ok(
      c,
      await deps.evidence.bundle(uuidParam(c.req.param('executionId'), 'execution'), role.data),
    );
  });
  routes.get('/evidence/:executionId/export', async (c) => {
    const executionId = uuidParam(c.req.param('executionId'), 'execution');
    const bundle = await deps.evidence.bundle(executionId, 'auditor');
    return c.body(canonicalJson(bundle), 200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="agentcerta-evidence-${executionId}.json"`,
      'cache-control': 'no-store',
    });
  });
  routes.get('/evidence/:executionId/ap2', async (c) =>
    ok(c, await deps.ap2Evidence.envelope(uuidParam(c.req.param('executionId'), 'execution'))),
  );

  routes.get('/audit/verify', async (c) => ok(c, await verifyAuditChain(deps.db)));

  return routes;
}
