// openapi listInsurerPlans / createInsurerPlan / getInsurerPlan / setInsurerPlanStatus / newInsurerPlanVersion /
// listInsurerPlanCoverages / replaceInsurerPlanCoverages (UC-SEG-04, BR-SEG-01/02/04/09/22). Leitura: qualquer papel do
// módulo; escrita: só INSURANCE_ADMIN (§8.2b). Planos com apólices ativas são imutáveis: só se edita um DRAFT e só se ativa um DRAFT.
import { ConflictError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import type { Page } from "../../../platform/page/index.js";
import type { OpsActor } from "../domain/access.js";
import {
  assertCanCreateVersion,
  assertCoveragesEditable,
  assertPlanTransition,
  parseCoverageItems,
  parsePlanInput,
  parsePlanStatusFilter,
  type InsurerPlan,
  type PlanCoverage,
} from "../domain/plan.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, invalidReference, notFound, toPage, toPageQuery, type PageInput } from "./support.js";

export function createListPlansUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listPlans(actor: OpsActor, query: PageInput & { status?: string | undefined; name?: string | undefined }): Promise<Page<InsurerPlan>> {
    const page = toPageQuery(query);
    const status = parsePlanStatusFilter(query.status);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      const rows = await deps.plans.list(trx, actor.insurerId, { ...(status ? { status } : {}), ...(query.name ? { name: query.name } : {}) }, page);
      return toPage(rows, page, (p) => p);
    });
  };
}

export function createCreatePlanUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function createPlan(actor: OpsActor, input: { name?: unknown }, context: RequestContext): Promise<InsurerPlan> {
    const parsed = parsePlanInput(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      const plan = await deps.plans.insert(trx, { id: newId(), insurerId: actor.insurerId, ...parsed, createdAt: deps.clock.now() });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_PLAN_CREATE", resourceType: "InsurerPlan", resourceId: plan.id }));
      return plan;
    });
  };
}

export function createGetPlanUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function getPlan(actor: OpsActor, planId: string): Promise<InsurerPlan> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      const plan = await deps.plans.findById(trx, actor.insurerId, planId);
      if (!plan) throw notFound();
      return plan;
    });
  };
}

export function createSetPlanStatusUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function setPlanStatus(actor: OpsActor, planId: string, input: { status?: unknown }, context: RequestContext): Promise<InsurerPlan> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      const current = await deps.plans.findById(trx, actor.insurerId, planId, true);
      if (!current) throw notFound();
      const next = assertPlanTransition(current, input.status);
      const updated = await deps.plans.setStatus(trx, actor.insurerId, planId, next, deps.clock.now());
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_PLAN_STATUS", resourceType: "InsurerPlan", resourceId: planId, metadata: { from: current.status, to: next } }));
      return updated;
    });
  };
}

export function createNewPlanVersionUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function newPlanVersion(actor: OpsActor, planId: string, context: RequestContext): Promise<InsurerPlan> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      const source = await deps.plans.findById(trx, actor.insurerId, planId, true);
      if (!source) throw notFound();
      assertCanCreateVersion(source);
      if (await deps.plans.hasDraft(trx, actor.insurerId, source.name)) {
        throw new ConflictError({ detail: "Já existe uma versão em rascunho deste plano." });
      }
      const version = (await deps.plans.maxVersion(trx, actor.insurerId, source.name)) + 1;
      const created = await deps.plans.insertNewVersion(trx, { id: newId(), insurerId: actor.insurerId, sourcePlanId: planId, name: source.name, version, createdAt: deps.clock.now() });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_PLAN_NEW_VERSION", resourceType: "InsurerPlan", resourceId: created.id, metadata: { fromPlanId: planId, version } }));
      return created;
    });
  };
}

export function createListCoveragesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listCoverages(actor: OpsActor, planId: string): Promise<PlanCoverage[]> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      if (!(await deps.plans.findById(trx, actor.insurerId, planId))) throw notFound();
      return deps.plans.listCoverages(trx, actor.insurerId, planId);
    });
  };
}

export function createReplaceCoveragesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function replaceCoverages(actor: OpsActor, planId: string, input: { items?: unknown }, context: RequestContext): Promise<PlanCoverage[]> {
    const items = parseCoverageItems(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      const plan = await deps.plans.findById(trx, actor.insurerId, planId, true);
      if (!plan) throw notFound();
      assertCoveragesEditable(plan);
      // BR-SEG-22: o serviço tem de ser da lista da própria seguradora (outra seguradora ⇒ VALIDATION_ERROR, nunca cruza).
      const ids = items.map((i) => i.serviceId);
      if ((await deps.services.countByIds(trx, actor.insurerId, ids)) !== ids.length) throw invalidReference("items", "serviço inexistente na lista da seguradora");
      await deps.plans.replaceCoverages(trx, actor.insurerId, planId, items, deps.clock.now());
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_COVERAGE_UPDATE", resourceType: "InsurerPlan", resourceId: planId, metadata: { count: items.length } }));
      return deps.plans.listCoverages(trx, actor.insurerId, planId);
    });
  };
}
