// Indicadores e retornos do portal da clínica (M14 Q, BR-CLN-29/30, UC-CLN-23/24): leituras agregadas só da PRÓPRIA clínica,
// sobre as portas `ReportSource` (consultas/exames) e `SlotReservation` (horários/capacidade) e os repositórios próprios
// (visitas, pacientes). Só contagens e taxas nos indicadores (nunca nomes nem ids); o nome/telefone dos retornos vêm do registo
// da clínica. Não se audita (volume, sem PII).
import { NotFoundError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { addDaysIso, isIsoDate, localDateIso } from "../../../platform/time/index.js";
import { isFollowUpNotified } from "../domain/day-flow.js";
import { REPORT_ACCOUNT_RULE } from "../domain/rate-limiter.js";
import { buildReport, parseReportWindow, type ReportCounts, type ReportFact } from "../domain/report.js";
import { isDoctor, slotsOfDoctor } from "./doctor-scope.js";
import type { ClinicPatientsDeps, ClinicPortalActor } from "./ports.js";

export interface ClinicReportRowView extends ReportCounts {
  professionalId: string | null;
  professionalName: string | null;
}

export interface ClinicReportSummaryView {
  from: string;
  to: string;
  totals: ReportCounts & { newPatients: number; examsCompleted: number };
  byProfessional: ClinicReportRowView[];
}

/** `GET /clinic-portal/reports/summary` (BR-CLN-29): `professionalId` de outra clínica => 404; 30 pedidos/min por conta. */
export function createGetClinicReportSummaryUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function getClinicReportSummary(actor: ClinicPortalActor, query: { from: unknown; to: unknown; professionalId?: string | undefined }): Promise<ClinicReportSummaryView> {
    const window = parseReportWindow(query.from, query.to);
    const decision = deps.reportLimiter.consume(`clinic-report:${actor.clinicAccountId}`, REPORT_ACCOUNT_RULE);
    if (!decision.allowed) {
      throw new RateLimitedError(decision.retryAfterMs);
    }
    return deps.withTransaction(async (trx) => {
      if (query.professionalId && !(await deps.slots.findProfessional(trx, actor.clinicId, query.professionalId))) {
        throw new NotFoundError({ detail: "Profissional não encontrado." });
      }
      const range = { from: window.start, to: window.end };
      const [slots, appointments, examinations, visits, newPatients] = await Promise.all([
        deps.slots.listSlots(trx, actor.clinicId, range),
        deps.reports.listAppointments(trx, actor.clinicId, range),
        deps.reports.listExaminations(trx, actor.clinicId, range),
        deps.visitsRepo.list(trx, actor.clinicId, { from: window.start, to: window.end }),
        deps.patientsRepo.countCreatedBetween(trx, actor.clinicId, window.start, window.end),
      ]);
      // Horários referidos por marcações mas fora da lista da janela (ex.: horário entretanto removido da janela): resolve o profissional.
      const professionalBySlot = new Map(slots.map((slot) => [slot.id, slot.professionalId ?? null]));
      const missing = [...new Set([...appointments, ...examinations, ...visits].flatMap((f) => (f.slotId && !professionalBySlot.has(f.slotId) ? [f.slotId] : [])))];
      for (const slot of missing.length === 0 ? [] : await deps.slots.findSlotsByIds(trx, actor.clinicId, missing)) {
        professionalBySlot.set(slot.id, slot.professionalId ?? null);
      }
      const professionalOf = (slotId: string | undefined): string | null => (slotId ? (professionalBySlot.get(slotId) ?? null) : null);
      const facts: ReportFact[] = [
        ...appointments.map((a) => ({ kind: "APPOINTMENT" as const, status: a.status, slotId: a.slotId ?? null, declined: a.confirmationStatus === "DECLINED", professionalId: professionalOf(a.slotId) })),
        ...visits.map((v) => ({ kind: "VISIT" as const, status: v.status, slotId: v.slotId ?? null, declined: false, professionalId: professionalOf(v.slotId) })),
        ...examinations.map((e) => ({ kind: "EXAM" as const, status: e.status, slotId: e.slotId ?? null, declined: false, professionalId: professionalOf(e.slotId) })),
      ];
      const report = buildReport(
        slots.map((slot) => ({ id: slot.id, capacity: slot.capacity, professionalId: slot.professionalId ?? null })),
        facts,
        query.professionalId,
      );

      const rows: ClinicReportRowView[] = [];
      for (const row of report.rows) {
        const professional = row.professionalId ? await deps.slots.findProfessional(trx, actor.clinicId, row.professionalId) : null;
        const { professionalId, ...counts } = row;
        rows.push({ ...counts, professionalId, professionalName: professional?.name ?? null });
      }
      // Profissionais por nome; "sem profissional" por último.
      rows.sort((a, b) => (a.professionalId === null ? 1 : 0) - (b.professionalId === null ? 1 : 0) || (a.professionalName ?? "").localeCompare(b.professionalName ?? "", "pt") || (a.professionalId ?? "").localeCompare(b.professionalId ?? ""));
      return { from: window.from, to: window.to, totals: { ...report.totals, newPatients }, byProfessional: rows };
    });
  };
}

