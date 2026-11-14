// Peças comuns dos casos de uso do pedido de autorização (BR-AUT): acesso da clínica, prazos por política, transições com
// evento, e a vista do prestador (Q-T1: nunca saldo, razão, notas internas, analista, ids de família/membro, nº de cartão).
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import { assertClinicRole, type ClinicOpsActor } from "../domain/access.js";
import {
  allowedActions,
  appealOpenUntil,
  isPartial,
  type AuthorizationAction,
  type AuthorizationAttachment,
  type AuthorizationEvent,
  type AuthorizationRow,
  type ClosedReason,
} from "../domain/authorization.js";
import { checkTransition, type AuthorizationStatus, type TransitionActor } from "../domain/authorization-machine.js";
import { calcularLimiteInformacao, calcularPrazoDecisao } from "../domain/deadline.js";
import { POLICY_KEYS, requireDefinition, resolvePolicySetting } from "../domain/policy-setting.js";

export { POLICY_KEYS };
import { notFoundError } from "./beneficiary-lookup.js";
import { authorizeClinic } from "./clinic-portal.js";
import type { OpsDeps } from "./ports.js";

export async function policyValue<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string, key: string, serviceId?: string): Promise<number> {
  const definition = requireDefinition(await deps.policySettings.definitions(trx), key);
  return resolvePolicySetting(definition, await deps.policySettings.list(trx, insurerId), serviceId).value;
}

/** BR-AUT-06: prazo de decisão do pedido (serviço > seguradora > omissão do Vita). */
export async function decisionDueAt<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string, serviceId: string, now: Date): Promise<Date> {
  return calcularPrazoDecisao(now, await policyValue(deps, trx, insurerId, POLICY_KEYS.decisionHours, serviceId));
}

/** BR-AUT-14: limite para a clínica responder, guardado ao entrar em `INFO_REQUESTED` (usado pela decisão do analista, fatia 4). */
export async function infoExpiresAt<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string, now: Date): Promise<Date> {
  return calcularLimiteInformacao(now, await policyValue(deps, trx, insurerId, POLICY_KEYS.infoExpiryDays));
}

/** Escritas: pedido da própria clínica (senão 404) E ligação ativa + módulo ativo (senão 404, §6.2b); devolve o pedido (bloqueado). */
export async function loadForWrite<Trx>(deps: OpsDeps<Trx>, trx: Trx, actor: ClinicOpsActor, authorizationId: string): Promise<{ row: AuthorizationRow; currency: string }> {
  assertClinicRole(actor.role);
  const row = await deps.authorizations.findForClinic(trx, actor.clinicId, authorizationId, true);
  if (!row) throw notFoundError();
  const { currency } = await authorizeClinic(deps, trx, actor, row.insurerId);
  return { row, currency };
}

/** `INVALID_STATE_TRANSITION` (409) a partir do resultado puro da máquina. */
export function assertTransition(from: AuthorizationStatus | null, to: AuthorizationStatus, actor: TransitionActor, closedReason?: ClosedReason): void {
  const check = checkTransition(from, to, actor, closedReason);
  if (!check.ok) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "O pedido não está num estado que permita esta ação." });
}

export interface TransitionInput {
  insurerId: string;
  authorizationId: string;
  from: AuthorizationStatus | null;
  to: AuthorizationStatus;
  actor: TransitionActor;
  actorAccountId: string | null;
  note: string | null;
  closedReason?: ClosedReason;
  now: Date;
}

/** Valida na máquina e grava o evento imutável (histórico funcional; a auditoria é à parte). */
export async function recordTransition<Trx>(deps: Pick<OpsDeps<Trx>, "authorizations">, trx: Trx, input: TransitionInput): Promise<void> {
  assertTransition(input.from, input.to, input.actor, input.closedReason);
  await deps.authorizations.insertEvent(trx, {
    insurerId: input.insurerId,
    authorizationId: input.authorizationId,
    from: input.from,
    to: input.to,
    actorType: input.actor === "CLINIC" ? "CLINIC_ACCOUNT" : input.actor === "SYSTEM" ? "SYSTEM" : "INSURANCE_ACCOUNT",
    actorAccountId: input.actorAccountId,
    channel: "PORTAL",
    note: input.note,
    at: input.now,
  });
}

