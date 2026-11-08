// Regras puras do consentimento por clínica (BR-CLN-19, entities.md `ClinicConsent`). Sem I/O.
import { ValidationError } from "../../../platform/errors/index.js";

export type ClinicConsentLevel = "BOOKINGS" | "HISTORY";

export interface ClinicConsent {
  clinicId: string;
  familyId: string;
  memberId: string;
  level: ClinicConsentLevel;
  historyValidUntil?: Date;
}

/** BR-CLN-19: `HISTORY` vale 12 meses a partir de cada `PUT` (meses civis, UTC). */
export const HISTORY_VALIDITY_MONTHS = 12;

export function historyValidUntil(now: Date): Date {
  const until = new Date(now.getTime());
  until.setUTCMonth(until.getUTCMonth() + HISTORY_VALIDITY_MONTHS);
  return until;
}

export function parseConsentLevel(value: unknown): ClinicConsentLevel {
  if (value === "BOOKINGS" || value === "HISTORY") return value;
  throw new ValidationError([{ field: "level", message: "tem de ser BOOKINGS ou HISTORY" }], { detail: "Nível de consentimento inválido." });
}

export interface EffectiveConsent {
  level: ClinicConsentLevel;
  /** Fim da validade do `HISTORY` efetivo; nulo em `BOOKINGS`. */
  validUntil: Date | null;
  /** `true` se o `HISTORY` expirou (a app mostra "renovar"). */
  renewalNeeded: boolean;
}

/** Nível efetivo calculado em consulta, sem job: `HISTORY` só enquanto `historyValidUntil > now` (BR-CLN-19). */
export function effectiveConsent(consent: Pick<ClinicConsent, "level" | "historyValidUntil">, now: Date): EffectiveConsent {
  if (consent.level === "HISTORY" && consent.historyValidUntil !== undefined) {
    if (consent.historyValidUntil.getTime() > now.getTime()) {
      return { level: "HISTORY", validUntil: consent.historyValidUntil, renewalNeeded: false };
    }
    return { level: "BOOKINGS", validUntil: null, renewalNeeded: true };
  }
  return { level: "BOOKINGS", validUntil: null, renewalNeeded: false };
}
