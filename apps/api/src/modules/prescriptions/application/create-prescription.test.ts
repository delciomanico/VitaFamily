import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreatePrescriptionUseCase } from "./create-prescription.js";
import { createPrescriptionsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

const MED_INPUT = { name: "Ibuprofeno", dosage: "400mg", scheduleType: "FIXED_TIMES" as const, times: ["08:00"], startAt: NOW.toISOString(), continuous: true };

describe("createPrescription (AC-RX-01, BR-RX-01/02)", () => {
  it("cria a receita ACTIVE e um plano por medicamento, na mesma transação", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);

    const prescription = await createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT, MED_INPUT] }, CTX);

    expect(prescription.status).toBe("ACTIVE");
    expect(prescription.medications).toHaveLength(2);
    expect(fixtures.medications.createCalls).toHaveLength(2);
    expect(fixtures.medications.createCalls[0]?.options?.prescriptionId).toBe(prescription.id);
    expect(fixtures.audit.events.some((e) => e.action === "PRESCRIPTION_CREATE")).toBe(true);
  });

  it("recusa sem medicamentos (VALIDATION_ERROR), sem chamar medications", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);

    await expect(createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [] }, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(fixtures.medications.createCalls).toHaveLength(0);
  });

  it("recusa data de emissão futura", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);

    await expect(createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-16", medications: [MED_INPUT] }, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("propaga a negação de access.policy.can()", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    fixtures.policy.denyWith = Object.assign(new Error("sem permissão"), { code: "FORBIDDEN" });
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);

    await expect(createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, CTX)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixtures.prescriptionsRepo.byId.size).toBe(0);
  });
});
