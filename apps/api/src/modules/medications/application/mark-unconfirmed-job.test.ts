import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createMarkUnconfirmedJobUseCase } from "./mark-unconfirmed-job.js";
import { createMedicationsFixtures } from "./fixtures.js";

describe("markUnconfirmedJob (Q2/BR-MED-03/04: 2h sem ação)", () => {
  it("marca PENDING com mais de 2h como UNCONFIRMED, sem tocar nas restantes", async () => {
    const now = new Date("2026-01-15T10:30:00.000Z");
    const fixtures = createMedicationsFixtures(new FixedClock(now));
    fixtures.dosesRepo.seed({
      id: "old",
      familyId: "f1",
      memberId: "m1",
      planId: "p1",
      medicationName: "X",
      dosage: "1",
      scheduledAt: new Date("2026-01-15T08:00:00.000Z"),
      status: "PENDING",
      generationVersion: 1,
      createdAt: new Date("2026-01-15T08:00:00.000Z"),
    });
    fixtures.dosesRepo.seed({
      id: "recent",
      familyId: "f1",
      memberId: "m1",
      planId: "p1",
      medicationName: "X",
      dosage: "1",
      scheduledAt: new Date("2026-01-15T09:30:00.000Z"),
      status: "PENDING",
      generationVersion: 1,
      createdAt: new Date("2026-01-15T09:30:00.000Z"),
    });

    const markUnconfirmedJob = createMarkUnconfirmedJobUseCase(fixtures.deps);
    const result = await markUnconfirmedJob();

    expect(result).toEqual({ marked: 1 });
    expect(fixtures.dosesRepo.byId.get("old")?.status).toBe("UNCONFIRMED");
    expect(fixtures.dosesRepo.byId.get("recent")?.status).toBe("PENDING");
  });

  it("não gera auditoria (BR-MED-06/D7-B: não é ação sensível, só histórico)", async () => {
    const now = new Date("2026-01-15T10:30:00.000Z");
    const fixtures = createMedicationsFixtures(new FixedClock(now));
    fixtures.dosesRepo.seed({
      id: "old",
      familyId: "f1",
      memberId: "m1",
      planId: "p1",
      medicationName: "X",
      dosage: "1",
      scheduledAt: new Date("2026-01-15T08:00:00.000Z"),
      status: "PENDING",
      generationVersion: 1,
      createdAt: new Date("2026-01-15T08:00:00.000Z"),
    });

    const markUnconfirmedJob = createMarkUnconfirmedJobUseCase(fixtures.deps);
    await markUnconfirmedJob();

    expect(fixtures.audit.events).toHaveLength(0);
  });
});
