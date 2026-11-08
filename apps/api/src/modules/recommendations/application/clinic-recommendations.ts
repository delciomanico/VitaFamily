// Casos de uso do portal da clínica parceira sobre `Recommendation` (D19/ADR-023, BR-CLN-09,
// UC-REC-01/02; endpoints.md `/clinic-portal/recommendations`). Autenticados pelo ator de clínica
// (`ClinicPortalActor`, ADR-020) — nunca `AccessPolicy`/`User` (authorization.md §6.1: a verificação é
// "clínica do token = clínica da origem", feita pelas portas `origins` e por `listByClinic`).
// BR-CLN-03: a vista só traz o mínimo (nome do paciente + o texto que a própria clínica escreveu).
import { NotFoundError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertOriginAcceptsRecommendation, parseRecommendationDraft, type Recommendation } from "../domain/recommendation.js";
import type { ClinicPortalActor, OriginFacts, RecommendationsDeps, RequestContext } from "./ports.js";

export interface ClinicRecommendationView {
  id: string;
  appointmentId?: string;
  examinationId?: string;
  patientName: string;
  text: string;
  createdAt: string;
}

export interface CreateClinicRecommendationInput {
  appointmentId?: string | null;
  examinationId?: string | null;
  text: string;
}

export interface ListClinicRecommendationsQuery {
  appointmentId?: string;
  examinationId?: string;
}

/** Limite de segurança da listagem do portal (o contrato devolve um array, sem paginação). */
const CLINIC_LIST_LIMIT = 200;
const UNKNOWN_PATIENT = "Membro da família";

function toView(recommendation: Recommendation, patientName: string): ClinicRecommendationView {
  return {
    id: recommendation.id,
    patientName,
    text: recommendation.text,
    createdAt: recommendation.createdAt.toISOString(),
    ...(recommendation.appointmentId ? { appointmentId: recommendation.appointmentId } : {}),
    ...(recommendation.examinationId ? { examinationId: recommendation.examinationId } : {}),
  };
}

/** `POST /clinic-portal/recommendations` (UC-REC-01): uma transação — grava, audita (sem texto) e alerta. */
export function createCreateClinicRecommendationUseCase<Trx>(deps: RecommendationsDeps<Trx>) {
  return async function createClinicRecommendation(actor: ClinicPortalActor, input: CreateClinicRecommendationInput, context: RequestContext): Promise<ClinicRecommendationView> {
    const draft = parseRecommendationDraft(input);

    return deps.withTransaction(async (trx) => {
      const origin: OriginFacts | null =
        draft.origin.kind === "APPOINTMENT"
          ? await deps.origins.findAppointmentOfClinic(trx, actor.clinicId, draft.origin.id, actor.professionalId)
          : await deps.origins.findExaminationOfClinic(trx, actor.clinicId, draft.origin.id, actor.professionalId);
      // Origem de outra clínica ou inexistente: NOT_FOUND indistinto (nunca revela existência).
      if (!origin) {
        throw new NotFoundError({ detail: draft.origin.kind === "APPOINTMENT" ? "Consulta não encontrada." : "Exame não encontrado." });
      }
      assertOriginAcceptsRecommendation(origin.status);

      const now = deps.clock.now();
      const id = newId();
      const recommendation = await deps.recommendationsRepo.insert(trx, {
        id,
        familyId: origin.familyId,
        memberId: origin.memberId,
        clinicId: actor.clinicId,
        clinicName: origin.clinicName ?? "Clínica",
        clinicAccountId: actor.clinicAccountId,
        ...(draft.origin.kind === "APPOINTMENT" ? { appointmentId: draft.origin.id } : { examinationId: draft.origin.id }),
        text: draft.text,
        createdAt: now,
      });

      // audit.md §3: portal sem `family_id`/`subject_member_id`; `metadata` NUNCA com o texto (BR-HLT-05).
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "RECOMMENDATION_CREATE",
        resourceType: "Recommendation",
        resourceId: id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { originType: draft.origin.kind, originId: draft.origin.id },
      });
      await deps.alerts.raiseRecommendationAdded(trx, { recommendationId: id, familyId: origin.familyId, memberId: origin.memberId });

      const patientName = (await deps.memberNames.getMemberName(trx, origin.familyId, origin.memberId)) ?? UNKNOWN_PATIENT;
      return toView(recommendation, patientName);
    });
  };
}

/** `GET /clinic-portal/recommendations` (UC-REC-02): só as da própria clínica (BR-CLN-09). */
export function createListClinicRecommendationsUseCase<Trx>(deps: RecommendationsDeps<Trx>) {
  return async function listClinicRecommendations(actor: ClinicPortalActor, query: ListClinicRecommendationsQuery): Promise<ClinicRecommendationView[]> {
    return deps.withTransaction(async (trx) => {
      const items = await deps.recommendationsRepo.listByClinic(
        trx,
        actor.clinicId,
        { ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}), ...(query.examinationId ? { examinationId: query.examinationId } : {}) },
        CLINIC_LIST_LIMIT,
      );
      // BR-CLN-39: o Médico só vê as recomendações de origens (consulta/exame) do seu profissional.
      const visible = [];
      for (const item of items) {
        if (!actor.professionalId) {
          visible.push(item);
          continue;
        }
        const origin = item.appointmentId
          ? await deps.origins.findAppointmentOfClinic(trx, actor.clinicId, item.appointmentId, actor.professionalId)
          : item.examinationId
            ? await deps.origins.findExaminationOfClinic(trx, actor.clinicId, item.examinationId, actor.professionalId)
            : null;
        if (origin) visible.push(item);
      }
      const names = new Map<string, string>();
      const views: ClinicRecommendationView[] = [];
      for (const item of visible) {
        const key = `${item.familyId}:${item.memberId}`;
        let name = names.get(key);
        if (name === undefined) {
          name = (await deps.memberNames.getMemberName(trx, item.familyId, item.memberId)) ?? UNKNOWN_PATIENT;
          names.set(key, name);
        }
        views.push(toView(item, name));
      }
      return views;
    });
  };
}
