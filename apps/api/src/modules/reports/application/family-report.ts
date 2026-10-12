// UC-RPT-02 Visão familiar (FR-RPT-02/03): por membro visível ao pedinte (o próprio, os seus
// dependentes e quem partilha), alergias, condições, medicamentos ativos, próximas consultas e
// exames e itens pendentes. O Family Admin não vê mais por ser Admin (D13): cada leitura passa
// pela `AccessPolicy` do módulo dono; um membro sem nenhuma secção legível é omitido.
import type { ActorIdentity, ApiObject, ReportsDeps, RequestContext } from "./ports.js";
import { readAll, readable, str } from "./support.js";

/** Q4/proposta: tomas "não confirmadas" recentes contam como pendentes durante estes dias. */
export const RECENT_UNCONFIRMED_DAYS = 7;

const DAY_MS = 86_400_000;

interface PendingItem {
  type: "UNCONFIRMED_DOSE" | "APPOINTMENT_OUTCOME" | "EXAM_OUTCOME";
  sourceId: string;
  date: string;
}

export function createFamilyReportUseCase(deps: ReportsDeps) {
  const { sources, clock } = deps;

  return async function familyReport(actor: ActorIdentity, familyId: string, context: RequestContext) {
    const now = clock.now();
    const today = now.toISOString().slice(0, 10);
    const recentSince = new Date(now.getTime() - RECENT_UNCONFIRMED_DAYS * DAY_MS).toISOString();
    const members = await sources.listMembers(actor.userId, familyId);

    const rows = await Promise.all(
      members.map(async (member) => {
        const memberId = str(member, "id");
        const [allergies, conditions, plans, unconfirmed, upcoming, awaiting, exams] = await Promise.all([
          readable(() => sources.allergies(actor, familyId, memberId, context)),
          readable(() => sources.conditions(actor, familyId, memberId, context)),
          readable(() => readAll(sources.plans, actor, familyId, memberId, { status: "ACTIVE" }, context)),
          readable(() => readAll(sources.doses, actor, familyId, memberId, { status: "UNCONFIRMED", from: recentSince, to: now.toISOString() }, context)),
          readable(() => readAll(sources.appointments, actor, familyId, memberId, { status: "SCHEDULED", from: now.toISOString() }, context)),
          readable(() => readAll(sources.appointments, actor, familyId, memberId, { status: "SCHEDULED", to: now.toISOString() }, context)),
          readable(() => readAll(sources.examinations, actor, familyId, memberId, { status: "SCHEDULED" }, context)),
        ]);

        const readableSections = [allergies, conditions, plans, upcoming, exams];
        if (readableSections.every((section) => section === undefined) && unconfirmed === undefined && awaiting === undefined) return null;

        const pending: PendingItem[] = [
          ...(unconfirmed ?? []).map((d): PendingItem => ({ type: "UNCONFIRMED_DOSE", sourceId: str(d, "id"), date: str(d, "scheduledAt") })),
          ...(awaiting ?? []).map((a): PendingItem => ({ type: "APPOINTMENT_OUTCOME", sourceId: str(a, "id"), date: str(a, "scheduledAt") })),
          ...(exams ?? []).filter((e) => str(e, "examDate") < today).map((e): PendingItem => ({ type: "EXAM_OUTCOME", sourceId: str(e, "id"), date: str(e, "examDate") })),
        ];

        return {
          member,
          ...(allergies !== undefined ? { allergies } : {}),
          ...(conditions !== undefined ? { conditions: conditions.filter((c) => c.kind === "CONDITION") } : {}),
          ...(plans !== undefined ? { activeMedications: plans } : {}),
          ...(upcoming !== undefined ? { upcomingAppointments: [...upcoming].sort((a: ApiObject, b: ApiObject) => str(a, "scheduledAt").localeCompare(str(b, "scheduledAt"))) } : {}),
          ...(exams !== undefined
            ? { upcomingExaminations: exams.filter((e) => str(e, "examDate") >= today).sort((a, b) => str(a, "examDate").localeCompare(str(b, "examDate"))) }
            : {}),
          pending,
        };
      }),
    );

    return { generatedAt: now.toISOString(), members: rows.filter((row) => row !== null) };
  };
}
