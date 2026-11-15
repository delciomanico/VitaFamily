// Peças comuns dos casos de uso da SEGURADORA sobre o pedido de autorização (fatia 4, ADR-035): carregar com bloqueio, aplicar a
// matriz de ações (403/409), montar a vista (allowedActions, SLA, expirada) e o detalhe (cobertura interna, anexos, linha do tempo).
// C2/BR-AUT-19: nunca ids de utilizador/família/membro nem `processId`; as notas internas só saem aqui (nunca para a clínica).
import { ConflictError, DomainError, ForbiddenError } from "../../../platform/errors/index.js";
import type { OpsActor } from "../domain/access.js";
import { acoesPermitidas, checkAction, type ActionActor, type ActionCheck, type ActionSubject, type AuthorizationDecider, type InsurerAuthorizationAction } from "../domain/authorization-actions.js";
import type { AutoApprovalTrace } from "../domain/auto-approval.js";
import { appealOpenUntil, isPartial, type AuthorizationAttachment, type ClosedReason } from "../domain/authorization.js";
import type { AuthorizationStatus } from "../domain/authorization-machine.js";
import { isExpired } from "../domain/deadline.js";
import type { InsurerAuthorizationEventRow, InsurerAuthorizationRow } from "../domain/insurer-authorization.js";
import { slaStatus, type SlaStatus } from "../domain/sla.js";
import { notFoundError } from "./beneficiary-lookup.js";
import { coverageOnDate } from "./submit-authorization.js";
import { POLICY_KEYS, policyValue } from "./authorization-support.js";
import type { OpsDeps } from "./ports.js";

export interface InsurerCoverageView {
  reason: string;
  copayPct: number;
  requiresAuthorization: boolean;
  waitingEndsOn: string | null;
  limitPerYear: number | null;
  remaining: number | null;
}

export interface InsurerTimelineEntry {
  status: AuthorizationStatus;
  occurredAt: Date;
  by: "CLINIC" | "ANALYST" | "SUPERVISOR" | "SYSTEM";
  note: string | null;
  internalNote: string | null;
}

export interface InsurerAuthorizationView {
  id: string;
  status: AuthorizationStatus;
  closedReason: ClosedReason | null;
  guideType: string;
  serviceCode: string;
  serviceName: string;
  providerName: string;
  beneficiaryId: string;
  beneficiaryName: string;
  currency: string;
  requestedAmount: number;
  authorizedAmount: number | null;
  partial: boolean;
  expectedOn: string;
  justification: string;
  parentRequestId: string | null;
  isAppeal: boolean;
  decisionNote: string | null;
  code: string | null;
  validUntil: Date | null;
  expired: boolean;
  decisionDueAt: Date;
  slaStatus: SlaStatus | null;
  escalatedAt: Date | null;
  infoExpiresAt: Date | null;
  assignedTo: { id: string; email: string } | null;
  decidedBy: AuthorizationDecider | null;
  decidedAt: Date | null;
  autoApproval: AutoApprovalTrace | null;
  allowedActions: InsurerAuthorizationAction[];
  createdAt: Date;
  updatedAt: Date;
}

export interface InsurerAuthorizationDetailView extends InsurerAuthorizationView {
  coverage: InsurerCoverageView;
  attachments: AuthorizationAttachment[];
  timeline: InsurerTimelineEntry[];
}

export const actionActor = (actor: OpsActor): ActionActor => ({ role: actor.role, accountId: actor.insuranceAccountId });

export function subjectOf(row: InsurerAuthorizationRow, appealDays: number, now: Date): ActionSubject {
  const until = appealOpenUntil(row, appealDays);
  return {
    status: row.status,
    isAppeal: row.parentRequestId !== null,
    assignedToAccountId: row.assignedTo?.id ?? null,
    decidedByKind: row.decidedByKind,
    decidedByAccountId: row.decidedByAccountId,
    originDeciderAccountId: row.originDeciderAccountId,
    priorRejecterAccountId: row.priorRejecterAccountId,
    appealWindowOpen: until !== null && now.getTime() <= until.getTime(),
    hasLiveAppeal: row.hasLiveAppeal,
  };
}

/** 403 / 409 `INVALID_STATE_TRANSITION` / 409 `CONFLICT` a partir da decisão pura da matriz (§8.2d). */
export function assertActionAllowed(check: ActionCheck): void {
  if (check.ok) return;
  if (check.error === "FORBIDDEN") throw new ForbiddenError({ detail: "Sem permissão para esta operação." });
  if (check.error === "CONFLICT") throw new ConflictError({ detail: "O pedido já está atribuído a outro analista ou existe um recurso ou pedido em curso." });
  throw new DomainError("INVALID_STATE_TRANSITION", { detail: "O pedido não está num estado que permita esta ação." });
}

/** Pedido da própria seguradora, bloqueado (`FOR UPDATE`) para decidir sem corridas; outro caso ⇒ `NOT_FOUND`. */
export async function loadForDecision<Trx>(deps: OpsDeps<Trx>, trx: Trx, actor: OpsActor, authorizationId: string): Promise<{ row: InsurerAuthorizationRow; appealDays: number; now: Date }> {
  const row = await deps.insurerAuthorizations.find(trx, actor.insurerId, authorizationId, true);
  if (!row) throw notFoundError();
  return { row, appealDays: await policyValue(deps, trx, actor.insurerId, POLICY_KEYS.appealDays), now: deps.clock.now() };
}

