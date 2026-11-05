// Apólices (cartão) do titular — UC-INS-01/02, BR-INS-01/02/09, openapi listInsurancePolicies/
// createInsurancePolicy/getInsurancePolicy/updateInsurancePolicy/deleteInsurancePolicy.
import { ConflictError, ValidationError, type FieldError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { optionalDate, requiredText, throwIfInvalid } from "../domain/insurance-policy.js";
import type { ActorIdentity, InsuranceHolderDeps, InsurancePolicyChanges, RequestContext } from "./ports.js";
import { assertCardDocumentBelongs, auditViewIfNotSelf, authorizeInsurance, buildPolicyView, loadPolicy, type InsurancePolicyView } from "./support-holder.js";

export interface InsurancePolicyInput {
  insurerId?: string | null;
  insurerName: string;
  policyNumber: string;
  holderName: string;
  validUntil?: string | null;
  cardDocumentId?: string | null;
}

export type InsurancePolicyPatch = Partial<InsurancePolicyInput>;

/** BR-INS-09: só seguradora parceira `ACTIVE` (a mesma lista de `GET /families/{id}/insurers`). */
async function assertPartnerActive<Trx>(deps: InsuranceHolderDeps<Trx>, trx: Trx, insurerId: unknown): Promise<string> {
  const insurer = typeof insurerId === "string" ? await deps.insurersRepo.findById(trx, insurerId) : null;
  if (insurer?.status !== "ACTIVE") {
    throw new ValidationError([{ field: "insurerId", message: "seguradora parceira inexistente ou inativa" }], { detail: "Dados inválidos." });
  }
  return insurer.id;
}

export function createListInsurancePoliciesUseCase<Trx>(deps: InsuranceHolderDeps<Trx>) {
  return async function listInsurancePolicies(actor: ActorIdentity, familyId: string, memberId: string, context: RequestContext): Promise<InsurancePolicyView[]> {
    return deps.withTransaction(async (trx) => {
      const ctx = await authorizeInsurance(deps, trx, actor, familyId, memberId);
      const policies = await deps.policiesRepo.listByMember(trx, familyId, memberId);
      const views = [];
      for (const policy of policies) {
        views.push(await buildPolicyView(deps, trx, policy));
      }
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "InsurancePolicy", context });
      return views;
    });
  };
}

export function createGetInsurancePolicyUseCase<Trx>(deps: InsuranceHolderDeps<Trx>) {
  return async function getInsurancePolicy(actor: ActorIdentity, familyId: string, memberId: string, policyId: string, context: RequestContext): Promise<InsurancePolicyView> {
    return deps.withTransaction(async (trx) => {
      const ctx = await authorizeInsurance(deps, trx, actor, familyId, memberId);
      const policy = await loadPolicy(deps, trx, familyId, memberId, policyId);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "InsurancePolicy", context });
      return buildPolicyView(deps, trx, policy);
    });
  };
}

export function createCreateInsurancePolicyUseCase<Trx>(deps: InsuranceHolderDeps<Trx>) {
  return async function createInsurancePolicy(actor: ActorIdentity, familyId: string, memberId: string, input: InsurancePolicyInput, context: RequestContext): Promise<InsurancePolicyView> {
    const errors: FieldError[] = [];
    const insurerName = requiredText("insurerName", input.insurerName, errors);
    const policyNumber = requiredText("policyNumber", input.policyNumber, errors);
    const holderName = requiredText("holderName", input.holderName, errors);
    const validUntil = optionalDate("validUntil", input.validUntil, errors);
    throwIfInvalid(errors);

    return deps.withTransaction(async (trx) => {
      await authorizeInsurance(deps, trx, actor, familyId, memberId);
      const insurerId = input.insurerId ? await assertPartnerActive(deps, trx, input.insurerId) : undefined;
      // A foto do cartão é um Document da própria apólice: só pode existir depois de a apólice existir.
      await assertCardDocumentBelongs(deps, trx, null, input.cardDocumentId);

      const now = deps.clock.now();
      const policy = await deps.policiesRepo.insert(trx, {
        id: newId(),
        familyId,
        memberId,
        ...(insurerId ? { insurerId } : {}),
        insurerName: insurerName ?? "",
        policyNumber: policyNumber ?? "",
        holderName: holderName ?? "",
        ...(validUntil ? { validUntil } : {}),
        createdBy: actor.userId,
        createdAt: now,
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "INSURANCE_POLICY_CREATE",
        resourceType: "InsurancePolicy",
        resourceId: policy.id,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { partnerInsurer: insurerId !== undefined },
        ...auditContextFields(context),
      });
      return buildPolicyView(deps, trx, policy);
    });
  };
}

