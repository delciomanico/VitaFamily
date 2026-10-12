// UC-ACC-06 Exportar os meus dados (FR-PRIV-05, N7, Q6, P2). O pedido responde 202; o pacote é
// gerado logo a seguir, no mesmo processo (modules.md §5 prevê um job `lifecycle.build-export` —
// ver README: desvio assumido enquanto o worker não monta os módulos de saúde). Um pedido que se
// perca (ex.: reinício) passa a FAILED ao fim de 15 min.
import { newId } from "../../../platform/ids/index.js";
import { DomainError, ForbiddenError, NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { EXPORTS_PER_DAY, effectiveStatus, exportExpiry, type DataExport } from "../domain/export.js";
import { buildExportPackage, type ExportScope } from "./build-package.js";
import type { ActorIdentity, LifecycleDeps, RequestContext } from "./ports.js";
import { exportKey, str } from "./support.js";

const DAY_MS = 86_400_000;

export interface DependentTarget {
  familyId: string;
  memberId: string;
}

export interface ExportView {
  id: string;
  status: ReturnType<typeof effectiveStatus>;
  reason: DataExport["reason"];
  requestedAt: Date;
  expiresAt?: Date;
}

function toView(item: DataExport, now: Date): ExportView {
  return {
    id: item.id,
    status: effectiveStatus(item, now),
    reason: item.reason,
    requestedAt: item.createdAt,
    ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
  };
}

export function createRequestExportUseCase<Trx>(deps: LifecycleDeps<Trx>) {
  async function build(actor: ActorIdentity, item: DataExport, scope: ExportScope, context: RequestContext): Promise<void> {
    try {
      const zip = await buildExportPackage(deps.sources, actor, scope, deps.clock.now(), context);
      const key = exportKey(item.id);
      await deps.storage.putObject(key, zip, "application/zip");
      await deps.withTransaction((trx) => deps.exportsRepo.markReady(trx, item.id, key, exportExpiry(deps.clock.now())));
    } catch (error) {
      deps.onBuildError(error, item.id);
      await deps.withTransaction((trx) => deps.exportsRepo.markFailed(trx, item.id)).catch((markError: unknown) => {
        deps.onBuildError(markError, item.id);
      });
    }
  }

  /** `target` presente = exportar um dependente (tutor, P2); ausente = os meus dados. */
  return async function requestExport(actor: ActorIdentity, target: DependentTarget | undefined, context: RequestContext): Promise<ExportView> {
    if (target) {
      const members = await deps.sources.listMembers(actor.userId, target.familyId);
      const me = members.find((m) => m.isSelf === true);
      const dependent = members.find((m) => str(m, "id") === target.memberId);
      if (!dependent) throw new NotFoundError();
      const guardianIds = Array.isArray(dependent.guardianIds) ? (dependent.guardianIds as unknown[]) : [];
      if (!me || !guardianIds.includes(me.id)) {
        throw new ForbiddenError({ detail: "Requer ser tutor do dependente." });
      }
    }

    const now = deps.clock.now();
    const item = await deps.withTransaction(async (trx) => {
      const recent = await deps.exportsRepo.countSince(trx, actor.userId, new Date(now.getTime() - DAY_MS));
      if (recent >= EXPORTS_PER_DAY) {
        throw new RateLimitedError(DAY_MS, { detail: "Limite de exportações por dia atingido." });
      }
      const created = await deps.exportsRepo.insert(trx, {
        id: newId(),
        requestedBy: actor.userId,
        reason: "USER_REQUEST",
        createdAt: now,
        ...(target ? { familyId: target.familyId, subjectMemberId: target.memberId } : {}),
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "USER_EXPORT_REQUEST",
        resourceType: "DataExport",
        resourceId: created.id,
        ...(target ? { familyId: target.familyId, subjectMemberId: target.memberId } : {}),
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      return created;
    });

    // Depois do commit: a resposta 202 não espera pela geração do pacote.
    void build(actor, item, target ? { family: target } : {}, context);
    return toView(item, now);
  };
}

export function createGetExportUseCase<Trx>(deps: LifecycleDeps<Trx>) {
  return async function getExport(actor: ActorIdentity, exportId: string): Promise<ExportView> {
    const now = deps.clock.now();
    const item = await deps.withTransaction(async (trx) => {
      const found = await deps.exportsRepo.findById(trx, exportId, actor.userId);
      if (!found) throw new NotFoundError();
      if (found.status === "PENDING" && effectiveStatus(found, now) === "FAILED") {
        await deps.exportsRepo.markFailed(trx, found.id);
        return { ...found, status: "FAILED" as const };
      }
      return found;
    });
    return toView(item, now);
  };
}

export function createDownloadExportUseCase<Trx>(deps: LifecycleDeps<Trx>) {
  return async function downloadExport(actor: ActorIdentity, exportId: string, context: RequestContext) {
    const now = deps.clock.now();
    const item = await deps.withTransaction(async (trx) => {
      const found = await deps.exportsRepo.findById(trx, exportId, actor.userId);
      if (!found) throw new NotFoundError();
      const status = effectiveStatus(found, now);
      if (status === "EXPIRED") throw new NotFoundError();
      if (status !== "READY" || !found.storageKey) {
        throw new DomainError("EXPORT_NOT_READY", { detail: status === "FAILED" ? "A exportação falhou; peça uma nova." : "A exportação ainda não está pronta." });
      }
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "USER_EXPORT_DOWNLOAD",
        resourceType: "DataExport",
        resourceId: found.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      return found;
    });
    return { fileName: `vita-family-dados-${item.createdAt.toISOString().slice(0, 10)}.zip`, stream: await deps.storage.getObject(item.storageKey ?? "") };
  };
}

/**
 * Pacote gerado e ESPERADO antes de os dados serem apagados (UC-MEM-09 "levar", BR-MEM-16): usado
 * por `families` (sair/remover membro) pela raiz. Se a geração falhar, propaga o erro e o chamador
 * aborta — nunca se apaga o que não foi exportado. Não conta para o limite diário (N7).
 * Depois de o pacote ficar pronto, avisa a pessoa por e-mail (BR-MEM-16/AC-MEM-07) — o pacote já
 * está acessível por `GET /users/me/exports/{id}`, por isso uma falha no envio não aborta a saída.
 */
export function createExportBeforeRemovalUseCase<Trx>(deps: LifecycleDeps<Trx>) {
  return async function exportBeforeRemoval(input: {
    userId: string;
    familyId: string;
    memberId: string;
    reason: "LEAVE_FAMILY" | "REMOVED_BY_ADMIN";
    requestId: string;
  }): Promise<string> {
    const now = deps.clock.now();
    const context = { requestId: input.requestId };
    const item = await deps.withTransaction((trx) =>
      deps.exportsRepo.insert(trx, {
        id: newId(),
        requestedBy: input.userId,
        familyId: input.familyId,
        subjectMemberId: input.memberId,
        reason: input.reason,
        createdAt: now,
      }),
    );
    try {
      const zip = await buildExportPackage(deps.sources, { userId: input.userId, platformAdmin: false }, { family: { familyId: input.familyId, memberId: input.memberId } }, now, context);
      const key = exportKey(item.id);
      await deps.storage.putObject(key, zip, "application/zip");
      await deps.withTransaction((trx) => deps.exportsRepo.markReady(trx, item.id, key, exportExpiry(deps.clock.now())));
      try {
        const account = await deps.sources.account(input.userId);
        if (account) {
          await deps.mailer.send({
            to: account.email,
            subject: "Vita Family: os seus dados",
            text: "Antes de saída/remoção da família, preparámos um pacote com os seus dados. Entre na app e aceda a \"Os meus dados\" para o descarregar (disponível por 7 dias).",
          });
        }
      } catch (error) {
        deps.onNotifyError(error);
      }
      return item.id;
    } catch (error) {
      await deps.withTransaction((trx) => deps.exportsRepo.markFailed(trx, item.id)).catch(() => undefined);
      throw error;
    }
  };
}
