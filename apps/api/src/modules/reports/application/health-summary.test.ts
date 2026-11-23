// UC-RPT-05/05b (M17): AC-RPT-04..08, TC-RPT-05/06/09/10/11/12.
import { describe, expect, it } from "vitest";
import { NotFoundError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { createSummaryFixtures, type MemberData, type SummaryFixtureOptions } from "./fixtures.js";
import { createFamilyHealthSummaryUseCase, createMemberHealthSummaryUseCase } from "./health-summary.js";
import type { ApiObject } from "./ports.js";

const ACTOR = { userId: "u1", platformAdmin: false };
const CTX = { requestId: "r1" };
const FAMILY = "f1";
const NOW = new Date("2026-10-12T10:00:00.000Z");
const self = { id: "m1", name: "Eu", isSelf: true };
const other = { id: "m2", name: "Outro", isSelf: false };

const exam = (id: string, examDate: string, status: string, extra: ApiObject = {}): ApiObject => ({ id, examDate, status, results: [], documentIds: [], ...extra });

function setup(data: Record<string, MemberData>, extra: Partial<SummaryFixtureOptions> = {}) {
  const fx = createSummaryFixtures({ now: NOW, members: [self, other], data, ...extra });
  return { fx, member: createMemberHealthSummaryUseCase(fx.deps), family: createFamilyHealthSummaryUseCase(fx.deps) };
}

describe("período (BR-RPT-12, AC-RPT-04, TC-RPT-05)", () => {
  it("omissão = 12 meses", async () => {
    const { member } = setup({ m1: {} });
    const s = await member(ACTOR, FAMILY, "m1", {}, CTX);
    expect(s.period).toEqual({ from: "2025-10-12", to: "2026-10-12" });
    expect(s.memberId).toBe("m1");
  });

  it.each([{ from: "2026-02-01", to: "2026-01-01" }, { from: "2020-01-01", to: "2026-01-01" }, { from: "lixo" }])("%j => VALIDATION_ERROR", async (query) => {
    const { member, family } = setup({ m1: {} });
    await expect(member(ACTOR, FAMILY, "m1", query, CTX)).rejects.toThrow(ValidationError);
    await expect(family(ACTOR, FAMILY, query, CTX)).rejects.toThrow(ValidationError);
  });

  it("membro fora da família => NOT_FOUND", async () => {
    const { member } = setup({});
    await expect(member(ACTOR, FAMILY, "zz", {}, CTX)).rejects.toThrow(NotFoundError);
  });

  it("30 pedidos/min: o 31.º => RATE_LIMITED", async () => {
    const { member } = setup({ m1: {} });
    for (let i = 0; i < 30; i++) await member(ACTOR, FAMILY, "m1", {}, CTX);
    await expect(member(ACTOR, FAMILY, "m1", {}, CTX)).rejects.toThrow(RateLimitedError);
  });
});

describe("adesão e receitas (AC-RPT-05, BR-RPT-13/15)", () => {
  const doses = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `t${String(i)}`, scheduledAt: `2026-10-0${String(i + 1)}T08:00:00Z`, status: "TAKEN" })),
    { id: "n1", scheduledAt: "2026-10-07T08:00:00Z", status: "NOT_TAKEN" },
    { id: "n2", scheduledAt: "2026-10-08T08:00:00Z", status: "NOT_TAKEN" },
    { id: "u1", scheduledAt: "2026-10-09T08:00:00Z", status: "UNCONFIRMED" },
    { id: "u2", scheduledAt: "2026-10-10T08:00:00Z", status: "UNCONFIRMED" },
  ];

  it("6 tomadas, 2 não tomadas, 2 por confirmar, 4 futuras => 60 % e pending=4", async () => {
    const { member } = setup({ m1: { doses, adherence: [{ planId: "p1", medicationName: "X", taken: 6, notTaken: 2, unconfirmed: 2, pending: 4 }] } });
    const s = await member(ACTOR, FAMILY, "m1", {}, CTX);
    expect(s.medication?.overall).toMatchObject({ taken: 6, notTaken: 2, unconfirmed: 2, adherencePct: 60 });
    expect(s.medication?.byMedication[0]).toMatchObject({ planId: "p1", adherencePct: 60, pending: 4 });
    expect(s.medication?.granularity).toBe("MONTH");
  });

  it("sem ocorrências => adherencePct null (nunca 0) e medicamentos sem ocorrências não aparecem", async () => {
    const { member } = setup({ m1: { adherence: [{ planId: "p1", medicationName: "X", taken: 0, notTaken: 0, unconfirmed: 0, pending: 0 }] } });
    const s = await member(ACTOR, FAMILY, "m1", { from: "2026-10-01", to: "2026-10-12" }, CTX);
    expect(s.medication?.overall.adherencePct).toBeNull();
    expect(s.medication?.byMedication).toEqual([]);
    expect(s.medication?.granularity).toBe("WEEK");
  });

  it("receitas ativas, a terminar (<= 14 dias) e fechadas no período", async () => {
    const plan = (endAt: string | null, status = "ACTIVE") => ({ status, endAt });
    const { member } = setup({
      m1: {
        prescriptions: [
          { id: "r1", status: "ACTIVE", issuedOn: "2026-09-01", issuedBy: "FAMILY", medications: [plan("2026-10-20T00:00:00Z")], documentIds: [] },
          { id: "r2", status: "ACTIVE", issuedOn: "2026-09-01", issuedBy: "FAMILY", medications: [plan("2026-12-01T00:00:00Z")], documentIds: ["d"] },
          { id: "r3", status: "ACTIVE", issuedOn: "2026-09-01", issuedBy: "FAMILY", medications: [plan("2026-10-30T00:00:00Z", "ENDED")], documentIds: ["d"] },
          { id: "r4", status: "COMPLETED", issuedOn: "2026-05-01", issuedBy: "FAMILY", medications: [], documentIds: [] },
          { id: "r5", status: "CANCELLED", issuedOn: "2019-05-01", issuedBy: "FAMILY", medications: [], documentIds: [] },
        ],
      },
    });
    const s = await member(ACTOR, FAMILY, "m1", {}, CTX);
    expect(s.prescriptions).toEqual({ active: 3, endingSoon: 1, closedInPeriod: 1 });
  });
});

