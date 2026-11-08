// Calendário por profissional, pesquisa global e ficha do paciente (UC-CLN-14/18/19, BR-CLN-22/23): composição só de
// leitura sobre as portas `CalendarSource`/`SlotReservation` e os repositórios próprios. Mínimo necessário (BR-CLN-03);
// nunca ids Vita; nunca a base Vita (a única pesquisa Vita é e-mail exato/código nos fluxos de marcação/ligação).
import { NotFoundError } from "../../../platform/errors/index.js";
import {
  assertWithinItemLimit,
  bookingMatches,
  calendarDayState,
  compareEntries,
  orderSearchBookings,
  parseCalendarWindow,
  type CalendarEntry,
  type CalendarFreeSlot,
} from "../domain/calendar.js";
import { visitWaitingMinutes } from "../domain/day-flow.js";
import { buildSearchTerms, normalizeSearchText, parseSearchQuery } from "../domain/clinic-patient.js";
import type { ClinicVisit } from "../domain/clinic-visit.js";
import type { AppointmentFact, ClinicPatientsDeps, ClinicPortalActor, ExaminationFact, SlotFacts } from "./ports.js";
import { enforceSearchRateLimit, toPatientViews, type ClinicPatientView } from "./support.js";

const UNKNOWN_MEMBER = "Membro da família";
/** Varrimento da pesquisa de marcações: as N mais recentes por origem (BR-CLN-22, "por varrimento dentro da clínica"). */
export const SEARCH_BOOKING_SCAN_LIMIT = 1000;
const CALENDAR_APPOINTMENT_STATUSES = ["REQUESTED", "SCHEDULED", "COMPLETED", "NO_SHOW"];
/** BR-CLN-23 (emenda Q): visitas manuais; `NO_SHOW` desde BR-CLN-28 (a falta da clínica aparece como nas consultas). */
const CALENDAR_VISIT_STATUSES = ["SCHEDULED", "COMPLETED", "NO_SHOW"] as const;

/** BR-CLN-23 (emenda Q): consultas ativas/realizadas e as `CANCELLED` por "Não posso" (`DECLINED`, horário livre mas visível). */
function inCalendar(appointment: AppointmentFact): boolean {
  return CALENDAR_APPOINTMENT_STATUSES.includes(appointment.status) || (appointment.status === "CANCELLED" && appointment.confirmationStatus === "DECLINED");
}

export interface BuiltEntries {
  entries: CalendarEntry[];
  slots: Map<string, SlotFacts>;
}

