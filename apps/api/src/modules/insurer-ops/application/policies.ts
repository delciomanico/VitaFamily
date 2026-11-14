// openapi listInsurerPolicies / createInsurerPolicy / getInsurerPolicy / updateInsurerPolicy / setInsurerPolicyStatus
// (UC-SEG-03, state-machines.md «Policy») e o job `insurer.expire-policies`. Distinta de `InsurancePolicy` (ADR-021).
import { ConflictError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import type { Page } from "../../../platform/page/index.js";
import type { OpsActor } from "../domain/access.js";
import {
  assertPolicyEditable,
  assertPolicyTransition,
  assertValidRange,
  parsePolicyInput,
  parsePolicyPatch,
  POLICY_STATUSES,
  type Policy,
  type PolicyStatus,
} from "../domain/policy.js";
import { statusNoteFor } from "../domain/validation.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, notFound, toPage, toPageQuery, type PageInput } from "./support.js";

function invalidReference(field: string, message: string): ValidationError {
  return new ValidationError([{ field, message }], { detail: "Dados inválidos." });
}

export function createListPoliciesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listPolicies(
    actor: OpsActor,
    query: PageInput & { status?: string | undefined; companyId?: string | undefined; holderId?: string | undefined; q?: string | undefined },
  ): Promise<Page<Policy>> {
    const page = toPageQuery(query);
    if (query.status !== undefined && !(POLICY_STATUSES as string[]).includes(query.status)) {
      throw invalidReference("status", "DRAFT, ACTIVE, SUSPENDED, EXPIRED ou CANCELLED");
    }
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      const rows = await deps.policies.list(
        trx,
        actor.insurerId,
        {
          ...(query.status === undefined ? {} : { status: query.status as PolicyStatus }),
          ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
          ...(query.holderId === undefined ? {} : { holderId: query.holderId }),
          ...(query.q === undefined || query.q.trim() === "" ? {} : { q: query.q.trim() }),
        },
        page,
      );
      return toPage(rows, page, (p) => p);
    });
  };
}

export function createCreatePolicyUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function createPolicy(actor: OpsActor, input: Record<string, unknown>, context: RequestContext): Promise<Policy> {
    const parsed = parsePolicyInput(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      const plan = await deps.policies.findPlan(trx, actor.insurerId, parsed.planId);
      if (!plan || plan.status === "ARCHIVED") throw invalidReference("planId", "plano inexistente ou arquivado");
      const holder = await deps.beneficiaries.findById(trx, actor.insurerId, parsed.holderId);
      if (holder?.relationship !== "HOLDER") throw invalidReference("holderId", "titular inexistente");
      if (parsed.companyId !== null && !(await deps.companies.findById(trx, actor.insurerId, parsed.companyId))) {
        throw invalidReference("companyId", "empresa inexistente");
      }
      const policy = await deps.policies.insert(trx, { id: newId(), insurerId: actor.insurerId, ...parsed, createdAt: deps.clock.now() });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_POLICY_CREATE", resourceType: "InsurerPolicy", resourceId: policy.id }));
      return policy;
    });
  };
}

export function createGetPolicyUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function getPolicy(actor: OpsActor, policyId: string): Promise<Policy> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      const policy = await deps.policies.findById(trx, actor.insurerId, policyId);
      if (!policy) throw notFound();
      return policy;
    });
  };
}

export function createUpdatePolicyUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function updatePolicy(actor: OpsActor, policyId: string, input: Record<string, unknown>, context: RequestContext): Promise<Policy> {
    const patch = parsePolicyPatch(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      const current = await deps.policies.findById(trx, actor.insurerId, policyId, true);
      if (!current) throw notFound();
      assertPolicyEditable(current, patch);
      assertValidRange(patch.validFrom ?? current.validFrom, patch.validTo ?? current.validTo);
      if (patch.planId !== undefined && patch.planId !== current.planId) {
        const plan = await deps.policies.findPlan(trx, actor.insurerId, patch.planId);
        if (!plan || plan.status === "ARCHIVED") throw invalidReference("planId", "plano inexistente ou arquivado");
      }
      if (patch.companyId !== undefined && patch.companyId !== null && !(await deps.companies.findById(trx, actor.insurerId, patch.companyId))) {
        throw invalidReference("companyId", "empresa inexistente");
      }
      const updated = await deps.policies.update(trx, actor.insurerId, policyId, patch, deps.clock.now());
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_POLICY_UPDATE", resourceType: "InsurerPolicy", resourceId: policyId }));
      return updated;
    });
  };
}

export function createSetPolicyStatusUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function setPolicyStatus(actor: OpsActor, policyId: string, input: { status?: unknown; note?: unknown }, context: RequestContext): Promise<Policy> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      const current = await deps.policies.findById(trx, actor.insurerId, policyId, true);
      if (!current) throw notFound();
      const plan = await deps.policies.findPlan(trx, actor.insurerId, current.planId);
      if (!plan) throw new ConflictError({ detail: "O plano da apólice já não existe." });
      const next = assertPolicyTransition(current, plan.status, input.status, input.note);
      const updated = await deps.policies.setStatus(trx, actor.insurerId, policyId, next, statusNoteFor(next, input.note), deps.clock.now());
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_POLICY_STATUS", resourceType: "InsurerPolicy", resourceId: policyId, metadata: { from: current.status, to: next } }));
      return updated;
    });
  };
}

/**
 * Job `insurer.expire-policies` (state-machines.md «Policy»: `ACTIVE → EXPIRED` pelo sistema, após `validTo`). Idempotente:
 * só toca em `ACTIVE`. Uma entrada de auditoria `SYSTEM` por seguradora, com a contagem (nunca ids de beneficiários).
 */
export function createExpirePoliciesJobUseCase<Trx>(deps: Pick<OpsDeps<Trx>, "policies" | "audit" | "withTransaction" | "clock">) {
  return async function expirePolicies(): Promise<{ expired: number }> {
    return deps.withTransaction(async (trx) => {
      const now = deps.clock.now();
      const today = now.toISOString().slice(0, 10);
      const perInsurer = await deps.policies.expireDue(trx, today, now);
      for (const { insurerId, count } of perInsurer) {
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "SYSTEM",
          action: "INSURER_POLICY_STATUS",
          resourceType: "InsurerPolicy",
          result: "SUCCESS",
          requestId: "job:insurer.expire-policies",
          metadata: { insurerId, to: "EXPIRED", count },
        });
      }
      return { expired: perInsurer.reduce((sum, r) => sum + r.count, 0) };
    });
  };
}
