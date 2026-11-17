// Validação pelo admin (UC-MKT-06/10, BR-MKT-18/20/27): fila, detalhe, decisões e download de credenciais. Só identificação profissional:
// nunca dados de saúde, palavra-passe, tokens nem `paymentInstructions`. O guard `PLATFORM_ADMIN` corre ANTES de qualquer acesso à BD.
import type { Readable } from "node:stream";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields, type AuditAction } from "../../audit/index.js";
import type { SpecialtyCategory } from "../domain/requirements.js";
import { decideTransition, normalizeDecisionReason, type ProfessionalDecision, type ProfessionalValidationStatus } from "../domain/validation-status.js";
import { computeMissing } from "./profile.js";
import type { CredentialRecord, ProfessionalsDeps, RequestContext, ValidationCaseRow } from "./ports.js";

export interface AdminActor {
  userId: string;
  platformAdmin: boolean;
}

function assertPlatformAdmin(actor: AdminActor): void {
  if (!actor.platformAdmin) throw new ForbiddenError();
}

export interface AdminListQuery {
  status?: ProfessionalValidationStatus;
  category?: SpecialtyCategory;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface AdminProfessionalListItem {
  id: string;
  displayName: string | null;
  email: string;
  validationStatus: ProfessionalValidationStatus;
  submittedAt: Date | null;
  specialties: { id: string; name: string; category: SpecialtyCategory }[];
  credentialCount: number;
  createdAt: Date;
}

export interface AdminProfessionalPageView {
  items: AdminProfessionalListItem[];
  nextCursor: string | null;
}

export interface AdminProfessionalDetailView {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  displayName: string | null;
  bio: string | null;
  city: string | null;
  validationStatus: ProfessionalValidationStatus;
  statusReason: string | null;
  statusChangedAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  specialties: { id: string; name: string; category: SpecialtyCategory }[];
  credentials: CredentialRecord[];
  history: ValidationCaseRow[];
  createdAt: Date;
}

const DEFAULT_LIMIT = 25;

const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function encodeCursor(item: { submittedAtKey: string | null; id: string }): string {
  return Buffer.from(`${item.submittedAtKey ?? ""}|${item.id}`).toString("base64url");
}

function decodeCursor(cursor: string): { submittedAtKey: string | null; id: string } {
  const bad = () => new DomainError("MALFORMED_REQUEST", { detail: "Cursor inválido." });
  const [ts, id, ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (rest.length > 0 || id === undefined || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw bad();
  if (ts === undefined || ts === "") return { submittedAtKey: null, id };
  if (!CURSOR_TS.test(ts)) throw bad();
  return { submittedAtKey: ts, id };
}

/** `GET /admin/professionals`: omissão `PENDING_REVIEW`, FIFO (BR-MKT-18). Não se audita (volume; sem dados sensíveis, audit.md §3). */
export function createAdminListProfessionalsUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function adminListProfessionals(actor: AdminActor, query: AdminListQuery): Promise<AdminProfessionalPageView> {
    assertPlatformAdmin(actor);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const q = query.q?.trim();
    return deps.withTransaction(async (trx) => {
      const rows = await deps.adminRepo.list(trx, {
        status: query.status ?? "PENDING_REVIEW",
        ...(query.category ? { category: query.category } : {}),
        ...(q && q.length >= 2 ? { q } : {}),
        limit: limit + 1,
        ...(query.cursor ? { after: decodeCursor(query.cursor) } : {}),
      });
      const page = rows.slice(0, limit);
      const specialties = await deps.adminRepo.listSpecialtiesFor(trx, page.map((r) => r.id));
      const last = page.at(-1);
      return {
        items: page.map((r) => ({
          id: r.id,
          displayName: r.displayName,
          email: r.email,
          validationStatus: r.validationStatus,
          submittedAt: r.submittedAt,
          specialties: (specialties.get(r.id) ?? []).map((s) => ({ id: s.id, name: s.name, category: s.category })),
          credentialCount: r.credentialCount,
          createdAt: r.createdAt,
        })),
        nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
      };
    });
  };
}

async function buildDetail<Trx>(deps: ProfessionalsDeps<Trx>, trx: Trx, professionalId: string): Promise<AdminProfessionalDetailView> {
  const record = await deps.profileRepo.findById(trx, professionalId);
  if (!record) throw new NotFoundError();
  const account = await deps.accountRepo.findById(trx, record.accountId);
  if (!account) throw new NotFoundError();
  const [specialties, credentials, history] = await Promise.all([
    deps.profileRepo.listSpecialties(trx, record.id),
    deps.credentialRepo.listByProfessional(trx, record.id),
    deps.validationCaseRepo.listByProfessional(trx, record.id),
  ]);
  return {
    id: record.id,
    email: account.email,
    emailVerifiedAt: account.emailVerifiedAt ?? null,
    displayName: record.displayName,
    bio: record.bio,
    city: record.city,
    validationStatus: record.validationStatus,
    statusReason: record.statusReason,
    statusChangedAt: record.statusChangedAt,
    submittedAt: record.submittedAt,
    approvedAt: record.approvedAt,
    specialties: specialties.map((s) => ({ id: s.id, name: s.name, category: s.category })),
    credentials,
    history,
    createdAt: record.createdAt,
  };
}

export function createAdminGetProfessionalUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function adminGetProfessional(actor: AdminActor, professionalId: string): Promise<AdminProfessionalDetailView> {
    assertPlatformAdmin(actor);
    return deps.withTransaction((trx) => buildDetail(deps, trx, professionalId));
  };
}

const AUDIT_ACTION: Record<ProfessionalDecision, AuditAction> = {
  APPROVE: "ADMIN_PROFESSIONAL_APPROVE",
  REJECT: "ADMIN_PROFESSIONAL_REJECT",
  REQUEST_INFO: "ADMIN_PROFESSIONAL_REQUEST_INFO",
  SUSPEND: "ADMIN_PROFESSIONAL_SUSPEND",
  REACTIVATE: "ADMIN_PROFESSIONAL_REACTIVATE",
};

/**
 * `POST /admin/professionals/{id}/decisions` (BR-MKT-18): transação única com `FOR UPDATE` do profissional — estado, `statusReason` e
 * `ValidationCase` imutável juntos; dois admins em corrida ⇒ o segundo vê o estado novo e leva `INVALID_STATE_TRANSITION` (sem decisões
 * duplicadas). `APPROVE`/`REACTIVATE` exigem BR-MKT-16 (`VALIDATION_ERROR`). Auditoria SEM o motivo (vai em `validation_cases`).
 */
export function createAdminDecideProfessionalUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function adminDecideProfessional(
    actor: AdminActor,
    professionalId: string,
    input: { decision: ProfessionalDecision; reason?: string },
    context: RequestContext,
  ): Promise<AdminProfessionalDetailView> {
    assertPlatformAdmin(actor);
    if (!Object.hasOwn(AUDIT_ACTION, input.decision)) {
      throw new ValidationError([{ field: "decision", message: "decisão inválida" }], { detail: "Decisão inválida." });
    }
    const now = deps.clock.now();
    return deps.withTransaction(async (trx) => {
      const record = await deps.profileRepo.findByIdForUpdate(trx, professionalId);
      if (!record) throw new NotFoundError();
      const transition = decideTransition(record.validationStatus, input.decision);
      const reason = normalizeDecisionReason(transition, input.reason);
      if (transition.requiresRequirements) {
        const missing = await computeMissing(deps, trx, record);
        if (missing.length > 0) {
          throw new ValidationError(
            missing.map((code) => ({ field: "requirements", message: code })),
            { detail: "Os requisitos de validação não estão cumpridos." },
          );
        }
      }
      await deps.profileRepo.updateStatus(
        trx,
        record.id,
        {
          validationStatus: transition.to,
          statusReason: reason,
          statusChangedAt: now,
          ...(transition.to === "APPROVED" ? { approvedAt: record.approvedAt ?? now } : {}),
        },
        now,
      );
      await deps.validationCaseRepo.insert(trx, {
        id: newId(),
        professionalId: record.id,
        action: transition.action,
        fromStatus: transition.from,
        toStatus: transition.to,
        actor: transition.actor,
        decidedBy: actor.userId,
        reason,
        createdAt: now,
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: AUDIT_ACTION[input.decision],
        resourceType: "Professional",
        resourceId: record.id,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { fromStatus: transition.from, toStatus: transition.to },
        ...auditContextFields(context),
      });
      if (transition.to === "APPROVED") {
        await deps.slotGenerator.generateForProfessional(trx, record.id, now);
      }
      return buildDetail(deps, trx, record.id);
    });
  };
}