/** Aplica a matriz a uma ação sobre um pedido já carregado (lança 403/409). */
export function requireAction(action: InsurerAuthorizationAction, actor: OpsActor, row: InsurerAuthorizationRow, appealDays: number, now: Date): void {
  assertActionAllowed(checkAction(action, actionActor(actor), subjectOf(row, appealDays, now)));
}

export function toInsurerView(row: InsurerAuthorizationRow, actor: OpsActor, currency: string, appealDays: number, now: Date): InsurerAuthorizationView {
  const approved = row.status === "APPROVED";
  return {
    id: row.id,
    status: row.status,
    closedReason: row.closedReason,
    guideType: row.guideType,
    serviceCode: row.serviceCode,
    serviceName: row.serviceName,
    providerName: row.providerName,
    beneficiaryId: row.beneficiaryId,
    beneficiaryName: row.beneficiaryName,
    currency,
    requestedAmount: row.requestedAmount,
    // Só uma aprovação em vigor tem valor/código/validade (BR-AUT-21: o código revertido deixa de valer).
    authorizedAmount: approved ? row.authorizedAmount : null,
    partial: isPartial(row),
    expectedOn: row.expectedOn,
    justification: row.justification,
    parentRequestId: row.parentRequestId,
    isAppeal: row.parentRequestId !== null,
    decisionNote: row.decisionNote,
    code: approved ? row.code : null,
    validUntil: approved ? row.validUntil : null,
    expired: approved && isExpired(row.validUntil, now),
    decisionDueAt: row.decisionDueAt,
    slaStatus: slaStatus(row, now),
    escalatedAt: row.escalatedAt,
    infoExpiresAt: row.infoExpiresAt,
    assignedTo: row.assignedTo,
    decidedBy: row.decidedByKind,
    decidedAt: row.decidedAt,
    autoApproval: row.autoApprovalTrace,
    allowedActions: acoesPermitidas(actionActor(actor), subjectOf(row, appealDays, now)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Cobertura avaliada em `expectedOn` (razão INTERNA, BR-SEG-41): `evaluateCoverage` é a única fonte (ADR-033). */
export async function coverageView<Trx>(deps: OpsDeps<Trx>, trx: Trx, row: InsurerAuthorizationRow): Promise<InsurerCoverageView> {
  const decision = await coverageOnDate(deps, trx, row.insurerId, row.beneficiaryId, { id: row.serviceId, status: row.serviceStatus }, row.expectedOn);
  if (decision === null) return { reason: "BENEFICIARY_NOT_ACTIVE", copayPct: 0, requiresAuthorization: false, waitingEndsOn: null, limitPerYear: null, remaining: null };
  return {
    reason: decision.reason,
    copayPct: decision.copayPct,
    requiresAuthorization: decision.requiresAuthorization,
    waitingEndsOn: decision.waitingEndsOn,
    limitPerYear: decision.limitPerYearMinor === null ? null : decision.limitPerYearMinor / 100,
    remaining: decision.remainingMinor === null ? null : decision.remainingMinor / 100,
  };
}

function timelineOf(events: InsurerAuthorizationEventRow[]): InsurerTimelineEntry[] {
  return events.map((e) => ({
    status: e.toStatus,
    occurredAt: e.occurredAt,
    by: e.actorType === "CLINIC_ACCOUNT" ? "CLINIC" : e.actorType === "SYSTEM" ? "SYSTEM" : (e.actorRole ?? "ANALYST"),
    note: e.note,
    internalNote: e.internalNote,
  }));
}

export async function toInsurerDetail<Trx>(deps: OpsDeps<Trx>, trx: Trx, actor: OpsActor, row: InsurerAuthorizationRow, currency: string): Promise<InsurerAuthorizationDetailView> {
  const now = deps.clock.now();
  const appealDays = await policyValue(deps, trx, actor.insurerId, POLICY_KEYS.appealDays);
  const attachments = (await deps.authorizations.attachments(trx, [row.id])).get(row.id) ?? [];
  return {
    ...toInsurerView(row, actor, currency, appealDays, now),
    coverage: await coverageView(deps, trx, row),
    attachments,
    timeline: timelineOf(await deps.insurerAuthorizations.events(trx, actor.insurerId, row.id)),
  };
}

/** Recarrega o pedido após a escrita e devolve o detalhe (a resposta das ações). */
export async function reloadDetail<Trx>(deps: OpsDeps<Trx>, trx: Trx, actor: OpsActor, id: string, currency: string): Promise<InsurerAuthorizationDetailView> {
  const row = await deps.insurerAuthorizations.find(trx, actor.insurerId, id);
  if (!row) throw new Error("pedido inexistente logo após a escrita");
  return toInsurerDetail(deps, trx, actor, row, currency);
}

/** O analista que age num pedido livre fica com ele (BR-AUT-18); o supervisor não atribui ao decidir (os recursos não se atribuem). */
export async function claimIfFreeAnalyst<Trx>(deps: OpsDeps<Trx>, trx: Trx, actor: OpsActor, row: InsurerAuthorizationRow, now: Date): Promise<void> {
  if (actor.role === "AUTHORIZATION_ANALYST" && row.assignedTo === null) await deps.insurerAuthorizations.assign(trx, actor.insurerId, row.id, actor.insuranceAccountId, now);
}

export const decisionRole = (actor: OpsActor): "ANALYST" | "SUPERVISOR" => (actor.role === "SUPERVISOR" ? "SUPERVISOR" : "ANALYST");
