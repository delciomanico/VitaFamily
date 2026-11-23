// Leitura e cálculo do Resumo de saúde (UC-RPT-05/05b, BR-RPT-11..17). Cada leitura passa pela
// `AccessPolicy` do módulo dono; `Forbidden`/`NotFound` = secção omitida (BR-RPT-01). Os números
// são aritmética determinística (domain/health-summary.ts), sem IA e sem juízo clínico.
import { localDateIso, addDaysIso, localMidnightUtc } from "../../../platform/time/index.js";
import {
  ENDING_SOON_DAYS,
  UPCOMING_DAYS,
  adherencePct,
  buildAdherenceSeries,
  buildExamSeries,
  countByMonth,
  countByStatus,
  inRange,
  missingItem,
  sumAdherence,
  withinNextDays,
  type ExamFact,
  type MissingRecordItem,
} from "../domain/health-summary.js";
import type { ReportPeriod } from "../domain/period.js";
import type { ActorIdentity, ApiObject, HealthSummarySources, ReportSources, RequestContext } from "./ports.js";
import { DOSE_MAX_PAGES, list, num, readAll, readable, str } from "./support.js";

export interface MemberFacts {
  bloodType?: string | null;
  prescriptions?: ApiObject[];
  activePlans?: ApiObject[];
  adherence?: ApiObject[];
  doses?: ApiObject[];
  appointments?: ApiObject[];
  openAppointments?: ApiObject[];
  examinations?: ApiObject[];
}

export interface SummaryClock {
  now: Date;
  today: string;
  timeZone: string;
}

export async function readMemberFacts(
  sources: ReportSources,
  actor: ActorIdentity,
  familyId: string,
  memberId: string,
  period: ReportPeriod,
  time: SummaryClock,
  context: RequestContext,
): Promise<MemberFacts> {
  const nowIso = time.now.toISOString();
  const periodStart = localMidnightUtc(period.from, time.timeZone);
  const periodEnd = new Date(localMidnightUtc(addDaysIso(period.to, 1), time.timeZone).getTime() - 1);
  const doseTo = new Date(Math.min(periodEnd.getTime(), time.now.getTime())).toISOString();
  const [bloodType, prescriptions, activePlans, adherence, doses, appointments, openAppointments, examinations] = await Promise.all([
    readable(() => sources.bloodType(actor, familyId, memberId, context)),
    readable(() => readAll(sources.prescriptions, actor, familyId, memberId, {}, context)),
    readable(() => readAll(sources.plans, actor, familyId, memberId, { status: "ACTIVE" }, context)),
    // Reutiliza `medicationAdherence` (BR-RPT-13): contagens por plano, `pending` fica fora da percentagem.
    readable(() => sources.adherence(actor, familyId, memberId, { from: period.from, to: period.to, timeZone: time.timeZone }, context)),
    readable(() => readAll(sources.doses, actor, familyId, memberId, { from: periodStart.toISOString(), to: doseTo }, context, DOSE_MAX_PAGES)),
    readable(() => readAll(sources.appointments, actor, familyId, memberId, { from: periodStart.toISOString() }, context)),
    readable(() => readAll(sources.appointments, actor, familyId, memberId, { status: "SCHEDULED", to: nowIso }, context)),
    readable(() => readAll(sources.examinations, actor, familyId, memberId, {}, context)),
  ]);
  return {
    ...(bloodType !== undefined ? { bloodType } : {}),
    ...(prescriptions !== undefined ? { prescriptions } : {}),
    ...(activePlans !== undefined ? { activePlans } : {}),
    ...(adherence !== undefined ? { adherence } : {}),
    ...(doses !== undefined ? { doses } : {}),
    ...(appointments !== undefined ? { appointments } : {}),
    ...(openAppointments !== undefined ? { openAppointments } : {}),
    ...(examinations !== undefined ? { examinations } : {}),
  };
}

export const hasAnyFact = (facts: MemberFacts): boolean => Object.keys(facts).length > 0;

const localDay = (instant: string, timeZone: string): string => {
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? "" : localDateIso(date, timeZone);
};

// --- secções ---

export function medicationSection(facts: MemberFacts, period: ReportPeriod, time: SummaryClock) {
  if (facts.adherence === undefined) return undefined;
  const items = facts.adherence.map((item) => ({
    ...item,
    taken: num(item, "taken") ?? 0,
    notTaken: num(item, "notTaken") ?? 0,
    unconfirmed: num(item, "unconfirmed") ?? 0,
    pending: num(item, "pending") ?? 0,
  }));
  const overall = sumAdherence(items);
  const { granularity, series } = buildAdherenceSeries(
    (facts.doses ?? []).map((d) => ({ scheduledAt: str(d, "scheduledAt"), status: str(d, "status") })),
    period,
    time.now,
    time.timeZone,
  );
  return {
    overall: { periodStart: period.from, ...overall, adherencePct: adherencePct(overall) },
    byMedication: items.filter((i) => i.taken + i.notTaken + i.unconfirmed + i.pending > 0).map((i) => ({ ...i, adherencePct: adherencePct(i) })),
    granularity,
    series,
  };
}

export function prescriptionsSection(facts: MemberFacts, period: ReportPeriod, time: SummaryClock) {
  if (facts.prescriptions === undefined) return undefined;
  const endingSoon = (rx: ApiObject) =>
    list(rx, "medications").some((plan) => {
      const endAt = str(plan, "endAt");
      return plan.status !== "ENDED" && endAt !== "" && withinNextDays(localDay(endAt, time.timeZone), time.today, ENDING_SOON_DAYS);
    });
  const active = facts.prescriptions.filter((rx) => rx.status === "ACTIVE");
  return {
    active: active.length,
    endingSoon: active.filter(endingSoon).length,
    // Sem data de fecho no contrato de leitura: usa-se a data de emissão (a validar, OP-143).
    closedInPeriod: facts.prescriptions.filter((rx) => (rx.status === "COMPLETED" || rx.status === "CANCELLED") && inRange(str(rx, "issuedOn"), period.from, period.to)).length,
  };
}

