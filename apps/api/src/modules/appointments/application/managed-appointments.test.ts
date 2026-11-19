// MK3 S5 (BR-MKT-55, TC-MKT-89): consultas geradas por uma marcação do mercado são geridas pela marcação. Cobre o escritor
// `createFamilyAppointmentWriter` (criação, idempotência, sem `Process.open`, sincronização de estado), as regras das rotas
// genéricas (update, setStatus, delete) quando a consulta tem `bookingId`, a regressão das consultas normais e a resposta da API.
// Fakes em memória (sem I/O); a persistência real testa-se em `tests/integration/appointments-booking-writer.integration.test.ts`.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { toAppointmentResponse } from "../interface/dto.js";
import { createCreateAppointmentUseCase } from "./create-appointment.js";
import { createDeleteAppointmentUseCase } from "./delete-appointment.js";
import { createAppointmentsFixtures, type AppointmentsFixtures } from "./fixtures.js";
import { createFamilyAppointmentWriter, type CreateFromBookingInput } from "./family-appointment-writer.js";
import { createSetAppointmentStatusUseCase } from "./set-appointment-status.js";
import { createUpdateAppointmentUseCase, type UpdateAppointmentInput } from "./update-appointment.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const SLOT_AT = new Date("2026-02-01T09:00:00.000Z");
const CTX = { requestId: "req-1", ip: "10.0.0.1" };
const ACTOR = { userId: "u1", platformAdmin: false };
const FAMILY = "f1";
const MEMBER = "m1";
const BOOKING = "bk-1";

type TerminalStatus = "COMPLETED" | "NO_SHOW" | "CANCELLED";

function setup(): AppointmentsFixtures {
  return createAppointmentsFixtures(new FixedClock(NOW));
}

function entrada(overrides: Partial<CreateFromBookingInput> = {}): CreateFromBookingInput {
  return {
    bookingId: BOOKING,
    processId: "proc-marcacao-1",
    familyId: FAMILY,
    memberId: MEMBER,
    startsAt: SLOT_AT,
    professionalName: "Dra. Ana Lopes",
    specialty: "Cardiologia",
    ...overrides,
  };
}

/** Cria a consulta gerada pela marcação através do próprio escritor (o caminho real). */
async function criarGerida(fx: AppointmentsFixtures, overrides: Partial<CreateFromBookingInput> = {}): Promise<string> {
  const writer = createFamilyAppointmentWriter(fx.deps);
  const { appointmentId } = await writer.createFromBooking(fx.deps.db, entrada(overrides));
  return appointmentId;
}

describe("createFamilyAppointmentWriter.createFromBooking (BR-MKT-55)", () => {
  it("cria a consulta SCHEDULED, sem clínica, com bookingId e processId da marcação", async () => {
    const fx = setup();
    const { appointmentId } = await createFamilyAppointmentWriter(fx.deps).createFromBooking(fx.deps.db, entrada({ durationMinutes: 45 }));

    const appointment = fx.appointmentsRepo.byId.get(appointmentId);
    expect(appointment).toMatchObject({
      id: appointmentId,
      familyId: FAMILY,
      memberId: MEMBER,
      scheduledAt: SLOT_AT,
      status: "SCHEDULED",
      professionalName: "Dra. Ana Lopes",
      specialty: "Cardiologia",
      processId: "proc-marcacao-1",
      bookingId: BOOKING,
      durationMinutes: 45,
    });
    expect(appointment?.clinicId).toBeUndefined();
    expect(appointment?.clinicName).toBeUndefined();
  });

  it("sem durationMinutes na entrada, a consulta usa a duração por omissão (30)", async () => {
    const fx = setup();
    const appointmentId = await criarGerida(fx);
    expect(fx.appointmentsRepo.byId.get(appointmentId)?.durationMinutes).toBe(30);
  });

  it("é idempotente por bookingId: segunda chamada devolve o mesmo id e não duplica a consulta", async () => {
    const fx = setup();
    const writer = createFamilyAppointmentWriter(fx.deps);
    const primeira = await writer.createFromBooking(fx.deps.db, entrada());
    const segunda = await writer.createFromBooking(fx.deps.db, entrada({ processId: "outro-processo", professionalName: "Outro" }));

    expect(segunda).toEqual(primeira);
    expect(fx.appointmentsRepo.byId.size).toBe(1);
    expect(fx.appointmentsRepo.byId.get(primeira.appointmentId)?.professionalName).toBe("Dra. Ana Lopes");
  });

  it("não abre Process (a consulta usa o da marcação): processes.open nunca é chamado", async () => {
    const fx = setup();
    await criarGerida(fx);
    expect(fx.processes.opened).toEqual([]);
    expect(fx.processes.discarded).toEqual([]);
  });

  it("não escreve auditoria própria (a auditoria é da marcação em `consultations`)", async () => {
    const fx = setup();
    await criarGerida(fx);
    expect(fx.audit.events).toHaveLength(0);
  });
});

