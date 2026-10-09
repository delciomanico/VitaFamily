import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreateConditionUseCase } from "./create-condition.js";
import { createHealthRecordsFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("createCondition (FR-HP-02/03)", () => {
  it("AC-HLT-01: cria a condição e regista a auditoria", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    const createCondition = createCreateConditionUseCase(fixtures.deps);

    const condition = await createCondition(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      { name: "Asma", kind: "CONDITION", since: "2018-01-01" },
      CTX,
    );

    expect(condition.kind).toBe("CONDITION");
    expect(fixtures.policy.calls[0]).toMatchObject({ action: "CREATE", category: "CONDITIONS" });
    expect(fixtures.audit.events.map((e) => e.action)).toContain("CONDITION_CREATE");
  });

  it("rejeita until anterior a since (VALIDATION_ERROR, schema.md §3)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    const createCondition = createCreateConditionUseCase(fixtures.deps);

    await expect(
      createCondition(
        ACTOR,
        FAMILY_ID,
        MEMBER_ID,
        { name: "Bronquite", kind: "HISTORY", since: "2020-06-01", until: "2020-01-01" },
        CTX,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