export const FOLLOW_UP_LIST_LIMIT = 200;
export const FOLLOW_UP_DEFAULT_DAYS = 14;

export interface ClinicFollowUpView {
  bookingId: string;
  source: "VITA" | "MANUAL";
  clinicPatientId: string | null;
  patientName: string;
  patientPhone: string | null;
  dueOn: string;
  patientNotified: boolean;
}

/** `GET /clinic-portal/follow-ups?until=` (BR-CLN-30): retornos por tratar até `until` (omissão: hoje + 14 dias), ≤ 200, por data. */
export function createListClinicFollowUpsUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function listClinicFollowUps(actor: ClinicPortalActor, rawUntil: unknown): Promise<ClinicFollowUpView[]> {
    const now = deps.clock.now();
    if (rawUntil !== undefined && !isIsoDate(rawUntil)) {
      throw new ValidationError([{ field: "until", message: "esperado AAAA-MM-DD" }], { detail: "Data inválida." });
    }
    const until = rawUntil ?? addDaysIso(localDateIso(now), FOLLOW_UP_DEFAULT_DAYS);
    return deps.withTransaction(async (trx) => {
      let [vita, visits] = await Promise.all([
        deps.reports.listAppointmentFollowUps(trx, actor.clinicId, until, FOLLOW_UP_LIST_LIMIT),
        deps.visitsRepo.listFollowUps(trx, actor.clinicId, until, FOLLOW_UP_LIST_LIMIT),
      ]);
      if (isDoctor(actor)) {
        // BR-CLN-39: só os retornos das marcações do seu profissional.
        const own = await slotsOfDoctor(deps, trx, actor, [...vita.map((f) => f.slotId), ...visits.map((v) => v.slotId ?? undefined)]);
        vita = vita.filter((f) => f.slotId && own.has(f.slotId));
        visits = visits.filter((v) => v.slotId && own.has(v.slotId));
      }
      const links = vita.length === 0 ? [] : await deps.linksRepo.findByMembers(trx, actor.clinicId, [...new Set(vita.map((f) => f.memberId))]);
      const patientIdByMember = new Map(links.map((link) => [link.memberId, link.clinicPatientId]));
      const patientIds = [...new Set([...patientIdByMember.values(), ...visits.map((v) => v.clinicPatientId)])];
      const patients = new Map((patientIds.length === 0 ? [] : await deps.patientsRepo.findManyByIds(trx, actor.clinicId, patientIds)).map((p) => [p.id, p]));

      const items: ClinicFollowUpView[] = [];
      for (const fact of vita) {
        const clinicPatientId = patientIdByMember.get(fact.memberId) ?? null;
        const patient = clinicPatientId ? patients.get(clinicPatientId) : undefined;
        const name = (await deps.members.getMemberName(trx, fact.familyId, fact.memberId)) ?? patient?.name ?? "Membro da família";
        items.push({ bookingId: fact.id, source: "VITA", clinicPatientId, patientName: name, patientPhone: patient?.phone ?? null, dueOn: fact.dueOn, patientNotified: isFollowUpNotified("VITA", fact.dueOn, now) });
      }
      for (const visit of visits) {
        const patient = patients.get(visit.clinicPatientId);
        if (!visit.followUpDueOn) continue;
        items.push({ bookingId: visit.id, source: "MANUAL", clinicPatientId: visit.clinicPatientId, patientName: patient?.name ?? "Paciente", patientPhone: patient?.phone ?? null, dueOn: visit.followUpDueOn, patientNotified: false });
      }
      items.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.bookingId.localeCompare(b.bookingId));
      return items.slice(0, FOLLOW_UP_LIST_LIMIT);
    });
  };
}
