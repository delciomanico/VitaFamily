// UC-ACC-05 Eliminar conta (FR-AUTH-05, BR-ACC-06/07, D15): confirmação por palavra-passe; recusada
// se o utilizador for o único tutor de um dependente (P8) ou o único Admin de uma família com
// outros membros (UC-FAM-07); famílias em que é o único membro são eliminadas (R2); nas outras
// sai-se com apagamento dos dados (R4). Depois apagam-se a conta, os pacotes de exportação e
// anonimizam-se os logs de auditoria. Todas as verificações correm ANTES de se apagar o que quer
// que seja, para uma recusa nunca deixar a eliminação a meio.
import { DomainError, UnauthenticatedError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ActorIdentity, ApiObject, LifecycleDeps, RequestContext } from "./ports.js";
import { str } from "./support.js";

interface Plan {
  familyId: string;
  action: "DELETE_FAMILY" | "LEAVE";
}

const blocked = (detail: string) => new DomainError("ACCOUNT_DELETION_BLOCKED", { detail });

export function createDeleteAccountUseCase<Trx>(deps: LifecycleDeps<Trx>) {
  async function plan(userId: string): Promise<Plan[]> {
    const plans: Plan[] = [];
    for (const family of await deps.sources.listFamilies(userId)) {
      const familyId = str(family, "id");
      const members: ApiObject[] = await deps.sources.listMembers(userId, familyId);
      const me = members.find((m) => m.isSelf === true);
      if (!me) continue;
      const others = members.filter((m) => m !== me);
      if (others.length === 0) {
        plans.push({ familyId, action: "DELETE_FAMILY" });
        continue;
      }
      if (me.isDependent === true) {
        throw blocked("Uma conta de dependente é eliminada pelo tutor ou pelo Family Admin.");
      }
      if (me.role === "FAMILY_ADMIN" && !others.some((m) => m.role === "FAMILY_ADMIN")) {
        throw blocked("É o único Family Admin: atribua o papel a outro adulto antes de eliminar a conta.");
      }
      const meId = str(me, "id");
      const sole = others.some((m) => {
        const guardians = Array.isArray(m.guardianIds) ? (m.guardianIds as unknown[]) : [];
        return guardians.includes(meId) && guardians.length === 1;
      });
      if (sole) {
        throw blocked("É o único tutor de um dependente: atribua outro tutor antes de eliminar a conta.");
      }
      plans.push({ familyId, action: "LEAVE" });
    }
    return plans;
  }

  return async function deleteAccount(actor: ActorIdentity, password: string, context: RequestContext): Promise<void> {
    if (!(await deps.account.verifyPassword(actor.userId, password))) {
      throw new UnauthenticatedError({ detail: "Palavra-passe incorreta." });
    }
    const plans = await plan(actor.userId);

    for (const step of plans) {
      if (step.action === "DELETE_FAMILY") await deps.account.deleteFamily(actor.userId, step.familyId, context);
      else await deps.account.leaveFamily(actor.userId, step.familyId, context);
    }

    const keys = await deps.withTransaction((trx) => deps.exportsRepo.listStorageKeysByUser(trx, actor.userId));
    await deps.withTransaction(async (trx) => {
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "USER_DELETE",
        resourceType: "User",
        resourceId: actor.userId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      await deps.account.deleteAccount(trx, actor.userId);
    });
    // Depois do commit: os pacotes de exportação saem do armazenamento (melhor esforço — são
    // privados e já sem dono) e os logs ficam anonimizados (BR-ACC-07).
    await Promise.all(keys.map((key) => deps.storage.deleteObject(key).catch(() => undefined)));
    await deps.account.anonymizeAudit(actor.userId);
  };
}
