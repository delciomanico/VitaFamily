// `ClinicPatientDirectory` (modules.md §2): o que o walk-in de `appointments` pede a este módulo — resolver o
// paciente da clínica (ligado a um membro Vita ou manual), criar/ligar por e-mail exato com `BOOKINGS`
// implícito (BR-CLN-18/19), saber que horários têm visita ativa e a que paciente pertence cada membro.
// `appointments` nunca lê as tabelas deste módulo; fala com esta porta (ligada no composition root).
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { normalizeSearchText } from "../domain/clinic-patient.js";
import { buildPatientDisplayName } from "../domain/display-name.js";
import type { ClinicPatientsDeps, ClinicPortalActor, RequestContext } from "./ports.js";

export interface ResolvedClinicPatient {
  clinicPatientId: string;
  name: string;
  /** Presente só se o paciente está ligado a um membro Vita (resolução no servidor; nunca sai para o portal). */
  link: { familyId: string; memberId: string } | null;
}

export function createResolvePatientUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function resolvePatient(trx: Trx, clinicId: string, clinicPatientId: string): Promise<ResolvedClinicPatient | null> {
    const patient = await deps.patientsRepo.findById(trx, clinicId, clinicPatientId);
    if (!patient) return null;
    const link = await deps.linksRepo.findByPatient(trx, clinicId, patient.id);
    return { clinicPatientId: patient.id, name: patient.name, link: link ? { familyId: link.familyId, memberId: link.memberId } : null };
  };
}

export interface EnsureLinkedByEmailInput {
  familyId: string;
  memberId: string;
  fullName: string;
}

/** BR-CLN-18 (a): cria ou reutiliza o `ClinicPatient` ligado ao membro `SELF` (`via=EMAIL`) e garante `BOOKINGS` (nunca baixa `HISTORY`). */
export function createEnsureLinkedByEmailUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function ensureLinkedByEmail(trx: Trx, actor: ClinicPortalActor, input: EnsureLinkedByEmailInput, context: RequestContext): Promise<{ clinicPatientId: string }> {
    const now = deps.clock.now();
    const existing = await deps.linksRepo.findByMember(trx, actor.clinicId, input.memberId);
    if (existing) {
      await deps.consentsRepo.insertBookingsIfMissing(trx, actor.clinicId, input.familyId, input.memberId, now);
      return { clinicPatientId: existing.clinicPatientId };
    }
    const name = buildPatientDisplayName(input.fullName) || "Paciente Vita";
    const patient = await deps.patientsRepo.insert(trx, {
      id: newId(),
      clinicId: actor.clinicId,
      name,
      nameNorm: normalizeSearchText(name),
      phone: null,
      phoneDigits: null,
      email: null,
      birthDate: null,
      notes: null,
      origin: "VITA",
      createdByClinicAccountId: actor.clinicAccountId,
      createdAt: now,
    });
    await deps.linksRepo.insert(trx, { clinicId: actor.clinicId, clinicPatientId: patient.id, familyId: input.familyId, memberId: input.memberId, via: "EMAIL" });
    await deps.consentsRepo.insertBookingsIfMissing(trx, actor.clinicId, input.familyId, input.memberId, now);
    await deps.audit.record(trx, {
      occurredAt: now,
      actorType: "CLINIC_ACCOUNT",
      actorClinicAccountId: actor.clinicAccountId,
      action: "CLINIC_PATIENT_LINK",
      resourceType: "ClinicPatient",
      resourceId: patient.id,
      familyId: input.familyId,
      subjectMemberId: input.memberId,
      result: "SUCCESS",
      requestId: context.requestId,
      ...auditContextFields(context),
      metadata: { via: "EMAIL", created: true },
    });
    return { clinicPatientId: patient.id };
  };
}

export function createCountActiveVisitsBySlotUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return (trx: Trx, slotIds: string[]): Promise<{ slotId: string; count: number }[]> => (slotIds.length === 0 ? Promise.resolve([]) : deps.visitsRepo.countScheduledBySlot(trx, slotIds));
}

/** `memberId -> clinicPatientId` na clínica (consultas Vita associam-se ao paciente pela ligação). */
export function createFindPatientIdsByMembersUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function findPatientIdsByMembers(trx: Trx, clinicId: string, memberIds: string[]): Promise<Map<string, string>> {
    if (memberIds.length === 0) return new Map();
    const links = await deps.linksRepo.findByMembers(trx, clinicId, memberIds);
    return new Map(links.map((link) => [link.memberId, link.clinicPatientId]));
  };
}
