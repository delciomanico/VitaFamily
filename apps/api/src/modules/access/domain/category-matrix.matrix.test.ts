// Matriz de testes de autorização (conventions.md §4, authorization.md §6: "os testes de
// autorização são gerados a partir da matriz"). A tabela `GOLDEN_CASES` é transcrita
// independentemente de `RELATION_CATEGORY_RULES` (authorization.md §3 + permissions.md §2-3) para
// servir de proteção contra deriva: se a implementação se desviar da documentação, um destes casos
// falha. Adicionar categoria/ação sem atualizar aqui e em authorization.md §3 falha a CI.
import { describe, expect, it } from "vitest";
import { decideCategory, isActionAllowed, type HealthAction } from "./category-matrix.js";
import type { Relation } from "./relation.js";
import { DATA_CATEGORIES, type DataCategory } from "./sharing-grant.js";

interface GoldenCase {
  relation: Relation;
  category: DataCategory;
  /** Só relevante para `OTHER`. */
  hasGrant: boolean;
  read: boolean;
  write: boolean;
  confirmDose: boolean;
}

const GOLDEN_CASES: GoldenCase[] = [];

// SELF (adulto) e TUTOR_OF: acesso total a todas as categorias (authorization.md §3).
for (const relation of ["SELF", "TUTOR_OF"] as const) {
  for (const category of DATA_CATEGORIES) {
    GOLDEN_CASES.push({ relation, category, hasGrant: false, read: true, write: true, confirmDose: true });
  }
}

// DEPENDENT_SELF: permissions.md §3 célula resolvida — "C1 V · C2 ❌ · C3 ❌ · C4 V + confirmar
// toma · C5 V · C6 ❌" (C1 identificação fica fora deste catálogo, BR-PRV-10).
GOLDEN_CASES.push(
  { relation: "DEPENDENT_SELF", category: "ALLERGIES", hasGrant: false, read: false, write: false, confirmDose: false },
  { relation: "DEPENDENT_SELF", category: "CONDITIONS", hasGrant: false, read: false, write: false, confirmDose: false },
  { relation: "DEPENDENT_SELF", category: "MEDICATION", hasGrant: false, read: true, write: false, confirmDose: true },
  { relation: "DEPENDENT_SELF", category: "APPOINTMENTS", hasGrant: false, read: true, write: false, confirmDose: false },
  { relation: "DEPENDENT_SELF", category: "EXAMS", hasGrant: false, read: false, write: false, confirmDose: false },
);

// OTHER (incl. Family Admin não tutor): só leitura, só com concessão ativa, nunca escrita/confirmação.
for (const category of DATA_CATEGORIES) {
  GOLDEN_CASES.push({ relation: "OTHER", category, hasGrant: true, read: true, write: false, confirmDose: false });
  GOLDEN_CASES.push({ relation: "OTHER", category, hasGrant: false, read: false, write: false, confirmDose: false });
}

describe("category-matrix (authorization.md §3, permissions.md §2-3)", () => {
  it.each(GOLDEN_CASES)(
    "$relation / $category (hasGrant=$hasGrant) -> read=$read write=$write confirmDose=$confirmDose",
    ({ relation, category, hasGrant, read, write, confirmDose }) => {
      expect(decideCategory(relation, category, hasGrant)).toEqual({ read, write, confirmDose });
    },
  );

  const actionField: Record<HealthAction, keyof Pick<GoldenCase, "read" | "write" | "confirmDose">> = {
    READ: "read",
    CREATE: "write",
    UPDATE: "write",
    DELETE: "write",
    CONFIRM_DOSE: "confirmDose",
  };

  it.each(
    GOLDEN_CASES.flatMap((goldenCase) =>
      (Object.keys(actionField) as HealthAction[]).map((action) => ({
        ...goldenCase,
        action,
        expected: goldenCase[actionField[action]],
      })),
    ),
  )(
    "isActionAllowed($relation, $category, hasGrant=$hasGrant, $action) === $expected",
    ({ relation, category, hasGrant, action, expected }) => {
      expect(isActionAllowed(relation, category, hasGrant, action)).toBe(expected);
    },
  );

  it("cobre as 5 categorias declaradas em authorization.md §3/permissions.md §1 (C2..C6)", () => {
    expect(DATA_CATEGORIES).toEqual(["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"]);
  });
});
