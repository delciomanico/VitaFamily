import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createAddExamResultUseCase } from "./add-exam-result.js";
import { createCreateExaminationUseCase } from "./create-examination.js";
import { createDeleteExaminationUseCase } from "./delete-examination.js";
import { createDeleteExamResultUseCase } from "./delete-exam-result.js";
import { createExamResultHistoryUseCase } from "./exam-result-history.js";
import { createExaminationsFixtures } from "./fixtures.js";
import { createGetExaminationUseCase } from "./get-examination.js";
import { createListExaminationsUseCase } from "./list-examinations.js";
import { createSetExaminationStatusUseCase } from "./set-examination-status.js";
import { createUpdateExaminationUseCase } from "./update-examination.js";
import { createUpdateExamResultUseCase } from "./update-exam-result.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("createExamination (ST5)", () => {
  it("examDate futura nasce SCHEDULED", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);

    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-01" }, CTX);

    expect(examination.status).toBe("SCHEDULED");
    expect(examination.results).toEqual([]);
    expect(examination.documentIds).toEqual([]);
    expect(fixtures.audit.events.some((e) => e.action === "EXAM_CREATE")).toBe(true);
  });

  it("examDate passada nasce COMPLETED", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);

    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-01-01" }, CTX);

    expect(examination.status).toBe("COMPLETED");
  });

  it("congela o nome da clínica selecionada (BR-CLN-02)", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    fixtures.clinics.seed("clinic-1", "Laboratório Sol", FAMILY_ID);
    const createExamination = createCreateExaminationUseCase(fixtures.deps);

    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-01", clinicId: "clinic-1" }, CTX);

    expect(examination.clinicName).toBe("Laboratório Sol");
  });

  it("recusa nome vazio (VALIDATION_ERROR)", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);

    await expect(createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "  ", examDate: "2026-02-01" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("addExamResult (ST5/BR-EXM-01/D11)", () => {
  it("recusa adicionar resultado a exame SCHEDULED (INVALID_STATE_TRANSITION)", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const addExamResult = createAddExamResultUseCase(fixtures.deps);
    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-01" }, CTX);

    await expect(addExamResult(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { parameter: "Glicose", valueNumeric: 110 }, CTX)).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("AC-EXM-01/D11: guarda e devolve valor fora do intervalo sem gerar alerta ou sinalização", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const addExamResult = createAddExamResultUseCase(fixtures.deps);
    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-01-01" }, CTX);

    const result = await addExamResult(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { parameter: "Glicose", valueNumeric: 500, unit: "mg/dL", referenceMin: 70, referenceMax: 100 }, CTX);

    expect(result.valueNumeric).toBe(500);
    // Nenhum campo de "fora do intervalo"/alerta existe na entidade — o sistema não interpreta (D11).
    expect(Object.keys(result)).not.toContain("outOfRange");
    expect(fixtures.audit.events.filter((e) => e.action.startsWith("ALERT")).length).toBe(0);
  });

  it("recusa resultado sem valor numérico nem texto (BR-EXM-01)", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const addExamResult = createAddExamResultUseCase(fixtures.deps);
    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-01-01" }, CTX);

    await expect(addExamResult(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { parameter: "Glicose" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("aceita valor de texto (Q9)", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const addExamResult = createAddExamResultUseCase(fixtures.deps);
    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Urina", examDate: "2026-01-01" }, CTX);

    const result = await addExamResult(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { parameter: "Cor", valueText: "Amarelo claro" }, CTX);
    expect(result.valueText).toBe("Amarelo claro");
  });
});

describe("updateExamResult/deleteExamResult", () => {
  it("altera e remove um resultado", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const addExamResult = createAddExamResultUseCase(fixtures.deps);
    const updateExamResult = createUpdateExamResultUseCase(fixtures.deps);
    const deleteExamResult = createDeleteExamResultUseCase(fixtures.deps);
    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-01-01" }, CTX);
    const result = await addExamResult(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { parameter: "Glicose", valueNumeric: 90 }, CTX);

    const updated = await updateExamResult(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, result.id, { valueNumeric: 95 }, CTX);
    expect(updated.valueNumeric).toBe(95);

    await deleteExamResult(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, result.id, CTX);
    expect(fixtures.examResultsRepo.byId.has(result.id)).toBe(false);
  });
});

describe("examResultHistory (UC-EXM-04)", () => {
  it("devolve o histórico de um parâmetro ordenado por data", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const addExamResult = createAddExamResultUseCase(fixtures.deps);
    const history = createExamResultHistoryUseCase(fixtures.deps);
    const exam1 = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-01-01" }, CTX);
    const exam2 = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2025-06-01" }, CTX);
    await addExamResult(ACTOR, FAMILY_ID, MEMBER_ID, exam1.id, { parameter: "Glicose", valueNumeric: 90 }, CTX);
    await addExamResult(ACTOR, FAMILY_ID, MEMBER_ID, exam2.id, { parameter: "Glicose", valueNumeric: 85 }, CTX);

    const items = await history(ACTOR, FAMILY_ID, MEMBER_ID, { parameter: "Glicose" }, CTX);
    expect(items.map((i) => i.examDate)).toEqual(["2025-06-01", "2026-01-01"]);
  });

  it("recusa sem o parâmetro (VALIDATION_ERROR)", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const history = createExamResultHistoryUseCase(fixtures.deps);
    await expect(history(ACTOR, FAMILY_ID, MEMBER_ID, {}, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("setExaminationStatus/updateExamination", () => {
  it("permite SCHEDULED -> CANCELLED -> SCHEDULED", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const setStatus = createSetExaminationStatusUseCase(fixtures.deps);
    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-01" }, CTX);

    const cancelled = await setStatus(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { status: "CANCELLED" }, CTX);
    expect(cancelled.status).toBe("CANCELLED");

    const rescheduled = await setStatus(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { status: "SCHEDULED" }, CTX);
    expect(rescheduled.status).toBe("SCHEDULED");
  });

  it("recusa COMPLETED -> SCHEDULED", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const setStatus = createSetExaminationStatusUseCase(fixtures.deps);
    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-01-01" }, CTX);

    await expect(setStatus(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { status: "SCHEDULED" }, CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("updateExamination altera nome e data", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const updateExamination = createUpdateExaminationUseCase(fixtures.deps);
    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-01" }, CTX);

    const updated = await updateExamination(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { name: "Hemograma completo" }, CTX);
    expect(updated.name).toBe("Hemograma completo");
  });
});

describe("listExaminations/getExamination (audit.md §3)", () => {
  it("lê por tutor é auditado; pelo próprio não", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const getExamination = createGetExaminationUseCase(fixtures.deps);
    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-01" }, CTX);

    fixtures.policy.relation = "SELF";
    await getExamination(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, CTX);
    expect(fixtures.audit.events.some((e) => e.action === "HEALTH_VIEW")).toBe(false);

    fixtures.policy.relation = "TUTOR_OF";
    await getExamination(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, CTX);
    expect(fixtures.audit.events.some((e) => e.action === "HEALTH_VIEW")).toBe(true);
  });

  it("listExaminations filtra por estado", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const listExaminations = createListExaminationsUseCase(fixtures.deps);
    await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-01" }, CTX);
    await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Urina", examDate: "2026-01-01" }, CTX);

    const scheduled = await listExaminations(ACTOR, FAMILY_ID, MEMBER_ID, { status: "SCHEDULED" }, CTX);
    expect(scheduled.items).toHaveLength(1);
  });
});

describe("deleteExamination (FR-DOC-04)", () => {
  it("apaga documentos antes do exame", async () => {
    const fixtures = createExaminationsFixtures(new FixedClock(NOW));
    const createExamination = createCreateExaminationUseCase(fixtures.deps);
    const deleteExamination = createDeleteExaminationUseCase(fixtures.deps);
    const examination = await createExamination(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-01" }, CTX);

    await deleteExamination(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, CTX);

    expect(fixtures.documents.deleteCalls).toEqual([{ resourceType: "EXAMINATION", resourceId: examination.id }]);
    expect(fixtures.examinationsRepo.byId.has(examination.id)).toBe(false);
    expect(fixtures.audit.events.some((e) => e.action === "EXAM_DELETE")).toBe(true);
  });
});
