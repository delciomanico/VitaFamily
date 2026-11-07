// Casos de uso de `ClinicSlot` (BR-CLN-04, BR-APT-11, UC-CLN-04/07, endpoints.md `/clinic-portal/slots/*`):
// publicar, listar (com ocupação), alterar `capacity` e remover (só sem marcações ativas) os
// horários da própria clínica. A ocupação vem da porta `slotOccupancy` (ligada no composition root a
// `appointments`+`examinations`, que dependem de `clinics`, nunca o inverso). Reserva de vaga,
// `PATCH` e `DELETE` serializam-se pelo mesmo bloqueio da linha do horário (`SELECT … FOR UPDATE`).
// `createListFreeClinicSlotsUseCase`/`createFindClinicSlotUseCase`/`createFindClinicSlotByIdUseCase`
// são também expostos pela raiz do módulo e consumidos por `appointments`/`examinations`.
import { newId } from "../../../platform/ids/index.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import {
  assertCapacityAllowedForKind,
  assertValidCapacity,
  assertValidDurationMinutes,
  assertValidSlotKind,
  assertValidSpecialty,
  computeSlotOccupancy,
  type ClinicSlot,
  type ClinicSlotKind,
  type SlotBookingCounts,
  type SlotOccupancy,
} from "../domain/clinic-slot.js";
import { parseLocalDate, parseLocalTime, zonedTimeToUtc } from "../domain/clinic-slot-time.js";
import type { ClinicPortalActor, ClinicsDeps, RequestContext } from "./ports.js";

export interface PublishClinicSlotsInput {
  /** BR-APT-10 (D19): omitido = `APPOINTMENT`. */
  kind?: string | null;
  date: string;
  times: string[];
  /** Obrigatório sem `serviceTypeId` (M14: com serviço é o nome do serviço). */
  specialty?: string | null;
  professionalName?: string | null;
  /** Obrigatório sem `serviceTypeId` (M14: com serviço vem do serviço). */
  durationMinutes?: number | null;
  /** BR-APT-11: 1–50, omitido = 1; > 1 só com `kind=EXAM`. */
  capacity?: number | null;
  /** M14 a1 (BR-CLN-11/13/14): profissional ativo da clínica — ativa a deteção de sobreposição e bloqueios. */
  professionalId?: string | null;
  /** M14 a1: serviço ativo da clínica — `kind`, `specialty` e `durationMinutes` vêm dele. */
  serviceTypeId?: string | null;
}

/** `POST /clinic-portal/slots` (`ClinicSlotBatchInput`): publica um horário por cada hora de
 * `times` no dia local `date` (fuso `CLINIC_TIMEZONE`). BR-CLN-04: ignora, em silêncio, horas já
 * passadas e duplicadas (mesma hora, especialidade, profissional) — nunca falha o lote por isso.
 * M14: com `professionalId`, duplicado exato (mesmo início e duração) é ignorado; qualquer outra
 * sobreposição de `[início, início+duração)` do profissional, ou um bloqueio, => `CONFLICT` e nada é criado. */
