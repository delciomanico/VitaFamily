// Catálogo da clínica (M14 a1, UC-CLN-11, BR-CLN-11/12/15): profissionais e tipos de serviço da
// própria clínica. Escrevem e leem `CLINIC_ADMIN` e `CLINIC_MANAGER` (authorization.md §6.2); o
// isolamento é pelo `clinicId` do ator (outra clínica => `NOT_FOUND`). Não se apaga: desativa-se
// (BR-CLN-15: desativar remove os horários futuros livres gerados). Auditoria sem nomes nem preços.
import { newId } from "../../../platform/ids/index.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields, type AuditEvent } from "../../audit/index.js";
import {
  assertValidCatalogName,
  assertValidServiceDuration,
  assertValidServiceKind,
  MAX_CLINIC_PROFESSIONALS,
  MAX_CLINIC_SERVICE_TYPES,
  normalizePriceMinor,
  normalizeProfessionalSpecialty,
  type ClinicProfessional,
  type ClinicServiceType,
} from "../domain/clinic-catalog.js";
import { assertValidSlotKind, type ClinicSlotKind } from "../domain/clinic-slot.js";
import { addGeneration, emptyGeneration, type ClinicScheduleRule } from "../domain/clinic-schedule.js";
import type { ClinicPortalActor, ClinicsDeps, RequestContext } from "./ports.js";
import { reconcileRule } from "./schedule-generation.js";

type AuditMetadata = NonNullable<AuditEvent["metadata"]>;

export type ClinicServiceTypeView = ClinicServiceType & { currency: string };

export function auditClinicWrite<Trx>(
  deps: Pick<ClinicsDeps<Trx>, "audit" | "clock">,
  trx: Trx,
  actor: ClinicPortalActor,
  context: RequestContext,
  event: { action: "CLINIC_PROFESSIONAL_CREATE" | "CLINIC_PROFESSIONAL_UPDATE" | "CLINIC_SERVICE_CREATE" | "CLINIC_SERVICE_UPDATE" | "CLINIC_SCHEDULE_RULE_CREATE" | "CLINIC_SCHEDULE_RULE_UPDATE" | "CLINIC_SCHEDULE_RULE_REGENERATE" | "CLINIC_TIME_OFF_CREATE" | "CLINIC_TIME_OFF_DELETE"; resourceType: string; resourceId: string; metadata: AuditMetadata },
): Promise<void> {
  return deps.audit.record(trx, {
    occurredAt: deps.clock.now(),
    actorType: "CLINIC_ACCOUNT",
    actorClinicAccountId: actor.clinicAccountId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    result: "SUCCESS",
    requestId: context.requestId,
    ...auditContextFields(context),
    metadata: event.metadata,
  });
}

function activeQuery(value: boolean | undefined): { active?: boolean } {
  return value === undefined ? {} : { active: value };
}

/** Reconcilia (BR-CLN-15) as regras ativas indicadas, bloqueando antes cada profissional (por ordem de id). */
async function reconcileRules<Trx>(deps: ClinicsDeps<Trx>, trx: Trx, rules: ClinicScheduleRule[]) {
  let total = emptyGeneration();
  const ordered = [...rules].sort((a, b) => a.professionalId.localeCompare(b.professionalId));
  for (const rule of ordered) {
    await deps.catalogRepo.lockProfessional(trx, rule.clinicId, rule.professionalId);
    total = addGeneration(total, await reconcileRule(deps, trx, rule));
  }
  return total;
}

// --- Profissionais ---

export function createListClinicProfessionalsUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function listClinicProfessionals(actor: ClinicPortalActor, query: { active?: boolean }): Promise<ClinicProfessional[]> {
    return deps.withTransaction((trx) => deps.catalogRepo.listProfessionals(trx, actor.clinicId, activeQuery(query.active)));
  };
}

export interface CreateClinicProfessionalInput {
  name: unknown;
  specialty?: unknown;
}

