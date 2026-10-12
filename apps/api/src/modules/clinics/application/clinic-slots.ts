// Casos de uso de `ClinicSlot` (BR-CLN-04, UC-CLN-04, endpoints.md `/clinic-portal/slots/*`):
// publicar, listar e remover (só livres) os horários da própria clínica. `createListFreeClinicSlotsUseCase`/
// `createFindClinicSlotUseCase` são também expostos pela raiz do módulo (`clinics/index.ts`) e
// desde a Fase D (D17) consumidos por `appointments` (`application/ports.ts#ClinicsPort`), que é
// quem decide "livre" cruzando com `appointments.slot_id` (`appointments` depende de `clinics`,
// nunca o inverso — por isso esta função continua a devolver só os horários publicados, sem noção
// de ocupação). `listOwnClinicSlots` (`ClinicSlotView.state`), usado pelo próprio portal da
// clínica, continua a devolver sempre `FREE` (não ligado a `appointments`, ver `clinics/README.md`
// "Decisão desta fase sobre 'livre'" — limitação conhecida, fora do âmbito da Fase D).
import { newId } from "../../../platform/ids/index.js";
import { NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidDurationMinutes, assertValidSpecialty, type ClinicSlot } from "../domain/clinic-slot.js";
import { parseLocalDate, parseLocalTime, zonedTimeToUtc } from "../domain/clinic-slot-time.js";
import type { ClinicPortalActor, ClinicsDeps, RequestContext } from "./ports.js";

export interface PublishClinicSlotsInput {
  date: string;
  times: string[];
  specialty: string;
  professionalName?: string | null;
  durationMinutes: number;
}

/** `POST /clinic-portal/slots` (`ClinicSlotBatchInput`): publica um horário por cada hora de
 * `times` no dia local `date` (fuso `CLINIC_TIMEZONE`). BR-CLN-04: ignora, em silêncio, horas já
 * passadas e duplicadas (mesma hora, especialidade, profissional) — nunca falha o lote por isso. */
export function createPublishClinicSlotsUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function publishClinicSlots(actor: ClinicPortalActor, input: PublishClinicSlotsInput, context: RequestContext): Promise<ClinicSlot[]> {
    const specialty = assertValidSpecialty(input.specialty);
    const durationMinutes = assertValidDurationMinutes(input.durationMinutes);
    const professionalName = input.professionalName?.trim() ? input.professionalName.trim() : undefined;
    const date = parseLocalDate(input.date);

    if (input.times.length === 0) {
      throw new ValidationError([{ field: "times", message: "pelo menos uma hora" }], { detail: "Sem horas para publicar." });
    }

    return deps.withTransaction(async (trx) => {
      const now = deps.clock.now();
      const published: ClinicSlot[] = [];

      for (const time of input.times) {
        const { hour, minute } = parseLocalTime(time, "times");
        const startsAt = zonedTimeToUtc({ ...date, hour, minute });

        // BR-CLN-04: ignora horas passadas e duplicadas (mesma hora, especialidade, profissional) —
        // tanto as já existentes na BD como as já publicadas neste mesmo lote.
        if (startsAt.getTime() <= now.getTime()) {
          continue;
        }
        const duplicateInBatch = published.some(
          (slot) => slot.startsAt.getTime() === startsAt.getTime() && slot.specialty === specialty && (slot.professionalName ?? null) === (professionalName ?? null),
        );
        if (duplicateInBatch) {
          continue;
        }
        const duplicateInRepo = await deps.clinicSlotsRepo.existsDuplicate(trx, actor.clinicId, {
          startsAt,
          specialty,
          ...(professionalName ? { professionalName } : {}),
        });
        if (duplicateInRepo) {
          continue;
        }

        const slot = await deps.clinicSlotsRepo.insert(trx, {
          id: newId(),
          clinicId: actor.clinicId,
          specialty,
          startsAt,
          durationMinutes,
          createdAt: now,
          ...(professionalName ? { professionalName } : {}),
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
  from?: Date;
  to?: Date;
}

/** `GET /clinic-portal/slots` (UC-CLN-04): horários (livres/pedidos/confirmados, `ClinicSlotView`)
 * da própria clínica. Nesta fase todos vêm `state: "FREE"` (interface/dto.ts) — a composição com
 * `appointments` fica para a Fase D. */
export function createListOwnClinicSlotsUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function listOwnClinicSlots(actor: ClinicPortalActor, query: ClinicSlotListQuery): Promise<ClinicSlot[]> {
    return deps.withTransaction((trx) => deps.clinicSlotsRepo.listByClinic(trx, actor.clinicId, { ...query }));
  };
}

/** `DELETE /clinic-portal/slots/{slotId}` (BR-CLN-04): só remove horários da própria clínica. Nesta
 * fase todo o horário publicado está livre (sem `appointments.slot_id`, Fase D) — quando essa
 * ligação existir, o caso de uso passa a verificar aqui se há pedido/consulta ativa antes de
 * remover (`CONFLICT`, endpoints.md `removeClinicSlot`). */
export function createRemoveClinicSlotUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function removeClinicSlot(actor: ClinicPortalActor, slotId: string, context: RequestContext): Promise<void> {
    await deps.withTransaction(async (trx) => {
      const slot = await deps.clinicSlotsRepo.findById(trx, slotId);
      if (slot?.clinicId !== actor.clinicId) {
        throw new NotFoundError({ detail: "Horário não encontrado." });
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
  return async function listFreeClinicSlots(clinicId: string, specialty?: string): Promise<ClinicSlot[]> {
    return deps.withTransaction((trx) => deps.clinicSlotsRepo.listByClinic(trx, clinicId, specialty ? { specialty } : {}));
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
