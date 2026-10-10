// Vista completa de uma receita (Prescription schema, openapi.yaml): junta `medications` (planos
// de toma, via `medications.listPlansForPrescription`) e `documentIds` (via
// `documents.listForResource`) — nenhum dos dois vive na tabela `prescriptions` (conventions.md
// §3.5: só os repositórios de cada módulo acedem às suas tabelas).
import type { MedicationPlan } from "../../medications/index.js";
import type { Prescription } from "../domain/prescription.js";
import type { PrescriptionsDeps } from "./ports.js";

export interface PrescriptionView extends Prescription {
  medications: MedicationPlan[];
  documentIds: string[];
}

export async function buildPrescriptionView<Trx>(deps: PrescriptionsDeps<Trx>, trx: Trx, prescription: Prescription): Promise<PrescriptionView> {
  const [medications, documents] = await Promise.all([
    deps.medications.listPlansForPrescription(trx, prescription.familyId, prescription.memberId, prescription.id),
    deps.documents.listForResource(trx, prescription.familyId, prescription.memberId, "PRESCRIPTION", prescription.id),
  ]);
  return { ...prescription, medications, documentIds: documents.map((document) => document.id) };
}
