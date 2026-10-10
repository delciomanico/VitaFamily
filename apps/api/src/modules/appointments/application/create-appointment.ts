// openapi.yaml `createAppointment`: "Autorização: WRITE(APPOINTMENTS). FR-APT-01; gera lembretes
// 24 h e 2 h se futura." A geração de lembretes é responsabilidade de `alerts` (M8, modules.md §2:
// `alerts` depende de `appointments`, nunca o inverso) — este módulo só garante que os dados
// (`scheduledAt`, `status`) ficam corretos para esse scanner ler mais tarde.
import { ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidCreationStatus, type Appointment, type AppointmentStatus } from "../domain/appointment.js";
import type { ActorIdentity, AppointmentsDeps, NewAppointmentRecord, RequestContext } from "./ports.js";
import { resolveClinicSnapshot } from "./support.js";

export interface CreateAppointmentInput {
  scheduledAt: string;
  professionalName?: string | null;
  clinicId?: string | null;
  clinicName?: string | null;
  reason?: string | null;
  notes?: string | null;
  status?: AppointmentStatus | null;
}

function parseScheduledAt(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ field: "scheduledAt", message: "data/hora inválida" }], { detail: "Data/hora da consulta inválida." });
  }
  return date;
}

export function createCreateAppointmentUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function createAppointment(actor: ActorIdentity, familyId: string, memberId: string, input: CreateAppointmentInput, context: RequestContext): Promise<Appointment> {
    const scheduledAt = parseScheduledAt(input.scheduledAt);
    // UC-APT-01 alternativo: registo retroativo pode nascer já REALIZADA; por omissão, AGENDADA
    // mesmo se `scheduledAt` for passado (BR-APT-02: o sistema nunca assume o desfecho).
    const status = input.status ?? "SCHEDULED";
    assertValidCreationStatus(status);

    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "CREATE",
        subjectMemberId: memberId,
        category: "APPOINTMENTS",
      });

      const clinicSnapshot = await resolveClinicSnapshot(deps, trx, familyId, input.clinicId, input.clinicName);

      const now = deps.clock.now();
      const record: NewAppointmentRecord = {
        id: newId(),
        familyId,
        memberId,
        scheduledAt,
        status,
        createdAt: now,
        ...(input.professionalName ? { professionalName: input.professionalName } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        ...clinicSnapshot,
      };
      const appointment = await deps.appointmentsRepo.insert(trx, record);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "APPOINTMENT_CREATE",
        resourceType: "Appointment",
        resourceId: appointment.id,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return appointment;
    });
  };
}
