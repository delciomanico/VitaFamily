import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import {
  createFindClinicSlotUseCase,
  createListFreeClinicSlotsUseCase,
  createListOwnClinicSlotsUseCase,
  createPublishClinicSlotsUseCase,
  createRemoveClinicSlotUseCase,
  createUpdateClinicSlotUseCase,
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

describe("removeClinicSlot: só horários livres (BR-CLN-04)", () => {
  it("horário com marcação ativa (consulta ou exame) -> CONFLICT e fica publicado", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);
    const slot = firstOf(await publish(ACTOR_A, { kind: "EXAM", date: "2026-10-20", times: ["09:00"], specialty: "Ecografia", durationMinutes: 30 }, CTX));
    fixtures.slotOccupancy.book(slot.id);

    await expect(createRemoveClinicSlotUseCase(fixtures.deps)(ACTOR_A, slot.id, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixtures.clinicSlotsRepo.byId.has(slot.id)).toBe(true);
  });
});

describe("ClinicSlot.kind (BR-APT-10, AC-APT-05)", () => {
  it("publicar sem kind cria APPOINTMENT; com kind=EXAM cria horários de exame (specialty = tipo de exame)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);
    const consulta = firstOf(await publish(ACTOR_A, { date: "2026-10-20", times: ["09:00"], specialty: "Cardiologia", durationMinutes: 30 }, CTX));
    const exame = firstOf(await publish(ACTOR_A, { kind: "EXAM", date: "2026-10-20", times: ["09:00"], specialty: "Ecografia", durationMinutes: 30 }, CTX));
    expect(consulta.kind).toBe("APPOINTMENT");
    expect(exame.kind).toBe("EXAM");
    expect(exame.specialty).toBe("Ecografia");
  });

  it("recusa kind desconhecido (VALIDATION_ERROR)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);
    await expect(publish(ACTOR_A, { kind: "OTHER", date: "2026-10-20", times: ["09:00"], specialty: "X", durationMinutes: 30 }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("a mesma hora/especialidade em kinds diferentes não é duplicado", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);
    await publish(ACTOR_A, { date: "2026-10-20", times: ["09:00"], specialty: "Geral", durationMinutes: 30 }, CTX);
    const second = await publish(ACTOR_A, { kind: "EXAM", date: "2026-10-20", times: ["09:00"], specialty: "Geral", durationMinutes: 30 }, CTX);
    expect(second).toHaveLength(1);
  });

  it("listFreeClinicSlots filtra por kind (default APPOINTMENT); o portal sem kind devolve todos", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);
    await publish(ACTOR_A, { date: "2026-10-20", times: ["09:00"], specialty: "Cardiologia", durationMinutes: 30 }, CTX);
    await publish(ACTOR_A, { kind: "EXAM", date: "2026-10-20", times: ["10:00"], specialty: "Ecografia", durationMinutes: 30 }, CTX);

    const listFree = createListFreeClinicSlotsUseCase(fixtures.deps);
    expect((await listFree(CLINIC_A)).map((s) => s.kind)).toEqual(["APPOINTMENT"]);
    expect((await listFree(CLINIC_A, undefined, "EXAM")).map((s) => s.kind)).toEqual(["EXAM"]);

    const listOwn = createListOwnClinicSlotsUseCase(fixtures.deps);
    expect(await listOwn(ACTOR_A, {})).toHaveLength(2);
    expect(await listOwn(ACTOR_A, { kind: "EXAM" })).toHaveLength(1);
  });
});

