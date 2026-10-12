import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import {
  createFindClinicSlotUseCase,
  createListFreeClinicSlotsUseCase,
  createListOwnClinicSlotsUseCase,
  createPublishClinicSlotsUseCase,
  createRemoveClinicSlotUseCase,
} from "./clinic-slots.js";
import { createClinicsFixtures } from "./fixtures.js";
import type { ClinicPortalActor } from "./ports.js";

// "Hoje" fixo em outubro (ainda WEST, Europe/Lisbon = UTC+1; a mudança para WET só em 25/10/2026).
const NOW = new Date("2026-10-12T08:00:00Z");
const CTX = { requestId: "req-1" };
const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";
const ACTOR_A: ClinicPortalActor = { clinicAccountId: "acc-a", clinicId: CLINIC_A, role: "CLINIC_MANAGER" };
const ACTOR_B: ClinicPortalActor = { clinicAccountId: "acc-b", clinicId: CLINIC_B, role: "CLINIC_ADMIN" };

function firstOf<T>(items: T[]): T {
  const [item] = items;
  if (!item) {
    throw new Error("esperava pelo menos um elemento");
  }
  return item;
}

describe("publishClinicSlots (BR-CLN-04/UC-CLN-04)", () => {
  it("publica um horário por cada hora válida e futura", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);

    const result = await publish(ACTOR_A, { date: "2026-10-20", times: ["09:00", "09:30"], specialty: "Cardiologia", durationMinutes: 30 }, CTX);

    expect(result).toHaveLength(2);
    expect(result.every((slot) => slot.clinicId === CLINIC_A && slot.specialty === "Cardiologia")).toBe(true);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("CLINIC_SLOT_PUBLISH");
  });

  it("ignora horas já passadas sem falhar o lote", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);

    // "Hoje" (2026-10-12) com uma hora no passado e outra no futuro.
    const result = await publish(ACTOR_A, { date: "2026-10-12", times: ["00:00", "23:00"], specialty: "Cardiologia", durationMinutes: 30 }, CTX);

    expect(result).toHaveLength(1);
  });

  it("ignora duplicadas (mesma hora, especialidade e profissional), já publicadas ou no mesmo lote", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);

    await publish(ACTOR_A, { date: "2026-10-20", times: ["09:00"], specialty: "Cardiologia", professionalName: "Dr. Costa", durationMinutes: 30 }, CTX);
    const second = await publish(
      ACTOR_A,
      { date: "2026-10-20", times: ["09:00", "09:00", "10:00"], specialty: "Cardiologia", professionalName: "Dr. Costa", durationMinutes: 30 },
      CTX,
    );

    expect(second).toHaveLength(1);
    // "10:00" local (WEST, UTC+1 em outubro) -> 09:00 UTC.
    expect(second[0]?.startsAt.getUTCHours()).toBe(9);
  });

  it("mesma hora com profissional diferente não é duplicada", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);

    await publish(ACTOR_A, { date: "2026-10-20", times: ["09:00"], specialty: "Cardiologia", professionalName: "Dr. Costa", durationMinutes: 30 }, CTX);
    const second = await publish(ACTOR_A, { date: "2026-10-20", times: ["09:00"], specialty: "Cardiologia", professionalName: "Dr. Silva", durationMinutes: 30 }, CTX);

    expect(second).toHaveLength(1);
  });

  it("recusa duração inválida (VALIDATION_ERROR)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);

    await expect(publish(ACTOR_A, { date: "2026-10-20", times: ["09:00"], specialty: "Cardiologia", durationMinutes: 25 }, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("listOwnClinicSlots/listFreeClinicSlots (UC-CLN-04)", () => {
  it("lista só os horários da própria clínica", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);
    await publish(ACTOR_A, { date: "2026-10-20", times: ["09:00"], specialty: "Cardiologia", durationMinutes: 30 }, CTX);
    await publish(ACTOR_B, { date: "2026-10-20", times: ["09:00"], specialty: "Dermatologia", durationMinutes: 30 }, CTX);

    const listOwn = createListOwnClinicSlotsUseCase(fixtures.deps);
    const resultA = await listOwn(ACTOR_A, {});
    expect(resultA).toHaveLength(1);
    expect(resultA[0]?.clinicId).toBe(CLINIC_A);

    const listFree = createListFreeClinicSlotsUseCase(fixtures.deps);
    const freeB = await listFree(CLINIC_B, "Dermatologia");
    expect(freeB).toHaveLength(1);
    const freeBWrongSpecialty = await listFree(CLINIC_B, "Cardiologia");
    expect(freeBWrongSpecialty).toHaveLength(0);
  });
});

describe("findClinicSlot (API pela raiz, Fase D ainda não ligada)", () => {
  it("devolve o horário só se pertencer à clínica pedida", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);
    const slot = firstOf(await publish(ACTOR_A, { date: "2026-10-20", times: ["09:00"], specialty: "Cardiologia", durationMinutes: 30 }, CTX));

    const findSlot = createFindClinicSlotUseCase(fixtures.deps);
    expect(await findSlot(CLINIC_A, slot.id)).not.toBeNull();
    expect(await findSlot(CLINIC_B, slot.id)).toBeNull();
  });
});

describe("removeClinicSlot (BR-CLN-04)", () => {
  it("remove um horário da própria clínica", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);
    const slot = firstOf(await publish(ACTOR_A, { date: "2026-10-20", times: ["09:00"], specialty: "Cardiologia", durationMinutes: 30 }, CTX));

    const removeSlot = createRemoveClinicSlotUseCase(fixtures.deps);
    await removeSlot(ACTOR_A, slot.id, CTX);

    expect(fixtures.clinicSlotsRepo.byId.has(slot.id)).toBe(false);
    expect(fixtures.audit.events.map((e) => e.action)).toContain("CLINIC_SLOT_REMOVE");
  });

  it("NOT_FOUND para horário de outra clínica (nunca enumera)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);
    const slot = firstOf(await publish(ACTOR_B, { date: "2026-10-20", times: ["09:00"], specialty: "Dermatologia", durationMinutes: 30 }, CTX));

    const removeSlot = createRemoveClinicSlotUseCase(fixtures.deps);
    await expect(removeSlot(ACTOR_A, slot.id, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("NOT_FOUND para horário inexistente", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const removeSlot = createRemoveClinicSlotUseCase(fixtures.deps);
    await expect(removeSlot(ACTOR_A, "slot-inexistente", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