export function createPublishClinicSlotsUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function publishClinicSlots(actor: ClinicPortalActor, input: PublishClinicSlotsInput, context: RequestContext): Promise<ClinicSlot[]> {
    const date = parseLocalDate(input.date);
    if (input.times.length === 0) {
      throw new ValidationError([{ field: "times", message: "pelo menos uma hora" }], { detail: "Sem horas para publicar." });
    }
    const times = input.times.map((time) => parseLocalTime(time, "times"));

    return deps.withTransaction(async (trx) => {
      // Ordem fixa profissional -> horários (schema.md §3a): o bloqueio do profissional vem primeiro.
      const professional = input.professionalId ? await deps.catalogRepo.lockProfessional(trx, actor.clinicId, input.professionalId) : null;
      if (input.professionalId && !professional) {
        throw new NotFoundError({ detail: "Profissional não encontrado." });
      }
      const service = input.serviceTypeId ? await deps.catalogRepo.findServiceType(trx, actor.clinicId, input.serviceTypeId) : null;
      if (input.serviceTypeId && !service) {
        throw new NotFoundError({ detail: "Serviço não encontrado." });
      }
      if ((professional && !professional.active) || (service && !service.active)) {
        throw new ConflictError({ detail: "Profissional ou serviço inativo." });
      }

      let kind: ClinicSlotKind;
      let specialty: string;
      let durationMinutes: number;
      if (service) {
        // `kind` omitido chega como `APPOINTMENT` (default do contrato): só um valor diferente do
        // do serviço E diferente do default é um desacordo explícito.
        if (input.kind !== undefined && input.kind !== null && input.kind !== service.kind && input.kind !== "APPOINTMENT") {
          throw new ValidationError([{ field: "kind", message: "tem de coincidir com o do serviço" }], { detail: "Tipo de horário diferente do serviço." });
        }
        if (input.specialty && input.specialty.trim() !== service.name) {
          throw new ValidationError([{ field: "specialty", message: "tem de coincidir com o nome do serviço" }], { detail: "Especialidade diferente do serviço." });
        }
        if (input.durationMinutes !== undefined && input.durationMinutes !== null && input.durationMinutes !== service.durationMinutes) {
          throw new ValidationError([{ field: "durationMinutes", message: "tem de coincidir com a duração do serviço" }], { detail: "Duração diferente do serviço." });
        }
        kind = service.kind;
        specialty = service.name;
        durationMinutes = service.durationMinutes;
      } else {
        kind = assertValidSlotKind(input.kind);
        if (input.specialty === undefined || input.specialty === null) {
          throw new ValidationError([{ field: "specialty", message: "obrigatório sem serviceTypeId" }], { detail: "Especialidade inválida." });
        }
        specialty = assertValidSpecialty(input.specialty);
        if (input.durationMinutes === undefined || input.durationMinutes === null) {
          throw new ValidationError([{ field: "durationMinutes", message: "obrigatório sem serviceTypeId" }], { detail: "Duração inválida." });
        }
        durationMinutes = assertValidDurationMinutes(input.durationMinutes);
      }
      const capacity = assertValidCapacity(input.capacity);
      assertCapacityAllowedForKind(kind, capacity);
      const professionalName = professional ? professional.name : input.professionalName?.trim() ? input.professionalName.trim() : undefined;

      const now = deps.clock.now();
      const published: ClinicSlot[] = [];

      for (const { hour, minute } of times) {
        const startsAt = zonedTimeToUtc({ ...date, hour, minute });

        // BR-CLN-04: ignora horas passadas e duplicadas (mesma hora, especialidade, profissional) —
        // tanto as já existentes na BD como as já publicadas neste mesmo lote.
        if (startsAt.getTime() <= now.getTime()) {
          continue;
        }
        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
        if (professional) {
          const overlapping = await deps.clinicSlotsRepo.listByProfessional(trx, professional.id, { endsAfter: startsAt, startsBefore: endsAt });
          if (overlapping.some((slot) => slot.startsAt.getTime() === startsAt.getTime() && slot.durationMinutes === durationMinutes)) {
            continue;
          }
          if (overlapping.length > 0) {
            throw new ConflictError({ detail: "O horário sobrepõe-se a outro horário do profissional." });
          }
          if ((await deps.timeOffRepo.listOverlapping(trx, professional.id, startsAt, endsAt)).length > 0) {
            throw new ConflictError({ detail: "O profissional está bloqueado nesse período." });
          }
        } else {
          const duplicateInBatch = published.some(
            (slot) => slot.startsAt.getTime() === startsAt.getTime() && slot.kind === kind && slot.specialty === specialty && (slot.professionalName ?? null) === (professionalName ?? null),
          );
          if (duplicateInBatch) {
            continue;
          }
          const duplicateInRepo = await deps.clinicSlotsRepo.existsDuplicate(trx, actor.clinicId, {
            kind,
            startsAt,
            specialty,
            ...(professionalName ? { professionalName } : {}),
          });
          if (duplicateInRepo) {
            continue;
          }
        }

        const slot = await deps.clinicSlotsRepo.insert(trx, {
          id: newId(),
          clinicId: actor.clinicId,
          kind,
          specialty,
          startsAt,
          durationMinutes,
          capacity,
          createdAt: now,
          ...(professionalName ? { professionalName } : {}),
          ...(professional ? { professionalId: professional.id } : {}),
          ...(service ? { serviceTypeId: service.id } : {}),
        });
        published.push(slot);
      }

      if (published.length > 0) {
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "CLINIC_ACCOUNT",
          actorClinicAccountId: actor.clinicAccountId,
          action: "CLINIC_SLOT_PUBLISH",
          resourceType: "ClinicSlot",
          resourceId: actor.clinicId,
          result: "SUCCESS",
          requestId: context.requestId,
          ...auditContextFields(context),
          metadata: { count: published.length },
        });
      }

      return published;
    });
  };
}

