// Marcação presencial pela clínica para um utilizador Vita já registado (D20, ADR-024, BR-CLN-10,
// UC-CLN-08, endpoints.md `/clinic-portal/patient-lookup` e `/clinic-portal/walk-in-appointments`).
// Autenticado pelo ator de clínica (ADR-020) — nunca `AccessPolicy`/`User` (authorization.md §6.1/§6.2:
// ambos os papéis; o isolamento é "horário da clínica do ator", via `clinics.findSlot`).
// Minimização (BR-CLN-03 emendado): a clínica nunca recebe ids de utilizador/família/membro; o
// e-mail e o `displayName` nunca entram em auditoria, `metadata` nem logs. O oráculo de existência é
// uniforme: inexistente, não `ACTIVE` ou sem `SELF` => o mesmo 404 (resolvido por `PatientDirectoryPort`).
import { ConflictError, NotFoundError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import {
  buildPatientDisplayName,
  normalizeWalkInEmail,
  WALK_IN_ACCOUNT_RULE,
  WALK_IN_IP_RULE,
  WALK_IN_NOTES_MAX,
  WALK_IN_NOT_FOUND_RULE,
} from "../domain/walk-in.js";
import { toView, type ClinicAppointmentView } from "./clinic-appointments.js";
import type { AppointmentsDeps, ClinicPortalActor, RequestContext } from "./ports.js";

const PATIENT_NOT_FOUND_DETAIL = "Utilizador não encontrado.";

/** BR-CLN-10: 30/h por conta (partilhado pelos dois endpoints), 60/h por IP; 404 de paciente contados à parte. */
async function enforceRateLimit<Trx>(
  deps: AppointmentsDeps<Trx>,
  actor: ClinicPortalActor,
  context: RequestContext,
  action: "CLINIC_WALKIN_LOOKUP" | "CLINIC_WALKIN_BOOK",
): Promise<void> {
  const ipDecision = deps.walkInRateLimiter.consume(`walk-in:ip:${context.ip ?? "unknown"}`, WALK_IN_IP_RULE);
  const accountDecision = deps.walkInRateLimiter.consume(`walk-in:account:${actor.clinicAccountId}`, WALK_IN_ACCOUNT_RULE);
  const failurePeek = deps.walkInRateLimiter.peek(`walk-in:404:${actor.clinicAccountId}`, WALK_IN_NOT_FOUND_RULE);
  const blocked = [ipDecision, accountDecision, failurePeek].find((decision) => !decision.allowed);
  if (!blocked) {
    return;
  }
  const retryAfterMs = Math.max(ipDecision.retryAfterMs, accountDecision.retryAfterMs, failurePeek.retryAfterMs);
  await deps.withTransaction(async (trx) => {
    await deps.audit.record(trx, {
      occurredAt: deps.clock.now(),
      actorType: "CLINIC_ACCOUNT",
      actorClinicAccountId: actor.clinicAccountId,
      action,
      resourceType: action === "CLINIC_WALKIN_LOOKUP" ? "FamilyMember" : "Appointment",
      result: "DENIED",
      requestId: context.requestId,
      ...auditContextFields(context),
      metadata: { reason: "RATE_LIMITED" },
    });
  });
  throw new RateLimitedError(retryAfterMs);
}

function countPatientNotFound<Trx>(deps: AppointmentsDeps<Trx>, actor: ClinicPortalActor): void {
  deps.walkInRateLimiter.consume(`walk-in:404:${actor.clinicAccountId}`, WALK_IN_NOT_FOUND_RULE);
}

export interface ClinicPatientLookupResult {
  displayName: string;
}

/** `POST /clinic-portal/patient-lookup`: 200 `{displayName}` ou 404 genérico (BR-CLN-10). */
export function createClinicPatientLookupUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function clinicPatientLookup(actor: ClinicPortalActor, input: { email: unknown }, context: RequestContext): Promise<ClinicPatientLookupResult> {
    const email = normalizeWalkInEmail(input.email);
    await enforceRateLimit(deps, actor, context, "CLINIC_WALKIN_LOOKUP");

    const found = await deps.withTransaction(async (trx) => {
      const patient = await deps.patients.findSelfByEmail(trx, email);
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "CLINIC_WALKIN_LOOKUP",
        resourceType: "FamilyMember",
        ...(patient ? { resourceId: patient.memberId, familyId: patient.familyId, subjectMemberId: patient.memberId } : {}),
        result: patient ? "SUCCESS" : "FAILURE",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      return patient;
    });

    if (!found) {
      countPatientNotFound(deps, actor);
      throw new NotFoundError({ detail: PATIENT_NOT_FOUND_DETAIL });
    }
    return { displayName: buildPatientDisplayName(found.fullName) };
  };
}