describe("createFamilyAppointmentWriter.syncFromBooking (BR-MKT-55)", () => {
  it.each<TerminalStatus>(["COMPLETED", "NO_SHOW", "CANCELLED"])("a marcação passa a %s => a consulta segue", async (status) => {
    const fx = setup();
    const appointmentId = await criarGerida(fx);

    await createFamilyAppointmentWriter(fx.deps).syncFromBooking(fx.deps.db, { bookingId: BOOKING, status });

    expect(fx.appointmentsRepo.byId.get(appointmentId)?.status).toBe(status);
  });

  it("sem consulta para a marcação (ex.: apagada pela família) não faz nada e não lança", async () => {
    const fx = setup();
    await expect(createFamilyAppointmentWriter(fx.deps).syncFromBooking(fx.deps.db, { bookingId: "sem-consulta", status: "CANCELLED" })).resolves.toBeUndefined();
    expect(fx.appointmentsRepo.byId.size).toBe(0);
  });

  it("só altera a consulta da marcação indicada", async () => {
    const fx = setup();
    const gerida = await criarGerida(fx);
    const outra = await criarGerida(fx, { bookingId: "bk-2", processId: "proc-2" });

    await createFamilyAppointmentWriter(fx.deps).syncFromBooking(fx.deps.db, { bookingId: BOOKING, status: "COMPLETED" });

    expect(fx.appointmentsRepo.byId.get(gerida)?.status).toBe("COMPLETED");
    expect(fx.appointmentsRepo.byId.get(outra)?.status).toBe("SCHEDULED");
  });
});

describe("updateAppointment numa consulta gerida (BR-MKT-55, TC-MKT-89)", () => {
  it.each<[string, UpdateAppointmentInput]>([
    ["scheduledAt", { scheduledAt: "2026-02-02T09:00:00.000Z" }],
    ["professionalName", { professionalName: "Outro profissional" }],
    ["clinicId", { clinicId: "clinic-1" }],
    ["clinicId (null)", { clinicId: null }],
    ["clinicName", { clinicName: "Clínica Sol" }],
    ["specialty", { specialty: "Dermatologia" }],
    ["reason", { reason: "Rotina" }],
  ])("alterar %s => ConflictError e a consulta fica igual", async (_campo, input) => {
    const fx = setup();
    const appointmentId = await criarGerida(fx);
    const antes = { ...fx.appointmentsRepo.byId.get(appointmentId) };

    await expect(createUpdateAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, appointmentId, input, CTX)).rejects.toMatchObject({ code: "CONFLICT" });

    expect(fx.appointmentsRepo.byId.get(appointmentId)).toEqual(antes);
  });

  it("só notes => edita e devolve a consulta atualizada", async () => {
    const fx = setup();
    const appointmentId = await criarGerida(fx);

    const updated = await createUpdateAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, appointmentId, { notes: "Levar exames anteriores" }, CTX);

    expect(updated.notes).toBe("Levar exames anteriores");
    expect(updated.professionalName).toBe("Dra. Ana Lopes");
    expect(updated.scheduledAt).toEqual(SLOT_AT);
    expect(updated.bookingId).toBe(BOOKING);
  });
});

describe("setAppointmentStatus numa consulta gerida (BR-MKT-55, TC-MKT-89)", () => {
  it.each<"COMPLETED" | "NO_SHOW" | "CANCELLED">(["COMPLETED", "NO_SHOW", "CANCELLED"])("mudar para %s => ConflictError e o estado não muda", async (status) => {
    const fx = setup();
    const appointmentId = await criarGerida(fx);

    await expect(createSetAppointmentStatusUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, appointmentId, { status }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });

    expect(fx.appointmentsRepo.byId.get(appointmentId)?.status).toBe("SCHEDULED");
  });
});

describe("deleteAppointment numa consulta gerida (BR-MKT-55, BR-PRC-07)", () => {
  it("SCHEDULED => ConflictError, a consulta continua e o Process não é tocado", async () => {
    const fx = setup();
    const appointmentId = await criarGerida(fx);

    await expect(createDeleteAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, appointmentId, CTX)).rejects.toMatchObject({ code: "CONFLICT" });

    expect(fx.appointmentsRepo.byId.has(appointmentId)).toBe(true);
    expect(fx.processes.discarded).toEqual([]);
  });

  it.each<TerminalStatus>(["COMPLETED", "NO_SHOW", "CANCELLED"])("%s => apaga a consulta e NÃO chama discard", async (status) => {
    const fx = setup();
    const appointmentId = await criarGerida(fx);
    await createFamilyAppointmentWriter(fx.deps).syncFromBooking(fx.deps.db, { bookingId: BOOKING, status });

    await createDeleteAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, appointmentId, CTX);

    expect(fx.appointmentsRepo.byId.has(appointmentId)).toBe(false);
    expect(fx.processes.discarded).toEqual([]);
  });

  it("regressão: consulta sem bookingId apagada => discard chamado com o id do ato", async () => {
    const fx = setup();
    fx.clinics.seed("clinic-1", "Clínica Sol", FAMILY);
    const appointment = await createCreateAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);
    expect(appointment.bookingId).toBeUndefined();

    await createDeleteAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, appointment.id, CTX);

    expect(fx.processes.discarded).toEqual([expect.objectContaining({ originId: appointment.id })]);
    expect(fx.appointmentsRepo.byId.has(appointment.id)).toBe(false);
  });
});

describe("toAppointmentResponse expõe bookingId (contrato da API)", () => {
  it("consulta gerida => bookingId da marcação", async () => {
    const fx = setup();
    const appointmentId = await criarGerida(fx);
    const appointment = fx.appointmentsRepo.byId.get(appointmentId);
    if (!appointment) throw new Error("a consulta gerada devia existir");
    expect(toAppointmentResponse(appointment).bookingId).toBe(BOOKING);
  });

  it("consulta normal (sem bookingId) => bookingId null", async () => {
    const fx = setup();
    fx.clinics.seed("clinic-1", "Clínica Sol", FAMILY);
    const appointment = await createCreateAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);
    expect(toAppointmentResponse(appointment).bookingId).toBeNull();
  });
});
