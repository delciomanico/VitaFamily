// Ficha do paciente (UC-CLN-14, BR-CLN-03/17): só atividade da PRÓPRIA clínica com ele — consultas (Vita, pela ligação, e
// visitas manuais), exames e recomendações emitidas pela clínica; mais recentes primeiro, até 200 de cada. Nunca dados de
// saúde Vita (isso é `shared-history`). Revogar a ligação deixa de associar as marcações Vita; as visitas mantêm-se.
import { calendarDayState, type CalendarEntry } from "../domain/calendar.js";
import { visitWaitingMinutes } from "../domain/day-flow.js";
import type { ClinicPatientsDeps, ClinicPortalActor } from "./ports.js";
import { buildEntries } from "./calendar.js";
import { requireOwnPatient, toPatientView, type ClinicPatientView } from "./support.js";
import { toVisitViews } from "./visits.js";

export const RECORD_LIST_LIMIT = 200;

export interface RecordBookingView {
  id: string;
  status: CalendarEntry["status"];
  scheduledAt: string;
  specialty?: string;
  professionalName?: string;
  patientName: string;
  notes?: string;
  responseNote?: string;
  source: "VITA" | "MANUAL";
  clinicPatientId: string;
  slotId?: string;
  /** M14 Q (BR-CLN-25/28). */
  confirmationStatus: "PENDING" | "CONFIRMED" | "DECLINED";
  dayState: NonNullable<CalendarEntry["dayState"]>;
  arrivedAt?: string;
  startedAt?: string;
  waitingMinutes?: number;
  followUpDueOn?: string;
}

export interface RecordExamView {
  id: string;
  status: "SCHEDULED" | "COMPLETED";
  scheduledAt: string;
  examType?: string;
  professionalName?: string;
  patientName: string;
  notes?: string;
  responseNote?: string;
  resultsCount: number;
  slotId?: string;
}

export interface RecordRecommendationView {
  id: string;
  appointmentId?: string;
  examinationId?: string;
  patientName: string;
  text: string;
  createdAt: string;
}

export interface ClinicPatientRecordView {
  patient: ClinicPatientView;
  bookings: RecordBookingView[];
  examinations: RecordExamView[];
  recommendations: RecordRecommendationView[];
}

export function createGetClinicPatientRecordUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function getClinicPatientRecord(actor: ClinicPortalActor, patientId: string): Promise<ClinicPatientRecordView> {
    return deps.withTransaction(async (trx) => {
      const patient = await requireOwnPatient(deps, trx, actor, patientId);
      const link = await deps.linksRepo.findByPatient(trx, actor.clinicId, patient.id);
      const memberName = link ? ((await deps.members.getMemberName(trx, link.familyId, link.memberId)) ?? patient.name) : patient.name;

      const [appointments, examinations, recommendations, visits] = await Promise.all([
        link ? deps.calendar.listAppointmentsOfMember(trx, actor.clinicId, link.familyId, link.memberId, RECORD_LIST_LIMIT) : Promise.resolve([]),
        link ? deps.calendar.listExaminationsOfMember(trx, actor.clinicId, link.familyId, link.memberId, RECORD_LIST_LIMIT) : Promise.resolve([]),
        link ? deps.recommendations.listOfMember(trx, actor.clinicId, link.familyId, link.memberId, RECORD_LIST_LIMIT) : Promise.resolve([]),
        deps.visitsRepo.list(trx, actor.clinicId, { clinicPatientId: patient.id }, RECORD_LIST_LIMIT),
      ]);
      const { entries, slots } = await buildEntries(deps, trx, actor.clinicId, { appointments, examinations: [], visits: [] });
      const entryById = new Map(entries.map((entry) => [entry.id, entry]));

      const now = deps.clock.now();
      const vitaBookings: RecordBookingView[] = appointments.map((a) => {
        const waiting = visitWaitingMinutes(a.arrivedAt, a.startedAt, now);
        const professionalName = entryById.get(a.id)?.professionalName;
        return {
          id: a.id,
          status: a.status,
          scheduledAt: a.startsAt.toISOString(),
          patientName: memberName,
          source: "VITA" as const,
          clinicPatientId: patient.id,
          confirmationStatus: a.confirmationStatus,
          dayState: calendarDayState(a.status, a.arrivedAt, a.startedAt),
          ...(a.arrivedAt ? { arrivedAt: a.arrivedAt.toISOString() } : {}),
          ...(a.startedAt ? { startedAt: a.startedAt.toISOString() } : {}),
          ...(waiting !== null ? { waitingMinutes: waiting } : {}),
          ...(a.specialty ? { specialty: a.specialty } : {}),
          ...(professionalName ? { professionalName } : {}),
          ...(a.notes ? { notes: a.notes } : {}),
          ...(a.responseNote ? { responseNote: a.responseNote } : {}),
          ...(a.slotId ? { slotId: a.slotId } : {}),
        };
      });
      const visitBookings = await toVisitViews(deps, trx, actor.clinicId, visits);
      const bookings = [...vitaBookings, ...visitBookings].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)).slice(0, RECORD_LIST_LIMIT);

      const exams: RecordExamView[] = examinations
        .map((e) => {
          const slot = e.slotId ? slots.get(e.slotId) : undefined;
          return {
            id: e.id,
            status: e.status,
            scheduledAt: e.startsAt.toISOString(),
            patientName: memberName,
            resultsCount: e.resultsCount,
            ...(e.examType ? { examType: e.examType } : {}),
            ...(slot?.professionalName ? { professionalName: slot.professionalName } : {}),
            ...(e.notes ? { notes: e.notes } : {}),
            ...(e.responseNote ? { responseNote: e.responseNote } : {}),
            ...(e.slotId ? { slotId: e.slotId } : {}),
          };
        })
        .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));

      return {
        patient: await toPatientView(deps, trx, actor.clinicId, patient),
        bookings,
        examinations: exams,
        recommendations: recommendations.map((r) => ({
          id: r.id,
          patientName: memberName,
          text: r.text,
          createdAt: r.createdAt.toISOString(),
          ...(r.appointmentId ? { appointmentId: r.appointmentId } : {}),
          ...(r.examinationId ? { examinationId: r.examinationId } : {}),
        })),
      };
    });
  };
}