describe("consultas, exames e alertas (BR-RPT-15, TC-RPT-10)", () => {
  it("por estado e mês, próximos 30 dias, alertas só com contagens", async () => {
    const { member } = setup({
      m1: {
        appointments: [
          { id: "a1", scheduledAt: "2026-09-10T09:00:00Z", status: "COMPLETED" },
          { id: "a2", scheduledAt: "2026-10-20T09:00:00Z", status: "SCHEDULED" },
          { id: "a3", scheduledAt: "2026-12-20T09:00:00Z", status: "SCHEDULED" },
        ],
        examinations: [exam("e1", "2026-09-05", "COMPLETED"), exam("e2", "2026-10-30", "SCHEDULED"), exam("e3", "2024-01-01", "COMPLETED")],
        alerts: { total: 3, unread: 1, byType: { EXAM_REMINDER: 3 } },
      },
    });
    const s = await member(ACTOR, FAMILY, "m1", {}, CTX);
    // O período termina em 12/10: as futuras (20/10, 30/10, 20/12) só contam em «próximos 30 dias», e só as de <= 30 dias.
    expect(s.appointments).toEqual({ byStatus: { COMPLETED: 1 }, byMonth: [{ month: "2026-09", count: 1 }], upcoming30d: 1 });
    expect(s.exams).toMatchObject({ byStatus: { COMPLETED: 1 }, byMonth: [{ month: "2026-09", count: 1 }], upcoming30d: 1, truncated: false });
    expect(s.alerts).toEqual({ total: 3, unread: 1, byType: { EXAM_REMINDER: 3 } });
  });
});

describe("séries de exames na resposta (AC-RPT-06, TC-RPT-08)", () => {
  it("100/130/120 mg/dL com um texto; sem marcas de fora da referência", async () => {
    const res = (parameter: string, valueNumeric: number | null, valueText: string | null, createdAt: string) => ({ parameter, valueNumeric, valueText, unit: "mg/dL", referenceMin: 70, referenceMax: 99, createdAt });
    const { member } = setup({
      m1: {
        examinations: [
          exam("e1", "2026-01-10", "COMPLETED", { results: [res("Glicose", 100, null, "2026-01-10T10:00:00Z"), res("Aspeto", null, "limpo", "2026-01-10T10:00:00Z")] }),
          exam("e2", "2026-04-10", "COMPLETED", { results: [res("Glicose", 130, null, "2026-04-10T10:00:00Z")] }),
          exam("e3", "2026-07-10", "COMPLETED", { results: [res("Glicose", 120, null, "2026-07-10T10:00:00Z")] }),
        ],
      },
    });
    const s = await member(ACTOR, FAMILY, "m1", {}, CTX);
    expect(s.exams?.series).toHaveLength(1);
    expect(s.exams?.series[0]).toMatchObject({ count: 3, min: 100, max: 130, first: 100, last: 120, variationAbs: 20, variationPct: 20 });
    expect(JSON.stringify(s)).not.toMatch(/outOfRange|abnormal|"high"|"low"|flag/i);
  });
});

