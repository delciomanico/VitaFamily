// Elegibilidade e resposta mínima à clínica (UC-SEG-05, BR-SEG-01/02/04/18/23). Regras puras.
// Elegível ⇔ beneficiário ACTIVE e apólice ACTIVE e hoje dentro de validFrom..validTo (BR-SEG-01). Sem saldo «usado» (D-A2).
import { fail, isIsoDate, requireText } from "./validation.js";

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

/** Soma `days` dias a uma data `AAAA-MM-DD` (UTC; sem fusos). */
export function addDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate)) throw new Error("data inválida");
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface PolicyWindow {
  status: string;
  validFrom: string;
  validTo: string;
}

/** BR-SEG-01. As datas são de calendário (`AAAA-MM-DD`), comparáveis como texto. */
export function isEligible(beneficiaryStatus: string, policy: PolicyWindow | null, today: string): boolean {
  return beneficiaryStatus === "ACTIVE" && policy !== null && policy.status === "ACTIVE" && policy.validFrom <= today && today <= policy.validTo;
}

export interface CoverageRowForEligibility {
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

/** BR-SEG-04: dentro de `waitingDays` desde `validFrom` o serviço não está coberto (`coveredNow=false`). */
export function toCoverageLimits(row: CoverageRowForEligibility, validFrom: string, today: string): CoverageLimits {
  const waitingEndsOn = row.waitingDays > 0 ? addDays(validFrom, row.waitingDays) : null;
  return {
    serviceCode: row.serviceCode,
    serviceName: row.serviceName,
    coveredNow: waitingEndsOn === null || today >= waitingEndsOn,
    copayPct: row.copayPct,
    limitPerYear: row.limitPerYear,
    waitingDays: row.waitingDays,
    waitingEndsOn,
    requiresAuthorization: row.requiresAuthorization,
  };
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
