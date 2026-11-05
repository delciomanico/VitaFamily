// Mapeamento vista -> corpo HTTP (convenção dos restantes módulos: campos opcionais nullable do
// contrato saem como `null`, nunca omitidos).
import type { ClinicRecommendationView } from "../application/clinic-recommendations.js";
import type { RecommendationView } from "../application/list-recommendations.js";

/** `components.schemas.ClinicRecommendation` (openapi.yaml, BR-CLN-03: só o mínimo). */
export function toClinicRecommendationResponse(view: ClinicRecommendationView) {
  return {
    id: view.id,
    appointmentId: view.appointmentId ?? null,
    examinationId: view.examinationId ?? null,
    patientName: view.patientName,
    text: view.text,
    createdAt: view.createdAt,
  };
}

/** `components.schemas.Recommendation` (openapi.yaml, BR-CLN-09). */
export function toRecommendationResponse(view: RecommendationView) {
  return {
    id: view.id,
    memberId: view.memberId,
    appointmentId: view.appointmentId ?? null,
    examinationId: view.examinationId ?? null,
    clinicName: view.clinicName,
    text: view.text,
    createdAt: view.createdAt,
  };
}
