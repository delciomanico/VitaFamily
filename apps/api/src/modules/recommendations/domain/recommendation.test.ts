import { describe, expect, it } from "vitest";
import { assertOriginAcceptsRecommendation, categoryOfOrigin, parseRecommendationDraft } from "./recommendation.js";

/** Código do erro de domínio lançado por `fn` (ou `undefined` se não lançar). */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const ID = "11111111-1111-4111-8111-111111111111";

describe("parseRecommendationDraft (BR-CLN-09, AC-REC-01)", () => {
  it("aceita exatamente uma origem e faz trim do texto", () => {
    expect(parseRecommendationDraft({ appointmentId: ID, text: "  repouso  " })).toEqual({ origin: { kind: "APPOINTMENT", id: ID }, text: "repouso" });
    expect(parseRecommendationDraft({ examinationId: ID, appointmentId: null, text: "x" })).toEqual({ origin: { kind: "EXAMINATION", id: ID }, text: "x" });
  });

  it.each([
    ["nenhuma origem", { text: "x" }],
    ["origem dupla", { appointmentId: ID, examinationId: ID, text: "x" }],
    ["texto vazio", { appointmentId: ID, text: "" }],
    ["texto só com espaços", { appointmentId: ID, text: "   " }],
    ["texto com 2001 caracteres", { appointmentId: ID, text: "a".repeat(2001) }],
  ])("rejeita %s com VALIDATION_ERROR", (_name, input) => {
    expect(codeOf(() => parseRecommendationDraft(input))).toBe("VALIDATION_ERROR");
  });

  it("aceita 1 e 2000 caracteres", () => {
    expect(parseRecommendationDraft({ appointmentId: ID, text: "a" }).text).toHaveLength(1);
    expect(parseRecommendationDraft({ appointmentId: ID, text: "a".repeat(2000) }).text).toHaveLength(2000);
  });
});

describe("assertOriginAcceptsRecommendation", () => {
  it.each(["SCHEDULED", "COMPLETED"])("aceita %s", (status) => {
    expect(codeOf(() => { assertOriginAcceptsRecommendation(status); })).toBeUndefined();
  });
  it.each(["REQUESTED", "REJECTED", "CANCELLED", "NO_SHOW"])("rejeita %s com CONFLICT", (status) => {
    expect(codeOf(() => { assertOriginAcceptsRecommendation(status); })).toBe("CONFLICT");
  });
});

describe("categoryOfOrigin", () => {
  it("consulta => APPOINTMENTS, exame => EXAMS", () => {
    expect(categoryOfOrigin("APPOINTMENT")).toBe("APPOINTMENTS");
    expect(categoryOfOrigin("EXAMINATION")).toBe("EXAMS");
  });
});
