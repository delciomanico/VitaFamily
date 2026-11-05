// Entidade pura `Recommendation` (entities.md, D19/ADR-023) e regras de BR-CLN-09. Sem I/O.
// O texto é uma nota da clínica: o sistema nunca o interpreta nem gera alertas por conteúdo (D11).
import { ConflictError, ValidationError } from "../../../platform/errors/index.js";

export type RecommendationOriginKind = "APPOINTMENT" | "EXAMINATION";

/** BR-CLN-09: 1–2000 caracteres (CHECK `recommendations_text_length_check`). */
export const MAX_RECOMMENDATION_TEXT_LENGTH = 2000;

export interface Recommendation {
  id: string;
  familyId: string;
  memberId: string;
  clinicId?: string;
  /** Nome congelado da clínica (BR-CLN-02): sobrevive à remoção/renomeação da clínica. */
  clinicName: string;
  /** Autor (rastreabilidade); fica nulo se a conta for removida — a visibilidade nunca depende dele. */
  clinicAccountId?: string;
  appointmentId?: string;
  examinationId?: string;
  text: string;
  createdAt: Date;
}

export interface RecommendationDraftInput {
  appointmentId?: string | null | undefined;
  examinationId?: string | null | undefined;
  text: string;
}

export interface RecommendationDraft {
  origin: { kind: RecommendationOriginKind; id: string };
  text: string;
}

/** BR-CLN-09 / UC-REC-01: exatamente um de `appointmentId`/`examinationId`; texto 1–2000 (após trim). */
export function parseRecommendationDraft(input: RecommendationDraftInput): RecommendationDraft {
  const appointmentId = input.appointmentId ?? undefined;
  const examinationId = input.examinationId ?? undefined;
  const origin: RecommendationDraft["origin"] | undefined =
    appointmentId !== undefined && examinationId === undefined
      ? { kind: "APPOINTMENT", id: appointmentId }
      : examinationId !== undefined && appointmentId === undefined
        ? { kind: "EXAMINATION", id: examinationId }
        : undefined;
  if (!origin) {
    throw new ValidationError([{ field: "appointmentId", message: "indicar exatamente um de appointmentId ou examinationId" }], {
      detail: "Indique exatamente uma consulta ou um exame.",
    });
  }
  const text = input.text.trim();
  const length = Array.from(text).length;
  if (length < 1 || length > MAX_RECOMMENDATION_TEXT_LENGTH) {
    throw new ValidationError([{ field: "text", message: `deve ter entre 1 e ${String(MAX_RECOMMENDATION_TEXT_LENGTH)} caracteres` }], {
      detail: "Texto da recomendação inválido.",
    });
  }
  return { origin, text };
}

/** BR-CLN-09: só origens `SCHEDULED` ou `COMPLETED` (consulta `REQUESTED/CANCELLED/NO_SHOW...` e exame `CANCELLED` ⇒ CONFLICT). */
export function assertOriginAcceptsRecommendation(status: string): void {
  if (status !== "SCHEDULED" && status !== "COMPLETED") {
    throw new ConflictError({ detail: "Só é possível emitir recomendações sobre marcações agendadas ou concluídas." });
  }
}

/** authorization.md §3: a recomendação herda a categoria da origem (consulta ⇒ APPOINTMENTS, exame ⇒ EXAMS). */
export function categoryOfOrigin(kind: RecommendationOriginKind): "APPOINTMENTS" | "EXAMS" {
  return kind === "APPOINTMENT" ? "APPOINTMENTS" : "EXAMS";
}