export function examsSection(facts: MemberFacts, period: ReportPeriod, time: SummaryClock) {
  if (facts.examinations === undefined) return undefined;
  const inPeriod = facts.examinations.filter((e) => inRange(str(e, "examDate"), period.from, period.to));
  const exams: ExamFact[] = inPeriod.map((e) => ({
    examDate: str(e, "examDate"),
    results: list(e, "results").map((r) => ({
      parameter: str(r, "parameter"),
      valueNumeric: num(r, "valueNumeric"),
      unit: typeof r.unit === "string" ? r.unit : null,
      referenceMin: num(r, "referenceMin"),
      referenceMax: num(r, "referenceMax"),
      createdAt: str(r, "createdAt"),
    })),
  }));
  const { series, truncated } = buildExamSeries(exams);
  return {
    byStatus: countByStatus(inPeriod.map((e) => ({ status: str(e, "status") }))),
    byMonth: countByMonth(inPeriod.map((e) => str(e, "examDate"))),
    upcoming30d: facts.examinations.filter((e) => e.status === "SCHEDULED" && withinNextDays(str(e, "examDate"), time.today, UPCOMING_DAYS)).length,
    series,
    truncated,
  };
}

export function appointmentsSection(facts: MemberFacts, period: ReportPeriod, time: SummaryClock) {
  if (facts.appointments === undefined) return undefined;
  const days = facts.appointments.map((a) => ({ appointment: a, day: localDay(str(a, "scheduledAt"), time.timeZone) }));
  const inPeriod = days.filter(({ day }) => day !== "" && inRange(day, period.from, period.to));
  return {
    byStatus: countByStatus(inPeriod.map(({ appointment }) => ({ status: str(appointment, "status") }))),
    byMonth: countByMonth(inPeriod.map(({ day }) => day)),
    upcoming30d: days.filter(({ appointment, day }) => appointment.status === "SCHEDULED" && new Date(str(appointment, "scheduledAt")) > time.now && withinNextDays(day, time.today, UPCOMING_DAYS)).length,
  };
}

/** BR-RPT-17: só completude; `canWrite` decide se se devolvem os ids dos registos (WRITE). */
export async function missingSection(
  facts: MemberFacts,
  actor: ActorIdentity,
  familyId: string,
  memberId: string,
  time: SummaryClock,
  canWrite: HealthSummarySources["canWrite"] | null,
): Promise<MissingRecordItem[] | undefined> {
  if (Object.keys(facts).length === 0) return undefined;
  const write = async (category: "MEDICATION" | "APPOINTMENTS" | "EXAMS", action: "UPDATE" | "CONFIRM_DOSE" = "UPDATE") => (canWrite ? canWrite(actor, familyId, memberId, category, action).catch(() => false) : false);
  const ids = (items: ApiObject[]) => items.map((i) => str(i, "id")).filter((id) => id !== "");
  const items: (MissingRecordItem | null)[] = [];

  // `health-records` devolve `UNKNOWN` (e não `null`) quando o tipo sanguíneo não foi indicado.
  if (facts.bloodType !== undefined && (!facts.bloodType || facts.bloodType === "UNKNOWN")) items.push(missingItem("BLOOD_TYPE_UNSET", [], false, 1));
  if (facts.openAppointments !== undefined) items.push(missingItem("APPOINTMENT_PAST_OPEN", ids(facts.openAppointments), await write("APPOINTMENTS")));
  if (facts.examinations !== undefined) {
    const open = facts.examinations.filter((e) => e.status === "SCHEDULED" && str(e, "examDate") < time.today);
    const withoutResults = facts.examinations.filter((e) => e.status === "COMPLETED" && list(e, "results").length === 0 && list(e, "documentIds").length === 0);
    const canWriteExams = open.length + withoutResults.length > 0 ? await write("EXAMS") : false;
    items.push(missingItem("EXAM_PAST_OPEN", ids(open), canWriteExams), missingItem("EXAM_WITHOUT_RESULTS", ids(withoutResults), canWriteExams));
  }
  if (facts.prescriptions !== undefined) {
    // Receitas digitais (CLINIC/PROFESSIONAL) são só de leitura para a família: não há documento a anexar (BR-RX-07).
    const without = facts.prescriptions.filter((rx) => rx.status === "ACTIVE" && rx.issuedBy === "FAMILY" && list(rx, "documentIds").length === 0);
    items.push(missingItem("PRESCRIPTION_WITHOUT_DOCUMENT", ids(without), without.length > 0 ? await write("MEDICATION") : false));
  }
  if (facts.activePlans !== undefined) {
    const without = facts.activePlans.filter((p) => (p.scheduleType === "FIXED_TIMES" ? list(p, "times").length === 0 : !num(p, "intervalHours")));
    items.push(missingItem("PLAN_WITHOUT_SCHEDULE", ids(without), without.length > 0 ? await write("MEDICATION") : false));
  }
  if (facts.doses !== undefined) {
    const unconfirmed = facts.doses.filter((d) => d.status === "UNCONFIRMED");
    items.push(missingItem("DOSES_UNCONFIRMED", ids(unconfirmed), unconfirmed.length > 0 ? await write("MEDICATION", "CONFIRM_DOSE") : false));
  }
  return items.filter((item): item is MissingRecordItem => item !== null);
}