describe("permissões (AC-RPT-07, TC-RPT-09)", () => {
  const meds: MemberData = { adherence: [{ planId: "p", medicationName: "X", taken: 1, notTaken: 0, unconfirmed: 0, pending: 0 }], prescriptions: [], plans: [], doses: [], appointments: [{ id: "a", scheduledAt: "2026-10-01T09:00:00Z", status: "COMPLETED" }], examinations: [exam("e", "2026-10-01", "COMPLETED")] };

  it("OTHER com partilha só de MEDICATION: só medicação/receitas; as restantes OMITIDAS (não vazias)", async () => {
    const { member, fx } = setup({ m2: meds }, { denied: { m2: ["ALLERGIES", "APPOINTMENTS", "EXAMS"] } });
    const s = await member(ACTOR, FAMILY, "m2", {}, CTX);
    expect(s).toHaveProperty("medication");
    expect(s).toHaveProperty("prescriptions");
    expect(s).not.toHaveProperty("exams");
    expect(s).not.toHaveProperty("appointments");
    expect(JSON.stringify(s)).not.toMatch(/BLOOD_TYPE_UNSET|APPOINTMENT_PAST_OPEN|EXAM_/);
    expect(fx.audit).toEqual([{ familyId: FAMILY, memberId: "m2", kind: "HEALTH_SUMMARY" }]);
  });

  it("sem nenhuma categoria legível => NOT_FOUND (não revela o membro) e sem auditoria", async () => {
    const { member, fx } = setup({ m2: meds }, { denied: { m2: ["ALLERGIES", "MEDICATION", "APPOINTMENTS", "EXAMS"] } });
    await expect(member(ACTOR, FAMILY, "m2", {}, CTX)).rejects.toThrow(NotFoundError);
    expect(fx.audit).toEqual([]);
  });

  it("família: só membros visíveis e só as categorias partilhadas (sem ids de outros titulares)", async () => {
    const { family, fx } = setup({ m1: meds, m2: meds }, { denied: { m2: ["ALLERGIES", "APPOINTMENTS", "EXAMS"] } });
    const s = await family(ACTOR, FAMILY, {}, CTX);
    expect(s.members.map((m) => m.memberId)).toEqual(["m1", "m2"]);
    const m2 = s.members[1];
    expect(m2?.activity).not.toHaveProperty("appointments");
    expect(m2?.activity).not.toHaveProperty("exams");
    expect(m2?.activity).toHaveProperty("dosesConfirmed");
    expect(m2).not.toHaveProperty("upcoming30d");
    expect(fx.audit.map((a) => a.memberId)).toEqual(["m2"]);

    const hidden = setup({ m2: meds }, { denied: { m2: ["ALLERGIES", "MEDICATION", "APPOINTMENTS", "EXAMS"] } });
    expect((await hidden.family(ACTOR, FAMILY, {}, CTX)).members.map((m) => m.memberId)).toEqual(["m1"]);
  });

  it("o próprio titular não gera REPORT_VIEW (só outro titular)", async () => {
    const { member, fx } = setup({ m1: meds });
    await member(ACTOR, FAMILY, "m1", {}, CTX);
    expect(fx.audit).toEqual([]);
  });
});

