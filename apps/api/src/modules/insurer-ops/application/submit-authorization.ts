// Gravação de um pedido novo (criação e recurso, UC-SEG-06, BR-AUT-02/06/08/16): o gate do semáforo, a ligação ao `Process`, os dois
// eventos (`SUBMITTED → IN_REVIEW`, a segunda pelo sistema) e a auditoria `AUTHORIZATION_SUBMIT`. Tudo na transação do chamador.
import { ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ClinicOpsActor } from "../domain/access.js";
import { podeAutoAprovar, type AutoApprovalTrace } from "../domain/auto-approval.js";
import { generateAuthorizationCode } from "../domain/authorization-code.js";
import { evaluateCoverage, toEligibilityLight, type CoverageDecision, type EligibilityLight } from "../domain/coverage.js";
import { calcularValidade } from "../domain/deadline.js";
import { fail } from "../domain/validation.js";
import { decisionDueAt, gateRejection, notifyFamily, POLICY_KEYS, policyValue, recordTransition } from "./authorization-support.js";
import type { OpsDeps, RequestContext } from "./ports.js";

export interface ServiceForRequest {
  id: string;
  status: "ACTIVE" | "INACTIVE";
  guideType: string | null;
  serviceKindId: string | null;
}

/**
 * A decisão de cobertura do beneficiário para o serviço na data (BR-SEG-41): UMA chamada a `evaluateCoverage`, a única fonte
 * (ADR-033). Beneficiário sem apólice vigente nessa data ⇒ plano vazio (a razão sai de `evaluateCoverage`); inexistente ⇒ `null`.
 * Sem `usage`: o saldo é o teto (ADR-035 §7).
 */
export async function coverageOnDate<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string, beneficiaryId: string, service: Pick<ServiceForRequest, "id" | "status">, date: string): Promise<CoverageDecision | null> {
  const candidate = await deps.eligibility.find(trx, insurerId, { kind: "ID", beneficiaryId }, date);
  if (candidate === null) return null;
  const coverages = candidate.policy ? await deps.authorizations.planCoverageLines(trx, insurerId, candidate.policy.planId) : [];
  return evaluateCoverage({ coverages }, { status: candidate.status, policy: candidate.policy }, { id: service.id, status: service.status }, date);
}

/** Semáforo do beneficiário para o serviço na data (BR-SEG-43): só mapeia a `CoverageDecision`. Inexistente ⇒ VERMELHO. */
export async function lightOnDate<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string, beneficiaryId: string, service: Pick<ServiceForRequest, "id" | "status">, date: string): Promise<EligibilityLight> {
  const decision = await coverageOnDate(deps, trx, insurerId, beneficiaryId, service, date);
  return decision === null ? "RED" : toEligibilityLight(decision);
}

/** BR-AUT-16: o tipo de guia deduz-se do serviço; override só para um código ATIVO de `guide_types`. */
export async function resolveGuideType<Trx>(deps: OpsDeps<Trx>, trx: Trx, service: ServiceForRequest, override: string | null): Promise<string> {
  const guideType = override ?? service.guideType;
  if (guideType === null) fail("guideType", "o serviço ainda não foi classificado: indique o tipo de guia");
  if (!(await deps.authorizations.activeGuideTypes(trx)).includes(guideType)) fail("guideType", "tipo de guia inválido");
  return guideType;
}

/** Mensagem única de `processId` inválido: inexistente, de outra clínica ou de outro membro (BR-AUT-01, sem enumeração). */
const invalidProcess = (): ValidationError => new ValidationError([{ field: "processId", message: "processo inválido" }], { detail: "Processo inválido." });

export interface SubmitInput {
  actor: ClinicOpsActor;
  context: RequestContext;
  insurerId: string;
  beneficiaryId: string;
  providerId: string;
  service: ServiceForRequest & { code?: string };
  guideType: string;
  requestedAmount: number;
  expectedOn: string;
  justification: string;
  /** `processId` pedido pela clínica (do ato) ou herdado (recurso); `undefined` ⇒ abrir um novo se o beneficiário está ligado. */
  processId: string | null;
  parentRequestId: string | null;
  light: EligibilityLight;
  /** A decisão de cobertura que originou o semáforo (alimenta `podeAutoAprovar`, que só corre em pedidos que não são recurso). */
  coverage: CoverageDecision;
}

