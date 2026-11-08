// Histórico partilhado (UC-CLN-17, BR-CLN-21, ADR-026): leitura da medicação ativa e dos exames só quando há ligação E
// consentimento `HISTORY` válido NO MOMENTO do pedido (não é `AccessPolicy`: o `ClinicConsent` é o critério, avaliado a
// cada pedido). Sem consentimento: `200 active=false` com listas vazias (nunca 403). Auditada sem conteúdo.
import { auditContextFields } from "../../audit/index.js";
import { effectiveConsent } from "../domain/consent.js";
import type { ClinicPatientsDeps, ClinicPortalActor, RequestContext, SharedExam, SharedMedication } from "./ports.js";
import { requireOwnPatient } from "./support.js";

export interface ClinicSharedHistoryView {
  active: boolean;
  level: "BOOKINGS" | "HISTORY" | null;
  validUntil: string | null;
  medications: { name: string; dosage: string; startAt: string; endAt: string | null; continuous: boolean }[];
  examinations: SharedExam[];
}

/** BR-CLN-21: exames dos últimos 24 meses e futuros. */
export const SHARED_EXAMS_LOOKBACK_MONTHS = 24;

export function sharedExamsSince(now: Date): string {
  const since = new Date(now.getTime());
  since.setUTCMonth(since.getUTCMonth() - SHARED_EXAMS_LOOKBACK_MONTHS);
  return since.toISOString().slice(0, 10);
}

function toMedicationView(medication: SharedMedication) {
  return { name: medication.name, dosage: medication.dosage, startAt: medication.startAt.toISOString(), endAt: medication.endAt?.toISOString() ?? null, continuous: medication.continuous };
}

export function createGetSharedHistoryUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function getSharedHistory(actor: ClinicPortalActor, patientId: string, context: RequestContext): Promise<ClinicSharedHistoryView> {
    return deps.withTransaction(async (trx) => {
      const patient = await requireOwnPatient(deps, trx, actor, patientId);
      const now = deps.clock.now();
      const link = await deps.linksRepo.findByPatient(trx, actor.clinicId, patient.id);
      const consent = link ? await deps.consentsRepo.find(trx, actor.clinicId, link.memberId) : null;
      const effective = consent ? effectiveConsent(consent, now) : null;
      if (link === null || effective?.level !== "HISTORY") {
        return { active: false, level: effective?.level ?? null, validUntil: null, medications: [], examinations: [] };
      }
      const [medications, examinations] = await Promise.all([
        deps.sharedHistory.listActiveMedications(trx, link.familyId, link.memberId),
        deps.sharedHistory.listExams(trx, link.familyId, link.memberId, sharedExamsSince(now)),
      ]);
      // audit.md: só `active=true`, ids internos e o nível; nunca o conteúdo.
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "CLINIC_SHARED_HISTORY_VIEW",
        resourceType: "ClinicPatient",
        resourceId: patient.id,
        familyId: link.familyId,
        subjectMemberId: link.memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { level: "HISTORY" },
      });
      return { active: true, level: "HISTORY", validUntil: effective.validUntil?.toISOString() ?? null, medications: medications.map(toMedicationView), examinations };
    });
  };
}
