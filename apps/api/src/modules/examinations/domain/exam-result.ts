// Entidade pura `ExamResult` (entities.md, categoria C6) e regras simples (BR-EXM-01, D8, Q9).
// O sistema NUNCA interpreta o valor (D11/FR-EXM-05) — só guarda e devolve. Sem I/O.
import { ValidationError } from "../../../platform/errors/index.js";

export interface ExamResult {
  id: string;
  examinationId: string;
  parameter: string;
  valueNumeric?: number;
  valueText?: string;
  unit?: string;
  referenceMin?: number;
  referenceMax?: number;
  createdAt: Date;
}

/** BR-EXM-01: pelo menos um de `valueNumeric`/`valueText` (CHECK de schema.md, replicado aqui). */
export function assertHasValue(valueNumeric: number | undefined, valueText: string | undefined): void {
  if (valueNumeric === undefined && valueText === undefined) {
    throw new ValidationError([{ field: "valueNumeric", message: "indique um valor numérico ou texto" }], {
      detail: "Indique valor numérico ou texto.",
    });
  }
}

/** schema.md CHECK `reference_min <= reference_max` (ambos opcionais, informados pelo utilizador). */
export function assertValidReferenceRange(referenceMin: number | undefined, referenceMax: number | undefined): void {
  if (referenceMin !== undefined && referenceMax !== undefined && referenceMin > referenceMax) {
    throw new ValidationError([{ field: "referenceMin", message: "tem de ser menor ou igual a referenceMax" }], {
      detail: "Intervalo de referência inválido.",
    });
  }
}

/** Nome do parâmetro obrigatório, sem espaços nas pontas, nunca vazio. */
export function assertValidParameter(parameter: string, field = "parameter"): string {
  const trimmed = parameter.trim();
  if (trimmed.length === 0) {
    throw new ValidationError([{ field, message: "não pode ser vazio" }], { detail: "Parâmetro inválido." });
  }
  return trimmed;
}