/** Grava o pedido já validado e devolve o seu id. */
export async function submitAuthorization<Trx>(deps: OpsDeps<Trx>, trx: Trx, input: SubmitInput): Promise<string> {
  const { actor, context } = input;
  const now = deps.clock.now();
  const id = newId();
  const link = await deps.authorizations.linkOfBeneficiary(trx, input.insurerId, input.beneficiaryId);

  let processId: string | null = null;
  if (input.processId !== null) {
    const found = await deps.processes.findForClinic(trx, { clinicId: actor.clinicId, processId: input.processId });
    // Um recurso herda o `processId` (já validado no pedido original); a criação exige o mesmo membro.
    if (!found || (input.parentRequestId === null && (link?.memberId !== found.memberId || link.familyId !== found.familyId))) throw invalidProcess();
    processId = found.processId;
  } else if (link) {
    // BR-AUT-01: sem ato, abre-se um Process novo (origem = id do 1.º pedido da cadeia), na MESMA transação.
    const opened = await deps.processes.open(trx, {
      familyId: link.familyId,
      memberId: link.memberId,
      originType: "AUTHORIZATION",
      originId: id,
      clinicId: actor.clinicId,
      by: { actorType: "CLINIC_ACCOUNT", actorClinicAccountId: actor.clinicAccountId, requestId: context.requestId, ...(context.ip !== undefined ? { ip: context.ip } : {}), ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}) },
    });
    processId = opened.processId;
  }

  // BR-AUT-03: avalia-se UMA vez, na criação de um pedido que NÃO é recurso (nunca em resposta, reabertura ou recurso).
  const isAppeal = input.parentRequestId !== null;
  const trace: AutoApprovalTrace | null = isAppeal
    ? null
    : podeAutoAprovar(
        { isAppeal, serviceId: input.service.id, serviceKindId: input.service.serviceKindId, requestedAmountMinor: Math.round(input.requestedAmount * 100) },
        input.coverage,
        await deps.autoApprovalRules.listActive(trx, input.insurerId),
      );
  const autoApproval = trace?.ok === true ? { authorizedAmount: input.requestedAmount, code: generateAuthorizationCode(), validUntil: calcularValidade(input.expectedOn, await policyValue(deps, trx, input.insurerId, POLICY_KEYS.validityDays)) } : undefined;

  await deps.authorizations.insert(trx, {
    id,
    insurerId: input.insurerId,
    beneficiaryId: input.beneficiaryId,
    providerId: input.providerId,
    serviceId: input.service.id,
    guideType: input.guideType,
    processId,
    parentRequestId: input.parentRequestId,
    // SUBMITTED é transitório: passa a IN_REVIEW (ou a APPROVED, auto-aprovação BR-AUT-03) na mesma transação.
    status: autoApproval ? "APPROVED" : "IN_REVIEW",
    ...(autoApproval ? { autoApproval } : {}),
    autoApprovalTrace: trace,
    justification: input.justification,
    requestedAmount: input.requestedAmount,
    expectedOn: input.expectedOn,
    decisionDueAt: await decisionDueAt(deps, trx, input.insurerId, input.service.id, now, isAppeal),
    submittedByClinicAccountId: actor.clinicAccountId,
    now,
  });
  const base = { insurerId: input.insurerId, authorizationId: id, now };
  await recordTransition(deps, trx, { ...base, from: null, to: "SUBMITTED", actor: "CLINIC", actorAccountId: actor.clinicAccountId, note: null });
  await recordTransition(deps, trx, { ...base, from: "SUBMITTED", to: autoApproval ? "APPROVED" : "IN_REVIEW", actor: "SYSTEM", actorAccountId: null, note: null });
  // ADR-036: a aprovação automática avisa a família como a manual (`APPROVED` igual; a clínica e a família não a distinguem).
  if (autoApproval) await notifyFamily(deps, trx, { processId, kind: "APPROVED", requestId: id, now });

  await deps.audit.record(trx, {
    occurredAt: now,
    actorType: "CLINIC_ACCOUNT",
    actorClinicAccountId: actor.clinicAccountId,
    actorClinicId: actor.clinicId,
    action: "AUTHORIZATION_SUBMIT",
    resourceType: "AuthorizationRequest",
    resourceId: id,
    result: "SUCCESS",
    requestId: context.requestId,
    ...auditContextFields(context),
    metadata: { insurerId: input.insurerId, guideType: input.guideType, light: input.light, appeal: input.parentRequestId !== null, hasProcess: processId !== null, serviceId: input.service.id },
  });
  if (trace?.ok === true) {
    // Só ids e contagens: nunca o nome da regra, valores nem o código (audit.md §3, BR-AUT-12).
    await deps.audit.record(trx, {
      occurredAt: now,
      actorType: "SYSTEM",
      action: "AUTHORIZATION_AUTO_APPROVE",
      resourceType: "AuthorizationRequest",
      resourceId: id,
      result: "SUCCESS",
      requestId: context.requestId,
      metadata: { insurerId: input.insurerId, ruleId: trace.ruleId, checks: trace.checks.length },
    });
  }
  return id;
}

export { gateRejection };
