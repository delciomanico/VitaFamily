import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createAddPrescriptionMedicationUseCase } from "./add-prescription-medication.js";
import { createCreatePrescriptionUseCase } from "./create-prescription.js";
import { createDeletePrescriptionUseCase } from "./delete-prescription.js";
import { createGetPrescriptionUseCase } from "./get-prescription.js";
import { createListPrescriptionsUseCase } from "./list-prescriptions.js";
import { createSetPrescriptionStatusUseCase } from "./set-prescription-status.js";
import { createUpdatePrescriptionUseCase } from "./update-prescription.js";
import { createPrescriptionsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };
const MED_INPUT = { name: "Ibuprofeno", dosage: "400mg", scheduleType: "FIXED_TIMES" as const, times: ["08:00"], startAt: NOW.toISOString(), continuous: true };

describe("updatePrescription/getPrescription/listPrescriptions", () => {
  it("atualiza campos simples e devolve a vista com medicamentos/documentos", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);
    const updatePrescription = createUpdatePrescriptionUseCase(fixtures.deps);
    const created = await createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, CTX);

    const updated = await updatePrescription(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { doctorName: "Dr. Silva" }, CTX);

    expect(updated.doctorName).toBe("Dr. Silva");
    expect(updated.medications).toHaveLength(1);
  });

  it("audit.md §3: lê por tutor é auditado (HEALTH_VIEW); lê pelo próprio titular não", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);
    const getPrescription = createGetPrescriptionUseCase(fixtures.deps);
    const created = await createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, CTX);

    fixtures.policy.relation = "SELF";
    await getPrescription(ACTOR, FAMILY_ID, MEMBER_ID, created.id, CTX);
    expect(fixtures.audit.events.some((e) => e.action === "HEALTH_VIEW")).toBe(false);

    fixtures.policy.relation = "TUTOR_OF";
    await getPrescription(ACTOR, FAMILY_ID, MEMBER_ID, created.id, CTX);
    expect(fixtures.audit.events.some((e) => e.action === "HEALTH_VIEW")).toBe(true);
  });

  it("getPrescription devolve NOT_FOUND para receita de outra família", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);
    const getPrescription = createGetPrescriptionUseCase(fixtures.deps);
    const created = await createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, CTX);

    await expect(getPrescription(ACTOR, "other", MEMBER_ID, created.id, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listPrescriptions filtra por estado", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);
    const listPrescriptions = createListPrescriptionsUseCase(fixtures.deps);
    await createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, CTX);

    const page = await listPrescriptions(ACTOR, FAMILY_ID, MEMBER_ID, { status: "ACTIVE" }, CTX);
    expect(page.items).toHaveLength(1);
    const empty = await listPrescriptions(ACTOR, FAMILY_ID, MEMBER_ID, { status: "CANCELLED" }, CTX);
    expect(empty.items).toHaveLength(0);
  });
});

describe("setPrescriptionStatus (ST1, BR-RX-04)", () => {
  it("CANCELLED termina os planos associados", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);
    const setPrescriptionStatus = createSetPrescriptionStatusUseCase(fixtures.deps);
    const created = await createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, CTX);

    const cancelled = await setPrescriptionStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "CANCELLED" }, CTX);

    expect(cancelled.status).toBe("CANCELLED");
    expect(fixtures.medications.endCalls).toHaveLength(1);
    expect(fixtures.medications.endCalls[0]?.prescriptionId).toBe(created.id);
  });

  it("reabrir (CANCELLED -> ACTIVE) não chama endPlansForPrescription", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);
    const setPrescriptionStatus = createSetPrescriptionStatusUseCase(fixtures.deps);
    const created = await createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, CTX);
    await setPrescriptionStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "CANCELLED" }, CTX);

    const reopened = await setPrescriptionStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "ACTIVE" }, CTX);

    expect(reopened.status).toBe("ACTIVE");
    expect(fixtures.medications.endCalls).toHaveLength(1);
  });

  it("recusa transição inválida (COMPLETED -> CANCELLED direto)", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);
    const setPrescriptionStatus = createSetPrescriptionStatusUseCase(fixtures.deps);
    const created = await createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, CTX);
    await setPrescriptionStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "COMPLETED" }, CTX);

    await expect(setPrescriptionStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "CANCELLED" }, CTX)).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });
});

describe("deletePrescription (BR-RX-06)", () => {
  it("apaga documentos antes da receita", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);
    const deletePrescription = createDeletePrescriptionUseCase(fixtures.deps);
    const created = await createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, CTX);

    await deletePrescription(ACTOR, FAMILY_ID, MEMBER_ID, created.id, CTX);

    expect(fixtures.documents.deleteCalls).toEqual([{ resourceType: "PRESCRIPTION", resourceId: created.id }]);
    expect(fixtures.prescriptionsRepo.byId.has(created.id)).toBe(false);
    expect(fixtures.audit.events.some((e) => e.action === "PRESCRIPTION_DELETE")).toBe(true);
  });

  it("devolve NOT_FOUND para receita inexistente", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const deletePrescription = createDeletePrescriptionUseCase(fixtures.deps);
    await expect(deletePrescription(ACTOR, FAMILY_ID, MEMBER_ID, "nope", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("addPrescriptionMedication (UC-RX-05)", () => {
  it("cria um novo plano ligado à receita", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const createPrescription = createCreatePrescriptionUseCase(fixtures.deps);
    const addPrescriptionMedication = createAddPrescriptionMedicationUseCase(fixtures.deps);
    const created = await createPrescription(ACTOR, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, CTX);

    const plan = await addPrescriptionMedication(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { ...MED_INPUT, name: "Paracetamol" }, CTX);

    expect(plan.name).toBe("Paracetamol");
    expect(plan.prescriptionId).toBe(created.id);
  });

  it("devolve NOT_FOUND para receita inexistente", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const addPrescriptionMedication = createAddPrescriptionMedicationUseCase(fixtures.deps);
    await expect(addPrescriptionMedication(ACTOR, FAMILY_ID, MEMBER_ID, "nope", MED_INPUT, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