export interface ClinicSlotListQuery {
  /** BR-APT-10: sem `kind` devolve todos (portal). */
  kind?: ClinicSlotKind;
  from?: Date;
  to?: Date;
}

/** `ClinicSlotView` (openapi.yaml): horário + `bookedCount`/`remaining`/`state` (BR-APT-11). */
export type ClinicSlotView = ClinicSlot & SlotOccupancy;

async function countsBySlot<Trx>(deps: ClinicsDeps<Trx>, trx: Trx, slotIds: string[]): Promise<Map<string, SlotBookingCounts>> {
  const rows = slotIds.length === 0 ? [] : await deps.slotOccupancy.countActiveBySlot(trx, slotIds);
  const bySlot = new Map<string, SlotBookingCounts>();
  for (const row of rows) {
    const current = bySlot.get(row.slotId) ?? { requested: 0, scheduled: 0 };
    bySlot.set(row.slotId, { requested: current.requested + row.requested, scheduled: current.scheduled + row.scheduled });
  }
  return bySlot;
}

function toView(slot: ClinicSlot, counts: SlotBookingCounts | undefined): ClinicSlotView {
  return { ...slot, ...computeSlotOccupancy(slot, counts ?? { requested: 0, scheduled: 0 }) };
}

/** `GET /clinic-portal/slots` (UC-CLN-04/08): horários da própria clínica com a ocupação calculada. */
export function createListOwnClinicSlotsUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function listOwnClinicSlots(actor: ClinicPortalActor, query: ClinicSlotListQuery): Promise<ClinicSlotView[]> {
    return deps.withTransaction(async (trx) => {
      const slots = await deps.clinicSlotsRepo.listByClinic(trx, actor.clinicId, { ...query });
      const counts = await countsBySlot(deps, trx, slots.map((slot) => slot.id));
      return slots.map((slot) => toView(slot, counts.get(slot.id)));
    });
  };
}

export interface UpdateClinicSlotInput {
  capacity: number;
}

/** `PATCH /clinic-portal/slots/{slotId}` (BR-APT-11): altera `capacity` de um horário `EXAM` da
 * própria clínica. `CONFLICT` se ficar abaixo das marcações ativas — a contagem e a escrita correm
 * sob o bloqueio da linha do horário (o mesmo da marcação), logo não há corrida. */
export function createUpdateClinicSlotUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function updateClinicSlot(actor: ClinicPortalActor, slotId: string, input: UpdateClinicSlotInput, context: RequestContext): Promise<ClinicSlotView> {
    if (typeof input.capacity !== "number") {
      throw new ValidationError([{ field: "capacity", message: "obrigatório" }], { detail: "Número de vagas inválido." });
    }
    const capacity = assertValidCapacity(input.capacity);
    return deps.withTransaction(async (trx) => {
      const slot = await deps.clinicSlotsRepo.lockById(trx, slotId);
      if (slot?.clinicId !== actor.clinicId) {
        throw new NotFoundError({ detail: "Horário não encontrado." });
      }
      if (slot.kind !== "EXAM") {
        throw new ValidationError([{ field: "capacity", message: "só horários de exame têm vagas editáveis" }], { detail: "Horário de consulta tem sempre uma vaga." });
      }
      const counts = (await countsBySlot(deps, trx, [slotId])).get(slotId);
      const { bookedCount } = computeSlotOccupancy(slot, counts ?? { requested: 0, scheduled: 0 });
      if (capacity < bookedCount) {
        throw new ConflictError({ detail: "O número de vagas é inferior às marcações ativas." });
      }

      const updated = await deps.clinicSlotsRepo.updateCapacity(trx, slotId, capacity);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "CLINIC_SLOT_UPDATE",
        resourceType: "ClinicSlot",
        resourceId: slotId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { capacityFrom: slot.capacity, capacityTo: capacity },
      });

      return toView(updated, counts);
    });
  };
}

/** `DELETE /clinic-portal/slots/{slotId}` (BR-CLN-04/BR-APT-11): só remove horários da própria clínica
 * sem marcações ativas (`CONFLICT` com consulta `REQUESTED`/`SCHEDULED` ou exame `SCHEDULED`); a
 * contagem e a remoção correm sob o bloqueio da linha do horário. */