export interface AdminCredentialDownload {
  stream: Readable;
  contentType: CredentialRecord["contentType"];
  kind: CredentialRecord["kind"];
}

/** `GET /admin/professionals/{id}/credentials/{cid}/file`: só `CLEAN`; TODO o download é auditado (BR-MKT-17/28), com o id da credencial. */
export function createAdminDownloadCredentialUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function adminDownloadCredential(actor: AdminActor, professionalId: string, credentialId: string, context: RequestContext): Promise<AdminCredentialDownload> {
    assertPlatformAdmin(actor);
    const now = deps.clock.now();
    return deps.withTransaction(async (trx) => {
      // O `professionalId` do caminho tem de ser o dono da credencial (senão `NOT_FOUND`, sem enumeração).
      const found = await deps.credentialRepo.findOwned(trx, professionalId, credentialId);
      if (!found) throw new NotFoundError();
      if (found.scanStatus !== "CLEAN") {
        throw new DomainError("DOCUMENT_NOT_AVAILABLE", { detail: "O ficheiro ainda não está disponível." });
      }
      const stream = await deps.fileStore.get(found.storageKey);
      try {
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PLATFORM_ADMIN",
          actorUserId: actor.userId,
          action: "ADMIN_PROFESSIONAL_CREDENTIAL_DOWNLOAD",
          resourceType: "ProfessionalCredential",
          resourceId: found.id,
          result: "SUCCESS",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
      } catch (error) {
        stream.destroy();
        throw error;
      }
      return { stream, contentType: found.contentType, kind: found.kind };
    });
  };
}
