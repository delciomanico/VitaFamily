// Regras de horário (M14 a2, UC-CLN-12, BR-CLN-12/13/15): criar, alterar/desativar e regenerar. Gera
// `ClinicSlot` na janela rolante, de forma idempotente. Serializado pelo bloqueio da linha do profissional
// (schema.md §3a). Ambos os papéis; outra clínica => `NOT_FOUND`.
import { newId } from "../../../platform/ids/index.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { MAX_CLINIC_SCHEDULE_RULES, scheduleRulesOverlap, validateRuleFields, type ClinicScheduleRule, type ScheduleGeneration } from "../domain/clinic-schedule.js";
import { auditClinicWrite } from "./clinic-catalog.js";
import type { ClinicPortalActor, ClinicsDeps, RequestContext } from "./ports.js";
import { generateForRule, reconcileRule } from "./schedule-generation.js";

export interface ClinicScheduleRuleResult {
  rule: ClinicScheduleRule;
  generation: ScheduleGeneration;
}

export function createListClinicScheduleRulesUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function listClinicScheduleRules(actor: ClinicPortalActor, query: { professionalId?: string; active?: boolean }): Promise<ClinicScheduleRule[]> {
    return deps.withTransaction((trx) =>
      deps.scheduleRulesRepo.list(trx, actor.clinicId, { ...(query.professionalId ? { professionalId: query.professionalId } : {}), ...(query.active !== undefined ? { active: query.active } : {}) }),
    );
  };
}

function generationMetadata(generation: ScheduleGeneration) {
  return { ...generation };
}

export interface CreateClinicScheduleRuleInput {
  professionalId: string;
  serviceTypeId: string;
  weekdays: unknown;
  startTime: unknown;
  endTime: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
  capacity?: unknown;
}

/** `POST /clinic-portal/schedule-rules`: profissional e serviço ativos da clínica; sem sobreposição a outra regra ativa. */
export function createCreateClinicScheduleRuleUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function createClinicScheduleRule(actor: ClinicPortalActor, input: CreateClinicScheduleRuleInput, context: RequestContext): Promise<ClinicScheduleRuleResult> {
    return deps.withTransaction(async (trx) => {
      const professional = await deps.catalogRepo.lockProfessional(trx, actor.clinicId, input.professionalId);
      const service = await deps.catalogRepo.findServiceType(trx, actor.clinicId, input.serviceTypeId);
      if (!professional || !service) {
        throw new NotFoundError({ detail: "Profissional ou serviço não encontrado." });
      }
      const fields = validateRuleFields(input, service);
      if (!professional.active || !service.active) {
        throw new ConflictError({ detail: "Profissional ou serviço inativo." });
      }
      await deps.catalogRepo.lockClinic(trx, actor.clinicId);
      if ((await deps.scheduleRulesRepo.count(trx, actor.clinicId)) >= MAX_CLINIC_SCHEDULE_RULES) {
        throw new ConflictError({ detail: "Limite de regras de horário da clínica atingido." });
      }
      const others = await deps.scheduleRulesRepo.listActiveByProfessional(trx, professional.id);
      if (others.some((other) => scheduleRulesOverlap(other, fields))) {
        throw new ConflictError({ detail: "A regra sobrepõe-se a outra regra ativa do profissional." });
      }
      const rule = await deps.scheduleRulesRepo.insert(trx, { id: newId(), clinicId: actor.clinicId, professionalId: professional.id, serviceTypeId: service.id, ...fields, createdAt: deps.clock.now() });
      const generation = await generateForRule(deps, trx, rule);
      await auditClinicWrite(deps, trx, actor, context, {
        action: "CLINIC_SCHEDULE_RULE_CREATE",
        resourceType: "ClinicScheduleRule",
        resourceId: rule.id,
        metadata: { professionalId: professional.id, serviceTypeId: service.id, kind: service.kind, active: true, ...generationMetadata(generation) },
      });
      return { rule, generation };
    });
  };
}

export interface UpdateClinicScheduleRuleInput {
  professionalId?: unknown;
  serviceTypeId?: unknown;
  weekdays?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
  capacity?: unknown;
  active?: unknown;
}

