// Mapeamento de `Insurer`/`InsuranceAccount` (application) -> forma da API (components.schemas).
import type { InsuranceClaimView } from "../application/portal-claims.js";
import type { PartnerInsurerView } from "../application/list-partner-insurers.js";
import type { InsuranceAccount, Insurer, ReimbursementClaim } from "../application/ports.js";
import type { InsurancePolicyView } from "../application/support-holder.js";

export function toInsurerResponse(insurer: Insurer) {
  return { id: insurer.id, name: insurer.name, taxId: insurer.taxId, status: insurer.status };
}

/** `components.schemas.InsuranceAccount`: nunca inclui `passwordHash`. */
export function toInsuranceAccountResponse(account: InsuranceAccount) {
  return { id: account.id, insurerId: account.insurerId, email: account.email, role: account.role, status: account.status };
}

/** `components.schemas.InsurancePolicy`. */
export function toInsurancePolicyResponse(policy: InsurancePolicyView) {
  return {
    id: policy.id,
    insurerId: policy.insurerId ?? null,
    insurerName: policy.insurerName,
    policyNumber: policy.policyNumber,
    holderName: policy.holderName,
    validUntil: policy.validUntil ?? null,
    cardDocumentId: policy.cardDocumentId,
    createdAt: policy.createdAt.toISOString(),
  };
}

/** `components.schemas.ReimbursementClaim` (lado do titular): sem `insurerId`/`decidedBy*` (internos). */
export function toReimbursementClaimResponse(claim: ReimbursementClaim) {
  return {
    id: claim.id,
    policyId: claim.policyId,
    amount: claim.amount,
    currency: claim.currency,
    status: claim.status,
    decisionNote: claim.decisionNote ?? null,
    documentIds: claim.documentIds,
    createdAt: claim.createdAt.toISOString(),
  };
}

/** `components.schemas.PartnerInsurer`: só id e nome (BR-INS-09). */
export function toPartnerInsurerResponse(insurer: PartnerInsurerView) {
  return { id: insurer.id, name: insurer.name };
}

/** `components.schemas.InsuranceClaimView`. */
export function toInsuranceClaimViewResponse(view: InsuranceClaimView) {
  return {
    id: view.id,
    status: view.status,
    amount: view.amount,
    currency: view.currency,
    policyHolderName: view.policyHolderName,
    policyNumber: view.policyNumber,
    decisionNote: view.decisionNote,
    documentIds: view.documentIds,
  };
}
