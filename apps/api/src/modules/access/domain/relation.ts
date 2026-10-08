// Relação do actor com o sujeito (authorization.md §2 passo 5). Puro: a resolução de qual relação
// se aplica (consultar tutela, pertença) é feita em `application/policy.ts` (precisa de I/O via
// `FamiliesPort`); aqui só o tipo e o único passo sem I/O (SELF vs. DEPENDENT_SELF depende apenas
// de `isDependent`, já resolvido).
export type Relation = "SELF" | "TUTOR_OF" | "DEPENDENT_SELF" | "OTHER";

/**
 * O actor é o próprio sujeito: `SELF` se não for dependente, `DEPENDENT_SELF` se for (qualquer
 * idade — authorization.md §3 nota: "o que define é ser dependente, não ser menor").
 */
export function resolveSelfRelation(subjectIsDependent: boolean): "SELF" | "DEPENDENT_SELF" {
  return subjectIsDependent ? "DEPENDENT_SELF" : "SELF";
}