/** `PATCH /clinic-portal/schedule-rules/{id}` (BR-CLN-15): reconcilia; os marcados nunca se removem (`keptBooked`). */
export function createUpdateClinicScheduleRuleUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function updateClinicScheduleRule(actor: ClinicPortalActor, ruleId: string, input: UpdateClinicScheduleRuleInput, context: RequestContext): Promise<ClinicScheduleRuleResult> {
    if (input.professionalId !== undefined || input.serviceTypeId !== undefined) {
      throw new ValidationError([{ field: "professionalId", message: "não é alterável" }], { detail: "Profissional e serviço não se alteram; crie outra regra." });
    }
    if (input.active !== undefined && typeof input.active !== "boolean") {
      throw new ValidationError([{ field: "active", message: "booleano esperado" }], { detail: "Estado inválido." });
    }
    return deps.withTransaction(async (trx) => {
      const found = await deps.scheduleRulesRepo.findById(trx, actor.clinicId, ruleId);
      if (!found) {
        throw new NotFoundError({ detail: "Regra não encontrada." });
      }
      const professional = await deps.catalogRepo.lockProfessional(trx, actor.clinicId, found.professionalId);
      const service = await deps.catalogRepo.findServiceType(trx, actor.clinicId, found.serviceTypeId);
      const current = await deps.scheduleRulesRepo.findById(trx, actor.clinicId, ruleId);
      if (!professional || !service || !current) {
        throw new NotFoundError({ detail: "Regra não encontrada." });
      }
      const fields = validateRuleFields(
        {
          weekdays: input.weekdays ?? current.weekdays,
          startTime: input.startTime ?? current.startTime,
          endTime: input.endTime ?? current.endTime,
          validFrom: input.validFrom !== undefined ? input.validFrom : current.validFrom,
          validUntil: input.validUntil !== undefined ? input.validUntil : current.validUntil,
          capacity: input.capacity ?? current.capacity,
        },
        service,
      );
      const active = typeof input.active === "boolean" ? input.active : current.active;
      if (active) {
        if (!professional.active || !service.active) {
          throw new ConflictError({ detail: "Profissional ou serviço inativo." });
        }
        const others = (await deps.scheduleRulesRepo.listActiveByProfessional(trx, professional.id)).filter((other) => other.id !== ruleId);
        if (others.some((other) => scheduleRulesOverlap(other, fields))) {
          throw new ConflictError({ detail: "A regra sobrepõe-se a outra regra ativa do profissional." });
        }
      }
      const rule = await deps.scheduleRulesRepo.update(trx, ruleId, { ...fields, active });
      const generation = await reconcileRule(deps, trx, rule);
      await auditClinicWrite(deps, trx, actor, context, {
        action: "CLINIC_SCHEDULE_RULE_UPDATE",
        resourceType: "ClinicScheduleRule",
        resourceId: ruleId,
        metadata: { active, ...generationMetadata(generation) },
      });
      return { rule, generation };
    });
  };
}

/** `POST /clinic-portal/schedule-rules/{id}/regenerate`: mesma geração do job; repetir não altera nada. */
export function createRegenerateClinicScheduleRuleUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function regenerateClinicScheduleRule(actor: ClinicPortalActor, ruleId: string, context: RequestContext): Promise<ClinicScheduleRuleResult> {
    return deps.withTransaction(async (trx) => {
      const found = await deps.scheduleRulesRepo.findById(trx, actor.clinicId, ruleId);
      if (!found) {
        throw new NotFoundError({ detail: "Regra não encontrada." });
      }
      await deps.catalogRepo.lockProfessional(trx, actor.clinicId, found.professionalId);
      const rule = (await deps.scheduleRulesRepo.findById(trx, actor.clinicId, ruleId)) ?? found;
      const generation = await reconcileRule(deps, trx, rule);
      await auditClinicWrite(deps, trx, actor, context, {
        action: "CLINIC_SCHEDULE_RULE_REGENERATE",
        resourceType: "ClinicScheduleRule",
        resourceId: ruleId,
        metadata: { active: rule.active, ...generationMetadata(generation) },
      });
      return { rule, generation };
    });
  };
}
