// Pedidos de reembolso do titular — UC-INS-03/04, BR-INS-03/04/05/10, openapi
// listReimbursementClaims/createReimbursementClaim/getReimbursementClaim/markReimbursementClaimPaid.
import { ConflictError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertCanMarkPaid, parseClaimInput, type ClaimInputFields, type ReimbursementClaim } from "../domain/reimbursement-claim.js";
import type { ActorIdentity, InsuranceHolderDeps, RequestContext } from "./ports.js";
import { auditViewIfNotSelf, authorizeInsurance, loadPolicy } from "./support-holder.js";

export type ReimbursementClaimInput = ClaimInputFields;

async function loadClaim<Trx>(deps: InsuranceHolderDeps<Trx>, trx: Trx, policyId: string, claimId: string, lock = false): Promise<ReimbursementClaim> {
  const claim = await deps.claimsRepo.findForPolicy(trx, policyId, claimId, lock);
  if (!claim) {
    throw new NotFoundError({ detail: "Pedido de reembolso não encontrado." });
  }
  return claim;
}

export function createListReimbursementClaimsUseCase<Trx>(deps: InsuranceHolderDeps<Trx>) {
  return async function listReimbursementClaims(actor: ActorIdentity, familyId: string, memberId: string, policyId: string, context: RequestContext): Promise<ReimbursementClaim[]> {
    return deps.withTransaction(async (trx) => {
      const ctx = await authorizeInsurance(deps, trx, actor, familyId, memberId);
      await loadPolicy(deps, trx, familyId, memberId, policyId);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "ReimbursementClaim", context });
      return deps.claimsRepo.listByPolicy(trx, policyId);
    });
  };
}

export function createGetReimbursementClaimUseCase<Trx>(deps: InsuranceHolderDeps<Trx>) {
  return async function getReimbursementClaim(actor: ActorIdentity, familyId: string, memberId: string, policyId: string, claimId: string, context: RequestContext): Promise<ReimbursementClaim> {
    return deps.withTransaction(async (trx) => {
      const ctx = await authorizeInsurance(deps, trx, actor, familyId, memberId);
      await loadPolicy(deps, trx, familyId, memberId, policyId);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "ReimbursementClaim", context });
      return loadClaim(deps, trx, policyId, claimId);
    });
  };
}

/** AC-INS-01: apólice sem parceira ⇒ `VALIDATION_ERROR`; seguradora suspensa ⇒ `CONFLICT` (BR-INS-09/10). */
export function createCreateReimbursementClaimUseCase<Trx>(deps: InsuranceHolderDeps<Trx>) {
  return async function createReimbursementClaim(actor: ActorIdentity, familyId: string, memberId: string, policyId: string, input: ReimbursementClaimInput, context: RequestContext): Promise<ReimbursementClaim> {
    const parsed = parseClaimInput(input);

    return deps.withTransaction(async (trx) => {
      await authorizeInsurance(deps, trx, actor, familyId, memberId);
      // Bloqueia a apólice: serializa com `PATCH`/`DELETE` da apólice (insurerId estável durante a submissão).
      const policy = await loadPolicy(deps, trx, familyId, memberId, policyId, true);
      if (!policy.insurerId) {
        throw new ValidationError([{ field: "policyId", message: "a apólice não está associada a uma seguradora parceira" }], { detail: "Só as apólices de seguradoras parceiras admitem pedidos de reembolso." });
      }
      const insurer = await deps.insurersRepo.findById(trx, policy.insurerId);
      if (insurer?.status !== "ACTIVE") {
        throw new ConflictError({ detail: "A seguradora está suspensa; não aceita novos pedidos." });
      }
      // BR-INS-04: só documentos JÁ carregados do próprio membro, verificados (CLEAN) e visíveis ao paciente.
      const attachable = await deps.documents.listAttachable(trx, familyId, memberId, parsed.documentIds);
      if (attachable.length !== parsed.documentIds.length) {
        throw new ValidationError([{ field: "documentIds", message: "documentos inexistentes, de outro membro ou ainda em verificação antivírus" }], { detail: "Dados inválidos." });
      }

      const now = deps.clock.now();
      const claim = await deps.claimsRepo.insert(trx, {
        id: newId(),
        policyId,
        insurerId: policy.insurerId,
        amount: parsed.amount,
        currency: parsed.currency,
        documentIds: parsed.documentIds,
        submittedBy: actor.userId,
        createdAt: now,
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CLAIM_SUBMIT",
        resourceType: "ReimbursementClaim",
        resourceId: claim.id,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { documentCount: parsed.documentIds.length },
        ...auditContextFields(context),
      });
      return claim;
    });
  };
}

export function createMarkReimbursementClaimPaidUseCase<Trx>(deps: InsuranceHolderDeps<Trx>) {
  return async function markReimbursementClaimPaid(actor: ActorIdentity, familyId: string, memberId: string, policyId: string, claimId: string, context: RequestContext): Promise<ReimbursementClaim> {
    return deps.withTransaction(async (trx) => {
      await authorizeInsurance(deps, trx, actor, familyId, memberId);
      await loadPolicy(deps, trx, familyId, memberId, policyId);
      const claim = await loadClaim(deps, trx, policyId, claimId, true);
      assertCanMarkPaid(claim.status);

      const now = deps.clock.now();
      const paid = await deps.claimsRepo.markPaid(trx, claimId, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CLAIM_PAID",
        resourceType: "ReimbursementClaim",
        resourceId: claimId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      return paid;
    });
  };
}