/** `POST /clinic-portal/professionals` (BR-CLN-11): nome único entre ativos; limite de 100 (`CONFLICT`). */
export function createCreateClinicProfessionalUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function createClinicProfessional(actor: ClinicPortalActor, input: CreateClinicProfessionalInput, context: RequestContext): Promise<ClinicProfessional> {
    const name = assertValidCatalogName(input.name);
    const specialty = normalizeProfessionalSpecialty(input.specialty);
    return deps.withTransaction(async (trx) => {
      await deps.catalogRepo.lockClinic(trx, actor.clinicId);
      if ((await deps.catalogRepo.countProfessionals(trx, actor.clinicId)) >= MAX_CLINIC_PROFESSIONALS) {
        throw new ConflictError({ detail: "Limite de profissionais da clínica atingido." });
      }
      const created = await deps.catalogRepo.insertProfessional(trx, { id: newId(), clinicId: actor.clinicId, name, specialty, createdAt: deps.clock.now() });
      await auditClinicWrite(deps, trx, actor, context, { action: "CLINIC_PROFESSIONAL_CREATE", resourceType: "ClinicProfessional", resourceId: created.id, metadata: { active: true } });
      return created;
    });
  };
}

export interface UpdateClinicProfessionalInput {
  name?: unknown;
  specialty?: unknown;
  active?: unknown;
}

/** `PATCH /clinic-portal/professionals/{id}` (BR-CLN-11/15): desativar remove os horários futuros livres gerados. */
export function createUpdateClinicProfessionalUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function updateClinicProfessional(actor: ClinicPortalActor, professionalId: string, input: UpdateClinicProfessionalInput, context: RequestContext): Promise<ClinicProfessional> {
    if (input.active !== undefined && typeof input.active !== "boolean") {
      throw new ValidationError([{ field: "active", message: "booleano esperado" }], { detail: "Estado inválido." });
    }
    const changes = {
      ...(input.name !== undefined ? { name: assertValidCatalogName(input.name) } : {}),
      ...(input.specialty !== undefined ? { specialty: normalizeProfessionalSpecialty(input.specialty) } : {}),
      ...(typeof input.active === "boolean" ? { active: input.active } : {}),
    };
    if (Object.keys(changes).length === 0) {
      throw new ValidationError([{ field: "name", message: "nenhuma alteração" }], { detail: "Sem alterações." });
    }
    return deps.withTransaction(async (trx) => {
      const current = await deps.catalogRepo.lockProfessional(trx, actor.clinicId, professionalId);
      if (!current) {
        throw new NotFoundError({ detail: "Profissional não encontrado." });
      }
      const updated = await deps.catalogRepo.updateProfessional(trx, professionalId, changes);
      let generation = emptyGeneration();
      if (current.active && !updated.active) {
        const rules = await deps.scheduleRulesRepo.listActiveByProfessional(trx, professionalId);
        generation = await reconcileRules(deps, trx, rules);
      }
      await auditClinicWrite(deps, trx, actor, context, {
        action: "CLINIC_PROFESSIONAL_UPDATE",
        resourceType: "ClinicProfessional",
        resourceId: professionalId,
        metadata: { active: updated.active, removedSlots: generation.removed, keptBooked: generation.keptBooked },
      });
      return updated;
    });
  };
}

// --- Tipos de serviço ---

export function createListClinicServiceTypesUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function listClinicServiceTypes(actor: ClinicPortalActor, query: { active?: boolean; kind?: string }): Promise<ClinicServiceTypeView[]> {
    const kind: ClinicSlotKind | undefined = query.kind === undefined ? undefined : assertValidSlotKind(query.kind);
    return deps.withTransaction(async (trx) => {
      const currency = await deps.catalogRepo.getCurrency(trx, actor.clinicId);
      const services = await deps.catalogRepo.listServiceTypes(trx, actor.clinicId, { ...activeQuery(query.active), ...(kind ? { kind } : {}) });
      return services.map((service) => ({ ...service, currency }));
    });
  };
}

/** `GET /clinic-portal/exam-service-types` (M15 U, BR-CLN-51): serviços EXAM ativos da clínica do token, só id/nome/duração (sem preço), por nome; não auditada. */
export function createListClinicExamServiceTypesUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function listClinicExamServiceTypes(actor: ClinicPortalActor): Promise<{ id: string; name: string; durationMinutes: number }[]> {
    return deps.withTransaction(async (trx) => {
      const services = await deps.catalogRepo.listServiceTypes(trx, actor.clinicId, { active: true, kind: "EXAM" });
      return services
        .filter((s) => s.active && s.kind === "EXAM" && s.clinicId === actor.clinicId)
        .map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt"));
    });
  };
}

