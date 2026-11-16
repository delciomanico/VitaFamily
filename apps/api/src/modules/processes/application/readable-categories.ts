// Decisão de leitura por categoria da origem (authorization.md §6.8, BR-PRC-05): `AccessPolicy.can(READ, categoria)`
// uma vez por pedido e categoria. A origem `AUTHORIZATION` (arquivo do marco B) não tem categoria: nunca é legível.
// Única fonte de autorização: nada de ifs de permissão fora de `access`.
import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import type { Relation } from "../../access/index.js";
import { categoryOfOrigin, PROCESS_ORIGIN_TYPES, type OriginCategory, type ProcessOriginType } from "../domain/process.js";
import type { ActorIdentity, ProcessesDeps } from "./ports.js";

export interface ReadAccess {
  /** Origens que o ator pode ler (consulta ⇒ APPOINTMENTS, exame ⇒ EXAMS). Pode ser vazio (lista filtra, BR-PRC-05). */
  readableOrigins: ProcessOriginType[];
  /** `undefined` só se nenhuma categoria foi permitida. */
  relation: Relation | undefined;
}

const CATEGORIES: readonly OriginCategory[] = ["APPOINTMENTS", "EXAMS"];

export async function resolveReadAccess<Trx>(deps: ProcessesDeps<Trx>, trx: Trx, actor: ActorIdentity, familyId: string, memberId: string): Promise<ReadAccess> {
  const allowed = new Set<OriginCategory>();
  let relation: Relation | undefined;
  for (const category of CATEGORIES) {
    try {
      const context = await deps.policy.can(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, subjectMemberId: memberId, action: "READ", category });
      allowed.add(category);
      relation = context.relation;
    } catch (error) {
      if (error instanceof ForbiddenError) {
        // Platform Admin nunca lê saúde e não pode sondar a existência (authorization.md §6.8): 404.
        if (actor.platformAdmin) throw new NotFoundError({ detail: "Processo não encontrado." });
        continue;
      }
      // NOT_FOUND (família/membro) e MEMBER_BLOCKED propagam.
      throw error;
    }
  }
  return { readableOrigins: PROCESS_ORIGIN_TYPES.filter((type) => { const category = categoryOfOrigin(type); return category !== undefined && allowed.has(category); }), relation };
}

/** audit.md §3 / BR-PRC-11: só a leitura por quem não é o titular (tutor ou `OTHER` com partilha) é auditada. */
export function isAuditedReader(relation: Relation | undefined): boolean {
  return relation === "TUTOR_OF" || relation === "OTHER";
}
