import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createMedicationAdherenceUseCase } from "./medication-adherence.js";
import { createMedicationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-30T10:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("medicationAdherence (BR-MED-07: só contagens, sem interpretação)", () => {
  it("conta por estado e por plano, sem avaliar se é bom/mau", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    fixtures.dosesRepo.seed({
      id: "d1",
      familyId: FAMILY_ID,
      memberId: MEMBER_ID,
      planId: "p1",
      medicationName: "Ibuprofeno",
      dosage: "400mg",
      scheduledAt: new Date("2026-01-15T08:00:00.000Z"),
      status: "TAKEN",
      generationVersion: 1,
      createdAt: new Date("2026-01-15T08:00:00.000Z"),
    });
    fixtures.dosesRepo.seed({
      id: "d2",
      familyId: FAMILY_ID,
      memberId: MEMBER_ID,
      planId: "p1",
      medicationName: "Ibuprofeno",
      dosage: "400mg",
      scheduledAt: new Date("2026-01-16T08:00:00.000Z"),
      status: "NOT_TAKEN",
      generationVersion: 1,
      createdAt: new Date("2026-01-16T08:00:00.000Z"),
    });

    const medicationAdherence = createMedicationAdherenceUseCase(fixtures.deps);
    const items = await medicationAdherence(ACTOR, FAMILY_ID, MEMBER_ID, { from: "2026-01-01", to: "2026-01-31" }, CTX);

    expect(items).toEqual([{ planId: "p1", medicationName: "Ibuprofeno", taken: 1, notTaken: 1, unconfirmed: 0, pending: 0 }]);
  });

  it("recusa período inválido (from depois de to)", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    const medicationAdherence = createMedicationAdherenceUseCase(fixtures.deps);
    await expect(medicationAdherence(ACTOR, FAMILY_ID, MEMBER_ID, { from: "2026-02-01", to: "2026-01-01" }, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