export function createRemoveClinicSlotUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function removeClinicSlot(actor: ClinicPortalActor, slotId: string, context: RequestContext): Promise<void> {
    await deps.withTransaction(async (trx) => {
      const slot = await deps.clinicSlotsRepo.lockById(trx, slotId);
      if (slot?.clinicId !== actor.clinicId) {
        throw new NotFoundError({ detail: "Horário não encontrado." });
      }
      // BR-CLN-12: horário gerado por regra não se remove individualmente (usar bloqueio ou desativar a regra).
      if (slot.scheduleRuleId) {
        throw new ConflictError({ detail: "Horário gerado por uma regra: use um bloqueio ou desative a regra." });
      }

      const counts = (await countsBySlot(deps, trx, [slotId])).get(slotId);
      if (computeSlotOccupancy(slot, counts ?? { requested: 0, scheduled: 0 }).bookedCount > 0) {
        throw new ConflictError({ detail: "O horário tem uma marcação ativa." });
      }

      await deps.clinicSlotsRepo.delete(trx, slotId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "CLINIC_SLOT_REMOVE",
        resourceType: "ClinicSlot",
        resourceId: slotId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}

/**
 * API pela raiz (`clinics/index.ts`), consumida por `appointments` desde a Fase D (D17,
 * `listAvailableSlots`): horários livres de uma clínica, opcionalmente por especialidade. Sem ator
 * do portal — é chamado por outro módulo, não por uma rota `/clinic-portal/*`. Devolve todos os
 * publicados (sem noção de ocupação própria); `appointments` filtra os que já têm marcação ativa
 * cruzando com `appointments.slot_id` (`clinics` não pode importar `appointments`).
 */
export function createListFreeClinicSlotsUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function listFreeClinicSlots(clinicId: string, specialty?: string, kind: ClinicSlotKind = "APPOINTMENT"): Promise<ClinicSlot[]> {
    // BR-APT-10: a listagem pública filtra por `kind` (default APPOINTMENT).
    return deps.withTransaction((trx) => deps.clinicSlotsRepo.listByClinic(trx, clinicId, { kind, ...(specialty ? { specialty } : {}) }));
  };
}

/**
 * API pela raiz (`clinics/index.ts`), consumida por `appointments` desde a Fase D (D17,
 * `support.ts#resolveSlotBooking`) para validar o `slotId`+`clinicId` escolhidos ao pedir consulta
 * (UC-APT-07): devolve o horário só se pertencer a `clinicId` (mesmo critério de não enumerar
 * recursos de outra clínica, authorization.md §6.1 passo 2) — quem chama decide "ocupado"/"livre"
 * com o seu próprio estado (`clinic_slots` não guarda estado próprio, schema.md §3).
 */
export function createFindClinicSlotUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function findClinicSlot(clinicId: string, slotId: string): Promise<ClinicSlot | null> {
    return deps.withTransaction(async (trx) => {
      const slot = await deps.clinicSlotsRepo.findById(trx, slotId);
      return slot?.clinicId === clinicId ? slot : null;
    });
  };
}

/**
 * API pela raiz (`clinics/index.ts`), consumida por `examinations` (D19, UC-EXM-08): o pedido de
 * exame traz só `slotId` (`ExaminationInput` não tem `clinicId`, openapi), por isso o horário
 * resolve-se pelo id. Devolve o horário publicado; quem chama valida `kind`, clínica e ocupação.
 */
export function createFindClinicSlotByIdUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function findClinicSlotById(slotId: string): Promise<ClinicSlot | null> {
    return deps.withTransaction((trx) => deps.clinicSlotsRepo.findById(trx, slotId));
  };
}

/**
 * API pela raiz (`clinics/index.ts`), consumida por `examinations` (BR-APT-11): bloqueia a linha do
 * horário (`SELECT … FOR UPDATE`) NA TRANSAÇÃO DO CHAMADOR e devolve-a. É o ponto de serialização
 * que impede overbooking: quem reserva vaga conta as marcações e insere só depois deste bloqueio.
 */
export function createLockClinicSlotUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function lockClinicSlot(trx: Trx, slotId: string): Promise<ClinicSlot | null> {
    return deps.clinicSlotsRepo.lockById(trx, slotId);
  };
}
