// Plano da seguradora, versões e coberturas (UC-SEG-04, BR-SEG-01/02/04/09/22; state-machines.md «Plan»). Regras puras.
// Fase A: cobertura sim/não, % comparticipação, teto anual, carência e «exige autorização» — sem saldo/consumo (D-A2).
import { ConflictError, DomainError } from "../../../platform/errors/index.js";
import { fail, requireText, requireUuid } from "./validation.js";
import type { PlanStatus } from "./policy.js";

export interface InsurerPlan {
  id: string;
  insurerId: string;
  name: string;
  version: number;
  status: PlanStatus;
  coverageCount: number;
  createdAt: Date;
}

export const PLAN_STATUSES: PlanStatus[] = ["DRAFT", "ACTIVE", "ARCHIVED"];

export function parsePlanInput(input: { name?: unknown }): { name: string } {
  return { name: requireText(input.name, "name", 120) };
}

export function parsePlanStatusFilter(value: unknown): PlanStatus | undefined {
  if (value === undefined) return undefined;
  if (!PLAN_STATUSES.includes(value as PlanStatus)) fail("status", "DRAFT, ACTIVE ou ARCHIVED", "Filtro inválido.");
  return value as PlanStatus;
}

/** ST Plan: `DRAFT→ACTIVE` (exige ≥1 cobertura), `ACTIVE→ARCHIVED`; `ARCHIVED` é final. */
export function assertPlanTransition(plan: Pick<InsurerPlan, "status" | "coverageCount">, to: unknown): "ACTIVE" | "ARCHIVED" {
  if (to !== "ACTIVE" && to !== "ARCHIVED") fail("status", "ACTIVE ou ARCHIVED");
  const allowed = (plan.status === "DRAFT" && to === "ACTIVE") || (plan.status === "ACTIVE" && to === "ARCHIVED");
  if (!allowed) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Transição de estado não permitida." });
  if (to === "ACTIVE" && plan.coverageCount < 1) throw new ConflictError({ detail: "O plano precisa de pelo menos uma cobertura para ser ativado." });
  return to;
}

/** `new-version` (BR-SEG-01): só a partir de uma versão `ACTIVE` (imutável); a outra DRAFT do mesmo nome é verificada com a BD. */
export function assertCanCreateVersion(plan: Pick<InsurerPlan, "status">): void {
  if (plan.status !== "ACTIVE") throw new ConflictError({ detail: "Só se cria uma nova versão a partir de um plano ativo." });
}

/** As coberturas só se substituem em plano `DRAFT` (planos ativos/arquivados são imutáveis). */
export function assertCoveragesEditable(plan: Pick<InsurerPlan, "status">): void {
  if (plan.status !== "DRAFT") throw new ConflictError({ detail: "As coberturas só se alteram num plano em rascunho." });
}

export type CoverageType = "INCLUDED" | "LIMITED" | "EXCLUDED";

export interface PlanCoverage {
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  covered: boolean;
  copayPct: number;
  limitPerYear: number | null;
  waitingDays: number;
  requiresAuthorization: boolean;
}

export interface ParsedCoverage {
  serviceId: string;
  type: CoverageType;
  copayPct: number;
  limitPerYear: number | null;
  waitingDays: number;
  requiresAuthorization: boolean;
}

export const MAX_COVERAGE_ITEMS = 1000;
const MAX_MONEY = 999_999_999_999.99;

/** schema.md §3c: covered=false→EXCLUDED; covered=true com `limitPerYear`→LIMITED; sem→INCLUDED. */
export function coverageTypeOf(covered: boolean, limitPerYear: number | null): CoverageType {
  if (!covered) return "EXCLUDED";
  return limitPerYear === null ? "INCLUDED" : "LIMITED";
}

const hasAtMostTwoDecimals = (n: number): boolean => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

function parseNumber(value: unknown, field: string, min: number, max: number, decimals: boolean): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(field, `número entre ${String(min)} e ${String(max)}`);
  if (decimals ? !hasAtMostTwoDecimals(value) : !Number.isInteger(value)) fail(field, decimals ? "no máximo 2 casas decimais" : "inteiro");
  return value;
}

export function parseCoverageItems(input: { items?: unknown }): ParsedCoverage[] {
  if (!Array.isArray(input.items)) fail("items", "lista obrigatória");
  if (input.items.length > MAX_COVERAGE_ITEMS) fail("items", `no máximo ${String(MAX_COVERAGE_ITEMS)} itens`);
  const seen = new Set<string>();
  return (input.items as unknown[]).map((raw, index) => {
    const field = (name: string) => `items[${String(index)}].${name}`;
    if (typeof raw !== "object" || raw === null) fail(`items[${String(index)}]`, "objeto obrigatório");
    const item = raw as Record<string, unknown>;
    const serviceId = requireUuid(item.serviceId, field("serviceId"));
    if (seen.has(serviceId)) fail(field("serviceId"), "repetido no pedido");
    seen.add(serviceId);
    if (typeof item.covered !== "boolean") fail(field("covered"), "booleano obrigatório");
    const copayPct = item.copayPct === undefined ? 100 : parseNumber(item.copayPct, field("copayPct"), 0, 100, true);
    const limit = item.limitPerYear === undefined || item.limitPerYear === null ? null : parseNumber(item.limitPerYear, field("limitPerYear"), 0, MAX_MONEY, true);
    const waitingDays = item.waitingDays === undefined ? 0 : parseNumber(item.waitingDays, field("waitingDays"), 0, 36500, false);
    if (item.requiresAuthorization !== undefined && typeof item.requiresAuthorization !== "boolean") fail(field("requiresAuthorization"), "booleano");
    // Serviço não coberto: os restantes parâmetros não se aplicam (teto nulo, para o CHECK `type`/`limit_per_year` da BD).
    const covered = item.covered;
    return {
      serviceId,
      type: coverageTypeOf(covered, covered ? limit : null),
      copayPct,
      limitPerYear: covered ? limit : null,
      waitingDays,
      requiresAuthorization: item.requiresAuthorization === true,
    };
  });
}
