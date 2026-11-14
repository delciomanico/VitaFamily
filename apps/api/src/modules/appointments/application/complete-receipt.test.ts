// TC-AUT-21 (BR-CLN-57, «Concluir ato», aplicação): `receipt` em `complete` chama a porta `CompletionReceiptIssuer` na MESMA operação,
// depois de COMPLETED; sem `receipt` a porta não é chamada; falha da porta propaga-se (a transação do chamador reverte).
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ConflictError, ForbiddenError } from "../../../platform/errors/index.js";
import { createCompleteClinicAppointmentUseCase } from "./clinic-appointments.js";
import { createAppointmentsFixtures } from "./fixtures.js";
import type { ClinicPortalActor } from "./ports.js";

const NOW = new Date("2026-11-14T09:00:00Z");
const CTX = { requestId: "req-1" };
const ADMIN: ClinicPortalActor = { clinicAccountId: "admin", clinicId: "clinic-a" };
const RECEIPT = { paymentMethod: "CASH" };

function setup() {
  const fx = createAppointmentsFixtures(new FixedClock(NOW));
  fx.clinics.seed("clinic-a", "Clínica Sol", "");
  fx.clinics.seedSlot({ id: "slot-1", clinicId: "clinic-a", kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: new Date(NOW.getTime() + 3_600_000), durationMinutes: 30, capacity: 1 });
  fx.memberNames.seed("fam", "mem", "Maria Silva");
  fx.appointmentsRepo.seed({ id: "apt-1", familyId: "fam", memberId: "mem", scheduledAt: new Date(NOW.getTime() + 3_600_000), status: "SCHEDULED", confirmationStatus: "PENDING", clinicId: "clinic-a", slotId: "slot-1", createdAt: NOW });
  return { fx, complete: createCompleteClinicAppointmentUseCase(fx.deps) };
}

describe("«Concluir ato»: complete com receipt (BR-CLN-57)", () => {
  it("com receipt: conclui e emite o recibo pela porta, com a marcação que se conclui", async () => {
    const { fx, complete } = setup();
    expect(await complete(ADMIN, "apt-1", { outcomeNote: "ok", receipt: RECEIPT }, CTX)).toMatchObject({ status: "COMPLETED" });
    expect(fx.completionReceipts.issued).toEqual([{ kind: "APPOINTMENT", bookingId: "apt-1", receipt: RECEIPT, actor: ADMIN }]);
  });

  it("sem receipt: a porta não é chamada (comportamento inalterado)", async () => {
    const { fx, complete } = setup();
    await complete(ADMIN, "apt-1", { outcomeNote: "ok" }, CTX);
    expect(fx.completionReceipts.issued).toEqual([]);
  });

  it.each([new ForbiddenError({ detail: "Médico" }), new ConflictError({ detail: "2.º recibo" })])("falha da porta (%s) propaga-se: a conclusão falha", async (error) => {
    const { fx, complete } = setup();
    fx.completionReceipts.failWith = error;
    await expect(complete(ADMIN, "apt-1", { receipt: RECEIPT }, CTX)).rejects.toBe(error);
  });
});
