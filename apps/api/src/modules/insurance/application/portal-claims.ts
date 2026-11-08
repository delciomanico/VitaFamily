// Pedidos de reembolso no portal da seguradora — UC-INS-06/07, BR-INS-04/05/07, authorization.md §8,
// openapi listInsuranceClaims/getInsuranceClaim/decideInsuranceClaim. `INSURANCE_ADMIN` e
// `INSURANCE_AGENT` têm as mesmas permissões aqui (BR-INS-07). O isolamento entre seguradoras é do
// repositório (filtra SEMPRE por `insurerId` da sessão): pedido de outra seguradora ⇒ `NOT_FOUND`.
import { NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { decide, type ClaimStatus } from "../domain/reimbursement-claim.js";
import type { InsuranceClaimReceiptSummary, InsurancePortalActor, InsurancePortalClaimsDeps, PortalClaim, RequestContext } from "./ports.js";

/** `components.schemas.InsuranceClaimView` — o mínimo necessário (ADR-021); `familyId`/`memberId` nunca saem. */
export interface InsuranceClaimView {
  id: string;
  status: ClaimStatus;
  amount: number;
  currency: string;
  policyHolderName: string;
  policyNumber: string;
  decisionNote: string | null;
  documentIds: string[];
  /** M14 R (BR-CLN-36): resumo mínimo dos recibos anexados. */
  receipts: InsuranceClaimReceiptSummary[];
}

export function toClaimView(portal: PortalClaim, receipts: InsuranceClaimReceiptSummary[] = []): InsuranceClaimView {
  const { claim } = portal;
  return {
    id: claim.id,
    status: claim.status,
    amount: claim.amount,
    currency: claim.currency,
    policyHolderName: portal.policyHolderName,
    policyNumber: portal.policyNumber,
    decisionNote: claim.decisionNote ?? null,
    documentIds: claim.documentIds,
    receipts,
  };
}

/** Resumo mínimo dos recibos de cada pedido (sem ids, sem PDF, sem profissional). */
async function viewsWithReceipts<Trx>(deps: InsurancePortalClaimsDeps<Trx>, trx: Trx, portals: PortalClaim[]): Promise<InsuranceClaimView[]> {
  const ids = [...new Set(portals.flatMap((p) => p.claim.receiptIds ?? []))];
  const summaries = ids.length === 0 ? [] : await deps.receipts.summaries(trx, ids);
  const byId = new Map(summaries.map(({ id, ...summary }) => [id, summary]));
  return portals.map((p) => toClaimView(p, (p.claim.receiptIds ?? []).flatMap((id) => (byId.has(id) ? [byId.get(id) as InsuranceClaimReceiptSummary] : []))));
}

const STATUSES: readonly ClaimStatus[] = ["SUBMITTED", "APPROVED", "REJECTED", "PAID"];

export function createListInsuranceClaimsUseCase<Trx>(deps: InsurancePortalClaimsDeps<Trx>) {
  return async function listInsuranceClaims(actor: InsurancePortalActor, query: { status?: string }): Promise<InsuranceClaimView[]> {
    let status: ClaimStatus | undefined;
    if (query.status !== undefined) {
      status = STATUSES.find((s) => s === query.status);
      if (!status) {
        throw new ValidationError([{ field: "status", message: STATUSES.join(" | ") }], { detail: "Filtro inválido." });
      }
    }
    return deps.withTransaction(async (trx) => viewsWithReceipts(deps, trx, await deps.claimsRepo.listByInsurer(trx, actor.insurerId, status)));
  };
}

export function createGetInsuranceClaimUseCase<Trx>(deps: InsurancePortalClaimsDeps<Trx>) {
  return async function getInsuranceClaim(actor: InsurancePortalActor, claimId: string): Promise<InsuranceClaimView> {
    return deps.withTransaction(async (trx) => {
      const found = await deps.claimsRepo.findByInsurer(trx, actor.insurerId, claimId);
      if (!found) {
        throw new NotFoundError({ detail: "Pedido não encontrado." });
      }
      return (await viewsWithReceipts(deps, trx, [found]))[0] ?? toClaimView(found);
    });
  };
}

export interface DecideInsuranceClaimInput {
  decision: "APPROVE" | "REJECT";
  note?: string | null;
}

export function createDecideInsuranceClaimUseCase<Trx>(deps: InsurancePortalClaimsDeps<Trx>) {
  return async function decideInsuranceClaim(actor: InsurancePortalActor, claimId: string, input: DecideInsuranceClaimInput, context: RequestContext): Promise<InsuranceClaimView> {
    return deps.withTransaction(async (trx) => {
      // Bloqueia a linha: duas decisões em simultâneo ⇒ a segunda vê o estado novo e recebe CONFLICT.
      const found = await deps.claimsRepo.findByInsurer(trx, actor.insurerId, claimId, true);
      if (!found) {
        throw new NotFoundError({ detail: "Pedido não encontrado." });
      }
      const outcome = decide(found.claim.status, input.decision, input.note);

      const now = deps.clock.now();
      const decided = await deps.claimsRepo.decide(trx, claimId, { status: outcome.status, note: outcome.note, insuranceAccountId: actor.insuranceAccountId, decidedAt: now });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "INSURANCE_ACCOUNT",
        actorInsuranceAccountId: actor.insuranceAccountId,
        action: "CLAIM_DECIDE",
        resourceType: "ReimbursementClaim",
        resourceId: claimId,
        familyId: found.familyId,
        subjectMemberId: found.memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { status: outcome.status },
        ...auditContextFields(context),
      });
      return (await viewsWithReceipts(deps, trx, [{ ...found, claim: decided }]))[0] ?? toClaimView({ ...found, claim: decided });
    });
  };
}
