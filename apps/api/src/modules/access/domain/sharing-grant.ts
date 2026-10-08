// Entidade pura `SharingGrant` (entities.md/relationships.md) e categorias de dados de saúde
// (permissions.md §1: C2 Alergias e tipo sanguíneo .. C6 Exames — C1 Identificação é sempre
// visível, não é uma categoria de partilha, BR-PRV-10). Sem I/O.

/** `permissions.md` §1 (C2..C6); C1 (nome/data de nascimento) não é partilha opcional. */
export type DataCategory = "ALLERGIES" | "CONDITIONS" | "MEDICATION" | "APPOINTMENTS" | "EXAMS";

export const DATA_CATEGORIES: readonly DataCategory[] = [
  "ALLERGIES",
  "CONDITIONS",
  "MEDICATION",
  "APPOINTMENTS",
  "EXAMS",
];

/** `sharing_grants` (schema.md §2). `granteeMemberId` ausente = toda a família (DM3). */
export interface SharingGrant {
  id: string;
  familyId: string;
  ownerMemberId: string;
  granteeMemberId?: string;
  category: DataCategory;
  grantedBy?: string;
  createdAt: Date;
}
