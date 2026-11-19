// Regras de horário, bloqueios e `GET /slots` (UC-MKT-09, BR-MKT-25). Escritas: transação única com `FOR UPDATE` do profissional; estado lido
// da BD; `REJECTED`/`SUSPENDED` ⇒ `PROFESSIONAL_LOCKED` (editável em `APPROVED`, OP-62). Auditoria só com ids, flags e contagens (nunca a nota).
import { ConflictError, DomainError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import {
  MAX_SCHEDULE_RULES,
  assertValidTimeOffRange,
  emptyGeneration,
  normalizeTimeOffReason,
  rulesOverlap,
  validateRuleFields,
  type GenerationCounts,
  type ScheduleRuleFields,
} from "../domain/schedule.js";
import { assertCanWrite } from "../domain/validation-status.js";
import { auditDeniedOnLock } from "./denied.js";
import type { ProfessionalsDeps, RequestContext, ScheduleRuleRecord, SlotRecord, TimeOffRecord } from "./ports.js";
import type { ProfessionalActor } from "./profile.js";
import { reconcileSchedule } from "./schedule-sync.js";

export interface ScheduleRuleResult {
  rule: ScheduleRuleRecord;
  generation: GenerationCounts;
}

const OVERLAP = "A regra sobrepõe-se a outra regra ativa (mesmo dia, horas e validade).";

function toFields(rule: ScheduleRuleRecord): ScheduleRuleFields {
  return { weekdays: rule.weekdays, startTime: rule.startTime, endTime: rule.endTime, validFrom: rule.validFrom, validUntil: rule.validUntil };
}

export function createListScheduleRulesUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function listScheduleRules(actor: ProfessionalActor, filter: { offerId?: string; active?: boolean }): Promise<ScheduleRuleRecord[]> {
    return deps.withTransaction((trx) => deps.scheduleRuleRepo.list(trx, actor.professionalId, filter));
  };
}

export function createCreateScheduleRuleUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function createScheduleRule(actor: ProfessionalActor, input: Record<string, unknown>, context: RequestContext): Promise<ScheduleRuleResult> {
    const now = deps.clock.now();
    const offerId = input.offerId;
    if (typeof offerId !== "string") {
      throw new ValidationError([{ field: "offerId", message: "obrigatório" }], { detail: "Regra inválida." });
    }
    return auditDeniedOnLock(deps, actor, context, "CREATE_SCHEDULE_RULE", () =>
      deps.withTransaction(async (trx) => {
        const professional = await deps.profileRepo.findByIdForUpdate(trx, actor.professionalId);
        if (!professional) throw new NotFoundError();
        // Oferta de outro profissional ou inexistente ⇒ 404 (antes do estado: sem enumeração).
        const offer = await deps.offerRepo.findOwned(trx, professional.id, offerId);
        if (!offer) throw new NotFoundError();
        assertCanWrite(professional.validationStatus, "EDIT_COMMERCIAL");
        // «Oferta ativa do profissional» (BR-MKT-25, UC-MKT-09): uma oferta desativada não aceita novas regras.
        if (!offer.active) {
          throw new ValidationError([{ field: "offerId", message: "a oferta está inativa" }], { detail: "Regra inválida." });
        }
        const fields = validateRuleFields(input, offer.durationMinutes);
        const others = await deps.scheduleRuleRepo.listActive(trx, professional.id);
        if (others.some((o) => rulesOverlap(fields, toFields(o)))) throw new ConflictError({ detail: OVERLAP });
        if (others.length >= MAX_SCHEDULE_RULES) throw new DomainError("LIMIT_EXCEEDED", { detail: `Máximo de ${String(MAX_SCHEDULE_RULES)} regras.` });

        const rule = await deps.scheduleRuleRepo.insert(trx, { id: newId(), professionalId: professional.id, offerId: offer.id, ...fields, active: true, createdAt: now });
        // Antes da aprovação só se guarda a regra; os horários nascem na aprovação (contagens a zero).
        const approved = professional.validationStatus === "APPROVED";
        const generation = approved ? await reconcileSchedule(deps, trx, professional.id, true, now, { ruleId: rule.id }) : emptyGeneration();
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_SCHEDULE_RULE_CREATE",
          resourceType: "ProfessionalScheduleRule",
          resourceId: rule.id,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { created: generation.created, removed: generation.removed, skippedOverlap: generation.skippedOverlap, skippedTimeOff: generation.skippedTimeOff },
          ...auditContextFields(context),
        });
        return { rule, generation };
      }),
    );
  };
}

export function createUpdateScheduleRuleUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function updateScheduleRule(actor: ProfessionalActor, ruleId: string, input: Record<string, unknown>, context: RequestContext): Promise<ScheduleRuleResult> {
    const now = deps.clock.now();
    if ("offerId" in input) {
      throw new ValidationError([{ field: "offerId", message: "imutável" }], { detail: "Regra inválida." });
    }
    return auditDeniedOnLock(deps, actor, context, "UPDATE_SCHEDULE_RULE", () =>
      deps.withTransaction(async (trx) => {
        const professional = await deps.profileRepo.findByIdForUpdate(trx, actor.professionalId);
        if (!professional) throw new NotFoundError();
        const current = await deps.scheduleRuleRepo.findOwned(trx, professional.id, ruleId, { forUpdate: true });
        if (!current) throw new NotFoundError();
        assertCanWrite(professional.validationStatus, "EDIT_COMMERCIAL");
        const offer = await deps.offerRepo.findOwned(trx, professional.id, current.offerId);
        if (!offer) throw new NotFoundError();

        const merged = { ...toFields(current), ...pick(input, ["weekdays", "startTime", "endTime", "validFrom", "validUntil"]) };
        const fields = validateRuleFields(merged, offer.durationMinutes);
        const active = typeof input.active === "boolean" ? input.active : current.active;
        if (input.active !== undefined && typeof input.active !== "boolean") {
          throw new ValidationError([{ field: "active", message: "booleano" }], { detail: "Regra inválida." });
        }
        if (Object.keys(input).length === 0) {
          throw new ValidationError([{ field: "body", message: "nenhum campo para alterar" }], { detail: "Regra inválida." });
        }
        if (active) {
          const others = await deps.scheduleRuleRepo.listActive(trx, professional.id, current.id);
          if (others.some((o) => rulesOverlap(fields, toFields(o)))) throw new ConflictError({ detail: OVERLAP });
          if (!current.active && others.length >= MAX_SCHEDULE_RULES) throw new DomainError("LIMIT_EXCEEDED", { detail: `Máximo de ${String(MAX_SCHEDULE_RULES)} regras.` });
        }
        await deps.scheduleRuleRepo.update(trx, current.id, { ...fields, active }, now);
        const approved = professional.validationStatus === "APPROVED";
        const generation = approved ? await reconcileSchedule(deps, trx, professional.id, true, now, { ruleId: current.id }) : emptyGeneration();
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_SCHEDULE_RULE_UPDATE",
          resourceType: "ProfessionalScheduleRule",
          resourceId: current.id,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { active, created: generation.created, removed: generation.removed, skippedOverlap: generation.skippedOverlap, skippedTimeOff: generation.skippedTimeOff },
          ...auditContextFields(context),
        });
        const rule = await deps.scheduleRuleRepo.findOwned(trx, professional.id, current.id);
        if (!rule) throw new NotFoundError();
        return { rule, generation };
      }),
    );
  };
}

function pick(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k in input).map((k) => [k, input[k]]));
}

export function createListTimeOffUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function listTimeOff(actor: ProfessionalActor, filter: { from?: Date; to?: Date }): Promise<TimeOffRecord[]> {
    const now = deps.clock.now();
    return deps.withTransaction((trx) => deps.timeOffRepo.list(trx, actor.professionalId, { ...filter, ...(filter.from ? {} : { endsAfter: now }) }));
  };
}

