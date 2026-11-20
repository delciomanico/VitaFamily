// Fonte `recordShares` da exportação do titular (BR-MKT-76, UC-MKT-58, TC-MKT-131). Mesma autorização da família
// (`SHARE_WITH_PROFESSIONALS`: só SELF/TUTOR_OF; relação insuficiente ⇒ lança e o `lifecycle` omite a secção). Só o que o titular já vê:
// partilhas e vistas SEM conteúdo dos registos, sem rótulo nem ids de utilizador/autoria.
import { deriveShareStatus } from "../domain/index.js";
import type { ActorIdentity, RecordSharingDeps } from "./ports.js";

const PAGE = 100;

export function createExportRecordShares<Trx>(deps: Pick<RecordSharingDeps<Trx>, "withTransaction" | "clock" | "access" | "professionals" | "shares">) {
  return async function exportRecordShares(actor: ActorIdentity, familyId: string, memberId: string): Promise<Record<string, unknown>[]> {
    const { now, records, viewsOf } = await deps.withTransaction(async (trx) => {
      await deps.access.assertCanShare(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
      const now = deps.clock.now();
      const records = [];
      let after: { createdAt: Date; id: string } | undefined;
      for (;;) {
        const rows = await deps.shares.list(trx, familyId, memberId, { limit: PAGE, now, ...(after ? { after } : {}) });
        records.push(...rows);
        const last = rows.at(-1);
        if (rows.length < PAGE || !last) break;
        after = { createdAt: last.createdAt, id: last.id };
      }
      // Vistas lidas na mesma transação; a identidade (outra ligação do pool) só depois de a fechar.
      const viewsOf = new Map<string, { viewNo: number; viewedAt: Date; categories: readonly string[] }[]>();
      for (const share of records) {
        const views = [];
        let before: number | undefined;
        for (;;) {
          const rows = await deps.shares.listViews(trx, share.id, PAGE, before);
          views.push(...rows);
          const last = rows.at(-1);
          if (rows.length < PAGE || !last) break;
          before = last.viewNo;
        }
        viewsOf.set(share.id, views);
      }
      return { now, records, viewsOf };
    });
    if (records.length === 0) return [];
    const identities = await deps.professionals.findIdentities([...new Set(records.map((r) => r.professionalId))]);
    const result: Record<string, unknown>[] = [];
    for (const share of records) {
      const views = viewsOf.get(share.id) ?? [];
      result.push({
        id: share.id,
        professional: identities.find((i) => i.id === share.professionalId)?.displayName ?? null,
        categories: [...share.categories],
        validity: share.validity,
        viewOnce: share.viewOnce,
        status: deriveShareStatus(share.status, share.expiresAt, now),
        expiresAt: share.expiresAt.toISOString(),
        revokedAt: share.revokedAt?.toISOString() ?? null,
        consumedAt: share.consumedAt?.toISOString() ?? null,
        createdAt: share.createdAt.toISOString(),
        views: views.map((v) => ({ viewNo: v.viewNo, viewedAt: v.viewedAt.toISOString(), categories: [...v.categories] })),
      });
    }
    return result;
  };
}
