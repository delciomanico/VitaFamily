import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreatePlanUseCase } from "./create-plan.js";
import { createEndPlansForPrescriptionUseCase, createListPlansForPrescriptionUseCase } from "./for-prescription.js";
import { createMedicationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("for-prescription (modules.md §3.6: orquestração em `prescriptions`)", () => {
  it("lista os planos de uma receita", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const listPlansForPrescription = createListPlansForPrescriptionUseCase(fixtures.deps);
    const plan = await createPlan(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      { name: "A", dosage: "1", scheduleType: "INTERVAL", intervalHours: 8, startAt: NOW.toISOString(), continuous: true },
      CTX,
      { prescriptionId: "rx-1" },
    );

    const plans = await listPlansForPrescription(fixtures.deps.db, FAMILY_ID, MEMBER_ID, "rx-1");
    expect(plans.map((p) => p.id)).toEqual([plan.id]);
  });

  it("BR-RX-04: termina os planos ACTIVE da receita e remove a agenda futura", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const endPlansForPrescription = createEndPlansForPrescriptionUseCase(fixtures.deps);
    const plan = await createPlan(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      { name: "A", dosage: "1", scheduleType: "FIXED_TIMES", times: ["08:00"], startAt: NOW.toISOString(), continuous: true },
      CTX,
      { prescriptionId: "rx-1" },
    );
    expect([...fixtures.dosesRepo.byId.values()].filter((d) => d.planId === plan.id)).not.toHaveLength(0);

    await endPlansForPrescription(fixtures.deps.db, FAMILY_ID, MEMBER_ID, "rx-1", NOW);

    expect(fixtures.plansRepo.byId.get(plan.id)?.status).toBe("ENDED");
    expect([...fixtures.dosesRepo.byId.values()].filter((d) => d.planId === plan.id)).toHaveLength(0);
  });
});
