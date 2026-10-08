// Entidade pura `Family` (entities.md "Família"): fronteira de isolamento (BR-FAM-03, ADR-008).
// Sem regras de negócio complexas aqui — a estrutura (membros, admins) vive em `member.ts`.

/** BR-FAM-07/B4: máximo de famílias por User. */
export const MAX_FAMILIES_PER_USER = 5;

export interface Family {
  id: string;
  name: string;
  createdBy?: string;
  createdAt: Date;
}
