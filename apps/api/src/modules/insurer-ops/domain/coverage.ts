// A ÚNICA decisão de cobertura (BR-SEG-41, ADR-033): elegibilidade (BR-SEG-01), serviço no plano/exclusões (BR-SEG-02/09/22),
// carência (BR-SEG-04), `requiresAuthorization` (BR-SEG-02), comparticipação e saldo (BR-SEG-06/07/08). Função pura:
// `date` é argumento (sem relógio), sem I/O, sem texto de UI; a razão é interna (nunca vai à clínica, BR-SEG-18).
// Nenhum outro ficheiro compara estado/datas de beneficiário ou apólice para decidir cobertura (TC-COV-13).
import { addDays } from "./validation.js";

/** Ordem de avaliação (BR-SEG-41): a primeira que falha ganha. */
export const COVERAGE_REASONS = [
  "BENEFICIARY_NOT_ACTIVE",
  "POLICY_NOT_ACTIVE",
  "OUTSIDE_POLICY_PERIOD",
  "SERVICE_INACTIVE",
  "NOT_IN_PLAN",
  "EXCLUDED",
  "WAITING_PERIOD",
  "LIMIT_EXHAUSTED",
  "COVERED",
] as const;
export type CoverageReason = (typeof COVERAGE_REASONS)[number];
export type EligibilityReason = Extract<CoverageReason, "BENEFICIARY_NOT_ACTIVE" | "POLICY_NOT_ACTIVE" | "OUTSIDE_POLICY_PERIOD">;

/** Datas de calendário `AAAA-MM-DD` (comparáveis como texto). */
export interface CoveragePolicyWindow {
  status: string;
  validFrom: string;
  validTo: string;
}

export interface CoverageBeneficiary {
  status: string;
  policy: CoveragePolicyWindow | null;
}

export interface CoverageLine {
  serviceId: string;
  type: "INCLUDED" | "LIMITED" | "EXCLUDED";
  /** % paga pela seguradora (BR-SEG-06). */
  copayPct: number;
  limitPerYearMinor: number | null;
  waitingDays: number;
  requiresAuthorization: boolean;
}

export interface CoveragePlan {
  coverages: readonly CoverageLine[];
}

export interface CoverageService {
  id: string;
  status: string;
}

export interface CoverageOptions {
  /** Valor do ato (unidade menor); só com ele se calculam as partes. */
  amountMinor?: number;
  /** Consumo já conhecido do teto anual; sem ele não há `LIMIT_EXHAUSTED` e o saldo é o teto (Fase A, D-A2). */
  usage?: { usedMinor: number; reservedMinor: number };
}

export interface CoverageDecision {
  covered: boolean;
  reason: CoverageReason;
  copayPct: number;
  requiresAuthorization: boolean;
  waitingDays: number;
  waitingEndsOn: string | null;
  limitPerYearMinor: number | null;
  remainingMinor: number | null;
  /** Só com `options.amountMinor`; soma sempre o valor do ato. Sem cobertura, a seguradora paga 0. */
  insurerShareMinor?: number;
  patientShareMinor?: number;
}

export type EligibilityDecision = { eligible: true } | { eligible: false; reason: EligibilityReason };

/** Primeiro passo de `evaluateCoverage`: beneficiário `ACTIVE`, apólice `ACTIVE` e `date` dentro de `validFrom..validTo`. */
export function evaluateEligibility(beneficiary: CoverageBeneficiary, date: string): EligibilityDecision {
  if (beneficiary.status !== "ACTIVE") return { eligible: false, reason: "BENEFICIARY_NOT_ACTIVE" };
  const { policy } = beneficiary;
  if (policy?.status !== "ACTIVE") return { eligible: false, reason: "POLICY_NOT_ACTIVE" };
  if (date < policy.validFrom || date > policy.validTo) return { eligible: false, reason: "OUTSIDE_POLICY_PERIOD" };
  return { eligible: true };
}

/** Parte da seguradora: `amount × pct / 100`, arredondada half-up à unidade menor (pct com até 2 casas). */
function insurerShare(amountMinor: number, copayPct: number): number {
  const basisPoints = Math.round(copayPct * 100);
  return Math.floor((amountMinor * basisPoints + 5000) / 10000);
}

function remaining(limit: number | null, usage: CoverageOptions["usage"]): number | null {
  if (limit === null) return null;
  return usage === undefined ? limit : Math.max(0, limit - usage.usedMinor - usage.reservedMinor);
}

function reasonFor(beneficiary: CoverageBeneficiary, service: CoverageService, line: CoverageLine | undefined, waitingEndsOn: string | null, date: string, left: number | null, hasUsage: boolean): CoverageReason {
  const eligibility = evaluateEligibility(beneficiary, date);
  if (!eligibility.eligible) return eligibility.reason;
  if (service.status !== "ACTIVE") return "SERVICE_INACTIVE";
  if (line === undefined) return "NOT_IN_PLAN"; // BR-SEG-22: ausente = não coberto
  if (line.type === "EXCLUDED") return "EXCLUDED"; // BR-SEG-09: prevalece
  if (waitingEndsOn !== null && date < waitingEndsOn) return "WAITING_PERIOD";
  if (hasUsage && left === 0) return "LIMIT_EXHAUSTED";
  return "COVERED";
}

export function evaluateCoverage(plan: CoveragePlan, beneficiary: CoverageBeneficiary, service: CoverageService, date: string, options: CoverageOptions = {}): CoverageDecision {
  const line = plan.coverages.find((c) => c.serviceId === service.id);
  const waitingDays = line?.waitingDays ?? 0;
  const waitingEndsOn = line !== undefined && waitingDays > 0 && beneficiary.policy !== null ? addDays(beneficiary.policy.validFrom, waitingDays) : null;
  const limit = line?.limitPerYearMinor ?? null;
  const left = remaining(limit, options.usage);
  const reason = reasonFor(beneficiary, service, line, waitingEndsOn, date, left, options.usage !== undefined);
  const covered = reason === "COVERED";
  const copayPct = line?.copayPct ?? 0;

  const decision: CoverageDecision = {
    covered,
    reason,
    copayPct,
    requiresAuthorization: line?.requiresAuthorization ?? false,
    waitingDays,
    waitingEndsOn,
    limitPerYearMinor: limit,
    remainingMinor: left,
  };
  if (options.amountMinor !== undefined) {
    const total = options.amountMinor;
    const share = covered ? Math.min(insurerShare(total, copayPct), left ?? total) : 0;
    decision.insurerShareMinor = share;
    decision.patientShareMinor = total - share;
  }
  return decision;
}
