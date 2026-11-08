// Pedidos de reembolso do titular — UC-INS-03/04, BR-INS-03/04/05/10, openapi
// listReimbursementClaims/createReimbursementClaim/getReimbursementClaim/markReimbursementClaimPaid.
import { ConflictError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertCanMarkPaid, parseClaimInput, type ClaimInputFields, type ReimbursementClaim } from "../domain/reimbursement-claim.js";
import type { ActorIdentity, InsuranceHolderDeps, RequestContext } from "./ports.js";
import { auditViewIfNotSelf, authorizeInsurance, loadPolicy } from "./support-holder.js";

export type ReimbursementClaimInput = ClaimInputFields;

/** BR-CLN-36: acrescenta as referências dos recibos anexados (lado do titular). */
async function withReceiptRefs<Trx>(deps: InsuranceHolderDeps<Trx>, trx: Trx, claims: ReimbursementClaim[]): Promise<ReimbursementClaim[]> {
  const ids = [...new Set(claims.flatMap((c) => c.receiptIds ?? []))];
  if (ids.length === 0) return claims.map((c) => ({ ...c, receipts: [] }));
  const refs = new Map((await deps.receipts.refs(trx, ids)).map((r) => [r.receiptId, r]));
  return claims.map((c) => ({ ...c, receipts: (c.receiptIds ?? []).flatMap((id) => refs.get(id) ?? []) }));
}

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
      return withReceiptRefs(deps, trx, await deps.claimsRepo.listByPolicy(trx, policyId));
    });
  };
}

export function createGetReimbursementClaimUseCase<Trx>(deps: InsuranceHolderDeps<Trx>) {
  return async function getReimbursementClaim(actor: ActorIdentity, familyId: string, memberId: string, policyId: string, claimId: string, context: RequestContext): Promise<ReimbursementClaim> {
    return deps.withTransaction(async (trx) => {
      const ctx = await authorizeInsurance(deps, trx, actor, familyId, memberId);
      await loadPolicy(deps, trx, familyId, memberId, policyId);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "ReimbursementClaim", context });
      return (await withReceiptRefs(deps, trx, [await loadClaim(deps, trx, policyId, claimId)]))[0] ?? await loadClaim(deps, trx, policyId, claimId);
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

      // BR-CLN-36: recibos visíveis ao membro, `ISSUED`, na moeda do pedido e sem outro pedido ativo.
      if (parsed.receiptIds.length > 0) {
        const visible = await deps.receipts.lockVisible(trx, familyId, memberId, parsed.receiptIds);
        if (visible.length !== parsed.receiptIds.length) {
          throw new NotFoundError({ detail: "Recibo não encontrado." });
        }
        if (visible.some((r) => r.status !== "ISSUED")) {
          throw new ConflictError({ detail: "Só se anexam recibos emitidos (não anulados)." });
        }
        if (visible.some((r) => r.currency !== parsed.currency)) {
          throw new ValidationError([{ field: "receiptIds", message: "a moeda do recibo difere da do pedido" }], { detail: "Moeda do recibo diferente da do pedido." });
        }
        if ((await deps.claimsRepo.activeClaimIdsByReceipts(trx, parsed.receiptIds)).size > 0) {
          throw new ConflictError({ detail: "Um dos recibos já está anexado a outro pedido ativo." });
        }
      }

      const now = deps.clock.now();
      const claim = await deps.claimsRepo.insert(trx, {
        id: newId(),
        policyId,
        insurerId: policy.insurerId,
        amount: parsed.amount,
        currency: parsed.currency,
        documentIds: parsed.documentIds,
        receiptIds: parsed.receiptIds,
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
        metadata: { documentCount: parsed.documentIds.length, receiptCount: parsed.receiptIds.length },
        ...auditContextFields(context),
      });
      return (await withReceiptRefs(deps, trx, [claim]))[0] ?? claim;
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
      return (await withReceiptRefs(deps, trx, [paid]))[0] ?? paid;
    });
  };
}