/** Converte factos de consultas/exames/visitas em entradas, resolvendo nomes, horários e pacientes em lote. */
export async function buildEntries<Trx>(
  deps: ClinicPatientsDeps<Trx>,
  trx: Trx,
  clinicId: string,
  facts: { appointments: AppointmentFact[]; examinations: ExaminationFact[]; visits: ClinicVisit[] },
  knownSlots: SlotFacts[] = [],
): Promise<BuiltEntries> {
  const slots = new Map(knownSlots.map((slot) => [slot.id, slot]));
  const missingSlotIds = [
    ...new Set([...facts.appointments.map((a) => a.slotId), ...facts.examinations.map((e) => e.slotId), ...facts.visits.map((v) => v.slotId)].flatMap((id) => (id && !slots.has(id) ? [id] : []))),
  ];
  for (const slot of missingSlotIds.length === 0 ? [] : await deps.slots.findSlotsByIds(trx, clinicId, missingSlotIds)) {
    slots.set(slot.id, slot);
  }
  const memberIds = [...new Set([...facts.appointments, ...facts.examinations].map((f) => f.memberId))];
  const links = memberIds.length === 0 ? [] : await deps.linksRepo.findByMembers(trx, clinicId, memberIds);
  const patientIdByMember = new Map(links.map((link) => [link.memberId, link.clinicPatientId]));
  const names = new Map<string, string>();
  const nameOf = async (familyId: string, memberId: string): Promise<string> => {
    const cached = names.get(memberId);
    if (cached !== undefined) return cached;
    const name = (await deps.members.getMemberName(trx, familyId, memberId)) ?? UNKNOWN_MEMBER;
    names.set(memberId, name);
    return name;
  };
  const visitPatients = new Map((facts.visits.length === 0 ? [] : await deps.patientsRepo.findManyByIds(trx, clinicId, [...new Set(facts.visits.map((v) => v.clinicPatientId))])).map((p) => [p.id, p.name]));

  const now = deps.clock.now();
  const entries: CalendarEntry[] = [];
  for (const a of facts.appointments) {
    const slot = a.slotId ? slots.get(a.slotId) : undefined;
    entries.push({
      id: a.id,
      source: "VITA",
      kind: "APPOINTMENT",
      status: a.status,
      startsAt: a.startsAt,
      endsAt: new Date(a.startsAt.getTime() + a.durationMinutes * 60_000),
      professionalId: slot?.professionalId ?? null,
      professionalName: a.professionalName ?? slot?.professionalName ?? null,
      specialty: a.specialty ?? null,
      patientName: await nameOf(a.familyId, a.memberId),
      clinicPatientId: patientIdByMember.get(a.memberId) ?? null,
      slotId: a.slotId ?? null,
      confirmationStatus: a.confirmationStatus,
      dayState: calendarDayState(a.status, a.arrivedAt, a.startedAt),
      arrivedAt: a.arrivedAt ?? null,
      waitingMinutes: visitWaitingMinutes(a.arrivedAt, a.startedAt, now),
    });
  }
  for (const e of facts.examinations) {
    const slot = e.slotId ? slots.get(e.slotId) : undefined;
    entries.push({
      id: e.id,
      source: "VITA",
      kind: "EXAM",
      status: e.status,
      startsAt: e.startsAt,
      // BR-CLN-23: `endsAt` do exame = fim do horário (sem horário, o próprio início).
      endsAt: slot ? new Date(slot.startsAt.getTime() + slot.durationMinutes * 60_000) : e.startsAt,
      professionalId: slot?.professionalId ?? null,
      professionalName: slot?.professionalName ?? null,
      specialty: e.examType ?? slot?.specialty ?? null,
      patientName: await nameOf(e.familyId, e.memberId),
      clinicPatientId: patientIdByMember.get(e.memberId) ?? null,
      slotId: e.slotId ?? null,
      confirmationStatus: null,
      dayState: null,
      arrivedAt: null,
      waitingMinutes: null,
    });
  }
  for (const v of facts.visits) {
    const slot = v.slotId ? slots.get(v.slotId) : undefined;
    entries.push({
      id: v.id,
      source: "MANUAL",
      kind: "APPOINTMENT",
      status: v.status,
      startsAt: v.scheduledAt,
      endsAt: new Date(v.scheduledAt.getTime() + v.durationMinutes * 60_000),
      professionalId: slot?.professionalId ?? null,
      professionalName: slot?.professionalName ?? null,
      specialty: slot?.specialty ?? null,
      patientName: visitPatients.get(v.clinicPatientId) ?? "Paciente",
      clinicPatientId: v.clinicPatientId,
      slotId: v.slotId ?? null,
      confirmationStatus: v.confirmationStatus,
      dayState: calendarDayState(v.status, v.arrivedAt, v.startedAt),
      arrivedAt: v.arrivedAt ?? null,
      waitingMinutes: visitWaitingMinutes(v.arrivedAt, v.startedAt, now),
    });
  }
  return { entries, slots };
}

export interface ClinicCalendarView {
  from: Date;
  to: Date;
  entries: CalendarEntry[];
  freeSlots: CalendarFreeSlot[];
}

