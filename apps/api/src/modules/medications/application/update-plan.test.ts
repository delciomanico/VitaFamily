import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ConflictError } from "../../../platform/errors/index.js";
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

describe("updatePlan em plano de receita PROFESSIONAL (OP-127, BR-MKT-81)", () => {
  const RX_ID = "rx-professional";
  const DETAIL = "O conteúdo desta receita só pode ser lido.";
  const PLAN_INPUT = { name: "Amoxicilina", dosage: "500mg", scheduleType: "FIXED_TIMES" as const, times: ["08:00"], startAt: NOW.toISOString(), continuous: true };

  function setup() {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const createPlan = createCreatePlanUseCase(fixtures.deps);
    const updatePlan = createUpdatePlanUseCase(fixtures.deps);
    fixtures.readOnlyPrescriptionIds.add(RX_ID);
    return { fixtures, createPlan, updatePlan };
  }

  it.each([
    ["name", { name: "Outro nome" }],
    ["dosage", { dosage: "2g" }],
    ["notes", { notes: "Tomar com comida" }],
    ["endAt", { endAt: "2026-06-01T00:00:00.000Z" }],
    ["continuous", { continuous: false }],
  ])("recusa alterar %s com CONFLICT e deixa o plano inalterado", async (_field, patch) => {
    const { fixtures, createPlan, updatePlan } = setup();
    const plan = await createPlan(ACTOR, FAMILY_ID, MEMBER_ID, PLAN_INPUT, CTX, { prescriptionId: RX_ID });
    const before = structuredClone(fixtures.plansRepo.byId.get(plan.id));

    const attempt = updatePlan(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, patch, CTX);

    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toMatchObject({ code: "CONFLICT", detail: DETAIL });
    expect(fixtures.plansRepo.byId.get(plan.id)).toEqual(before);
  });

  it("recusa o pedido inteiro se misturar horário com conteúdo (name)", async () => {
    const { fixtures, createPlan, updatePlan } = setup();
    const plan = await createPlan(ACTOR, FAMILY_ID, MEMBER_ID, PLAN_INPUT, CTX, { prescriptionId: RX_ID });
    const before = structuredClone(fixtures.plansRepo.byId.get(plan.id));
    const dosesBefore = structuredClone([...fixtures.dosesRepo.byId.values()]);

    await expect(updatePlan(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, { times: ["09:00"], name: "Outro nome" }, CTX)).rejects.toMatchObject({
      code: "CONFLICT",
      detail: DETAIL,
    });

    expect(fixtures.plansRepo.byId.get(plan.id)).toEqual(before);
    expect([...fixtures.dosesRepo.byId.values()]).toEqual(dosesBefore);
  });

  it("permite ajustar só horários (scheduleType, times, daysOfWeek) numa receita PROFESSIONAL", async () => {
    const { fixtures, createPlan, updatePlan } = setup();
    const plan = await createPlan(ACTOR, FAMILY_ID, MEMBER_ID, PLAN_INPUT, CTX, { prescriptionId: RX_ID });

    const updated = await updatePlan(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      plan.id,
      { scheduleType: "FIXED_TIMES", times: ["09:00", "21:00"], daysOfWeek: [1, 2, 3] },
      CTX,
    );

    expect(updated.times).toEqual(["09:00", "21:00"]);
    expect(updated.daysOfWeek).toEqual([1, 2, 3]);
    expect(updated.name).toBe("Amoxicilina");
    expect(fixtures.plansRepo.byId.get(plan.id)?.times).toEqual(["09:00", "21:00"]);
  });

  it("permite ajustar o intervalo (intervalHours) numa receita PROFESSIONAL", async () => {
    const { createPlan, updatePlan } = setup();
    const plan = await createPlan(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      { name: "Soro", dosage: "1 saqueta", scheduleType: "INTERVAL", intervalHours: 8, startAt: NOW.toISOString(), continuous: true },
      CTX,
      { prescriptionId: RX_ID },
    );

    const updated = await updatePlan(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, { intervalHours: 6 }, CTX);

    expect(updated.intervalHours).toBe(6);
    expect(updated.scheduleType).toBe("INTERVAL");
  });

  it("plano sem prescriptionId aceita alterar conteúdo", async () => {
    const { fixtures, createPlan, updatePlan } = setup();
    const plan = await createPlan(ACTOR, FAMILY_ID, MEMBER_ID, PLAN_INPUT, CTX);

    const updated = await updatePlan(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, { name: "Ibuprofeno", dosage: "400mg", notes: "Com comida", continuous: true }, CTX);

    expect(updated.name).toBe("Ibuprofeno");
    expect(updated.dosage).toBe("400mg");
    expect(fixtures.plansRepo.byId.get(plan.id)?.name).toBe("Ibuprofeno");
  });

  it("plano de receita que não é só leitura (FAMILY/CLINIC) aceita alterar conteúdo", async () => {
    const { fixtures, createPlan, updatePlan } = setup();
    const plan = await createPlan(ACTOR, FAMILY_ID, MEMBER_ID, PLAN_INPUT, CTX, { prescriptionId: "rx-family" });

    const updated = await updatePlan(ACTOR, FAMILY_ID, MEMBER_ID, plan.id, { name: "Paracetamol", dosage: "1g" }, CTX);

    expect(fixtures.readOnlyPrescriptionIds.has("rx-family")).toBe(false);
    expect(updated.name).toBe("Paracetamol");
    expect(updated.dosage).toBe("1g");
  });
});
