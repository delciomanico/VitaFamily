import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreatePlanUseCase } from "./create-plan.js";
import { createMedicationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("createPlan (BR-MED-01/02, AC-RX-01)", () => {
  it("cria um plano FIXED_TIMES e gera as ocorrências dos próximos 14 dias", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);

    const plan = await createPlan(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      {
        name: "Ibuprofeno",
        dosage: "400mg",
        scheduleType: "FIXED_TIMES",
        times: ["08:00", "20:00"],
        startAt: NOW.toISOString(),
        continuous: true,
      },
      CTX,
    );

    expect(plan.status).toBe("ACTIVE");
    expect(fixtures.policy.calls).toEqual([
      { userId: "u1", platformAdmin: false, familyId: FAMILY_ID, action: "CREATE", subjectMemberId: MEMBER_ID, category: "MEDICATION" },
    ]);
    // 14 dias * 2 horários = 28 ocorrências (janela DM5).
    const doses = [...fixtures.dosesRepo.byId.values()].filter((d) => d.planId === plan.id);
    expect(doses).toHaveLength(28);
    expect(doses.every((d) => d.status === "PENDING")).toBe(true);

    const event = fixtures.audit.events.find((e) => e.action === "PLAN_CREATE");
    expect(event).toMatchObject({ actorUserId: "u1", resourceId: plan.id, familyId: FAMILY_ID, subjectMemberId: MEMBER_ID, result: "SUCCESS" });
  });

  it("liga o plano à receita quando chamado por `prescriptions` (options.prescriptionId)", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);

    const plan = await createPlan(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      { name: "Amoxicilina", dosage: "500mg", scheduleType: "INTERVAL", intervalHours: 8, startAt: NOW.toISOString(), continuous: true },
      CTX,
      { prescriptionId: "rx-1" },
    );

    expect(plan.prescriptionId).toBe("rx-1");
  });

  it("recusa desenho inválido (INVALID_SCHEDULE) sem criar nada", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);

    await expect(
      createPlan(ACTOR, FAMILY_ID, MEMBER_ID, { name: "X", dosage: "1", scheduleType: "FIXED_TIMES", times: [], startAt: NOW.toISOString(), continuous: true }, CTX),
    ).rejects.toMatchObject({ code: "INVALID_SCHEDULE" });
    expect(fixtures.plansRepo.byId.size).toBe(0);
  });

  it("propaga a negação de access.policy.can()", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    fixtures.policy.denyWith = Object.assign(new Error("sem permissão"), { code: "FORBIDDEN" });
    const createPlan = createCreatePlanUseCase(fixtures.deps);

    await expect(
      createPlan(ACTOR, FAMILY_ID, MEMBER_ID, { name: "X", dosage: "1", scheduleType: "INTERVAL", intervalHours: 8, startAt: NOW.toISOString(), continuous: true }, CTX),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixtures.plansRepo.byId.size).toBe(0);
  });
});
