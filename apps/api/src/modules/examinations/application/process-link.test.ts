// Marco B fatia 1 (BR-PRC-01/07, TC-PRC-10/13): os exames abrem e apagam o seu Process pela porta ProcessLinker,
// nos dois caminhos de criação (livre e num horário de clínica) (fakes em memória, sem I/O).
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { toClinicExamResponse, toExaminationResponse } from "../interface/dto.js";
import { createCreateExaminationUseCase } from "./create-examination.js";
import { createDeleteExaminationUseCase } from "./delete-examination.js";
import { createExaminationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const CTX = { requestId: "req-1", ip: "10.0.0.1" };
const ACTOR = { userId: "u1", platformAdmin: false };
const FAMILY = "f1";
const MEMBER = "m1";

function setup() {
  const fx = createExaminationsFixtures(new FixedClock(NOW));
  fx.clinics.seed("clinic-1", "Laboratório Sol", FAMILY);
  fx.clinics.seedSlot({ id: "slot-1", clinicId: "clinic-1", kind: "EXAM", specialty: "Ecografia", startsAt: new Date("2026-02-01T09:00:00.000Z"), durationMinutes: 30, capacity: 2 });
  return fx;
}

describe("abertura do Process ao criar o exame (TC-PRC-10, BR-PRC-01)", () => {
  it("exame livre: abre 1 processo, grava o processId e devolve-o na resposta Examination", async () => {
    const fx = setup();
    const exam = await createCreateExaminationUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, { name: "Hemograma", examDate: "2026-02-01" }, CTX);
    expect(fx.processes.opened).toEqual([expect.objectContaining({ familyId: FAMILY, memberId: MEMBER, originId: exam.id, by: expect.objectContaining({ actorType: "USER", actorUserId: "u1", requestId: "req-1" }) as unknown })]);
    expect(exam.processId).toBe(fx.processes.opened[0]?.processId);
    expect(toExaminationResponse(exam).processId).toBe(exam.processId);
  });

  it("exame num horário de clínica: o processo leva o clinicId e a vista da clínica (ClinicExamBooking) o processId", async () => {
    const fx = setup();
    const exam = await createCreateExaminationUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, { name: "x", examDate: "2026-02-01", slotId: "slot-1" }, CTX);
    expect(fx.processes.opened[0]).toMatchObject({ originId: exam.id, clinicId: "clinic-1" });
    expect(exam.processId).toBe(fx.processes.opened[0]?.processId);
    expect(toClinicExamResponse({ id: exam.id, status: "SCHEDULED", scheduledAt: NOW.toISOString(), patientName: "X", resultsCount: 0, documents: [], hasResultsDraft: false, reportAvailable: false, processId: exam.processId ?? "" }).processId).toBe(exam.processId);
  });

  it("falha ao abrir o processo => o exame não existe", async () => {
    const fx = setup();
    fx.processes.failOpen = new Error("boom");
    await expect(createCreateExaminationUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, { name: "Hemograma", examDate: "2026-02-01" }, CTX)).rejects.toThrow("boom");
    expect(fx.examinationsRepo.byId.size).toBe(0);
    expect(fx.audit.events).toHaveLength(0);
  });
});

describe("apagar o exame apaga o Process (TC-PRC-13, BR-PRC-07)", () => {
  it("chama discard com o id do ato e o ator", async () => {
    const fx = setup();
    const exam = await createCreateExaminationUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, { name: "Hemograma", examDate: "2026-02-01" }, CTX);
    await createDeleteExaminationUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, exam.id, CTX);
    expect(fx.processes.discarded).toEqual([{ originId: exam.id, by: expect.objectContaining({ actorType: "USER", actorUserId: "u1" }) as unknown }]);
  });
});
