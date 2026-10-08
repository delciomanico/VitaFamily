// Entidade pura `FamilyMember` (entities.md) e regras de idade (BR-MEM-01/02). Duplica
// pequenos utilitários de idade/data já existentes em `auth`/`users` de propósito: módulos só se
// importam pela raiz (ver auth/domain/registration-rules.ts, mesma justificação).
import { ValidationError } from "../../../platform/errors/index.js";

/** BR-MEM-02/M1: idade a partir da qual um FamilyMember é adulto. */
export const MIN_ADULT_AGE = 18;
/** BR-MEM-01 [PROPOSTO]: data de nascimento não pode implicar mais de 120 anos. */
export const MAX_MEMBER_AGE_YEARS = 120;
/** BR-FAM-07/B4: máximo de membros por família. */
export const MAX_MEMBERS_PER_FAMILY = 20;
/** B3: idade mínima para conta de dependente (acesso limitado). */
export const MIN_DEPENDENT_ACCOUNT_AGE = 13;

export type FamilyRole = "FAMILY_ADMIN" | "FAMILY_MEMBER";
export type MemberStatus = "ACTIVE" | "BLOCKED";

export interface FamilyMember {
  id: string;
  familyId: string;
  /** Sem conta quando `undefined` (perfil criado por um Admin, schema.md). */
  userId?: string;
  name: string;
  birthDate: string;
  /** Só com conta (schema.md CHECK `role IS NULL OR user_id IS NOT NULL`). */
  role?: FamilyRole;
  isDependent: boolean;
  status: MemberStatus;
  scheduledDeletionAt?: Date;
  createdAt: Date;
}

/** Idade em anos completos de `birthDate` (YYYY-MM-DD) em `referenceDate` (UTC). */
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

/** BR-MEM-02: menor = idade <18. */
export function isMinor(birthDate: string, referenceDate: Date): boolean {
  return ageInYears(birthDate, referenceDate) < MIN_ADULT_AGE;
}

/** Derivado (entities.md): tem conta ligada. */
export function hasAccount(member: Pick<FamilyMember, "userId">): boolean {
  return member.userId !== undefined;
}

/** BR-MEM-01: não futura, não implica mais de `MAX_MEMBER_AGE_YEARS` anos. */
export function assertValidBirthDate(birthDate: string, referenceDate: Date, field = "birthDate"): void {
  const date = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ field, message: "data inválida" }], {
      detail: "Data de nascimento inválida.",
    });
  }
  if (date.getTime() > referenceDate.getTime()) {
    throw new ValidationError([{ field, message: "não pode ser futura" }], {
      detail: "Data de nascimento inválida.",
    });
  }
  if (ageInYears(birthDate, referenceDate) > MAX_MEMBER_AGE_YEARS) {
    throw new ValidationError([{ field, message: "implica mais de 120 anos" }], {
      detail: "Data de nascimento inválida.",
    });
  }
}

/** BR-MEM-05: tutor é adulto, com conta (a pertença à mesma família é validada pelo repositório). */
export function isEligibleGuardian(member: FamilyMember, now: Date): boolean {
  return hasAccount(member) && !isMinor(member.birthDate, now);
}
