// Âmbito do Médico (M14 R, BR-CLN-39, authorization.md §6.2b): o Médico (`professionalId` no ator) só vê e age em marcações
// cujo horário (`clinic_slots.professional_id`) é o seu e em pacientes que tenham ou tenham tido marcação com ele; fora disso
// `NOT_FOUND`. Admin/Gestor (sem `professionalId`) não são filtrados. Cada módulo dono do dado aplica o seu filtro.
import type { ClinicVisit } from "../domain/clinic-visit.js";
import type { ClinicPatientsDeps, ClinicPortalActor } from "./ports.js";

/** Quantas marcações recentes (consultas e exames Vita) se varrem para saber os pacientes do Médico. */
export const DOCTOR_SCOPE_SCAN_LIMIT = 1000;

export function isDoctor(actor: ClinicPortalActor): actor is ClinicPortalActor & { professionalId: string } {
  return actor.professionalId !== undefined;
}

/** Ids de horários (entre `slotIds`) cujo profissional é o do Médico. */
export async function slotsOfDoctor<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, actor: ClinicPortalActor & { professionalId: string }, slotIds: (string | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(slotIds.filter((id): id is string => id !== undefined))];
  if (ids.length === 0) return new Set();
  const slots = await deps.slots.findSlotsByIds(trx, actor.clinicId, ids);
  return new Set(slots.filter((s) => s.professionalId === actor.professionalId).map((s) => s.id));
}

export async function visitIsDoctors<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, visit: ClinicVisit): Promise<boolean> {
  if (!isDoctor(actor)) return true;
  return (await slotsOfDoctor(deps, trx, actor, [visit.slotId])).size > 0;
}

/** Pacientes (da clínica) com marcação, passada ou futura, no profissional do Médico: visitas e consultas/exames Vita ligados. */
export async function doctorPatientIds<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, actor: ClinicPortalActor & { professionalId: string }): Promise<string[]> {
  const [visits, appointments, examinations] = await Promise.all([
    deps.visitsRepo.list(trx, actor.clinicId, {}),
    deps.calendar.listRecentAppointments(trx, actor.clinicId, DOCTOR_SCOPE_SCAN_LIMIT),
    deps.calendar.listRecentExaminations(trx, actor.clinicId, DOCTOR_SCOPE_SCAN_LIMIT),
  ]);
  const own = await slotsOfDoctor(deps, trx, actor, [...visits.map((v) => v.slotId), ...appointments.map((a) => a.slotId), ...examinations.map((e) => e.slotId)]);
  const patientIds = new Set(visits.filter((v) => v.slotId && own.has(v.slotId)).map((v) => v.clinicPatientId));
  const memberIds = [...new Set([...appointments, ...examinations].filter((f) => f.slotId && own.has(f.slotId)).map((f) => f.memberId))];
  if (memberIds.length > 0) {
    for (const link of await deps.linksRepo.findByMembers(trx, actor.clinicId, memberIds)) patientIds.add(link.clinicPatientId);
  }
  return [...patientIds];
}