export interface CreateWalkInAppointmentInput {
  /** Exatamente um de `patientEmail` e `clinicPatientId` (BR-CLN-18; `VALIDATION_ERROR` caso contrário). */
  patientEmail?: unknown;
  clinicPatientId?: unknown;
  slotId: string;
  notes?: string | null;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** `POST /clinic-portal/walk-in-appointments`: ordem horário -> paciente -> estado do horário -> sobreposição.
 * M14 P (BR-CLN-18): `patientEmail` cria/liga o paciente da clínica; `clinicPatientId` ligado => consulta no membro;
 * sem ligação (manual/revogada) => visita presencial só da clínica (`clinic-patients`). */
export function createCreateWalkInAppointmentUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function createWalkInAppointment(actor: ClinicPortalActor, input: CreateWalkInAppointmentInput, context: RequestContext): Promise<ClinicAppointmentView> {
    if (isPresent(input.patientEmail) === isPresent(input.clinicPatientId)) {
      throw new ValidationError([{ field: "patientEmail", message: "indique exatamente um de patientEmail e clinicPatientId" }], { detail: "Indique exatamente um identificador do paciente." });
    }
    const email = isPresent(input.patientEmail) ? normalizeWalkInEmail(input.patientEmail, "patientEmail") : undefined;
    const clinicPatientId = typeof input.clinicPatientId === "string" ? input.clinicPatientId : undefined;
    const notes = input.notes?.trim() ? input.notes.trim() : undefined;
    if (notes && notes.length > WALK_IN_NOTES_MAX) {
      throw new ValidationError([{ field: "notes", message: `máximo ${String(WALK_IN_NOTES_MAX)} caracteres` }], { detail: "Observações demasiado longas." });
    }
    await enforceRateLimit(deps, actor, context, "CLINIC_WALKIN_BOOK");

    const outcome = await deps.withTransaction(async (trx) => {
      // 1. Horário da própria clínica (outra clínica/inexistente => 404, sem distinguir).
      const found = await deps.clinics.findSlot(actor.clinicId, input.slotId);
      if (!found) {
        throw new NotFoundError({ detail: "Horário não encontrado." });
      }
      // 2. Paciente (404 genérico; contado à parte para o rate limit, fora da transação que falha).
      let patient: { familyId: string; memberId: string; fullName: string } | null = null;
      if (email !== undefined) {
        patient = await deps.patients.findSelfByEmail(trx, email);
      } else if (clinicPatientId !== undefined) {
        const resolved = await deps.clinicPatients.resolvePatient(trx, actor.clinicId, clinicPatientId);
        if (resolved && !resolved.link) {
          // BR-CLN-18 (c): sem ligação Vita => visita presencial só da clínica.
          return deps.clinicPatients.bookVisit(trx, actor, { clinicPatientId: resolved.clinicPatientId, slotId: found.id, notes: notes ?? null }, context);
        }
        patient = resolved?.link ? { ...resolved.link, fullName: resolved.name } : null;
      }
      if (!patient) {
        return null;
      }
      // 3. Estado do horário, sob bloqueio da linha (BR-APT-06/11: um só vence a corrida).
      const slot = await deps.clinics.lockSlot(trx, found.id);
      if (slot?.clinicId !== actor.clinicId) {
        throw new NotFoundError({ detail: "Horário não encontrado." });
      }
      if (slot.kind !== "APPOINTMENT") {
        throw new ValidationError([{ field: "slotId", message: "horário de exame; só consultas" }], { detail: "Horário inválido para consulta." });
      }
      const now = deps.clock.now();
      if (slot.startsAt.getTime() <= now.getTime()) {
        throw new ConflictError({ detail: "O horário já passou." });
      }
      if (await deps.appointmentsRepo.findActiveBySlot(trx, slot.id)) {
        throw new ConflictError({ detail: "Esse horário já tem uma marcação ativa." });
      }
      // BR-APT-06 (M14 P): uma visita manual `SCHEDULED` também ocupa o horário.
      if ((await deps.clinicPatients.countActiveVisitsBySlot(trx, [slot.id])).some((row) => row.count > 0)) {
        throw new ConflictError({ detail: "Esse horário já tem uma marcação ativa." });
      }
      // 4. Sobreposição por duração (BR-CLN-16): consulta SCHEDULED do paciente cujo intervalo
      // `[início, início + duração)` sobrepõe o do horário.
      const endsAt = new Date(slot.startsAt.getTime() + slot.durationMinutes * 60_000);
      const overlapping = await deps.appointmentsRepo.findScheduledOverlapping(trx, patient.familyId, patient.memberId, slot.startsAt, endsAt);
      if (overlapping.length > 0) {
        throw new ConflictError({ detail: "O paciente já tem uma consulta nesse período." });
      }
      // 4b. Defesa em profundidade (BR-CLN-13): o profissional já tem outra marcação ativa sobreposta
      // (consulta REQUESTED/SCHEDULED ou exame SCHEDULED) — só possível com dados antigos/manuais.
      if (slot.professionalId) {
        const others = await deps.clinics.listProfessionalSlotsOverlapping(trx, slot.professionalId, slot.startsAt, endsAt, slot.id);
        if (others.length > 0) {
          const consultations = await deps.appointmentsRepo.countActiveBySlot(trx, others);
          const exams = await deps.examSlotOccupancy.countScheduledBySlot(trx, others);
          const visits = await deps.clinicPatients.countActiveVisitsBySlot(trx, others);
          if (consultations.length > 0 || exams.some((row) => row.count > 0) || visits.some((row) => row.count > 0)) {
            throw new ConflictError({ detail: "O profissional já tem uma marcação nesse período." });
          }
        }
      }
      const clinic = await deps.clinics.getBookableClinic(trx, patient.familyId, actor.clinicId);
      if (!clinic) {
        throw new ConflictError({ detail: "Clínica indisponível." });
      }

      // BR-CLN-18 (a)/BR-CLN-19: com e-mail, cria/reutiliza o paciente da clínica ligado ao membro e garante `BOOKINGS`.
      if (email !== undefined) {
        await deps.clinicPatients.ensureLinkedByEmail(trx, actor, { familyId: patient.familyId, memberId: patient.memberId, fullName: patient.fullName }, context);
      }

      const appointment = await deps.appointmentsRepo.insert(trx, {
        id: newId(),
        familyId: patient.familyId,
        memberId: patient.memberId,
        scheduledAt: slot.startsAt,
        status: "SCHEDULED",
        clinicId: clinic.id,
        clinicName: clinic.name,
        specialty: slot.specialty,
        slotId: slot.id,
        durationMinutes: slot.durationMinutes,
        walkIn: true,
        bookedByClinicAccountId: actor.clinicAccountId,
        createdAt: now,
        ...(slot.professionalName ? { professionalName: slot.professionalName } : {}),
        ...(notes ? { notes } : {}),
      });

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "CLINIC_WALKIN_BOOK",
        resourceType: "Appointment",
        resourceId: appointment.id,
        familyId: patient.familyId,
        subjectMemberId: patient.memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { slotId: slot.id },
      });

      // APPOINTMENT_CONFIRMED ao paciente: NÃO implementado (OP-22/OP-07); os lembretes 24 h/2 h
      // vêm do scanner de `alerts` sobre consultas SCHEDULED (BR-APT-03/07).
      return toView(deps, trx, appointment);
    });

    if (!outcome) {
      countPatientNotFound(deps, actor);
      throw new NotFoundError({ detail: PATIENT_NOT_FOUND_DETAIL });
    }
    return outcome;
  };
}
