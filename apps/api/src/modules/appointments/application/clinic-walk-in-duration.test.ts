// M14 a2 (BR-CLN-13/16, AC-CLN-12, TC-CLN-07): walk-in com sobreposição por duração, duração copiada do
// horário e defesa por profissional (fakes em memória, sem I/O).
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreateWalkInAppointmentUseCase } from "./clinic-walk-in.js";
import { createAppointmentsFixtures } from "./fixtures.js";
import { createCreateAppointmentUseCase } from "./create-appointment.js";
import type { ClinicSlotLite } from "./ports.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const CTX = { requestId: "req-1", ip: "10.0.0.1" };
const CLINIC = "clinic-a";
const ACTOR = { clinicAccountId: "acc-a", clinicId: CLINIC };
const FAMILY = "fam-1";
const MEMBER = "mem-1";
const EMAIL = "maria.silva@example.pt";
function createClinicsPortSlot(input: Partial<ClinicSlotLite> & Pick<ClinicSlotLite, "id" | "clinicId" | "startsAt" | "durationMinutes">): ClinicSlotLite {
  return { kind: "APPOINTMENT", specialty: "Cardiologia", capacity: input.kind === "EXAM" ? 2 : 1, ...input };
}
const at = (hhmm: string) => new Date(`2026-02-01T${hhmm}:00.000Z`);

function setup() {
  const fx = createAppointmentsFixtures(new FixedClock(NOW));
  fx.clinics.seed(CLINIC, "Clínica Sol", "");
  fx.patients.seed(EMAIL, FAMILY, MEMBER, "Maria Santos Silva");
  fx.memberNames.seed(FAMILY, MEMBER, "Maria Santos Silva");
  return { fx, book: createCreateWalkInAppointmentUseCase(fx.deps) };
}

const slot = (id: string, hhmm: string, durationMinutes: number, professionalId?: string) => createClinicsPortSlot({ id, clinicId: CLINIC, startsAt: at(hhmm), durationMinutes, ...(professionalId ? { professionalId } : {}) });

