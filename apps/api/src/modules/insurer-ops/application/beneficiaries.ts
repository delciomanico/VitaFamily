// openapi listInsurerBeneficiaries / createInsurerBeneficiary / getInsurerBeneficiary / updateInsurerBeneficiary /
// setInsurerBeneficiaryStatus / issueInsurerBeneficiaryClaimCode (UC-SEG-02, BR-SEG-14/17/20). Nunca dados de saúde nem
// ids de família/membro (só `linked`).
import { ConflictError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import type { Page } from "../../../platform/page/index.js";
import type { OpsActor } from "../domain/access.js";
import {
  assertBeneficiaryTransition,
  BENEFICIARY_STATUSES,
  CLAIM_CODE_TTL_MS,
  formatClaimCode,
  generateCardNumber,
  generateClaimCode,
  hashClaimCode,
  isRelationship,
  type BeneficiaryRelationship,
  parseBeneficiaryInput,
  parseBeneficiaryPatch,
  type Beneficiary,
  type BeneficiaryInput,
  type BeneficiaryStatus,
} from "../domain/beneficiary.js";
import { statusNoteFor } from "../domain/validation.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, notFound, toPage, toPageQuery, type PageInput } from "./support.js";

const CARD_NUMBER_ATTEMPTS = 5;

function invalidReference(field: string, message: string): ValidationError {
  return new ValidationError([{ field, message }], { detail: "Dados inválidos." });
}

/** `companyId`/`holderId` de outra seguradora ou inexistente ⇒ `VALIDATION_ERROR`, nunca cruzamento (TC-AZ-SEG-02). */
async function assertCompanyExists<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string, companyId: string | null): Promise<void> {
  if (companyId !== null && !(await deps.companies.findById(trx, insurerId, companyId))) {
    throw invalidReference("companyId", "empresa inexistente");
  }
}

export function createListBeneficiariesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listBeneficiaries(
    actor: OpsActor,
    query: PageInput & { q?: string | undefined; status?: string | undefined; companyId?: string | undefined; holderId?: string | undefined; relationship?: string | undefined },
  ): Promise<Page<Beneficiary>> {
    const page = toPageQuery(query);
    if (query.status !== undefined && !(BENEFICIARY_STATUSES as string[]).includes(query.status)) {
      throw invalidReference("status", "PENDING, ACTIVE, SUSPENDED ou CANCELLED");
    }
    if (query.relationship !== undefined && !isRelationship(query.relationship)) {
      throw invalidReference("relationship", "HOLDER, SPOUSE, CHILD ou OTHER");
    }
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      const rows = await deps.beneficiaries.list(
        trx,
        actor.insurerId,
        {
          ...(query.q === undefined || query.q.trim() === "" ? {} : { q: query.q.trim() }),
          ...(query.status === undefined ? {} : { status: query.status as BeneficiaryStatus }),
          ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
          ...(query.holderId === undefined ? {} : { holderId: query.holderId }),
          ...(query.relationship === undefined ? {} : { relationship: query.relationship as BeneficiaryRelationship }),
        },
        page,
      );
      return toPage(rows, page, (b) => b);
    });
  };
}

async function newCardNumber<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string): Promise<string> {
  for (let attempt = 0; attempt < CARD_NUMBER_ATTEMPTS; attempt++) {
    const candidate = generateCardNumber();
    if ((await deps.beneficiaries.existingCardNumbers(trx, insurerId, [candidate])).size === 0) return candidate;
  }
  throw new ConflictError({ detail: "Não foi possível gerar um número de cartão único; tente novamente." });
}

