import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createHealthRecordsFixtures } from "./fixtures.js";
import { createUpdateConditionUseCase } from "./update-condition.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

function seedCondition(fixtures: ReturnType<typeof createHealthRecordsFixtures>) {
  fixtures.conditionsRepo.seed({
    id: "c1",
    familyId: FAMILY_ID,
    memberId: MEMBER_ID,
    name: "Asma",
    kind: "CONDITION",
    since: "2018-01-01",
    createdAt: NOW,
  });
}

describe("updateCondition (schema.md §3: until >= since com valores efetivos)", () => {
  it("AC-HLT-01: altera o kind para HISTORY e regista a auditoria", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    seedCondition(fixtures);
    const updateCondition = createUpdateConditionUseCase(fixtures.deps);

    const updated = await updateCondition(ACTOR, FAMILY_ID, MEMBER_ID, "c1", { kind: "HISTORY", until: "2022-01-01" }, CTX);

    expect(updated.kind).toBe("HISTORY");
    expect(updated.until).toBe("2022-01-01");
    expect(fixtures.audit.events.map((e) => e.action)).toContain("CONDITION_UPDATE");
  });

  it("rejeita until anterior ao since existente quando só until é alterado", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    seedCondition(fixtures);
    const updateCondition = createUpdateConditionUseCase(fixtures.deps);

    await expect(updateCondition(ACTOR, FAMILY_ID, MEMBER_ID, "c1", { until: "2010-01-01" }, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejeita kind nulo (VALIDATION_ERROR)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    seedCondition(fixtures);
    const updateCondition = createUpdateConditionUseCase(fixtures.deps);

    await expect(updateCondition(ACTOR, FAMILY_ID, MEMBER_ID, "c1", { kind: null }, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("condição inexistente (NOT_FOUND)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    const updateCondition = createUpdateConditionUseCase(fixtures.deps);

    await expect(updateCondition(ACTOR, FAMILY_ID, MEMBER_ID, "missing", { name: "X" }, CTX)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
