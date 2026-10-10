// openapi.yaml `listAppointments`: "Autorização: READ(APPOINTMENTS). Dependente com conta lê (N2)."
import { ValidationError } from "../../../platform/errors/index.js";
import { parsePageParams } from "../../../platform/page/index.js";
import type { AppointmentStatus } from "../domain/appointment.js";
import type { ActorIdentity, AppointmentListFilter, AppointmentsDeps, CursorPage, Appointment, RequestContext } from "./ports.js";
import { auditViewIfNotSelf } from "./support.js";

export interface ListAppointmentsQuery {
  status?: string;
  from?: string;
  to?: string;
  limit?: string;
  cursor?: string;
}

function isAppointmentStatus(value: string | undefined): value is AppointmentStatus {
  return value === "SCHEDULED" || value === "COMPLETED" || value === "NO_SHOW" || value === "CANCELLED";
}

function parseDateQuery(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ field, message: "data/hora inválida" }], { detail: "Filtro de período inválido." });
  }
  return date;
}

export function createListAppointmentsUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function listAppointments(actor: ActorIdentity, familyId: string, memberId: string, query: ListAppointmentsQuery, context: RequestContext): Promise<CursorPage<Appointment>> {
    const { limit, cursor } = parsePageParams(query.limit, query.cursor);
    const from = parseDateQuery(query.from, "from");
    const to = parseDateQuery(query.to, "to");

    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "APPOINTMENTS",
      });

      const filter: AppointmentListFilter = { ...(isAppointmentStatus(query.status) ? { status: query.status } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
      const page = await deps.appointmentsRepo.listByMember(trx, familyId, memberId, filter, limit, cursor);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, context });
      return page;
    });
  };
}