describe("walk-in: sobreposição do paciente por duração (BR-CLN-16, AC-CLN-12)", () => {
  it("consulta SCHEDULED 10:00 de 60 min: 10:30 (30 min) => CONFLICT; 11:00 => 201; durationMinutes copiada do horário", async () => {
    const { fx, book } = setup();
    fx.appointmentsRepo.seed({ id: "a1", familyId: FAMILY, memberId: MEMBER, scheduledAt: at("10:00"), status: "SCHEDULED", durationMinutes: 60, confirmationStatus: "PENDING", createdAt: NOW });
    fx.clinics.seedSlot(slot("s-1030", "10:30", 30));
    fx.clinics.seedSlot(slot("s-1100", "11:00", 30));

    await expect(book(ACTOR, { patientEmail: EMAIL, slotId: "s-1030" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    const created = await book(ACTOR, { patientEmail: EMAIL, slotId: "s-1100" }, CTX);
    expect(created.status).toBe("SCHEDULED");
    expect(fx.appointmentsRepo.byId.get(created.id)?.durationMinutes).toBe(30);
  });

  it("um horário longo que engloba o início de outra consulta também sobrepõe; consecutivas não", async () => {
    const { fx, book } = setup();
    fx.appointmentsRepo.seed({ id: "a1", familyId: FAMILY, memberId: MEMBER, scheduledAt: at("10:30"), status: "SCHEDULED", durationMinutes: 30, confirmationStatus: "PENDING", createdAt: NOW });
    fx.clinics.seedSlot(slot("s-long", "10:00", 60));
    fx.clinics.seedSlot(slot("s-before", "10:00", 30));
    fx.clinics.seedSlot(slot("s-after", "11:00", 30));
    await expect(book(ACTOR, { patientEmail: EMAIL, slotId: "s-long" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(book(ACTOR, { patientEmail: EMAIL, slotId: "s-before" }, CTX)).resolves.toBeDefined(); // [10:00,10:30) encosta
    await expect(book(ACTOR, { patientEmail: EMAIL, slotId: "s-after" }, CTX)).resolves.toBeDefined(); // [11:00,11:30) encosta no fim de 10:30–11:00
  });

  it("consulta anterior à migração sem duração assume 30 min (fake: omitido = 30)", async () => {
    const { fx, book } = setup();
    fx.appointmentsRepo.seed({ id: "a1", familyId: FAMILY, memberId: MEMBER, scheduledAt: at("10:00"), status: "SCHEDULED", confirmationStatus: "PENDING", createdAt: NOW });
    fx.clinics.seedSlot(slot("s-1030", "10:30", 30));
    await expect(book(ACTOR, { patientEmail: EMAIL, slotId: "s-1030" }, CTX)).resolves.toBeDefined();
  });
});

describe("walk-in: defesa por profissional (BR-CLN-13)", () => {
  it("outra marcação ativa de consulta do profissional sobreposta (dados antigos) => CONFLICT", async () => {
    const { fx, book } = setup();
    fx.clinics.seedSlot(slot("s-main", "10:00", 60, "prof-1"));
    fx.clinics.seedSlot(slot("s-legacy", "10:30", 30, "prof-1")); // sobreposto (impossível com a EXCLUDE; dados antigos)
    fx.appointmentsRepo.seed({ id: "a-other", familyId: "fam-9", memberId: "mem-9", scheduledAt: at("10:30"), status: "REQUESTED", slotId: "s-legacy", clinicId: CLINIC, confirmationStatus: "PENDING", createdAt: NOW });
    await expect(book(ACTOR, { patientEmail: EMAIL, slotId: "s-main" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fx.appointmentsRepo.byId.size).toBe(1);
  });

  it("exame SCHEDULED do profissional sobreposto => CONFLICT", async () => {
    const { fx, book } = setup();
    fx.clinics.seedSlot(slot("s-main", "10:00", 60, "prof-1"));
    fx.clinics.seedSlot(createClinicsPortSlot({ id: "s-exam", clinicId: CLINIC, kind: "EXAM", startsAt: at("10:15"), durationMinutes: 30, professionalId: "prof-1" }));
    fx.examSlotOccupancy.booked.set("s-exam", 1);
    await expect(book(ACTOR, { patientEmail: EMAIL, slotId: "s-main" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("horário sobreposto mas livre, ou de outro profissional, não bloqueia; sem professionalId não há deteção", async () => {
    const { fx, book } = setup();
    fx.clinics.seedSlot(slot("s-main", "10:00", 60, "prof-1"));
    fx.clinics.seedSlot(slot("s-free", "10:30", 30, "prof-1"));
    fx.clinics.seedSlot(slot("s-q", "10:00", 60, "prof-2"));
    fx.appointmentsRepo.seed({ id: "a-q", familyId: "fam-9", memberId: "mem-9", scheduledAt: at("10:00"), status: "SCHEDULED", slotId: "s-q", clinicId: CLINIC, confirmationStatus: "PENDING", createdAt: NOW });
    await expect(book(ACTOR, { patientEmail: EMAIL, slotId: "s-main" }, CTX)).resolves.toBeDefined();
  });
});

describe("pedido da família num horário copia a duração (BR-CLN-16)", () => {
  it("createAppointment com slotId grava a durationMinutes do horário", async () => {
    const { fx } = setup();
    fx.clinics.seedSlot(slot("s-45", "10:00", 45));
    const create = createCreateAppointmentUseCase(fx.deps);
    const created = await create({ userId: "u", platformAdmin: false }, FAMILY, MEMBER, { scheduledAt: at("10:00").toISOString(), clinicId: CLINIC, slotId: "s-45" }, CTX);
    expect(fx.appointmentsRepo.byId.get(created.id)?.durationMinutes).toBe(45);
  });
});