describe("o que falta registar (AC-RPT-08, BR-RPT-17, TC-RPT-11)", () => {
  const data: MemberData = {
    bloodType: null,
    appointments: [{ id: "ap1", scheduledAt: "2026-09-01T09:00:00Z", status: "SCHEDULED" }],
    examinations: [exam("ex1", "2026-09-01", "SCHEDULED"), exam("ex2", "2026-08-01", "COMPLETED"), exam("ex3", "2026-08-01", "COMPLETED", { documentIds: ["d"] })],
    prescriptions: [{ id: "rx1", status: "ACTIVE", issuedOn: "2026-09-01", issuedBy: "FAMILY", medications: [], documentIds: [] }, { id: "rx2", status: "ACTIVE", issuedOn: "2026-09-01", issuedBy: "CLINIC", medications: [], documentIds: [] }],
    plans: [{ id: "pl1", status: "ACTIVE", scheduleType: "FIXED_TIMES", times: [] }, { id: "pl2", status: "ACTIVE", scheduleType: "INTERVAL", intervalHours: 8 }],
    doses: [{ id: "d1", scheduledAt: "2026-10-01T08:00:00Z", status: "UNCONFIRMED" }],
    adherence: [],
  };

  it("códigos de completude e ids só com escrita", async () => {
    const withWrite = await setup({ m1: data }, { writable: { m1: ["APPOINTMENTS", "EXAMS", "MEDICATION"] } }).member(ACTOR, FAMILY, "m1", {}, CTX);
    expect(withWrite.missing).toEqual(
      expect.arrayContaining([
        { code: "BLOOD_TYPE_UNSET", count: 1 },
        { code: "APPOINTMENT_PAST_OPEN", count: 1, sourceIds: ["ap1"] },
        { code: "EXAM_PAST_OPEN", count: 1, sourceIds: ["ex1"] },
        { code: "EXAM_WITHOUT_RESULTS", count: 1, sourceIds: ["ex2"] },
        { code: "PRESCRIPTION_WITHOUT_DOCUMENT", count: 1, sourceIds: ["rx1"] },
        { code: "PLAN_WITHOUT_SCHEDULE", count: 1, sourceIds: ["pl1"] },
        { code: "DOSES_UNCONFIRMED", count: 1, sourceIds: ["d1"] },
      ]),
    );
    expect(withWrite.missing).toHaveLength(7);

    const readOnly = await setup({ m1: data }).member(ACTOR, FAMILY, "m1", {}, CTX);
    expect(JSON.stringify(readOnly.missing)).not.toContain("sourceIds");
    expect(readOnly.missing).toHaveLength(7);
  });

  it("nunca sugere consultas, exames ou tratamentos", async () => {
    const s = await setup({ m1: data }).member(ACTOR, FAMILY, "m1", {}, CTX);
    for (const item of s.missing ?? []) expect(item.code).toMatch(/^(BLOOD_TYPE_UNSET|APPOINTMENT_PAST_OPEN|EXAM_PAST_OPEN|EXAM_WITHOUT_RESULTS|PRESCRIPTION_WITHOUT_DOCUMENT|PLAN_WITHOUT_SCHEDULE|DOSES_UNCONFIRMED)$/);
  });

  it("tudo em ordem => missing vazio (não omitido)", async () => {
    const s = await setup({ m1: { bloodType: "A_POS" } }).member(ACTOR, FAMILY, "m1", {}, CTX);
    expect(s.missing).toEqual([]);
  });
});

describe("visão da família (BR-RPT-16)", () => {
  it("resumo reduzido e atividade por categoria visível", async () => {
    const { family } = setup({
      m1: {
        bloodType: "A_POS",
        adherence: [{ planId: "p", medicationName: "X", taken: 3, notTaken: 1, unconfirmed: 0, pending: 0 }],
        plans: [{ id: "p", status: "ACTIVE", scheduleType: "INTERVAL", intervalHours: 8 }],
        doses: [{ id: "d", scheduledAt: "2026-10-05T08:00:00Z", actedAt: "2026-10-05T08:10:00Z", status: "TAKEN" }],
        prescriptions: [{ id: "r", status: "ACTIVE", issuedOn: "2026-09-20", issuedBy: "FAMILY", medications: [], documentIds: ["d"] }],
        appointments: [{ id: "a", scheduledAt: "2026-10-20T09:00:00Z", status: "SCHEDULED" }],
        examinations: [exam("e", "2026-10-02", "COMPLETED", { documentIds: ["d"] })],
      },
    });
    const s = await family(ACTOR, FAMILY, {}, CTX);
    expect(s.members[0]).toEqual({
      memberId: "m1",
      displayName: "Eu",
      adherencePct: 75,
      activeMedications: 1,
      upcoming30d: 1,
      missingCount: 0,
      activity: { prescriptions: 1, appointments: 0, exams: 1, dosesConfirmed: 1, lastActivityOn: "2026-10-05" },
    });
    expect(s.period.to).toBe("2026-10-12");
  });
});

describe("canário de conteúdo (TC-RPT-12)", () => {
  it("a resposta e a auditoria não contêm texto livre de saúde", async () => {
    const CANARY = "ZXQ-CANARIO-NOTA";
    const { member, fx } = setup({
      m2: {
        prescriptions: [{ id: "r", status: "ACTIVE", issuedOn: "2026-09-20", issuedBy: "FAMILY", doctorName: CANARY, notes: CANARY, medications: [{ status: "ACTIVE", name: CANARY, dosage: CANARY }], documentIds: [] }],
        appointments: [{ id: "a", scheduledAt: "2026-10-01T09:00:00Z", status: "COMPLETED", notes: CANARY, professionalName: CANARY }],
        examinations: [exam("e", "2026-10-02", "COMPLETED", { name: CANARY, notes: CANARY })],
      },
    });
    const s = await member(ACTOR, FAMILY, "m2", {}, CTX);
    expect(JSON.stringify(s)).not.toContain(CANARY);
    expect(JSON.stringify(fx.audit)).not.toContain(CANARY);
  });
});
