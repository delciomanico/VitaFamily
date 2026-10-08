// Regras puras do registo (BR-ACC-02/04, UC-ACC-01). Duplicam pequenos utilitários já existentes
// em `modules/users/domain/user.ts` de propósito: a superfície que `auth` pode importar de `users`
// é só a exposta pela raiz (createAccount/byEmail/byId/setEmailVerified/setPasswordHash —
// CLAUDE.md M1 §3); duplicar 5 linhas puras é mais barato do que acoplar os dois módulos por um
// detalhe de validação.
import { ValidationError } from "../../../platform/errors/index.js";

export const MIN_SELF_REGISTRATION_AGE = 18;

/** Idade em anos completos de `birthDate` (YYYY-MM-DD) em `referenceDate`. */
export function ageInYears(birthDate: string, referenceDate: Date): number {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  let age = referenceDate.getUTCFullYear() - birth.getUTCFullYear();
  const referenceMonthDay = referenceDate.getUTCMonth() * 100 + referenceDate.getUTCDate();
  const birthMonthDay = birth.getUTCMonth() * 100 + birth.getUTCDate();
  if (referenceMonthDay < birthMonthDay) {
    age -= 1;
  }
  return age;
}

export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new ValidationError([{ field: "timezone", message: "fuso horário inválido" }], {
      detail: "Fuso horário inválido.",
    });
  }
}

export function assertValidBirthDate(birthDate: string, referenceDate: Date): void {
  const date = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ field: "birthDate", message: "data inválida" }], {
      detail: "Data de nascimento inválida.",
    });
  }
  if (date.getTime() > referenceDate.getTime()) {
    throw new ValidationError([{ field: "birthDate", message: "não pode ser futura" }], {
      detail: "Data de nascimento inválida.",
    });
  }
}
