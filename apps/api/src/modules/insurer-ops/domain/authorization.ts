// Pedido de autorização pelo prestador (ADR-034, BR-AUT-01..16): entidade, validação do pedido e ações permitidas. Regras puras.
// C2 (BR-AUT-12): NENHUM campo de diagnóstico/clínico; campos desconhecidos são rejeitados; a justificação é só administrativa.
import { PENDING_STATUSES, type AuthorizationStatus } from "./authorization-machine.js";
import { calcularLimiteRecurso } from "./deadline.js";
import { parseEligibilityRequest, type EligibilityRequest } from "./eligibility.js";
import { fail, isIsoDate, requireText, requireUuid } from "./validation.js";

export type ClosedReason = "INFO_TIMEOUT" | "CLINIC_CANCELLED";
export type AuthorizationAction = "RESPOND" | "CANCEL" | "APPEAL" | "ATTACH";
export type AttachmentKind = "QUOTE" | "INSURER_FORM" | "ID_COPY" | "OTHER_ADMIN";
/** Só administrativos (BR-AUT-13): não existe tipo para laudo, receita, exame ou relatório. */
export const ATTACHMENT_KINDS: readonly AttachmentKind[] = ["QUOTE", "INSURER_FORM", "ID_COPY", "OTHER_ADMIN"];

export const JUSTIFICATION_MAX = 500;
export const MAX_REQUESTED_AMOUNT = 999999999999.99;
export const NOTE_MAX = 200;

export interface Authorization {
  id: string;
  insurerId: string;
  beneficiaryId: string;
  providerId: string;
  serviceId: string;
  guideType: string;
  processId: string | null;
  parentRequestId: string | null;
  status: AuthorizationStatus;
  closedReason: ClosedReason | null;
  justification: string;
  requestedAmount: number;
  authorizedAmount: number | null;
  expectedOn: string;
  code: string | null;
  validUntil: Date | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  decisionDueAt: Date;
  infoExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Pedido + o que a lista/detalhe do prestador junta (nomes e se já tem recurso vivo). */
export interface AuthorizationRow extends Authorization {
  beneficiaryName: string;
  serviceCode: string;
  serviceName: string;
  /** Existe um recurso não cancelado deste pedido (BR-AUT-08). */
  hasLiveAppeal: boolean;
}

export interface AuthorizationAttachment {
  id: string;
  authorizationId: string;
  kind: AttachmentKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByClinicAccountId: string | null;
  createdAt: Date;
}

export interface AuthorizationEvent {
  toStatus: AuthorizationStatus;
  actorType: "CLINIC_ACCOUNT" | "INSURANCE_ACCOUNT" | "SYSTEM";
  note: string | null;
  occurredAt: Date;
}

/** BR-AUT-04: «aprovada em parte» é derivado, nunca persistido. */
export const isPartial = (a: Pick<Authorization, "status" | "authorizedAmount" | "requestedAmount">): boolean => a.status === "APPROVED" && a.authorizedAmount !== null && a.authorizedAmount < a.requestedAmount;

/** Fim do prazo de recurso (só `REJECTED`, BR-AUT-08). */
export function appealOpenUntil(a: Pick<Authorization, "status" | "decidedAt">, appealDays: number): Date | null {
  return a.status === "REJECTED" && a.decidedAt !== null ? calcularLimiteRecurso(a.decidedAt, appealDays) : null;
}

/** Ações que o servidor permite agora; a UI mostra só estas (BR-AUT-08/13/14/15). */
export function allowedActions(a: Pick<AuthorizationRow, "status" | "decidedAt" | "hasLiveAppeal">, now: Date, appealDays: number): AuthorizationAction[] {
  const actions: AuthorizationAction[] = [];
  const pending = PENDING_STATUSES.includes(a.status);
  if (a.status === "INFO_REQUESTED") actions.push("RESPOND");
  if (pending) actions.push("CANCEL");
  const until = appealOpenUntil(a, appealDays);
  if (until !== null && now.getTime() <= until.getTime() && !a.hasLiveAppeal) actions.push("APPEAL");
  if (pending) actions.push("ATTACH");
  return actions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rejeita campos fora da lista (C2: nunca `diagnosis`, `icd`, …). */
function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fail(key, "campo não permitido");
}

/** Valor em unidades da moeda com no máximo 2 casas decimais, > 0 e ≤ máximo (BR-AUT, openapi). */
export function parseRequestedAmount(value: unknown, field = "requestedAmount"): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(field, "número esperado");
  if (value <= 0) fail(field, "tem de ser maior que zero");
  if (value > MAX_REQUESTED_AMOUNT) fail(field, "valor acima do máximo permitido");
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) fail(field, "no máximo duas casas decimais");
  return Math.round(value * 100) / 100;
}

