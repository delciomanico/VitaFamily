// UC-REC-01/02/03, BR-CLN-09, AC-REC-01 (sobre os fakes; a BD real está em tests/integration/recommendations).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ForbiddenError } from "../../../platform/errors/index.js";
import { createCreateClinicRecommendationUseCase, createListClinicRecommendationsUseCase } from "./clinic-recommendations.js";
import { createRecommendationsFixtures, type RecommendationsFixtures } from "./fixtures.js";
import { createListRecommendationsUseCase } from "./list-recommendations.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const FAMILY = "fam-1";
const MEMBER = "member-1";
const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";
const ACTOR_A = { clinicAccountId: "acc-a", clinicId: CLINIC_A };
const ACTOR_B = { clinicAccountId: "acc-b", clinicId: CLINIC_B };
const USER = { userId: "user-1", platformAdmin: false };
const CTX = { requestId: "req-1" };
const TEXT_SECRET = "Evitar esforço; dieta sem glúten";

let clock: FixedClock;
let fx: RecommendationsFixtures;

beforeEach(() => {
  clock = new FixedClock(NOW);
  fx = createRecommendationsFixtures(clock);
  fx.memberNames.names.set(`${FAMILY}:${MEMBER}`, "Maria Silva");
  fx.origins.seedAppointment("appt-ok", CLINIC_A, { familyId: FAMILY, memberId: MEMBER, status: "SCHEDULED", clinicName: "Clínica Sol" });
  fx.origins.seedAppointment("appt-done", CLINIC_A, { familyId: FAMILY, memberId: MEMBER, status: "COMPLETED", clinicName: "Clínica Sol" });
  fx.origins.seedAppointment("appt-cancelled", CLINIC_A, { familyId: FAMILY, memberId: MEMBER, status: "CANCELLED", clinicName: "Clínica Sol" });
  fx.origins.seedExamination("exam-ok", CLINIC_A, { familyId: FAMILY, memberId: MEMBER, status: "SCHEDULED", clinicName: "Clínica Sol" });
  fx.origins.seedExamination("exam-cancelled", CLINIC_A, { familyId: FAMILY, memberId: MEMBER, status: "CANCELLED", clinicName: "Clínica Sol" });
});

