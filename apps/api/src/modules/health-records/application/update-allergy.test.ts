import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createHealthRecordsFixtures } from "./fixtures.js";
import { createUpdateAllergyUseCase } from "./update-allergy.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

function seedAllergy(fixtures: ReturnType<typeof createHealthRecordsFixtures>) {
  fixtures.allergiesRepo.seed({ id: "a1", familyId: FAMILY_ID, memberId: MEMBER_ID, name: "Pólen", notes: "Primavera", createdAt: NOW });
}

describe("updateAllergy (R6: só estado atual)", () => {
  it("AC-HLT-01: altera o nome e regista a auditoria", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    seedAllergy(fixtures);
    const updateAllergy = createUpdateAllergyUseCase(fixtures.deps);

    const updated = await updateAllergy(ACTOR, FAMILY_ID, MEMBER_ID, "a1", { name: "Pólen de bétula" }, CTX);

    expect(updated.name).toBe("Pólen de bétula");
    expect(updated.notes).toBe("Primavera");
    expect(fixtures.audit.events.map((e) => e.action)).toContain("ALLERGY_UPDATE");
  });

  it("limpa notes/since quando o patch traz null", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    seedAllergy(fixtures);
    const updateAllergy = createUpdateAllergyUseCase(fixtures.deps);

    const updated = await updateAllergy(ACTOR, FAMILY_ID, MEMBER_ID, "a1", { notes: null }, CTX);

    expect(updated.notes).toBeUndefined();
  });

  it("rejeita nome nulo (VALIDATION_ERROR)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    seedAllergy(fixtures);
    const updateAllergy = createUpdateAllergyUseCase(fixtures.deps);

    await expect(updateAllergy(ACTOR, FAMILY_ID, MEMBER_ID, "a1", { name: null }, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("alergia inexistente (NOT_FOUND)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    const updateAllergy = createUpdateAllergyUseCase(fixtures.deps);

    await expect(updateAllergy(ACTOR, FAMILY_ID, MEMBER_ID, "missing", { name: "X" }, CTX)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
