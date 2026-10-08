// Matriz de dados de saúde (authorization.md §3, permissions.md §2-3) — DADOS, transcrita uma vez
// a partir dos documentos; `decideCategory`/`isActionAllowed` só fazem a leitura/mapeamento
// (conventions.md §4: "a matriz de autorização é dados"). Puro, sem I/O.
import type { Relation } from "./relation.js";
import type { DataCategory } from "./sharing-grant.js";

export type HealthAction = "READ" | "CREATE" | "UPDATE" | "DELETE" | "CONFIRM_DOSE";

export interface CategoryDecision {
  read: boolean;
  write: boolean;
  confirmDose: boolean;
}

const FULL_ACCESS: CategoryDecision = { read: true, write: true, confirmDose: true };
const NO_ACCESS: CategoryDecision = { read: false, write: false, confirmDose: false };

/**
 * authorization.md §3: SELF (adulto) e TUTOR_OF têm acesso total a todas as categorias.
 * DEPENDENT_SELF: permissions.md §3 (célula resolvida) — MEDICATION e APPOINTMENTS legíveis,
 * confirmar toma só em MEDICATION, nunca escrever. OTHER (incl. Family Admin não tutor): resolvido
 * por concessão ativa (`hasGrant`), nunca escrita/confirmação — ver `decideCategory`.
 */
export const RELATION_CATEGORY_RULES: Record<Exclude<Relation, "OTHER">, Record<DataCategory, CategoryDecision>> = {
  SELF: {
    ALLERGIES: FULL_ACCESS,
    CONDITIONS: FULL_ACCESS,
    MEDICATION: FULL_ACCESS,
    APPOINTMENTS: FULL_ACCESS,
    EXAMS: FULL_ACCESS,
  },
  TUTOR_OF: {
    ALLERGIES: FULL_ACCESS,
    CONDITIONS: FULL_ACCESS,
    MEDICATION: FULL_ACCESS,
    APPOINTMENTS: FULL_ACCESS,
    EXAMS: FULL_ACCESS,
  },
  DEPENDENT_SELF: {
    ALLERGIES: NO_ACCESS,
    CONDITIONS: NO_ACCESS,
    MEDICATION: { read: true, write: false, confirmDose: true },
    APPOINTMENTS: { read: true, write: false, confirmDose: false },
    EXAMS: NO_ACCESS,
  },
};

/**
 * Decisão para `relation`/`category`; `hasGrant` só importa para `OTHER` (authorization.md §3: "só
 * categorias com SharingGrant ativo do sujeito -> actor ou -> toda a família"; sempre leitura).
 */
export function decideCategory(relation: Relation, category: DataCategory, hasGrant: boolean): CategoryDecision {
  if (relation === "OTHER") {
    return { read: hasGrant, write: false, confirmDose: false };
  }
  return RELATION_CATEGORY_RULES[relation][category];
}

/** Mapeia a ação pedida para o campo da decisão (authorization.md §3: colunas Ler/Criar-Editar-Eliminar/Confirmar). */
export function isActionAllowed(relation: Relation, category: DataCategory, hasGrant: boolean, action: HealthAction): boolean {
  const decision = decideCategory(relation, category, hasGrant);
  switch (action) {
    case "READ":
      return decision.read;
    case "CREATE":
    case "UPDATE":
    case "DELETE":
      return decision.write;
    case "CONFIRM_DOSE":
      return decision.confirmDose;
    default:
      return false;
  }
}

export const RELATIONS: readonly Relation[] = ["SELF", "TUTOR_OF", "DEPENDENT_SELF", "OTHER"];
export const HEALTH_ACTIONS: readonly HealthAction[] = ["READ", "CREATE", "UPDATE", "DELETE", "CONFIRM_DOSE"];
