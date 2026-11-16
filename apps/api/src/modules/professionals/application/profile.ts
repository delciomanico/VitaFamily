// Perfil, especialidades e submissão do profissional (UC-MKT-03/05/12, BR-MKT-15/16/22/23). Toda escrita: transação única com
// `SELECT ... FOR UPDATE` do profissional; o estado de validação lê-se da BD nessa transação (nunca do token, BR-MKT-29), de modo que
// uma decisão concorrente do admin e uma escrita do profissional se serializam (a segunda vê o estado novo).
import { NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import {
  IDENTITY_FIELDS,
  validateProfilePatch,
  validateSpecialtyIds,
  type ProfilePatchField,
} from "../domain/profile.js";
import { deriveRequirements, type ProfessionalRequirement } from "../domain/requirements.js";
import { luandaToday } from "../domain/schedule.js";
import {
  assertCanWrite,
  canWrite,
  submitTransition,
  type ProfessionalValidationStatus,
} from "../domain/validation-status.js";
import { ConflictError } from "../../../platform/errors/index.js";
import { auditDeniedOnLock } from "./denied.js";
import type { ProfessionalRecord, ProfessionalsDeps, RequestContext } from "./ports.js";

export interface ProfessionalActor {
  professionalAccountId: string;
  professionalId: string;
}

export interface ProfessionalProfileView {
  id: string;
  email: string;
  displayName: string | null;
  bio: string | null;
  city: string | null;
  paymentInstructions: string | null;
  validationStatus: ProfessionalValidationStatus;
  statusReason: string | null;
  statusChangedAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  specialties: { id: string; name: string; category: "HEALTH" | "WELLNESS" }[];
  requirements: { canSubmit: boolean; missing: ProfessionalRequirement[] };
}

/** Requisitos em falta (BR-MKT-16), com «hoje» em Africa/Luanda e relógio injetado. */
export async function computeMissing<Trx>(
  deps: ProfessionalsDeps<Trx>,
  trx: Trx,
  record: ProfessionalRecord,
): Promise<ProfessionalRequirement[]> {
  const [specialties, credentials] = await Promise.all([
    deps.profileRepo.listSpecialties(trx, record.id),
    deps.profileRepo.listCredentialSummaries(trx, record.id),
  ]);
  return deriveRequirements({
    displayName: record.displayName,
    city: record.city,
    specialties: specialties.map((s) => ({ category: s.category, active: s.active })),
    credentials,
    today: luandaToday(deps.clock.now()),
  });
}

async function buildView<Trx>(
  deps: ProfessionalsDeps<Trx>,
  trx: Trx,
  record: ProfessionalRecord,
): Promise<ProfessionalProfileView> {
  const account = await deps.accountRepo.findById(trx, record.accountId);
  if (!account) throw new NotFoundError();
  const specialties = await deps.profileRepo.listSpecialties(trx, record.id);
  const missing = await computeMissing(deps, trx, record);
  return {
    id: record.id,
    email: account.email,
    displayName: record.displayName,
    bio: record.bio,
    city: record.city,
    paymentInstructions: record.paymentInstructions,
    validationStatus: record.validationStatus,
    statusReason: record.statusReason,
    statusChangedAt: record.statusChangedAt,
    submittedAt: record.submittedAt,
    approvedAt: record.approvedAt,
    specialties: specialties.map((s) => ({ id: s.id, name: s.name, category: s.category })),
    requirements: {
      canSubmit: canWrite(record.validationStatus, "EDIT_IDENTITY") && missing.length === 0,
      missing,
    },
  };
}

/** `GET /professional-portal/me`: disponível em todos os estados. O `professionalId` vem sempre do token (nunca do pedido). */
export function createGetMeUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function getMe(actor: ProfessionalActor): Promise<ProfessionalProfileView> {
    return deps.withTransaction(async (trx) => {
      const record = await deps.profileRepo.findById(trx, actor.professionalId);
      if (!record) throw new NotFoundError();
      return buildView(deps, trx, record);
    });
  };
}