export interface CreateClinicServiceTypeInput {
  name: unknown;
  kind: unknown;
  durationMinutes: unknown;
  priceMinor?: unknown;
}

/** `POST /clinic-portal/services` (BR-CLN-12): duração em {15,20,30,45,60}, preço ≥ 0 em cêntimos (informativo). */
export function createCreateClinicServiceTypeUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function createClinicServiceType(actor: ClinicPortalActor, input: CreateClinicServiceTypeInput, context: RequestContext): Promise<ClinicServiceTypeView> {
    const name = assertValidCatalogName(input.name);
    const kind = assertValidServiceKind(input.kind);
    const durationMinutes = assertValidServiceDuration(input.durationMinutes);
    const priceMinor = normalizePriceMinor(input.priceMinor);
    return deps.withTransaction(async (trx) => {
      await deps.catalogRepo.lockClinic(trx, actor.clinicId);
      if ((await deps.catalogRepo.countServiceTypes(trx, actor.clinicId)) >= MAX_CLINIC_SERVICE_TYPES) {
        throw new ConflictError({ detail: "Limite de serviços da clínica atingido." });
      }
      const created = await deps.catalogRepo.insertServiceType(trx, { id: newId(), clinicId: actor.clinicId, name, kind, durationMinutes, priceMinor, createdAt: deps.clock.now() });
      await auditClinicWrite(deps, trx, actor, context, { action: "CLINIC_SERVICE_CREATE", resourceType: "ClinicServiceType", resourceId: created.id, metadata: { kind, active: true } });
      return { ...created, currency: await deps.catalogRepo.getCurrency(trx, actor.clinicId) };
    });
  };
}

export interface UpdateClinicServiceTypeInput {
  name?: unknown;
  kind?: unknown;
  durationMinutes?: unknown;
  priceMinor?: unknown;
  active?: unknown;
}

/** `PATCH /clinic-portal/services/{id}` (BR-CLN-12/15): `kind` imutável; desativar remove os horários livres gerados. */
export function createUpdateClinicServiceTypeUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function updateClinicServiceType(actor: ClinicPortalActor, serviceTypeId: string, input: UpdateClinicServiceTypeInput, context: RequestContext): Promise<ClinicServiceTypeView> {
    if (input.kind !== undefined) {
      throw new ValidationError([{ field: "kind", message: "não é alterável" }], { detail: "O tipo (consulta/exame) de um serviço não se altera; crie outro." });
    }
    if (input.active !== undefined && typeof input.active !== "boolean") {
      throw new ValidationError([{ field: "active", message: "booleano esperado" }], { detail: "Estado inválido." });
    }
    const changes = {
      ...(input.name !== undefined ? { name: assertValidCatalogName(input.name) } : {}),
      ...(input.durationMinutes !== undefined ? { durationMinutes: assertValidServiceDuration(input.durationMinutes) } : {}),
      ...(input.priceMinor !== undefined ? { priceMinor: normalizePriceMinor(input.priceMinor) } : {}),
      ...(typeof input.active === "boolean" ? { active: input.active } : {}),
    };
    if (Object.keys(changes).length === 0) {
      throw new ValidationError([{ field: "name", message: "nenhuma alteração" }], { detail: "Sem alterações." });
    }
    return deps.withTransaction(async (trx) => {
      const current = await deps.catalogRepo.findServiceType(trx, actor.clinicId, serviceTypeId);
      if (!current) {
        throw new NotFoundError({ detail: "Serviço não encontrado." });
      }
      const updated = await deps.catalogRepo.updateServiceType(trx, serviceTypeId, changes);
      let generation = emptyGeneration();
      if (current.active && !updated.active) {
        const rules = (await deps.scheduleRulesRepo.list(trx, actor.clinicId, { active: true })).filter((rule) => rule.serviceTypeId === serviceTypeId);
        generation = await reconcileRules(deps, trx, rules);
      }
      await auditClinicWrite(deps, trx, actor, context, {
        action: "CLINIC_SERVICE_UPDATE",
        resourceType: "ClinicServiceType",
        resourceId: serviceTypeId,
        metadata: { kind: updated.kind, active: updated.active, removedSlots: generation.removed, keptBooked: generation.keptBooked },
      });
      return { ...updated, currency: await deps.catalogRepo.getCurrency(trx, actor.clinicId) };
    });
  };
}
