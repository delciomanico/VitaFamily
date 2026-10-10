import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCorrectDoseUseCase } from "./correct-dose.js";
import { createMarkDoseNotTakenUseCase } from "./mark-dose-not-taken.js";
import { createMarkDoseTakenUseCase } from "./mark-dose-taken.js";
import { createMedicationsFixtures } from "./fixtures.js";

const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };
const scheduledAt = new Date("2026-01-15T08:00:00.000Z");

function seedPendingDose(fixtures: ReturnType<typeof createMedicationsFixtures>, overrides: Partial<Parameters<typeof fixtures.dosesRepo.seed>[0]> = {}) {
  const dose = {
    id: "dose-1",
    familyId: FAMILY_ID,
    memberId: MEMBER_ID,
    planId: "plan-1",
    medicationName: "Ibuprofeno",
    dosage: "400mg",
    scheduledAt,
    status: "PENDING" as const,
    generationVersion: 1,
    createdAt: scheduledAt,
    ...overrides,
  };
  fixtures.dosesRepo.seed(dose);
  return dose;
}

describe("markDoseTaken/markDoseNotTaken (AC-MED-02/03)", () => {
  it("confirma uma toma PENDING dentro da janela e regista quem/quando", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(new Date("2026-01-15T08:30:00.000Z")));
    seedPendingDose(fixtures);
    const markDoseTaken = createMarkDoseTakenUseCase(fixtures.deps);

    const dose = await markDoseTaken(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", {}, CTX);

    expect(dose.status).toBe("TAKEN");
    expect(dose.actedByUserId).toBe("u1");
    expect(dose.actedAt).toEqual(new Date("2026-01-15T08:30:00.000Z"));
    expect(fixtures.audit.events.some((e) => e.action === "DOSE_TAKEN")).toBe(true);
  });

  it("é idempotente: confirmar duas vezes não duplica nem altera actedAt", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(new Date("2026-01-15T08:30:00.000Z")));
    seedPendingDose(fixtures);
    const markDoseTaken = createMarkDoseTakenUseCase(fixtures.deps);

    const first = await markDoseTaken(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", {}, CTX);
    const second = await markDoseTaken(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", {}, CTX);

    expect(second).toEqual(first);
  });

  it("recusa DOSE_IN_FUTURE mais de 1h antes do horário", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(new Date("2026-01-15T06:00:00.000Z")));
    seedPendingDose(fixtures);
    const markDoseTaken = createMarkDoseTakenUseCase(fixtures.deps);

    await expect(markDoseTaken(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", {}, CTX)).rejects.toMatchObject({ code: "DOSE_IN_FUTURE" });
  });

  it("recusa DOSE_WINDOW_EXPIRED depois do fim do dia seguinte", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(new Date("2026-01-17T01:00:00.000Z")));
    seedPendingDose(fixtures);
    const markDoseTaken = createMarkDoseTakenUseCase(fixtures.deps);

    await expect(markDoseTaken(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", {}, CTX)).rejects.toMatchObject({ code: "DOSE_WINDOW_EXPIRED" });
  });

  it("marca como não tomada", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(new Date("2026-01-15T08:30:00.000Z")));
    seedPendingDose(fixtures);
    const markDoseNotTaken = createMarkDoseNotTakenUseCase(fixtures.deps);

    const dose = await markDoseNotTaken(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", { note: "esqueceu-se" }, CTX);
    expect(dose.status).toBe("NOT_TAKEN");
    expect(dose.note).toBe("esqueceu-se");
  });

  it("dependente com conta pode confirmar (DEPENDENT_SELF, authorization.md §3)", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(new Date("2026-01-15T08:30:00.000Z")));
    fixtures.policy.relation = "DEPENDENT_SELF";
    seedPendingDose(fixtures);
    const markDoseTaken = createMarkDoseTakenUseCase(fixtures.deps);

    const dose = await markDoseTaken(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", {}, CTX);
    expect(dose.status).toBe("TAKEN");
  });
});

describe("correctDose (ST2, UC-MED-07)", () => {
  it("titular/tutor corrige TAKEN -> NOT_TAKEN dentro de 7 dias", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(new Date("2026-01-16T08:00:00.000Z")));
    seedPendingDose(fixtures, { status: "TAKEN", actedAt: scheduledAt, actedByUserId: "other-user" });
    fixtures.policy.relation = "TUTOR_OF";
    const correctDose = createCorrectDoseUseCase(fixtures.deps);

    const dose = await correctDose(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", { status: "NOT_TAKEN" }, CTX);
    expect(dose.status).toBe("NOT_TAKEN");
    expect(fixtures.audit.events.some((e) => e.action === "DOSE_CORRECTED")).toBe(true);
  });

  it("recusa depois de 7 dias (DOSE_WINDOW_EXPIRED)", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(new Date("2026-01-22T08:00:00.001Z")));
    seedPendingDose(fixtures, { status: "TAKEN", actedAt: scheduledAt, actedByUserId: "u1" });
    const correctDose = createCorrectDoseUseCase(fixtures.deps);

    await expect(correctDose(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", { status: "NOT_TAKEN" }, CTX)).rejects.toMatchObject({ code: "DOSE_WINDOW_EXPIRED" });
  });

  it("dependente com conta só corrige a sua própria ação anterior", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(new Date("2026-01-16T08:00:00.000Z")));
    fixtures.policy.relation = "DEPENDENT_SELF";
    seedPendingDose(fixtures, { status: "TAKEN", actedAt: scheduledAt, actedByUserId: "other-user" });
    const correctDose = createCorrectDoseUseCase(fixtures.deps);

    await expect(correctDose(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", { status: "NOT_TAKEN" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("dependente com conta pode corrigir a sua própria ação anterior", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(new Date("2026-01-16T08:00:00.000Z")));
    fixtures.policy.relation = "DEPENDENT_SELF";
    seedPendingDose(fixtures, { status: "TAKEN", actedAt: scheduledAt, actedByUserId: "u1" });
    const correctDose = createCorrectDoseUseCase(fixtures.deps);

    const dose = await correctDose(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", { status: "NOT_TAKEN" }, CTX);
    expect(dose.status).toBe("NOT_TAKEN");
  });

  it("recusa corrigir uma toma ainda PENDING (CONFLICT)", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(new Date("2026-01-15T08:30:00.000Z")));
    seedPendingDose(fixtures);
    const correctDose = createCorrectDoseUseCase(fixtures.deps);

    await expect(correctDose(ACTOR, FAMILY_ID, MEMBER_ID, "dose-1", { status: "NOT_TAKEN" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
