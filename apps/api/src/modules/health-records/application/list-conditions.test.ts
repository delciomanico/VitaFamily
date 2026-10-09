import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createHealthRecordsFixtures } from "./fixtures.js";
import { createListConditionsUseCase } from "./list-conditions.js";

const NOW = new Date("2026-10-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("listConditions (audit.md §3)", () => {
  it("não audita o titular a ler os seus próprios dados", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.policy.relation = "SELF";
    const listConditions = createListConditionsUseCase(fixtures.deps);

    await listConditions(ACTOR, FAMILY_ID, MEMBER_ID, CTX);

    expect(fixtures.audit.events).toHaveLength(0);
  });

  it("audita HEALTH_VIEW quando é partilha (relation=OTHER)", async () => {
    const fixtures = createHealthRecordsFixtures(new FixedClock(NOW));
    fixtures.policy.relation = "OTHER";
    const listConditions = createListConditionsUseCase(fixtures.deps);

    await listConditions(ACTOR, FAMILY_ID, MEMBER_ID, CTX);

    expect(fixtures.audit.events[0]).toMatchObject({ action: "HEALTH_VIEW", resourceType: "Condition" });
  });
});