export function createCreateBeneficiaryUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function createBeneficiary(actor: OpsActor, input: BeneficiaryInput, context: RequestContext): Promise<Beneficiary> {
    const parsed = parseBeneficiaryInput(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      await assertCompanyExists(deps, trx, actor.insurerId, parsed.companyId);
      if (parsed.holderId !== null) {
        const holder = await deps.beneficiaries.findById(trx, actor.insurerId, parsed.holderId);
        if (holder?.relationship !== "HOLDER") throw invalidReference("holderId", "titular inexistente");
      }
      if (await deps.beneficiaries.findByDocument(trx, actor.insurerId, parsed.idDocumentType, parsed.idDocumentNumber)) {
        throw new ConflictError({ detail: "Já existe um beneficiário com este documento de identificação." });
      }
      // BR-SEG-17: nasce PENDING (o repositório não aceita outro estado inicial).
      const beneficiary = await deps.beneficiaries.insert(trx, {
        id: newId(),
        insurerId: actor.insurerId,
        ...parsed,
        cardNumber: await newCardNumber(deps, trx, actor.insurerId),
        createdAt: deps.clock.now(),
      });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_BENEFICIARY_CREATE", resourceType: "InsurerBeneficiary", resourceId: beneficiary.id, metadata: { relationship: beneficiary.relationship } }));
      return beneficiary;
    });
  };
}

export function createGetBeneficiaryUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function getBeneficiary(actor: OpsActor, beneficiaryId: string): Promise<Beneficiary> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      const beneficiary = await deps.beneficiaries.findById(trx, actor.insurerId, beneficiaryId);
      if (!beneficiary) throw notFound();
      return beneficiary;
    });
  };
}

export function createUpdateBeneficiaryUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function updateBeneficiary(actor: OpsActor, beneficiaryId: string, input: { name?: unknown; birthDate?: unknown; companyId?: unknown }, context: RequestContext): Promise<Beneficiary> {
    const patch = parseBeneficiaryPatch(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      if (!(await deps.beneficiaries.findById(trx, actor.insurerId, beneficiaryId))) throw notFound();
      if (patch.companyId !== undefined) await assertCompanyExists(deps, trx, actor.insurerId, patch.companyId);
      const updated = await deps.beneficiaries.update(trx, actor.insurerId, beneficiaryId, patch, deps.clock.now());
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_BENEFICIARY_UPDATE", resourceType: "InsurerBeneficiary", resourceId: beneficiaryId }));
      return updated;
    });
  };
}

export function createSetBeneficiaryStatusUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function setBeneficiaryStatus(actor: OpsActor, beneficiaryId: string, input: { status?: unknown; note?: unknown }, context: RequestContext): Promise<Beneficiary> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      const current = await deps.beneficiaries.findById(trx, actor.insurerId, beneficiaryId, true);
      if (!current) throw notFound();
      const next = assertBeneficiaryTransition(current.status, input.status, input.note);
      const updated = await deps.beneficiaries.setStatus(trx, actor.insurerId, beneficiaryId, next, statusNoteFor(next, input.note), deps.clock.now());
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_BENEFICIARY_STATUS", resourceType: "InsurerBeneficiary", resourceId: beneficiaryId, metadata: { from: current.status, to: next } }));
      return updated;
    });
  };
}

/** BR-SEG-20: o código em claro só sai nesta resposta; guarda-se o HMAC; emitir novo invalida o anterior. */
export function createIssueClaimCodeUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function issueClaimCode(actor: OpsActor, beneficiaryId: string, context: RequestContext): Promise<{ code: string; expiresAt: Date }> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      const beneficiary = await deps.beneficiaries.findById(trx, actor.insurerId, beneficiaryId, true);
      if (!beneficiary) throw notFound();
      if (beneficiary.status === "CANCELLED") throw new ConflictError({ detail: "O beneficiário está cancelado." });
      const now = deps.clock.now();
      const code = generateClaimCode();
      const expiresAt = new Date(now.getTime() + CLAIM_CODE_TTL_MS);
      await deps.beneficiaries.setClaimCode(trx, actor.insurerId, beneficiaryId, { hash: hashClaimCode(deps.claimCodeSecret, code), expiresAt }, now);
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_LINK_REQUEST", resourceType: "InsurerBeneficiary", resourceId: beneficiaryId, metadata: { step: "CODE_ISSUED" } }));
      return { code: formatClaimCode(code), expiresAt };
    });
  };
}
