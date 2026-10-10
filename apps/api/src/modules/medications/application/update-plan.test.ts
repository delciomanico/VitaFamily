import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreatePlanUseCase } from "./create-plan.js";
import { createUpdatePlanUseCase } from "./update-plan.js";
import { createMedicationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("updatePlan (BR-RX-05)", () => {
  it("altera os horários e recalcula só as ocorrências PENDING futuras", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const updatePlan = createUpdatePlanUseCase(fixtures.deps);

    const plan = await createPlan(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      { name: "Ibuprofeno", dosage: "400mg", scheduleType: "FIXED_TIMES", times: ["08:00"], startAt: NOW.toISOString(), continuous: true },
      CTX,
    );
    // Simula uma toma já confirmada no passado/presente (nunca deve ser tocada pela atualização).
    const firstDose = [...fixtures.dosesRepo.byId.values()].find((d) => d.planId === plan.id);
    if (firstDose) {
      fixtures.dosesRepo.byId.set(firstDose.id, { ...firstDose, status: "TAKEN", actedAt: NOW, actedByUserId: "u1" });
    }

    const updated = await updatePlan(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, { times: ["09:00"] }, CTX);

    expect(updated.times).toEqual(["09:00"]);
    const doses = [...fixtures.dosesRepo.byId.values()].filter((d) => d.planId === plan.id);
    // A toma TAKEN preservada (histórico), as PENDING futuras passam a 09:00.
    expect(doses.find((d) => d.status === "TAKEN")).toBeDefined();
    expect(doses.filter((d) => d.status === "PENDING").every((d) => d.scheduledAt.getUTCHours() === 9)).toBe(true);
  });

  it("recusa desenho inválido (INVALID_SCHEDULE)", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const updatePlan = createUpdatePlanUseCase(fixtures.deps);
    const plan = await createPlan(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      { name: "X", dosage: "1", scheduleType: "FIXED_TIMES", times: ["08:00"], startAt: NOW.toISOString(), continuous: true },
      CTX,
    );

    await expect(updatePlan(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, { times: [] }, CTX)).rejects.toMatchObject({ code: "INVALID_SCHEDULE" });
  });

  it("devolve NOT_FOUND para plano inexistente", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const updatePlan = createUpdatePlanUseCase(fixtures.deps);
    await expect(updatePlan(ACTOR, FAMILY_ID, MEMBER_ID, "nope", { notes: "x" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