/** `PATCH /professional-portal/me`: `displayName` = identidade; `bio`/`city`/`paymentInstructions` = livres (matriz §10.2). */
export function createUpdateMeUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function updateMe(
    actor: ProfessionalActor,
    input: Record<string, unknown>,
    context: RequestContext,
  ): Promise<ProfessionalProfileView> {
    const patch = validateProfilePatch(input);
    const fields = Object.keys(patch) as ProfilePatchField[];
    const now = deps.clock.now();
    return auditDeniedOnLock(deps, actor, context, "UPDATE_PROFILE", () =>
      deps.withTransaction(async (trx) => {
        const record = await deps.profileRepo.findByIdForUpdate(trx, actor.professionalId);
        if (!record) throw new NotFoundError();
        for (const field of fields) {
          assertCanWrite(
            record.validationStatus,
            IDENTITY_FIELDS.includes(field) ? "EDIT_IDENTITY" : "EDIT_FREE_PROFILE",
          );
        }
        await deps.profileRepo.updateFields(trx, record.id, patch, now);
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_PROFILE_UPDATE",
          resourceType: "Professional",
          resourceId: record.id,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { fields: fields.join(",") },
          ...auditContextFields(context),
        });
        const updated = await deps.profileRepo.findById(trx, record.id);
        if (!updated) throw new NotFoundError();
        return buildView(deps, trx, updated);
      }),
    );
  };
}

/** `PUT /professional-portal/me/specialties`: 1–5 ativas; só DRAFT/NEEDS_INFO; retirar uma com ofertas ⇒ CONFLICT (BR-MKT-22). */
export function createSetSpecialtiesUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function setSpecialties(
    actor: ProfessionalActor,
    input: { specialtyIds: unknown },
    context: RequestContext,
  ): Promise<ProfessionalProfileView> {
    const ids = validateSpecialtyIds(input.specialtyIds);
    const now = deps.clock.now();
    return auditDeniedOnLock(deps, actor, context, "SET_SPECIALTIES", () =>
      deps.withTransaction(async (trx) => {
        const record = await deps.profileRepo.findByIdForUpdate(trx, actor.professionalId);
        if (!record) throw new NotFoundError();
        assertCanWrite(record.validationStatus, "EDIT_IDENTITY");

        const current = await deps.profileRepo.listSpecialties(trx, record.id);
        const currentIds = new Set(current.map((s) => s.id));
        const found = await deps.profileRepo.lockSpecialtiesByIds(trx, ids);
        const byId = new Map(found.map((s) => [s.id, s]));
        // Inexistente ou INATIVA ⇒ VALIDATION_ERROR; as ligações existentes a especialidades entretanto desativadas mantêm-se (BR-MKT-22).
        const invalid = ids.filter((id) => {
          const s = byId.get(id);
          return !s || (!s.active && !currentIds.has(id));
        });
        if (invalid.length > 0) {
          throw new ValidationError(
            [{ field: "specialtyIds", message: "especialidade inexistente ou inativa" }],
            { detail: "Especialidades inválidas." },
          );
        }
        const removed = [...currentIds].filter((id) => !ids.includes(id));
        if (
          removed.length > 0 &&
          (await deps.profileRepo.hasOffersForSpecialties(trx, record.id, removed))
        ) {
          throw new ConflictError({
            detail: "Existem ofertas associadas a uma especialidade que quer retirar.",
          });
        }
        await deps.profileRepo.replaceSpecialties(trx, record.id, ids);
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_SPECIALTIES_SET",
          resourceType: "Professional",
          resourceId: record.id,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { specialtyIds: [...ids].sort().join(",") },
          ...auditContextFields(context),
        });
        return buildView(deps, trx, record);
      }),
    );
  };
}

/** `POST /professional-portal/submission`: estado errado ⇒ `INVALID_STATE_TRANSITION` (antes dos requisitos); requisitos em falta ⇒ 422 com `errors[]`. */
export function createSubmitUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function submit(
    actor: ProfessionalActor,
    context: RequestContext,
  ): Promise<ProfessionalProfileView> {
    const now = deps.clock.now();
    return deps.withTransaction(async (trx) => {
      const record = await deps.profileRepo.findByIdForUpdate(trx, actor.professionalId);
      if (!record) throw new NotFoundError();
      const transition = submitTransition(record.validationStatus);
      const missing = await computeMissing(deps, trx, record);
      if (missing.length > 0) {
        throw new ValidationError(
          missing.map((code) => ({ field: "requirements", message: code })),
          { detail: "Faltam requisitos para submeter." },
        );
      }
      await deps.profileRepo.updateStatus(
        trx,
        record.id,
        {
          validationStatus: transition.to,
          statusReason: record.statusReason,
          statusChangedAt: now,
          submittedAt: now,
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
        reason: null,
        createdAt: now,
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PROFESSIONAL_ACCOUNT",
        actorProfessionalAccountId: actor.professionalAccountId,
        action: "PROFESSIONAL_SUBMIT",
        resourceType: "Professional",
        resourceId: record.id,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { toStatus: transition.to },
        ...auditContextFields(context),
      });
      const updated = await deps.profileRepo.findById(trx, record.id);
      if (!updated) throw new NotFoundError();
      return buildView(deps, trx, updated);
    });
  };
}
