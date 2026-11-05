// openapi.yaml `listAvailableSlots`: "Autorização: FAM_MEMBER. Listar horários livres e futuros de
// uma clínica parceira, para escolher ao marcar (D17)." BR-APT-06: só horários sem marcação ativa
// (REQUESTED/SCHEDULED) — `clinics.listFreeSlots` devolve todos os publicados (sem noção de
// "ocupado", Fase C `clinics/README.md`); é aqui, em `appointments` (que já conhece
// `appointments.slot_id`), que se filtra a lista final.
import { NotFoundError } from "../../../platform/errors/index.js";
import type { ActorIdentity, AppointmentsDeps, AvailableSlotItem } from "./ports.js";

export interface ListAvailableSlotsQuery {
  /** BR-APT-10: por defeito `APPOINTMENT`. */
  kind?: "APPOINTMENT" | "EXAM";
  specialty?: string;
  /** openapi `listAvailableSlots`: período opcional (`from`/`to`, inclusive). */
  from?: Date;
  to?: Date;
}

export interface AvailableSlotsResult {
  clinicName: string;
  items: AvailableSlotItem[];
}

export function createListAvailableSlotsUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function listAvailableSlots(actor: ActorIdentity, familyId: string, clinicId: string, query: ListAvailableSlotsQuery): Promise<AvailableSlotsResult> {
    return deps.withTransaction(async (trx) => {
      // authorization.md §2 passo 3: pertença à família do caminho; sem categoria de dados de
      // saúde envolvida (FAM_MEMBER, não READ(APPOINTMENTS) de um sujeito concreto).
      const membership = await deps.membership.getMembershipFacts(trx, familyId, actor.userId);
      if (!membership) {
        throw new NotFoundError({ detail: "Família não encontrada." });
      }

      const clinic = await deps.clinics.getBookableClinic(trx, familyId, clinicId);
      if (!clinic) {
        throw new NotFoundError({ detail: "Clínica não encontrada." });
      }

      const kind = query.kind ?? "APPOINTMENT";
      const slots = (await deps.clinics.listFreeSlots(clinicId, query.specialty, kind))
        .filter((slot) => !query.from || slot.startsAt.getTime() >= query.from.getTime())
        .filter((slot) => !query.to || slot.startsAt.getTime() <= query.to.getTime());
      if (slots.length === 0) {
        return { clinicName: clinic.name, items: [] };
      }
      const slotIds = slots.map((slot) => slot.id);
      // BR-APT-06/10/11: `APPOINTMENT` livre = sem marcação ativa (1 vaga); `EXAM` com vaga =
      // exames `SCHEDULED` < `capacity`. `remaining` ≥ 1 em todos os itens devolvidos.
      if (kind === "EXAM") {
        const booked = new Map((await deps.examSlotOccupancy.countScheduledBySlot(trx, slotIds)).map((row) => [row.slotId, row.count]));
        const items = slots.map((slot) => ({ ...slot, remaining: slot.capacity - (booked.get(slot.id) ?? 0) })).filter((slot) => slot.remaining >= 1);
        return { clinicName: clinic.name, items };
      }
      const activeSlotIds = new Set(await deps.appointmentsRepo.listActiveSlotIds(trx, slotIds));
      return { clinicName: clinic.name, items: slots.filter((slot) => !activeSlotIds.has(slot.id)).map((slot) => ({ ...slot, remaining: 1 })) };
    });
  };
}
