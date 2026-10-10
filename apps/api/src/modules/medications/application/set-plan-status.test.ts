import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreatePlanUseCase } from "./create-plan.js";
import { createSetPlanStatusUseCase } from "./set-plan-status.js";
import { createMedicationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("setPlanStatus (ST1)", () => {
  it("ACTIVE -> ENDED remove a agenda futura PENDING", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const setPlanStatus = createSetPlanStatusUseCase(fixtures.deps);
    const plan = await createPlan(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      { name: "X", dosage: "1", scheduleType: "FIXED_TIMES", times: ["08:00"], startAt: NOW.toISOString(), continuous: true },
      CTX,
    );
    expect([...fixtures.dosesRepo.byId.values()].filter((d) => d.planId === plan.id)).not.toHaveLength(0);

    const ended = await setPlanStatus(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, { status: "ENDED" }, CTX);

    expect(ended.status).toBe("ENDED");
    expect(ended.endedAt).toEqual(NOW);
    expect([...fixtures.dosesRepo.byId.values()].filter((d) => d.planId === plan.id)).toHaveLength(0);
  });

  it("ENDED -> ACTIVE (reabrir) gera só tomas futuras, sem recriar o passado", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const setPlanStatus = createSetPlanStatusUseCase(fixtures.deps);
    const plan = await createPlan(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      { name: "X", dosage: "1", scheduleType: "FIXED_TIMES", times: ["08:00"], startAt: NOW.toISOString(), continuous: true },
      CTX,
    );
    await setPlanStatus(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, { status: "ENDED" }, CTX);

    const reactivated = await setPlanStatus(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, { status: "ACTIVE", continuous: true }, CTX);

    expect(reactivated.status).toBe("ACTIVE");
    expect(reactivated.endedAt).toBeUndefined();
    expect([...fixtures.dosesRepo.byId.values()].filter((d) => d.planId === plan.id).length).toBeGreaterThan(0);
  });

  it("transição inválida (ACTIVE -> ACTIVE com estado inconsistente) é idempotente", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const setPlanStatus = createSetPlanStatusUseCase(fixtures.deps);
    const plan = await createPlan(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      { name: "X", dosage: "1", scheduleType: "FIXED_TIMES", times: ["08:00"], startAt: NOW.toISOString(), continuous: true },
      CTX,
    );

    const result = await setPlanStatus(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, { status: "ACTIVE", continuous: true }, CTX);
    expect(result.status).toBe("ACTIVE");
  });

  it("devolve NOT_FOUND para plano inexistente", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const setPlanStatus = createSetPlanStatusUseCase(fixtures.deps);
    await expect(setPlanStatus(ACTOR, FAMILY_ID, MEMBER_ID, "nope", { status: "ENDED" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
