import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createGenerateDosesJobUseCase } from "./generate-doses-job.js";
import { createMedicationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");

describe("generateDosesJob (modules.md §5: diário, janela de 14 dias)", () => {
  it("gera ocorrências para todos os planos ACTIVE de todas as famílias", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    fixtures.plansRepo.seed({
      id: "p1",
      familyId: "f1",
      memberId: "m1",
      name: "A",
      dosage: "1",
      scheduleType: "FIXED_TIMES",
      times: ["08:00"],
      daysOfWeek: [],
      startAt: NOW,
      continuous: true,
      status: "ACTIVE",
      createdAt: NOW,
    });
    fixtures.plansRepo.seed({
      id: "p2",
      familyId: "f2",
      memberId: "m2",
      name: "B",
      dosage: "1",
      scheduleType: "INTERVAL",
      intervalHours: 6,
      startAt: NOW,
      continuous: true,
      status: "ACTIVE",
      createdAt: NOW,
    });

    const generateDosesJob = createGenerateDosesJobUseCase(fixtures.deps);
    const result = await generateDosesJob();

    expect(result).toEqual({ plansProcessed: 2, plansFailed: 0 });
    expect([...fixtures.dosesRepo.byId.values()].filter((d) => d.planId === "p1").length).toBeGreaterThan(0);
    expect([...fixtures.dosesRepo.byId.values()].filter((d) => d.planId === "p2").length).toBeGreaterThan(0);
  });

  it("ignora planos ENDED", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    fixtures.plansRepo.seed({
      id: "p1",
      familyId: "f1",
      memberId: "m1",
      name: "A",
      dosage: "1",
      scheduleType: "FIXED_TIMES",
      times: ["08:00"],
      daysOfWeek: [],
      startAt: NOW,
      continuous: true,
      status: "ENDED",
      createdAt: NOW,
    });

    const generateDosesJob = createGenerateDosesJobUseCase(fixtures.deps);
    const result = await generateDosesJob();

    expect(result).toEqual({ plansProcessed: 0, plansFailed: 0 });
  });

  it("é idempotente: correr duas vezes não duplica", async () => {
    const fixtures = createMedicationsFixtures(new FixedClock(NOW));
    fixtures.plansRepo.seed({
      id: "p1",
      familyId: "f1",
      memberId: "m1",
      name: "A",
      dosage: "1",
      scheduleType: "FIXED_TIMES",
      times: ["08:00"],
      daysOfWeek: [],
      startAt: NOW,
      continuous: true,
      status: "ACTIVE",
      createdAt: NOW,
    });
    const generateDosesJob = createGenerateDosesJobUseCase(fixtures.deps);

    await generateDosesJob();
    const countAfterFirst = fixtures.dosesRepo.byId.size;
    await generateDosesJob();

    expect(fixtures.dosesRepo.byId.size).toBe(countAfterFirst);
  });
});