export function createUpdateInsurancePolicyUseCase<Trx>(deps: InsuranceHolderDeps<Trx>) {
  return async function updateInsurancePolicy(actor: ActorIdentity, familyId: string, memberId: string, policyId: string, input: InsurancePolicyPatch, context: RequestContext): Promise<InsurancePolicyView> {
    const errors: FieldError[] = [];
    const changes: InsurancePolicyChanges = {};
    if (input.insurerName !== undefined) {
      const value = requiredText("insurerName", input.insurerName, errors);
      if (value !== undefined) changes.insurerName = value;
    }
    if (input.policyNumber !== undefined) {
      const value = requiredText("policyNumber", input.policyNumber, errors);
      if (value !== undefined) changes.policyNumber = value;
    }
    if (input.holderName !== undefined) {
      const value = requiredText("holderName", input.holderName, errors);
      if (value !== undefined) changes.holderName = value;
    }
    if (input.validUntil !== undefined) {
      const value = optionalDate("validUntil", input.validUntil, errors);
      if (value !== undefined) changes.validUntil = value;
    }
    throwIfInvalid(errors);

    return deps.withTransaction(async (trx) => {
      await authorizeInsurance(deps, trx, actor, familyId, memberId);
      const existing = await loadPolicy(deps, trx, familyId, memberId, policyId, true);
      if (input.insurerId !== undefined) {
        // Só revalida (parceira ACTIVE) se a seguradora muda; manter a atual nunca falha por suspensão.
        changes.insurerId = input.insurerId === null || input.insurerId === existing.insurerId ? input.insurerId : await assertPartnerActive(deps, trx, input.insurerId);
      }
      await assertCardDocumentBelongs(deps, trx, existing, input.cardDocumentId);

      const now = deps.clock.now();
      const updated = Object.keys(changes).length > 0 ? await deps.policiesRepo.update(trx, familyId, memberId, policyId, changes, now) : existing;
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "INSURANCE_POLICY_UPDATE",
        resourceType: "InsurancePolicy",
        resourceId: policyId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      return buildPolicyView(deps, trx, updated);
    });
  };
}

export function createDeleteInsurancePolicyUseCase<Trx>(deps: InsuranceHolderDeps<Trx>) {
  return async function deleteInsurancePolicy(actor: ActorIdentity, familyId: string, memberId: string, policyId: string, context: RequestContext): Promise<void> {
    await deps.withTransaction(async (trx) => {
      await authorizeInsurance(deps, trx, actor, familyId, memberId);
      await loadPolicy(deps, trx, familyId, memberId, policyId, true);
      if (await deps.claimsRepo.hasActiveForPolicy(trx, policyId)) {
        throw new ConflictError({ detail: "A apólice tem pedidos de reembolso em curso." });
      }
      // ADR-011: a foto do cartão sai pelo outbox de ficheiros ANTES de apagar a apólice; os pedidos vão em cascata (FK).
      await deps.documents.deleteAllForResource(trx, familyId, memberId, "INSURANCE_POLICY", policyId);
      await deps.policiesRepo.delete(trx, familyId, memberId, policyId);
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "INSURANCE_POLICY_DELETE",
        resourceType: "InsurancePolicy",
        resourceId: policyId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