/** BR-AUT-05: nesta fatia a data prevista não pode ser passada (hoje ou futura, UTC). */
export function parseExpectedOn(value: unknown, today: string, field = "expectedOn"): string {
  if (!isIsoDate(value)) fail(field, "data inválida (AAAA-MM-DD)");
  if (value < today) fail(field, "não pode ser uma data passada");
  return value;
}

export function parseGuideTypeOverride(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^[A-Z][A-Z_]{1,29}$/.test(value)) fail("guideType", "tipo de guia inválido");
  return value;
}

export interface CreateAuthorizationInput {
  insurerId: string;
  identification: EligibilityRequest;
  requestedAmount: number;
  expectedOn: string;
  justification: string;
  guideType: string | null;
  processId: string | null;
}

const CREATE_KEYS = ["insurerId", "cardNumber", "qrToken", "idDocument", "serviceCode", "guideType", "requestedAmount", "expectedOn", "justification", "processId"] as const;

/** `POST /clinic-portal/authorizations` (UC-SEG-06): o beneficiário identifica-se como na elegibilidade (exatamente um dos três). */
export function parseCreateAuthorizationInput(body: unknown, today: string): CreateAuthorizationInput {
  if (!isRecord(body)) fail("body", "objeto esperado");
  assertOnlyKeys(body, CREATE_KEYS);
  const identification = parseEligibilityRequest(body);
  if (identification.serviceCode === null) fail("serviceCode", "obrigatório");
  return {
    insurerId: requireUuid(body.insurerId, "insurerId"),
    identification,
    requestedAmount: parseRequestedAmount(body.requestedAmount),
    expectedOn: parseExpectedOn(body.expectedOn, today),
    justification: requireText(body.justification, "justification", JUSTIFICATION_MAX),
    guideType: parseGuideTypeOverride(body.guideType),
    processId: body.processId === undefined || body.processId === null ? null : requireUuid(body.processId, "processId"),
  };
}

export function parseRespondInput(body: unknown): { message: string } {
  if (!isRecord(body)) fail("body", "objeto esperado");
  assertOnlyKeys(body, ["message"]);
  return { message: requireText(body.message, "message", JUSTIFICATION_MAX) };
}

export function parseCancelInput(body: unknown): { note: string | null } {
  if (body === undefined || body === null) return { note: null };
  if (!isRecord(body)) fail("body", "objeto esperado");
  assertOnlyKeys(body, ["note"]);
  return { note: body.note === undefined || body.note === null ? null : requireText(body.note, "note", NOTE_MAX) };
}

export interface AppealInput {
  justification: string;
  requestedAmount: number | null;
  expectedOn: string | null;
}

export function parseAppealInput(body: unknown, today: string): AppealInput {
  if (!isRecord(body)) fail("body", "objeto esperado");
  assertOnlyKeys(body, ["justification", "requestedAmount", "expectedOn"]);
  return {
    justification: requireText(body.justification, "justification", JUSTIFICATION_MAX),
    requestedAmount: body.requestedAmount === undefined || body.requestedAmount === null ? null : parseRequestedAmount(body.requestedAmount),
    expectedOn: body.expectedOn === undefined || body.expectedOn === null ? null : parseExpectedOn(body.expectedOn, today),
  };
}

export function parseAttachmentKind(value: unknown): AttachmentKind {
  const kind = ATTACHMENT_KINDS.find((candidate) => candidate === value);
  if (kind === undefined) fail("kind", ATTACHMENT_KINDS.join(" | "));
  return kind;
}

/** Filtro da lista (`status=OPEN` = os três pendentes). */
export type AuthorizationListStatus = AuthorizationStatus | "OPEN";
