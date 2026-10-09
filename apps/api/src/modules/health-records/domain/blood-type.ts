// `BloodType` (entities.md: campo de `FamilyMember`, categoria C2 — mesma matriz de ALLERGIES).
// Duplica o tipo de `families/domain/member.ts` de propósito: módulos só se importam pela raiz
// (mesmo critério de `auth/domain/registration-rules.ts`); aqui só o valor, nunca a tabela.
export type BloodType = "A_POS" | "A_NEG" | "B_POS" | "B_NEG" | "AB_POS" | "AB_NEG" | "O_POS" | "O_NEG" | "UNKNOWN";

/** Sentinela quando `family_members.blood_type` ainda não foi definido (nunca `null` na API). */
export const UNKNOWN_BLOOD_TYPE: BloodType = "UNKNOWN";
