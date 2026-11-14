// Elegibilidade e resposta mínima à clínica (UC-SEG-05, BR-SEG-01/02/04/18/23). Regras puras.
// A decisão de elegibilidade/cobertura vive só em `coverage.ts` (BR-SEG-41); aqui ficam o pedido, a resposta mínima e mapeadores.
import { evaluateCoverage, type CoverageBeneficiary, type CoverageDecision, type CoveragePlan } from "./coverage.js";
import { fail, requireText } from "./validation.js";

export { addDays } from "./validation.js";

/** BR-SEG-18/§7 do recorte: verificação de cobertura, não garantia de pagamento (até existir S4). */
export const ELIGIBILITY_NOTICE = "Verificação de cobertura; não constitui garantia de pagamento.";

export interface EligibilityRequest {
  by: { kind: "CARD"; cardNumber: string } | { kind: "QR"; token: string } | { kind: "DOCUMENT"; type: string; number: string };
  serviceCode: string | null;
}

/** BR-SEG-18: exatamente um de `cardNumber`, `qrToken`, `idDocument` (senão `VALIDATION_ERROR`). */
export function parseEligibilityRequest(input: { cardNumber?: unknown; qrToken?: unknown; idDocument?: unknown; serviceCode?: unknown }): EligibilityRequest {
  const present = [input.cardNumber, input.qrToken, input.idDocument].filter((v) => v !== undefined && v !== null).length;
  if (present !== 1) fail("cardNumber", "indique exatamente um de cardNumber, qrToken ou idDocument");
  const serviceCode = input.serviceCode === undefined || input.serviceCode === null ? null : requireText(input.serviceCode, "serviceCode", 40);
  if (input.cardNumber !== undefined && input.cardNumber !== null) return { by: { kind: "CARD", cardNumber: requireText(input.cardNumber, "cardNumber", 60).toUpperCase() }, serviceCode };
  if (input.qrToken !== undefined && input.qrToken !== null) return { by: { kind: "QR", token: requireText(input.qrToken, "qrToken", 2000) }, serviceCode };
  const doc = input.idDocument as { type?: unknown; number?: unknown } | null;
  if (typeof doc !== "object" || doc === null) fail("idDocument", "objeto {type, number}");
  return { by: { kind: "DOCUMENT", type: requireText(doc.type, "idDocument.type", 40).toUpperCase(), number: requireText(doc.number, "idDocument.number", 60) }, serviceCode };
}

export interface CoverageRowForEligibility {
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  copayPct: number;
  limitPerYear: number | null;
  waitingDays: number;
  requiresAuthorization: boolean;
}

export interface CoverageLimits {
  serviceCode: string;
  serviceName: string;
  coveredNow: boolean;
  copayPct: number;
  limitPerYear: number | null;
  waitingDays: number;
  waitingEndsOn: string | null;
  requiresAuthorization: boolean;
}

/** Mapeador `CoverageDecision → CoverageLimits` (sem regras; a decisão é de `coverage.ts`, BR-SEG-41). */
export function toCoverageLimits(row: CoverageRowForEligibility, decision: CoverageDecision): CoverageLimits {
  return {
    serviceCode: row.serviceCode,
    serviceName: row.serviceName,
    // Contrato atual (ADR-033 §3): `coveredNow` = «fora de carência»; endurecer fica para decisão futura do proprietário.
    coveredNow: decision.reason !== "WAITING_PERIOD",
    copayPct: decision.copayPct,
    limitPerYear: decision.limitPerYearMinor === null ? null : decision.limitPerYearMinor / 100,
    waitingDays: decision.waitingDays,
    waitingEndsOn: decision.waitingEndsOn,
    requiresAuthorization: decision.requiresAuthorization,
  };
}

/** Limites de cada cobertura do plano para um beneficiário numa data: uma chamada a `evaluateCoverage` por linha. */
export function coverageLimitsFor(rows: CoverageRowForEligibility[], beneficiary: CoverageBeneficiary, date: string): CoverageLimits[] {
  const plan: CoveragePlan = {
    coverages: rows.map((r) => ({ serviceId: r.serviceId, type: r.limitPerYear === null ? "INCLUDED" : "LIMITED", copayPct: r.copayPct, limitPerYearMinor: r.limitPerYear === null ? null : Math.round(r.limitPerYear * 100), waitingDays: r.waitingDays, requiresAuthorization: r.requiresAuthorization })),
  };
  return rows.map((row) => toCoverageLimits(row, evaluateCoverage(plan, beneficiary, { id: row.serviceId, status: "ACTIVE" }, date)));
}

export interface EligibleResult {
  eligible: true;
  notice: string;
  beneficiaryName: string;
  status: "ACTIVE";
  planName: string;
  validFrom: string;
  validTo: string;
  currency: string;
  coverages: CoverageLimits[];
}

/** Resposta única para inexistente, inelegível ou QR inválido/expirado/revogado/de outra seguradora (BR-SEG-18). */
export const NOT_ELIGIBLE_RESULT = { eligible: false as const, notice: ELIGIBILITY_NOTICE };
export type EligibilityResult = typeof NOT_ELIGIBLE_RESULT | EligibleResult;
