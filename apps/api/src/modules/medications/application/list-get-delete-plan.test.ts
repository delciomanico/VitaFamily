import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreatePlanUseCase } from "./create-plan.js";
import { createDeletePlanUseCase } from "./delete-plan.js";
import { createGetPlanUseCase } from "./get-plan.js";
import { createListPlansUseCase } from "./list-plans.js";
import { createMedicationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("listPlans/getPlan/deletePlan", () => {
  it("lista planos do membro, paginados", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const listPlans = createListPlansUseCase(fixtures.deps);
    await createPlan(ACTOR, FAMILY_ID, MEMBER_ID, { name: "A", dosage: "1", scheduleType: "INTERVAL", intervalHours: 8, startAt: NOW.toISOString(), continuous: true }, CTX);
    await createPlan(ACTOR, FAMILY_ID, MEMBER_ID, { name: "B", dosage: "1", scheduleType: "INTERVAL", intervalHours: 8, startAt: NOW.toISOString(), continuous: true }, CTX);

    const page = await listPlans(ACTOR, FAMILY_ID, MEMBER_ID, {}, CTX);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("filtra por estado", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const listPlans = createListPlansUseCase(fixtures.deps);
    const plan = await createPlan(ACTOR, FAMILY_ID, MEMBER_ID, { name: "A", dosage: "1", scheduleType: "INTERVAL", intervalHours: 8, startAt: NOW.toISOString(), continuous: true }, CTX);
    fixtures.plansRepo.byId.set(plan.id, { ...plan, status: "ENDED" });

    const page = await listPlans(ACTOR, FAMILY_ID, MEMBER_ID, { status: "ENDED" }, CTX);
    expect(page.items).toHaveLength(1);
  });

  it("audit.md §3: lê por tutor é auditado (HEALTH_VIEW); lê pelo próprio titular não", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const getPlan = createGetPlanUseCase(fixtures.deps);
    const plan = await createPlan(ACTOR, FAMILY_ID, MEMBER_ID, { name: "A", dosage: "1", scheduleType: "INTERVAL", intervalHours: 8, startAt: NOW.toISOString(), continuous: true }, CTX);

    fixtures.policy.relation = "SELF";
    await getPlan(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, CTX);
    expect(fixtures.audit.events.some((e) => e.action === "HEALTH_VIEW")).toBe(false);

    fixtures.policy.relation = "TUTOR_OF";
    await getPlan(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, CTX);
    expect(fixtures.audit.events.some((e) => e.action === "HEALTH_VIEW")).toBe(true);
  });

  it("getPlan devolve NOT_FOUND para plano de outra família (isolamento)", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const getPlan = createGetPlanUseCase(fixtures.deps);
    const plan = await createPlan(ACTOR, FAMILY_ID, MEMBER_ID, { name: "A", dosage: "1", scheduleType: "INTERVAL", intervalHours: 8, startAt: NOW.toISOString(), continuous: true }, CTX);

    await expect(getPlan(ACTOR, "other-family", MEMBER_ID, plan.id, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletePlan remove o plano e audita", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const deletePlan = createDeletePlanUseCase(fixtures.deps);
    const plan = await createPlan(ACTOR, FAMILY_ID, MEMBER_ID, { name: "A", dosage: "1", scheduleType: "INTERVAL", intervalHours: 8, startAt: NOW.toISOString(), continuous: true }, CTX);

    await deletePlan(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, CTX);

    expect(fixtures.plansRepo.byId.has(plan.id)).toBe(false);
    expect(fixtures.audit.events.some((e) => e.action === "PLAN_DELETE")).toBe(true);
  });
});
