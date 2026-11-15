// Entradas e validações puras da decisão pela seguradora (fatia 4, ADR-035, BR-AUT-04/07/17/21/22/23): corpos das rotas do
// analista/supervisor e das regras de auto-aprovação. Campos desconhecidos são rejeitados; textos são ADMINISTRATIVOS (C2, BR-AUT-12).
import { NOTE_MAX, parseRequestedAmount } from "./authorization.js";
import { toEligibilityLight, type CoverageDecision } from "./coverage.js";
import { calcularValidade } from "./deadline.js";
import { fail, requireText, requireUuid } from "./validation.js";

export const REASON_MAX = 500;
export const RULE_NAME_MAX = 80;
export const MAX_RULES_PER_INSURER = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fail(key, "campo não permitido");
}

/** `{ reason }` (request-info, reject, cancel, reopen): 1–500 caracteres. */
export function parseReasonInput(body: unknown): { reason: string } {
  if (!isRecord(body)) fail("body", "objeto esperado");
  assertOnlyKeys(body, ["reason"]);
  return { reason: requireText(body.reason, "reason", REASON_MAX) };
}

export interface ApproveInput {
  authorizedAmount: number | null;
  validUntil: Date | null;
  note: string | null;
  overrideReason: string | null;
}

function optionalText(body: Record<string, unknown>, field: string, max: number): string | null {
  return body[field] === undefined || body[field] === null ? null : requireText(body[field], field, max);
}

export function parseApproveInput(body: unknown): ApproveInput {
  if (body === undefined || body === null) return { authorizedAmount: null, validUntil: null, note: null, overrideReason: null };
  if (!isRecord(body)) fail("body", "objeto esperado");
  assertOnlyKeys(body, ["authorizedAmount", "validUntil", "note", "overrideReason"]);
  let validUntil: Date | null = null;
  if (body.validUntil !== undefined && body.validUntil !== null) {
    const parsed = typeof body.validUntil === "string" ? new Date(body.validUntil) : null;
    if (parsed === null || Number.isNaN(parsed.getTime())) fail("validUntil", "data e hora inválidas");
    validUntil = parsed;
  }
  return {
    authorizedAmount: body.authorizedAmount === undefined || body.authorizedAmount === null ? null : parseRequestedAmount(body.authorizedAmount, "authorizedAmount"),
    validUntil,
    note: optionalText(body, "note", NOTE_MAX),
    overrideReason: optionalText(body, "overrideReason", NOTE_MAX),
  };
}

export interface ApprovalDecision {
  authorizedAmount: number;
  validUntil: Date;
  partial: boolean;
  override: boolean;
}

/** Razões internas que a decisão humana pode sobrepor (BR-SEG-04): exigem `overrideReason` INTERNO. */
const OVERRIDABLE_REASONS: readonly string[] = ["WAITING_PERIOD", "LIMIT_EXHAUSTED"];

/**
 * BR-AUT-04/07/17: valor ≤ pedido e ≤ saldo (havendo teto); em parte ⇒ `note`; carência/limite ⇒ `overrideReason`; `validUntil`
 * futura e até `expectedOn` + o máximo da chave. Cobertura VERMELHA agora ⇒ `coverage` (a seguradora recusa em vez de aprovar).
 * Puro: o relógio, a validade por omissão e o máximo da chave chegam como argumentos (valores vêm de `resolvePolicySetting`).
 */
export function decideApproval(input: ApproveInput, request: { requestedAmount: number; expectedOn: string }, coverage: Pick<CoverageDecision, "reason" | "requiresAuthorization" | "remainingMinor">, validity: { defaultDays: number; maxDays: number }, now: Date): ApprovalDecision {
  if (toEligibilityLight(coverage) === "RED") fail("coverage", "o serviço já não está coberto; recuse o pedido");
  const authorizedAmount = input.authorizedAmount ?? request.requestedAmount;
  if (authorizedAmount > request.requestedAmount) fail("authorizedAmount", "não pode exceder o valor pedido");
  if (coverage.remainingMinor !== null && Math.round(authorizedAmount * 100) > coverage.remainingMinor) fail("authorizedAmount", "não pode exceder o saldo disponível");
  const partial = authorizedAmount < request.requestedAmount;
  if (partial && input.note === null) fail("note", "obrigatória na aprovação em parte");
  const override = OVERRIDABLE_REASONS.includes(coverage.reason);
  if (override && input.overrideReason === null) fail("overrideReason", "obrigatória (carência ou limite esgotado)");

  let validUntil = calcularValidade(request.expectedOn, validity.defaultDays);
  if (input.validUntil !== null) {
    if (input.validUntil.getTime() <= now.getTime()) fail("validUntil", "tem de ser futura");
    if (input.validUntil.getTime() > calcularValidade(request.expectedOn, validity.maxDays).getTime()) fail("validUntil", "acima do máximo permitido");
    validUntil = input.validUntil;
  }
  return { authorizedAmount, validUntil, partial, override };
}

/** `POST …/assign`: `analystId` omitido (= eu), um uuid, ou `null` (libertar). */
export function parseAssignInput(body: unknown): { analystId: string | null | undefined } {
  if (body === undefined || body === null) return { analystId: undefined };
  if (!isRecord(body)) fail("body", "objeto esperado");
  assertOnlyKeys(body, ["analystId"]);
  if (!("analystId" in body) || body.analystId === undefined) return { analystId: undefined };
  return { analystId: body.analystId === null ? null : requireUuid(body.analystId, "analystId") };
}

export interface RuleInput {
  name: string;
  serviceKindId: string | null;
  serviceId: string | null;
  maxAmount: number;
  active: boolean;
}

export function parseRuleInput(body: unknown): RuleInput {
  if (!isRecord(body)) fail("body", "objeto esperado");
  assertOnlyKeys(body, ["name", "serviceKindId", "serviceId", "maxAmount", "active"]);
  const serviceKindId = body.serviceKindId === undefined || body.serviceKindId === null ? null : requireUuid(body.serviceKindId, "serviceKindId");
  const serviceId = body.serviceId === undefined || body.serviceId === null ? null : requireUuid(body.serviceId, "serviceId");
  if ((serviceKindId === null) === (serviceId === null)) fail("serviceKindId", "indique exatamente um de serviceKindId e serviceId");
  if (body.active !== undefined && typeof body.active !== "boolean") fail("active", "booleano esperado");
  return { name: requireText(body.name, "name", RULE_NAME_MAX), serviceKindId, serviceId, maxAmount: parseRequestedAmount(body.maxAmount, "maxAmount"), active: body.active ?? true };
}

export interface RulePatch {
  name?: string;
  maxAmount?: number;
  active?: boolean;
}

/** O alvo (`serviceKindId`/`serviceId`) não se altera: apaga-se e cria-se outra (BR-AUT-23). */
export function parseRulePatch(body: unknown): RulePatch {
  if (!isRecord(body)) fail("body", "objeto esperado");
  assertOnlyKeys(body, ["name", "maxAmount", "active"]);
  const patch: RulePatch = {};
  if (body.name !== undefined) patch.name = requireText(body.name, "name", RULE_NAME_MAX);
  if (body.maxAmount !== undefined) patch.maxAmount = parseRequestedAmount(body.maxAmount, "maxAmount");
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") fail("active", "booleano esperado");
    patch.active = body.active;
  }
  if (Object.keys(patch).length === 0) fail("body", "indique pelo menos um campo");
  return patch;
}