describe("createClinicRecommendation (UC-REC-01, AC-REC-01)", () => {
  it.each([
    ["consulta SCHEDULED", { appointmentId: "appt-ok" }],
    ["consulta COMPLETED", { appointmentId: "appt-done" }],
    ["exame SCHEDULED", { examinationId: "exam-ok" }],
  ])("grava sobre %s, audita sem texto e avisa o paciente", async (_name, origin) => {
    const view = await createCreateClinicRecommendationUseCase(fx.deps)(ACTOR_A, { ...origin, text: TEXT_SECRET }, CTX);

    expect(view).toMatchObject({ ...origin, patientName: "Maria Silva", text: TEXT_SECRET, createdAt: NOW.toISOString() });
    const stored = fx.repo.byId.get(view.id);
    expect(stored).toMatchObject({ familyId: FAMILY, memberId: MEMBER, clinicId: CLINIC_A, clinicName: "Clínica Sol", clinicAccountId: "acc-a" });

    const event = fx.audit.events.find((e) => e.action === "RECOMMENDATION_CREATE");
    expect(event).toMatchObject({ actorType: "CLINIC_ACCOUNT", actorClinicAccountId: "acc-a", resourceType: "Recommendation", resourceId: view.id, result: "SUCCESS" });
    expect(JSON.stringify(event)).not.toContain("esforço");
    expect(event?.familyId).toBeUndefined();

    expect(fx.alerts.events).toEqual([{ recommendationId: view.id, familyId: FAMILY, memberId: MEMBER }]);
  });

  it("origem de outra clínica ou inexistente => NOT_FOUND, sem gravar nem alertar", async () => {
    const create = createCreateClinicRecommendationUseCase(fx.deps);
    await expect(create(ACTOR_B, { appointmentId: "appt-ok", text: "x" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(create(ACTOR_B, { examinationId: "exam-ok", text: "x" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(create(ACTOR_A, { appointmentId: "nope", text: "x" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fx.repo.byId.size).toBe(0);
    expect(fx.alerts.events).toHaveLength(0);
    expect(fx.audit.events).toHaveLength(0);
  });

  it("origem noutro estado (consulta CANCELLED, exame CANCELLED) => CONFLICT", async () => {
    const create = createCreateClinicRecommendationUseCase(fx.deps);
    await expect(create(ACTOR_A, { appointmentId: "appt-cancelled", text: "x" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(create(ACTOR_A, { examinationId: "exam-cancelled", text: "x" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fx.repo.byId.size).toBe(0);
  });

  it.each([
    ["sem origem", { text: "x" }],
    ["origem dupla", { appointmentId: "appt-ok", examinationId: "exam-ok", text: "x" }],
    ["texto vazio", { appointmentId: "appt-ok", text: "" }],
    ["texto > 2000", { appointmentId: "appt-ok", text: "a".repeat(2001) }],
  ])("%s => VALIDATION_ERROR", async (_name, input) => {
    await expect(createCreateClinicRecommendationUseCase(fx.deps)(ACTOR_A, input, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fx.repo.byId.size).toBe(0);
  });

  it("não usa a AccessPolicy (autorização do portal é clínica do token = clínica da origem)", async () => {
    await createCreateClinicRecommendationUseCase(fx.deps)(ACTOR_A, { appointmentId: "appt-ok", text: "x" }, CTX);
    expect(fx.policy.calls).toHaveLength(0);
  });
});

describe("listClinicRecommendations (UC-REC-02, BR-CLN-09)", () => {
  it("devolve só as da própria clínica e filtra por origem", async () => {
    const create = createCreateClinicRecommendationUseCase(fx.deps);
    fx.origins.seedAppointment("appt-b", CLINIC_B, { familyId: FAMILY, memberId: MEMBER, status: "SCHEDULED", clinicName: "Outra" });
    await create(ACTOR_A, { appointmentId: "appt-ok", text: "A1" }, CTX);
    clock.advance(1000);
    await create(ACTOR_A, { examinationId: "exam-ok", text: "A2" }, CTX);
    await create(ACTOR_B, { appointmentId: "appt-b", text: "B1" }, CTX);

    const list = createListClinicRecommendationsUseCase(fx.deps);
    expect((await list(ACTOR_A, {})).map((r) => r.text)).toEqual(["A2", "A1"]);
    expect((await list(ACTOR_A, { examinationId: "exam-ok" })).map((r) => r.text)).toEqual(["A2"]);
    expect((await list(ACTOR_B, {})).map((r) => r.text)).toEqual(["B1"]);
    expect((await list(ACTOR_B, { appointmentId: "appt-ok" }))).toEqual([]);
  });
});

describe("listRecommendations (UC-REC-03, BR-CLN-09, authorization.md §3)", () => {
  beforeEach(async () => {
    const create = createCreateClinicRecommendationUseCase(fx.deps);
    await create(ACTOR_A, { appointmentId: "appt-ok", text: "consulta" }, CTX);
    clock.advance(1000);
    await create(ACTOR_A, { examinationId: "exam-ok", text: "exame" }, CTX);
    fx.audit.events.length = 0;
    fx.policy.calls.length = 0;
  });

  const list = (query = {}) => createListRecommendationsUseCase(fx.deps)(USER, FAMILY, MEMBER, query, CTX);

  it("titular lê tudo (READ APPOINTMENTS e EXAMS), com clinicName, sem auditar", async () => {
    const page = await list();
    expect(page.items.map((r) => r.text)).toEqual(["exame", "consulta"]);
    expect(page.items[0]).toMatchObject({ memberId: MEMBER, clinicName: "Clínica Sol" });
    expect(fx.policy.calls.map((c) => [c.action, c.category])).toEqual([["READ", "APPOINTMENTS"], ["READ", "EXAMS"]]);
    expect(fx.audit.events).toHaveLength(0);
  });

  it("sem READ(EXAMS) omite as de exame (filtra, não anula); dependente com conta só lê as de consulta (N2)", async () => {
    fx.policy.deniedCategories.add("EXAMS");
    fx.policy.forbidden = () => new ForbiddenError();
    expect((await list()).items.map((r) => r.text)).toEqual(["consulta"]);
  });

  it("sem READ(APPOINTMENTS) omite as de consulta", async () => {
    fx.policy.deniedCategories.add("APPOINTMENTS");
    fx.policy.forbidden = () => new ForbiddenError();
    expect((await list()).items.map((r) => r.text)).toEqual(["exame"]);
  });

  it("sem nenhuma das duas categorias => FORBIDDEN", async () => {
    fx.policy.deniedCategories.add("APPOINTMENTS").add("EXAMS");
    fx.policy.forbidden = () => new ForbiddenError();
    await expect(list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("erros que não são negação por categoria propagam (NOT_FOUND)", async () => {
    fx.policy.denyWith = Object.assign(new Error("nf"), { code: "NOT_FOUND" });
    await expect(list()).rejects.toThrow("nf");
  });

  it("leitura por quem não é o titular é auditada (RECOMMENDATION_VIEW, sem texto)", async () => {
    fx.policy.relation = "TUTOR_OF";
    await list();
    expect(fx.audit.events).toHaveLength(1);
    expect(fx.audit.events[0]).toMatchObject({ action: "RECOMMENDATION_VIEW", actorType: "USER", actorUserId: "user-1", familyId: FAMILY, subjectMemberId: MEMBER });
    expect(JSON.stringify(fx.audit.events[0])).not.toContain("consulta");
  });

  it("filtra por consulta/exame e pagina por cursor", async () => {
    expect((await list({ examinationId: "exam-ok" })).items.map((r) => r.text)).toEqual(["exame"]);
    expect((await list({ appointmentId: "appt-ok" })).items.map((r) => r.text)).toEqual(["consulta"]);
    const first = await list({ limit: "1" });
    expect(first.items.map((r) => r.text)).toEqual(["exame"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list({ limit: "1", ...(first.nextCursor ? { cursor: first.nextCursor } : {}) });
    expect(second.items.map((r) => r.text)).toEqual(["consulta"]);
    expect(second.nextCursor).toBeNull();
  });

  it("limit inválido => VALIDATION_ERROR", async () => {
    await expect(list({ limit: "0" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
