import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ConflictError } from "../../../platform/errors/index.js";
import { createAddPrescriptionMedicationUseCase } from "./add-prescription-medication.js";
import { createDeletePrescriptionUseCase } from "./delete-prescription.js";
import { createSetPrescriptionStatusUseCase } from "./set-prescription-status.js";
import { createUpdatePrescriptionUseCase } from "./update-prescription.js";
import { createPrescriptionsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };
const PRO_RX_ID = "rx-professional";
const FAMILY_RX_ID = "rx-family";
const CLINIC_RX_ID = "rx-clinic";
const MED_INPUT = { name: "Paracetamol", dosage: "1g", scheduleType: "FIXED_TIMES" as const, times: ["08:00"], startAt: NOW.toISOString(), continuous: true };

function seedPrescriptions(fixtures: ReturnType<typeof createPrescriptionsFixtures>): void {
  fixtures.prescriptionsRepo.seed({
    id: PRO_RX_ID,
    familyId: FAMILY_ID,
    memberId: MEMBER_ID,
    issuedOn: "2026-01-10",
    doctorName: "Profissional Teste",
    status: "ACTIVE",
    issuedBy: "PROFESSIONAL",
    issuedByProfessionalId: "prof-1",
    bookingId: "booking-1",
    createdAt: NOW,
  });
  fixtures.prescriptionsRepo.seed({ id: FAMILY_RX_ID, familyId: FAMILY_ID, memberId: MEMBER_ID, issuedOn: "2026-01-10", status: "ACTIVE", issuedBy: "FAMILY", createdAt: NOW });
  fixtures.prescriptionsRepo.seed({
    id: CLINIC_RX_ID,
    familyId: FAMILY_ID,
    memberId: MEMBER_ID,
    issuedOn: "2026-01-10",
    status: "ACTIVE",
    issuedBy: "CLINIC",
    issuedByClinicAccountId: "clinic-1",
    appointmentId: "appointment-1",
    createdAt: NOW,
  });
}

describe("conteúdo de receita PROFESSIONAL é só leitura (OP-127, BR-MKT-81)", () => {
  it("updatePrescription recusa com CONFLICT e não altera a receita", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    seedPrescriptions(fixtures);
    const updatePrescription = createUpdatePrescriptionUseCase(fixtures.deps);
    const before = structuredClone(fixtures.prescriptionsRepo.byId.get(PRO_RX_ID));

    const attempt = updatePrescription(ACTOR, FAMILY_ID, MEMBER_ID, PRO_RX_ID, { doctorName: "Outro", notes: "Nova nota" }, CTX);

    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toMatchObject({ code: "CONFLICT", detail: "O conteúdo desta receita só pode ser lido." });
    expect(fixtures.prescriptionsRepo.byId.get(PRO_RX_ID)).toEqual(before);
    expect(fixtures.audit.events.some((e) => e.action === "PRESCRIPTION_UPDATE")).toBe(false);
  });

  it("addPrescriptionMedication recusa com CONFLICT e não cria plano", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    seedPrescriptions(fixtures);
    const addPrescriptionMedication = createAddPrescriptionMedicationUseCase(fixtures.deps);
    const before = structuredClone(fixtures.prescriptionsRepo.byId.get(PRO_RX_ID));

    const attempt = addPrescriptionMedication(ACTOR, FAMILY_ID, MEMBER_ID, PRO_RX_ID, { ...MED_INPUT, name: "Ibuprofeno" }, CTX);

    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toMatchObject({ code: "CONFLICT", detail: "O conteúdo desta receita só pode ser lido." });
    expect(fixtures.medications.createCalls).toHaveLength(0);
    expect(fixtures.medications.plans.size).toBe(0);
    expect(fixtures.prescriptionsRepo.byId.get(PRO_RX_ID)).toEqual(before);
  });

  it("setPrescriptionStatus continua permitido (concluir, cancelar e reabrir)", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    seedPrescriptions(fixtures);
    const setPrescriptionStatus = createSetPrescriptionStatusUseCase(fixtures.deps);

    const completed = await setPrescriptionStatus(ACTOR, FAMILY_ID, MEMBER_ID, PRO_RX_ID, { status: "COMPLETED" }, CTX);
    expect(completed.status).toBe("COMPLETED");

    const reopened = await setPrescriptionStatus(ACTOR, FAMILY_ID, MEMBER_ID, PRO_RX_ID, { status: "ACTIVE" }, CTX);
    expect(reopened.status).toBe("ACTIVE");

    const cancelled = await setPrescriptionStatus(ACTOR, FAMILY_ID, MEMBER_ID, PRO_RX_ID, { status: "CANCELLED" }, CTX);
    expect(cancelled.status).toBe("CANCELLED");
    expect(fixtures.medications.endCalls.map((c) => c.prescriptionId)).toEqual([PRO_RX_ID, PRO_RX_ID]);
  });

  it("deletePrescription continua permitido", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    seedPrescriptions(fixtures);
    const deletePrescription = createDeletePrescriptionUseCase(fixtures.deps);

    await deletePrescription(ACTOR, FAMILY_ID, MEMBER_ID, PRO_RX_ID, CTX);

    expect(fixtures.prescriptionsRepo.byId.has(PRO_RX_ID)).toBe(false);
    expect(fixtures.documents.deleteCalls).toEqual([{ resourceType: "PRESCRIPTION", resourceId: PRO_RX_ID }]);
  });

  it("receita FAMILY continua editável (update e add)", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    seedPrescriptions(fixtures);
    const updatePrescription = createUpdatePrescriptionUseCase(fixtures.deps);
    const addPrescriptionMedication = createAddPrescriptionMedicationUseCase(fixtures.deps);

    const updated = await updatePrescription(ACTOR, FAMILY_ID, MEMBER_ID, FAMILY_RX_ID, { doctorName: "Dr. Silva" }, CTX);
    expect(updated.doctorName).toBe("Dr. Silva");

    const plan = await addPrescriptionMedication(ACTOR, FAMILY_ID, MEMBER_ID, FAMILY_RX_ID, MED_INPUT, CTX);
    expect(plan.prescriptionId).toBe(FAMILY_RX_ID);
    expect(fixtures.medications.createCalls).toHaveLength(1);
  });

  it("receita CLINIC continua editável (update e add)", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    seedPrescriptions(fixtures);
    const updatePrescription = createUpdatePrescriptionUseCase(fixtures.deps);
    const addPrescriptionMedication = createAddPrescriptionMedicationUseCase(fixtures.deps);

    const updated = await updatePrescription(ACTOR, FAMILY_ID, MEMBER_ID, CLINIC_RX_ID, { notes: "Rever em 30 dias" }, CTX);
    expect(updated.notes).toBe("Rever em 30 dias");

    const plan = await addPrescriptionMedication(ACTOR, FAMILY_ID, MEMBER_ID, CLINIC_RX_ID, MED_INPUT, CTX);
    expect(plan.prescriptionId).toBe(CLINIC_RX_ID);
    expect(fixtures.medications.createCalls).toHaveLength(1);
  });
});
