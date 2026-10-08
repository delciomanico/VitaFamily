// Entidade User (entities.md "Identidade e acesso"; schema.md §1; BR-ACC-01..07). Tipo puro,
// sem I/O: validações de formato aqui; hashing de password e geração de tokens ficam no módulo
// `auth` (que é quem conhece argon2/jose — conventions.md §3.9).
import { ValidationError } from "../../../platform/errors/index.js";

export type UserStatus = "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";
export type PlatformRole = "NONE" | "PLATFORM_ADMIN";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  birthDate: string; // ISO date (YYYY-MM-DD), schema.md: `birth_date date`.
  timezone: string; // IANA (BR-ACC-04).
  status: UserStatus;
  platformRole: PlatformRole;
  emailVerifiedAt?: Date;
  termsAcceptedVersion: string;
  termsAcceptedAt: Date;
  suspendedAt?: Date;
  suspensionReason?: string;
  createdAt: Date;
}

/** Normaliza o e-mail (único, minúsculas — schema.md/entities.md). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Valida um identificador de fuso IANA (BR-ACC-04); lança `VALIDATION_ERROR` se inválido. */
export function assertValidTimezone(timezone: string): void {
  try {
    // `Intl` é global da plataforma (não é biblioteca de I/O) — forma padrão de validar IANA tz.
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new ValidationError([{ field: "timezone", message: "fuso horário inválido" }], {
      detail: "Fuso horário inválido.",
    });
  }
}

/** Idade em anos completos em `referenceDate`, no fuso do titular não é necessário aqui (datas). */
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

/** B6: versão de termos aceite difere da atual ⇒ reaceitação exigida (exceto rotas isentas). */
export function termsReacceptanceRequired(user: User, currentTermsVersion: string): boolean {
  return user.termsAcceptedVersion !== currentTermsVersion;
}
