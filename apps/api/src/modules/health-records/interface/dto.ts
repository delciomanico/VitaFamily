// Mapeamento das vistas da application -> forma da API (components.schemas, openapi.yaml).
import type { Allergy } from "../domain/allergy.js";
import type { BloodType } from "../domain/blood-type.js";
import type { MedicalCondition } from "../domain/medical-condition.js";

export function toAllergyResponse(allergy: Allergy) {
  return {
    id: allergy.id,
    name: allergy.name,
    notes: allergy.notes ?? null,
    since: allergy.since ?? null,
  };
}

export function toConditionResponse(condition: MedicalCondition) {
  return {
    id: condition.id,
    name: condition.name,
    kind: condition.kind,
    notes: condition.notes ?? null,
    since: condition.since ?? null,
    until: condition.until ?? null,
  };
}

export function toBloodTypeResponse(bloodType: BloodType) {
  return { bloodType };
}