/** `GET /clinic-portal/calendar` (BR-CLN-23): só leitura; janela ≤ 31 dias; `professionalId` de outra clínica => 404. */
export function createGetClinicCalendarUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function getClinicCalendar(actor: ClinicPortalActor, query: { from: unknown; to: unknown; professionalId?: string | undefined }): Promise<ClinicCalendarView> {
    const window = parseCalendarWindow(query.from, query.to);
    return deps.withTransaction(async (trx) => {
      if (query.professionalId && !(await deps.slots.findProfessional(trx, actor.clinicId, query.professionalId))) {
        throw new NotFoundError({ detail: "Profissional não encontrado." });
      }
      const now = deps.clock.now();
      const [appointments, examinations, visits, slotsInWindow] = await Promise.all([
        deps.calendar.listAppointments(trx, actor.clinicId, window),
        deps.calendar.listExaminations(trx, actor.clinicId, window),
        deps.visitsRepo.list(trx, actor.clinicId, { statuses: [...CALENDAR_VISIT_STATUSES], from: window.from, to: window.to }),
        deps.slots.listSlots(trx, actor.clinicId, window),
      ]);
      const built = await buildEntries(
        deps,
        trx,
        actor.clinicId,
        { appointments: appointments.filter(inCalendar), examinations, visits },
        slotsInWindow,
      );
      const entries = built.entries.filter((entry) => !query.professionalId || entry.professionalId === query.professionalId).sort(compareEntries);

      // Horários futuros com vaga: consultas+exames (porta) + visitas SCHEDULED (repositório próprio, BR-APT-06).
      const candidates = slotsInWindow.filter((slot) => slot.startsAt.getTime() > now.getTime() && (!query.professionalId || slot.professionalId === query.professionalId));
      const ids = candidates.map((slot) => slot.id);
      const [counts, visitCounts] = ids.length === 0 ? [[], []] : await Promise.all([deps.slots.countActiveBySlot(trx, ids), deps.visitsRepo.countScheduledBySlot(trx, ids)]);
      const freeSlots: CalendarFreeSlot[] = [];
      for (const slot of candidates) {
        const c = counts.filter((row) => row.slotId === slot.id).reduce((sum, row) => ({ requested: sum.requested + row.requested, scheduled: sum.scheduled + row.scheduled }), { requested: 0, scheduled: 0 });
        const visitsCount = visitCounts.filter((row) => row.slotId === slot.id).reduce((sum, row) => sum + row.count, 0);
        const booked = slot.kind === "EXAM" ? c.scheduled : c.requested + c.scheduled + visitsCount;
        const remaining = Math.max(slot.capacity - booked, 0);
        if (remaining >= 1) {
          freeSlots.push({
            slotId: slot.id,
            kind: slot.kind,
            startsAt: slot.startsAt,
            endsAt: new Date(slot.startsAt.getTime() + slot.durationMinutes * 60_000),
            professionalId: slot.professionalId ?? null,
            professionalName: slot.professionalName ?? null,
            specialty: slot.specialty,
            remaining,
          });
        }
      }
      assertWithinItemLimit(entries.length);
      assertWithinItemLimit(freeSlots.length);
      return { from: window.from, to: window.to, entries, freeSlots };
    });
  };
}

export interface ClinicSearchView {
  patients: ClinicPatientView[];
  bookings: CalendarEntry[];
}

/** `GET /clinic-portal/search` (BR-CLN-22): ≤10 pacientes e ≤10 marcações da própria clínica; `q` nunca em logs/auditoria. */
export function createClinicGlobalSearchUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function clinicGlobalSearch(actor: ClinicPortalActor, rawQ: unknown): Promise<ClinicSearchView> {
    const q = parseSearchQuery(rawQ, true) ?? "";
    enforceSearchRateLimit(deps, actor);
    return deps.withTransaction(async (trx) => {
      const patients = await deps.patientsRepo.list(trx, actor.clinicId, { terms: buildSearchTerms(q) }, 10);
      const [appointments, examinations, visits] = await Promise.all([
        deps.calendar.listRecentAppointments(trx, actor.clinicId, SEARCH_BOOKING_SCAN_LIMIT),
        deps.calendar.listRecentExaminations(trx, actor.clinicId, SEARCH_BOOKING_SCAN_LIMIT),
        deps.visitsRepo.list(trx, actor.clinicId, {}, SEARCH_BOOKING_SCAN_LIMIT),
      ]);
      const { entries } = await buildEntries(deps, trx, actor.clinicId, { appointments, examinations, visits });
      const normalizedQ = normalizeSearchText(q);
      const matching = entries.filter((entry) => bookingMatches(entry, normalizedQ, normalizeSearchText));
      return { patients: await toPatientViews(deps, trx, actor.clinicId, patients), bookings: orderSearchBookings(matching, deps.clock.now()).slice(0, 10) };
    });
  };
}
