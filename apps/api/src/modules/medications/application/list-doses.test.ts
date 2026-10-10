import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createListDosesUseCase } from "./list-doses.js";
import { createMedicationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

function seed(fixtures: ReturnType<typeof createMedicationsFixtures>, id: string, planId: string, scheduledAt: Date, status: "PENDING" | "TAKEN" = "PENDING") {
  fixtures.dosesRepo.seed({
    id,
    familyId: FAMILY_ID,
    memberId: MEMBER_ID,
    planId,
    medicationName: "X",
    dosage: "1",
    scheduledAt,
    status,
    generationVersion: 1,
    createdAt: scheduledAt,
  });
}

describe("listDoses (FR-MED-05)", () => {
  it("filtra por período, estado e plano", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    seed(fixtures, "d1", "p1", new Date("2026-01-14T08:00:00.000Z"), "TAKEN");
    seed(fixtures, "d2", "p1", new Date("2026-01-15T08:00:00.000Z"), "PENDING");
    seed(fixtures, "d3", "p2", new Date("2026-01-15T09:00:00.000Z"), "PENDING");
    const listDoses = createListDosesUseCase(fixtures.deps);

    const byPlan = await listDoses(ACTOR, FAMILY_ID, MEMBER_ID, { planId: "p1" }, CTX);
    expect(byPlan.items.map((d) => d.id)).toEqual(["d1", "d2"]);

    const byStatus = await listDoses(ACTOR, FAMILY_ID, MEMBER_ID, { status: "PENDING" }, CTX);
    expect(byStatus.items.map((d) => d.id).sort()).toEqual(["d2", "d3"]);

    const byPeriod = await listDoses(ACTOR, FAMILY_ID, MEMBER_ID, { from: "2026-01-15T00:00:00.000Z" }, CTX);
    expect(byPeriod.items.map((d) => d.id).sort()).toEqual(["d2", "d3"]);
  });

  it("pagina com cursor", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    seed(fixtures, "d1", "p1", new Date("2026-01-14T08:00:00.000Z"));
    seed(fixtures, "d2", "p1", new Date("2026-01-15T08:00:00.000Z"));
    const listDoses = createListDosesUseCase(fixtures.deps);

    const first = await listDoses(ACTOR, FAMILY_ID, MEMBER_ID, { limit: "1" }, CTX);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const cursor = first.nextCursor;
    if (!cursor) {
      throw new Error("cursor esperado");
    }
    const second = await listDoses(ACTOR, FAMILY_ID, MEMBER_ID, { limit: "1", cursor }, CTX);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});
