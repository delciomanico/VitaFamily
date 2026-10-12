// openapi.yaml `listAvailableSlots`: "Autorização: FAM_MEMBER. Listar horários livres e futuros de
// uma clínica parceira, para escolher ao marcar (D17)." BR-APT-06: só horários sem marcação ativa
// (REQUESTED/SCHEDULED) — `clinics.listFreeSlots` devolve todos os publicados (sem noção de
// "ocupado", Fase C `clinics/README.md`); é aqui, em `appointments` (que já conhece
// `appointments.slot_id`), que se filtra a lista final.
import { NotFoundError } from "../../../platform/errors/index.js";
import type { ActorIdentity, AppointmentsDeps, ClinicSlotLite } from "./ports.js";

export interface ListAvailableSlotsQuery {
  specialty?: string;
}

export interface AvailableSlotsResult {
  clinicName: string;
  items: ClinicSlotLite[];
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

      const slots = await deps.clinics.listFreeSlots(clinicId, query.specialty);
      if (slots.length === 0) {
        return { clinicName: clinic.name, items: [] };
      }
      const activeSlotIds = new Set(await deps.appointmentsRepo.listActiveSlotIds(trx, slots.map((slot) => slot.id)));
      return { clinicName: clinic.name, items: slots.filter((slot) => !activeSlotIds.has(slot.id)) };
    });
  };
}
