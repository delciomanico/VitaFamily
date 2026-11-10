// AC-CLN-35 / TC-CLN-26 (M15 U, BR-CLN-52, modules.md §2 nota 28): `examOrderId` em `createExamination` e propagação do estado pela
// porta `ExamOrderLinker` (criar com ligação, concluir, cancelar, apagar) NA transação do exame; erros do linker revertem a criação.
import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCancelClinicExaminationUseCase, createCompleteClinicExaminationUseCase } from "./clinic-examinations.js";
import { createCreateExaminationUseCase } from "./create-examination.js";
import { createDeleteExaminationUseCase } from "./delete-examination.js";
import { createExaminationsFixtures, type ExaminationsFixtures } from "./fixtures.js";
import type { ClinicPortalActor } from "./ports.js";
import { createSetExaminationStatusUseCase } from "./set-examination-status.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const SLOT_AT = new Date("2026-02-01T09:30:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };
const CLINIC_A = "clinic-a";
const CLINIC_ACTOR: ClinicPortalActor = { clinicAccountId: "acc-a", clinicId: CLINIC_A };
const ORDER = "order-1";

function setup(): ExaminationsFixtures {
  const fixtures = createExaminationsFixtures(new FixedClock(NOW));
  fixtures.clinics.seed(CLINIC_A, "Clínica Sol", FAMILY_ID);
  fixtures.clinics.seedSlot({ id: "slot-exam", clinicId: CLINIC_A, kind: "EXAM", specialty: "Análises", startsAt: SLOT_AT, durationMinutes: 30, capacity: 3 });
  fixtures.memberNames.names.set(`${FAMILY_ID}:${MEMBER_ID}`, "Maria Silva");
  return fixtures;
}

describe("examOrderId em createExamination", () => {
  it("marcação em horário: liga ao pedido com a clínica do horário, estado SCHEDULED, na mesma transação", async () => {
    const f = setup();
    const exam = await createCreateExaminationUseCase(f.deps)(ACTOR, FAMILY_ID, MEMBER_ID, { name: "x", examDate: "1999-01-01", slotId: "slot-exam", examOrderId: ORDER }, CTX);
    expect(f.examOrders.links).toEqual([{ orderId: ORDER, examinationId: exam.id, familyId: FAMILY_ID, memberId: MEMBER_ID, examClinicId: CLINIC_A, status: "SCHEDULED" }]);
  });

  it("exame privado futuro: liga sem clínica (booked_here será false); data passada nasce COMPLETED => liga como COMPLETED", async () => {
    const f = setup();
    const create = createCreateExaminationUseCase(f.deps);
    await create(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-10", examOrderId: ORDER }, CTX);
    await create(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-01-01", examOrderId: "order-2" }, CTX);
    expect(f.examOrders.links.map((l) => [l.orderId, l.status, l.examClinicId])).toEqual([[ORDER, "SCHEDULED", undefined], ["order-2", "COMPLETED", undefined]]);
  });

  it("exame numa clínica escolhida (clinicId) liga com essa clínica", async () => {
    const f = setup();
    await createCreateExaminationUseCase(f.deps)(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-10", clinicId: CLINIC_A, examOrderId: ORDER }, CTX);
    expect(f.examOrders.links[0]?.examClinicId).toBe(CLINIC_A);
  });

  it("sem examOrderId o pedido não é tocado", async () => {
    const f = setup();
    await createCreateExaminationUseCase(f.deps)(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-10" }, CTX);
    expect(f.examOrders.links).toEqual([]);
  });

  it.each([
    ["CONFLICT", new ConflictError({ detail: "já marcado" })],
    ["NOT_FOUND", new NotFoundError({ detail: "pedido" })],
    ["FORBIDDEN", new ForbiddenError({ detail: "sem permissão" })],
  ])("erro %s do linker propaga-se (a transação do chamador reverte a criação)", async (code, error) => {
    const f = setup();
    f.examOrders.failLinkWith = error;
    await expect(createCreateExaminationUseCase(f.deps)(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-10", examOrderId: ORDER }, CTX)).rejects.toMatchObject({ code });
  });
});

describe("propagação ao pedido (BR-CLN-52)", () => {
  async function scheduled(f: ExaminationsFixtures) {
    return createCreateExaminationUseCase(f.deps)(ACTOR, FAMILY_ID, MEMBER_ID, { name: "x", examDate: "1999-01-01", slotId: "slot-exam", examOrderId: ORDER }, CTX);
  }

  it("estado do exame pelo titular: COMPLETED => fulfil; CANCELLED => release; idêntico não propaga", async () => {
    const f = setup();
    const a = await scheduled(f);
    const set = createSetExaminationStatusUseCase(f.deps);
    await set(ACTOR, FAMILY_ID, MEMBER_ID, a.id, { status: "SCHEDULED" }, CTX);
    expect([f.examOrders.fulfilled, f.examOrders.released]).toEqual([[], []]);
    await set(ACTOR, FAMILY_ID, MEMBER_ID, a.id, { status: "COMPLETED" }, CTX);
    expect(f.examOrders.fulfilled).toEqual([a.id]);
    const b = await scheduled(f);
    await set(ACTOR, FAMILY_ID, MEMBER_ID, b.id, { status: "CANCELLED" }, CTX);
    expect(f.examOrders.released).toEqual([b.id]);
  });

  it("apagar o exame liberta o pedido (antes de apagar)", async () => {
    const f = setup();
    const a = await scheduled(f);
    await createDeleteExaminationUseCase(f.deps)(ACTOR, FAMILY_ID, MEMBER_ID, a.id, CTX);
    expect(f.examOrders.released).toEqual([a.id]);
  });

  it("a clínica cancela o exame => release; a clínica conclui => fulfil", async () => {
    const f = setup();
    const a = await scheduled(f);
    const b = await createCreateExaminationUseCase(f.deps)(ACTOR, FAMILY_ID, "m2", { name: "x", examDate: "1999-01-01", slotId: "slot-exam", examOrderId: "order-2" }, CTX);
    await createCancelClinicExaminationUseCase(f.deps)(CLINIC_ACTOR, a.id, { note: "avaria" }, CTX);
    expect(f.examOrders.released).toEqual([a.id]);
    await createCompleteClinicExaminationUseCase(f.deps)(CLINIC_ACTOR, b.id, { results: [{ parameter: "Glicemia", valueText: "ok" }] }, CTX);
    expect(f.examOrders.fulfilled).toEqual([b.id]);
  });
});