/** Vista do prestador (`AuthorizationRequest`/`Detail` do contrato). Datas como `Date`; a `interface` serializa. */
export interface AuthorizationView {
  id: string;
  insurerId: string;
  insurerName: string;
  beneficiaryName: string;
  serviceCode: string;
  serviceName: string;
  guideType: string;
  currency: string;
  requestedAmount: number;
  authorizedAmount: number | null;
  partial: boolean;
  expectedOn: string;
  justification: string;
  status: AuthorizationStatus;
  closedReason: ClosedReason | null;
  decisionNote: string | null;
  code: string | null;
  validUntil: Date | null;
  decisionDueAt: Date;
  infoExpiresAt: Date | null;
  appealOpenUntil: Date | null;
  processId: string | null;
  parentRequestId: string | null;
  allowedActions: AuthorizationAction[];
  attachments: AuthorizationAttachment[];
  createdAt: Date;
  updatedAt: Date;
  /** Só no detalhe. */
  timeline?: { status: AuthorizationStatus; occurredAt: Date; by: "CLINIC" | "INSURER" | "SYSTEM"; note: string | null }[];
}

/** Monta as vistas em lote (sem N+1 por seguradora/anexos). `withTimeline` só no detalhe. */
export async function toViews<Trx>(deps: OpsDeps<Trx>, trx: Trx, rows: AuthorizationRow[], withTimeline: boolean): Promise<AuthorizationView[]> {
  const now = deps.clock.now();
  const insurerIds = [...new Set(rows.map((r) => r.insurerId))];
  const insurers = new Map<string, { name: string; currency: string; appealDays: number }>();
  for (const insurerId of insurerIds) {
    const settings = await deps.insurers.get(trx, insurerId);
    insurers.set(insurerId, { name: settings?.name ?? "", currency: settings?.currency ?? "", appealDays: await policyValue(deps, trx, insurerId, POLICY_KEYS.appealDays) });
  }
  const ids = rows.map((r) => r.id);
  const attachments = await deps.authorizations.attachments(trx, ids);
  const events = withTimeline ? await deps.authorizations.events(trx, ids) : new Map<string, AuthorizationEvent[]>();
  return rows.map((row) => {
    const insurer = insurers.get(row.insurerId) ?? { name: "", currency: "", appealDays: 0 };
    const view: AuthorizationView = {
      id: row.id,
      insurerId: row.insurerId,
      insurerName: insurer.name,
      beneficiaryName: row.beneficiaryName,
      serviceCode: row.serviceCode,
      serviceName: row.serviceName,
      guideType: row.guideType,
      currency: insurer.currency,
      requestedAmount: row.requestedAmount,
      authorizedAmount: row.authorizedAmount,
      partial: isPartial(row),
      expectedOn: row.expectedOn,
      justification: row.justification,
      status: row.status,
      closedReason: row.closedReason,
      decisionNote: row.decisionNote,
      code: row.code,
      validUntil: row.validUntil,
      decisionDueAt: row.decisionDueAt,
      infoExpiresAt: row.infoExpiresAt,
      appealOpenUntil: appealOpenUntil(row, insurer.appealDays),
      processId: row.processId,
      parentRequestId: row.parentRequestId,
      allowedActions: allowedActions(row, now, insurer.appealDays),
      attachments: attachments.get(row.id) ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    if (withTimeline) {
      view.timeline = (events.get(row.id) ?? []).map((e) => ({
        status: e.toStatus,
        occurredAt: e.occurredAt,
        by: e.actorType === "CLINIC_ACCOUNT" ? ("CLINIC" as const) : e.actorType === "SYSTEM" ? ("SYSTEM" as const) : ("INSURER" as const),
        note: e.note,
      }));
    }
    return view;
  });
}

/** Mensagem única do gate do semáforo (BR-AUT-02): igual para VERMELHO, VERDE e serviço desconhecido (sem razão, BR-SEG-18). */
export function gateRejection(): ValidationError {
  return new ValidationError([{ field: "serviceCode", message: "este serviço não permite pedido de autorização" }], { detail: "Não é possível pedir autorização para este serviço." });
}
