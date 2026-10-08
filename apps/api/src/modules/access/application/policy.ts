// `AccessPolicy.can()` — ÚNICA fonte de autorização (conventions.md §2, modules.md §2, ADR-008).
// Implementa authorization.md §2 (algoritmo) nos passos que cabem a `access`: o passo 1 (conta
// ativa/termos, B6) já é resolvido pelo middleware de `auth` antes do pedido chegar aqui
// (`platform/actor`); os passos 2/3/5/6/7 são decididos nesta função. O passo 4 (ações
// estruturais de `families` — convites, papéis, nome da família) e as invariantes de
// `FamilyMember`/`Guardianship` continuam em `families/application/membership.ts` (ver nota em
// `families/index.ts`): não há ciclo possível (`access` depende de `families`, nunca o inverso),
// e authorization.md §4 trata-as numa tabela separada da matriz de categorias (§3) — só a partilha
// (`MANAGE_SHARING`, também em §4) e os dados de saúde por categoria (§3) são decisão de
// `AccessPolicy`. Módulos de saúde (M4+) chamam `can()` passando só identificadores: é esta função
// que resolve pertença/relação via `FamiliesPort` (API pública de `families`).
import { DomainError, ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import { isActionAllowed, type HealthAction } from "../domain/category-matrix.js";
import { resolveSelfRelation, type Relation } from "../domain/relation.js";
import type { DataCategory } from "../domain/sharing-grant.js";
import type { AccessDeps, MemberFacts } from "./ports.js";

/** authorization.md §1 (ações sobre dados de saúde) + §4 (partilha) + VIEW_SHARED_WITH_ME (UC-PRV-02). */
export type Action = HealthAction | "MANAGE_SHARING" | "VIEW_SHARED_WITH_ME";

export interface CanInput {
  userId: string;
  platformAdmin: boolean;
  familyId: string;
  action: Action;
  /** Obrigatório exceto em `VIEW_SHARED_WITH_ME` (não incide sobre um único sujeito). */
  subjectMemberId?: string;
  /** Obrigatório para `HealthAction` (READ/CREATE/UPDATE/DELETE/CONFIRM_DOSE). */
  category?: DataCategory;
}

/**
 * Factos já resolvidos por `can()` — devolvidos em caso de ALLOW para quem chamou não repetir as
 * mesmas consultas (authorization.md §5.4: a decisão de visibilidade calcula-se uma vez).
 */
export interface AccessContext {
  actor: MemberFacts;
  subject?: MemberFacts;
  relation?: Relation;
}

function isHealthAction(action: Action): action is HealthAction {
  return action !== "MANAGE_SHARING" && action !== "VIEW_SHARED_WITH_ME";
}

export interface AccessPolicy<Trx> {
  /** Lança `NotFoundError`/`ForbiddenError`/`DomainError("MEMBER_BLOCKED")` em DENY; devolve o contexto resolvido em ALLOW. */
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

export function createAccessPolicy<Trx>(deps: Pick<AccessDeps<Trx>, "familiesPort" | "sharingGrantsRepo">): AccessPolicy<Trx> {
  async function can(trx: Trx, input: CanInput): Promise<AccessContext> {
    // 2. Platform Admin: nunca acede a dados de saúde nem gere partilha (BR-PRV-07/D4).
    if (input.platformAdmin) {
      throw new ForbiddenError({ detail: "Platform Admin não acede a dados de saúde." });
    }

    // 3. Pertença: FamilyMember com conta ligada na família do pedido; senão NOT_FOUND (nunca
    // revela se a família existe ou só não é membro — mesma regra de `families/membership.ts`).
    const actor = await deps.familiesPort.findMemberByUserId(trx, input.familyId, input.userId);
    if (!actor) {
      throw new NotFoundError({ detail: "Família não encontrada." });
    }

    if (input.action === "VIEW_SHARED_WITH_ME") {
      return { actor };
    }

    if (!input.subjectMemberId) {
      throw new DomainError("INTERNAL_ERROR", { detail: "subjectMemberId obrigatório para esta ação." });
    }

    const subject =
      input.subjectMemberId === actor.id
        ? actor
        : await deps.familiesPort.findMemberById(trx, input.familyId, input.subjectMemberId);
    if (!subject) {
      throw new NotFoundError({ detail: "Membro não encontrado." });
    }

    // 7. Sujeito bloqueado: DENY para todos (MEMBER_BLOCKED) — `access` não lida com as exceções de
    // estrutura do Admin (fora do seu âmbito, authorization.md §2 passo 7).
    if (subject.status === "BLOCKED") {
      throw new DomainError("MEMBER_BLOCKED", { detail: "Perfil bloqueado." });
    }

    // 5. Relação do actor com o sujeito.
    let relation: Relation;
    if (subject.id === actor.id) {
      relation = resolveSelfRelation(subject.isDependent);
    } else if (await deps.familiesPort.isGuardianOf(trx, input.familyId, subject.id, actor.id)) {
      relation = "TUTOR_OF";
    } else {
      relation = "OTHER";
    }

    if (input.action === "MANAGE_SHARING") {
      // authorization.md §4: "Definir partilha: SELF (adulto) ou tutor (dependente)".
      if (relation === "SELF" || relation === "TUTOR_OF") {
        return { actor, subject, relation };
      }
      throw new ForbiddenError({ detail: "Sem permissão para gerir a partilha deste membro." });
    }

    if (!input.category) {
      throw new DomainError("INTERNAL_ERROR", { detail: "category obrigatória para esta ação." });
    }

    // 6. Matriz de categorias (authorization.md §3) — `hasGrant` só interessa à relação OTHER.
    const hasGrant =
      relation === "OTHER"
        ? await deps.sharingGrantsRepo.hasGrant(trx, input.familyId, subject.id, actor.id, input.category)
        : false;

    if (isHealthAction(input.action) && !isActionAllowed(relation, input.category, hasGrant, input.action)) {
      throw new ForbiddenError({ detail: "Sem permissão sobre esta categoria." });
    }

    return { actor, subject, relation };
  }

  return { can };
}