export function createCreateTimeOffUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function createTimeOff(actor: ProfessionalActor, input: { startsAt: unknown; endsAt: unknown; reason?: unknown }, context: RequestContext): Promise<TimeOffRecord> {
    const now = deps.clock.now();
    const startsAt = new Date(typeof input.startsAt === "string" ? input.startsAt : Number.NaN);
    const endsAt = new Date(typeof input.endsAt === "string" ? input.endsAt : Number.NaN);
    assertValidTimeOffRange(startsAt, endsAt, now);
    const reason = normalizeTimeOffReason(input.reason);
    return auditDeniedOnLock(deps, actor, context, "CREATE_TIME_OFF", () =>
      deps.withTransaction(async (trx) => {
        const professional = await deps.profileRepo.findByIdForUpdate(trx, actor.professionalId);
        if (!professional) throw new NotFoundError();
        assertCanWrite(professional.validationStatus, "EDIT_COMMERCIAL");
        // Veto (BR-MKT-53, OP-98): um bloqueio sobre horários com marcação futura é recusado; o `detail` só leva a contagem (nunca ids de família).
        const booked = await deps.slotRepo.countBookedIntersecting(trx, professional.id, startsAt, endsAt, now);
        if (booked > 0) {
          throw new ConflictError({ detail: `O bloqueio cobre ${String(booked)} horário(s) com marcação; recuse ou cancele essas marcações primeiro.` });
        }
        const created = await deps.timeOffRepo.insert(trx, { id: newId(), professionalId: professional.id, startsAt, endsAt, reason, createdAt: now });
        // Remove os horários livres do intervalo (os ocupados já foram vetados acima). Só os FUTUROS: o passado é histórico e não se apaga.
        const removed = await deps.slotRepo.deleteIntersecting(trx, professional.id, new Date(Math.max(startsAt.getTime(), now.getTime())), endsAt);
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_TIME_OFF_CREATE",
          resourceType: "ProfessionalTimeOff",
          resourceId: created.id,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { removed },
          ...auditContextFields(context),
        });
        return created;
      }),
    );
  };
}

export function createDeleteTimeOffUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function deleteTimeOff(actor: ProfessionalActor, timeOffId: string, context: RequestContext): Promise<void> {
    const now = deps.clock.now();
    await auditDeniedOnLock(deps, actor, context, "DELETE_TIME_OFF", () =>
      deps.withTransaction(async (trx) => {
        const professional = await deps.profileRepo.findByIdForUpdate(trx, actor.professionalId);
        if (!professional) throw new NotFoundError();
        const found = await deps.timeOffRepo.findOwned(trx, professional.id, timeOffId);
        if (!found) throw new NotFoundError();
        assertCanWrite(professional.validationStatus, "EDIT_COMMERCIAL");
        await deps.timeOffRepo.delete(trx, professional.id, found.id);
        // Repõe, de forma idempotente, o que as regras ainda prevêem (só para APPROVED).
        const generation = await reconcileSchedule(deps, trx, professional.id, professional.validationStatus === "APPROVED", now);
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_TIME_OFF_DELETE",
          resourceType: "ProfessionalTimeOff",
          resourceId: found.id,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { created: generation.created },
          ...auditContextFields(context),
        });
      }),
    );
  };
}

const MAX_SLOT_RANGE_MS = 62 * 24 * 3600 * 1000;

export function createListSlotsUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function listSlots(actor: ProfessionalActor, range: { from: Date; to: Date }): Promise<SlotRecord[]> {
    if (Number.isNaN(range.from.getTime()) || Number.isNaN(range.to.getTime()) || range.to.getTime() <= range.from.getTime() || range.to.getTime() - range.from.getTime() > MAX_SLOT_RANGE_MS) {
      throw new ValidationError([{ field: "to", message: "intervalo inválido (to > from, máx. 62 dias)" }], { detail: "Intervalo inválido." });
    }
    return deps.withTransaction((trx) => deps.slotRepo.listInRange(trx, actor.professionalId, range.from, range.to));
  };
}
