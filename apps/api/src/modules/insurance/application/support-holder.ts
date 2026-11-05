// Auxiliares do lado do titular (apólices/pedidos): autorização única (`MANAGE_INSURANCE`, BR-INS-02),
// vista da apólice com `cardDocumentId` derivado e auditoria de leitura por quem não é o titular.
import { NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import type { AccessContext } from "../../access/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { InsurancePolicy } from "../domain/insurance-policy.js";
import type { ActorIdentity, InsuranceHolderDeps, RequestContext } from "./ports.js";

export interface InsurancePolicyView extends InsurancePolicy {
  /** Derivado: o `Document` mais recente com `resourceType=INSURANCE_POLICY` desta apólice (schema.md: sem coluna). */
  cardDocumentId: string | null;
}

/** BR-INS-02: só SELF (adulto) ou TUTOR_OF — leitura e escrita; nunca OTHER/DEPENDENT_SELF. */
export function authorizeInsurance<Trx>(deps: InsuranceHolderDeps<Trx>, trx: Trx, actor: ActorIdentity, familyId: string, memberId: string): Promise<AccessContext> {
  return deps.policy.can(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, action: "MANAGE_INSURANCE", subjectMemberId: memberId });
}

export async function loadPolicy<Trx>(deps: InsuranceHolderDeps<Trx>, trx: Trx, familyId: string, memberId: string, policyId: string, lock = false): Promise<InsurancePolicy> {
  const found = await deps.policiesRepo.findById(trx, familyId, memberId, policyId, lock);
  if (!found) {
    throw new NotFoundError({ detail: "Apólice não encontrada." });
  }
  return found;
}

export async function buildPolicyView<Trx>(deps: InsuranceHolderDeps<Trx>, trx: Trx, policy: InsurancePolicy): Promise<InsurancePolicyView> {
  const documents = await deps.documents.listForResource(trx, policy.familyId, policy.memberId, "INSURANCE_POLICY", policy.id);
  const latest = documents.filter((d) => d.scanStatus !== "INFECTED").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return { ...policy, cardDocumentId: latest?.id ?? null };
}

/** audit.md: a leitura de dados de saúde por tutor (não titular) audita-se como `HEALTH_VIEW`. */
export async function auditViewIfNotSelf<Trx>(
  deps: InsuranceHolderDeps<Trx>,
  trx: Trx,
  ctx: AccessContext,
  params: { userId: string; familyId: string; memberId: string; resourceType: "InsurancePolicy" | "ReimbursementClaim"; context: RequestContext },
): Promise<void> {
  if (ctx.relation === "SELF") {
    return;
  }
  await deps.audit.record(trx, {
    occurredAt: deps.clock.now(),
    actorType: "USER",
    actorUserId: params.userId,
    action: "HEALTH_VIEW",
    resourceType: params.resourceType,
    familyId: params.familyId,
    subjectMemberId: params.memberId,
    result: "SUCCESS",
    requestId: params.context.requestId,
    ...auditContextFields(params.context),
  });
}

/** `cardDocumentId` (BR: sem coluna): só aceita um documento JÁ carregado desta apólice; não persiste seleção. */
export async function assertCardDocumentBelongs<Trx>(deps: InsuranceHolderDeps<Trx>, trx: Trx, policy: { id: string; familyId: string; memberId: string } | null, cardDocumentId: unknown): Promise<void> {
  if (cardDocumentId === undefined || cardDocumentId === null) {
    return;
  }
  const documents = policy ? await deps.documents.listForResource(trx, policy.familyId, policy.memberId, "INSURANCE_POLICY", policy.id) : [];
  if (typeof cardDocumentId !== "string" || !documents.some((d) => d.id === cardDocumentId)) {
    throw new ValidationError([{ field: "cardDocumentId", message: "tem de ser um documento já carregado para esta apólice" }], { detail: "Dados inválidos." });
  }
}