describe("capacity (BR-APT-11, AC-APT-05)", () => {
  const publishExam = (fixtures: ReturnType<typeof createClinicsFixtures>, capacity?: number) =>
    createPublishClinicSlotsUseCase(fixtures.deps)(
      ACTOR_A,
      { kind: "EXAM", date: "2026-10-20", times: ["09:00"], specialty: "Análises", durationMinutes: 30, ...(capacity !== undefined ? { capacity } : {}) },
      CTX,
    );

  it("publicar: default 1; EXAM aceita 1–50; APPOINTMENT com > 1 e capacity fora de 1–50 -> VALIDATION_ERROR", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    expect(firstOf(await publishExam(fixtures)).capacity).toBe(1);
    expect(firstOf(await createPublishClinicSlotsUseCase(fixtures.deps)(ACTOR_A, { kind: "EXAM", date: "2026-10-21", times: ["09:00"], specialty: "Análises", durationMinutes: 30, capacity: 50 }, CTX)).capacity).toBe(50);
    const publish = createPublishClinicSlotsUseCase(fixtures.deps);
    await expect(publish(ACTOR_A, { date: "2026-10-22", times: ["09:00"], specialty: "Cardiologia", durationMinutes: 30, capacity: 2 }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(publishExam(fixtures, 0)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(publishExam(fixtures, 51)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("listOwnClinicSlots devolve capacity/bookedCount/remaining/state (FREE -> PARTIAL -> FULL)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const slot = firstOf(await publishExam(fixtures, 2));
    const listOwn = createListOwnClinicSlotsUseCase(fixtures.deps);
    expect(await listOwn(ACTOR_A, {})).toMatchObject([{ capacity: 2, bookedCount: 0, remaining: 2, state: "FREE" }]);
    fixtures.slotOccupancy.book(slot.id);
    expect(await listOwn(ACTOR_A, {})).toMatchObject([{ bookedCount: 1, remaining: 1, state: "PARTIAL" }]);
    fixtures.slotOccupancy.book(slot.id);
    expect(await listOwn(ACTOR_A, {})).toMatchObject([{ bookedCount: 2, remaining: 0, state: "FULL" }]);
  });

  it("consulta: state REQUESTED/SCHEDULED conforme a marcação", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const [a, b] = await createPublishClinicSlotsUseCase(fixtures.deps)(ACTOR_A, { date: "2026-10-20", times: ["09:00", "10:00"], specialty: "Cardiologia", durationMinutes: 30 }, CTX);
    fixtures.slotOccupancy.book(a?.id ?? "", "requested");
    fixtures.slotOccupancy.book(b?.id ?? "", "scheduled");
    const views = await createListOwnClinicSlotsUseCase(fixtures.deps)(ACTOR_A, {});
    expect(views.map((v) => v.state)).toEqual(["REQUESTED", "SCHEDULED"]);
  });

  describe("updateClinicSlot (PATCH /clinic-portal/slots/{slotId})", () => {
    it("altera capacity, audita CLINIC_SLOT_UPDATE e devolve a vista", async () => {
      const fixtures = createClinicsFixtures(new FixedClock(NOW));
      const slot = firstOf(await publishExam(fixtures, 2));
      fixtures.slotOccupancy.book(slot.id);

      const view = await createUpdateClinicSlotUseCase(fixtures.deps)(ACTOR_A, slot.id, { capacity: 5 }, CTX);

      expect(view).toMatchObject({ capacity: 5, bookedCount: 1, remaining: 4, state: "PARTIAL" });
      expect(fixtures.audit.events.at(-1)).toMatchObject({ action: "CLINIC_SLOT_UPDATE", actorType: "CLINIC_ACCOUNT", resourceId: slot.id, metadata: { capacityFrom: 2, capacityTo: 5 } });
    });

    it("reduzir abaixo das marcações ativas -> CONFLICT (sem alterar); igual às marcações é permitido", async () => {
      const fixtures = createClinicsFixtures(new FixedClock(NOW));
      const slot = firstOf(await publishExam(fixtures, 3));
      fixtures.slotOccupancy.book(slot.id, "scheduled", 2);
      const update = createUpdateClinicSlotUseCase(fixtures.deps);

      await expect(update(ACTOR_A, slot.id, { capacity: 1 }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(fixtures.clinicSlotsRepo.byId.get(slot.id)?.capacity).toBe(3);
      await expect(update(ACTOR_A, slot.id, { capacity: 2 }, CTX)).resolves.toMatchObject({ capacity: 2, state: "FULL" });
    });

    it("horário de consulta -> VALIDATION_ERROR; capacity fora de 1–50 ou em falta -> VALIDATION_ERROR; outra clínica -> NOT_FOUND", async () => {
      const fixtures = createClinicsFixtures(new FixedClock(NOW));
      const appt = firstOf(await createPublishClinicSlotsUseCase(fixtures.deps)(ACTOR_A, { date: "2026-10-20", times: ["09:00"], specialty: "Cardiologia", durationMinutes: 30 }, CTX));
      const exam = firstOf(await publishExam(fixtures, 2));
      const update = createUpdateClinicSlotUseCase(fixtures.deps);

      await expect(update(ACTOR_A, appt.id, { capacity: 2 }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(update(ACTOR_A, exam.id, { capacity: 0 }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(update(ACTOR_A, exam.id, { capacity: 51 }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(update(ACTOR_A, exam.id, {} as { capacity: number }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(update(ACTOR_B, exam.id, { capacity: 3 }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("remover horário de exame com marcações SCHEDULED -> CONFLICT; sem marcações remove", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const slot = firstOf(await publishExam(fixtures, 5));
    const remove = createRemoveClinicSlotUseCase(fixtures.deps);
    fixtures.slotOccupancy.book(slot.id);
    await expect(remove(ACTOR_A, slot.id, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    fixtures.slotOccupancy.counts.clear();
    await remove(ACTOR_A, slot.id, CTX);
    expect(fixtures.clinicSlotsRepo.byId.has(slot.id)).toBe(false);
  });
});
