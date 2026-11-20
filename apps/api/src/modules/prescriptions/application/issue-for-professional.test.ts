import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { CreateMedicationPlanInput } from "../../medications/index.js";
import {
  createFindPrescriptionIdsByBookingsUseCase,
  createGetProfessionalPrescriptionUseCase,
  createIsContentReadOnlyUseCase,
  createIssuePrescriptionForProfessionalUseCase,
} from "./issue-for-professional.js";
import { createPrescriptionsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const BOOKING_ID = "booking-1";
const PROFESSIONAL_ID = "prof-1";
const PROFESSIONAL_ACCOUNT_ID = "prof-account-1";
const PROFESSIONAL_NAME = "Profissional Teste";

const CANARIES = ["CANARIO-MED", "CANARIO-DOSE", "CANARIO-NOTA"];

const MED_CANARY = { name: "CANARIO-MED", dosage: "CANARIO-DOSE", scheduleType: "FIXED_TIMES" as const, times: ["08:00"], startAt: NOW.toISOString(), continuous: true, notes: "CANARIO-NOTA" };
const MED_AMOXI = { name: "Amoxicilina", dosage: "500mg", scheduleType: "FIXED_TIMES" as const, times: ["08:00", "20:00"], startAt: NOW.toISOString(), continuous: true };
const MED_PARA = { name: "Paracetamol", dosage: "1g", scheduleType: "FIXED_TIMES" as const, times: ["12:00"], startAt: NOW.toISOString(), continuous: true };

function issueInput(medications: CreateMedicationPlanInput[], notes: string | null = "Tomar após as refeições") {
  return {
    familyId: FAMILY_ID,
    memberId: MEMBER_ID,
    bookingId: BOOKING_ID,
    professionalId: PROFESSIONAL_ID,
    professionalAccountId: PROFESSIONAL_ACCOUNT_ID,
    professionalName: PROFESSIONAL_NAME,
    issuedOn: "2026-01-10",
    notes,
    medications,
  };
}

describe("issuePrescriptionForProfessional (MK4, BR-MKT-79..81)", () => {
  it("cria a receita com issuedBy=PROFESSIONAL e um plano por medicamento ligado à receita", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issue = createIssuePrescriptionForProfessionalUseCase(fixtures.deps);

    const { prescriptionId } = await issue(fixtures.deps.db, issueInput([MED_AMOXI]), CTX);

    expect(fixtures.prescriptionsRepo.byId.get(prescriptionId)).toMatchObject({
      id: prescriptionId,
      familyId: FAMILY_ID,
      memberId: MEMBER_ID,
      status: "ACTIVE",
      issuedBy: "PROFESSIONAL",
      issuedByProfessionalId: PROFESSIONAL_ID,
      bookingId: BOOKING_ID,
      doctorName: PROFESSIONAL_NAME,
      issuedOn: "2026-01-10",
      notes: "Tomar após as refeições",
    });
    expect(fixtures.medications.createForProfessionalCalls).toHaveLength(1);
    expect(fixtures.medications.createForProfessionalCalls[0]).toMatchObject({
      professionalAccountId: PROFESSIONAL_ACCOUNT_ID,
      familyId: FAMILY_ID,
      memberId: MEMBER_ID,
      options: { prescriptionId },
    });
    expect(fixtures.medications.createCalls).toHaveLength(0);
  });

  it("cria um plano por cada medicamento (todos ligados à mesma receita)", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issue = createIssuePrescriptionForProfessionalUseCase(fixtures.deps);

    const { prescriptionId } = await issue(fixtures.deps.db, issueInput([MED_AMOXI, MED_PARA]), CTX);

    expect(fixtures.medications.createForProfessionalCalls).toHaveLength(2);
    expect(fixtures.medications.createForProfessionalCalls.every((call) => call.options?.prescriptionId === prescriptionId)).toBe(true);
    expect(fixtures.medications.createForProfessionalCalls.map((call) => call.input.name)).toEqual(["Amoxicilina", "Paracetamol"]);
  });

  it("audita PRESCRIPTION_ISSUED_BY_PROFESSIONAL só com bookingId e medicationCount (sem nomes, dosagens nem notas)", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issue = createIssuePrescriptionForProfessionalUseCase(fixtures.deps);

    const { prescriptionId } = await issue(fixtures.deps.db, issueInput([MED_CANARY, MED_AMOXI], "CANARIO-NOTA"), CTX);

    expect(fixtures.audit.events).toHaveLength(1);
    const [event] = fixtures.audit.events;
    expect(event).toMatchObject({
      action: "PRESCRIPTION_ISSUED_BY_PROFESSIONAL",
      actorType: "PROFESSIONAL_ACCOUNT",
      actorProfessionalAccountId: PROFESSIONAL_ACCOUNT_ID,
      resourceType: "Prescription",
      resourceId: prescriptionId,
      familyId: FAMILY_ID,
      subjectMemberId: MEMBER_ID,
      result: "SUCCESS",
    });
    expect(event?.metadata).toEqual({ bookingId: BOOKING_ID, medicationCount: 2 });

    const serialized = JSON.stringify(fixtures.audit.events);
    for (const canary of CANARIES) {
      expect(serialized).not.toContain(canary);
    }
  });

  it("não chama AccessPolicy (a autorização já foi decidida por consultations)", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issue = createIssuePrescriptionForProfessionalUseCase(fixtures.deps);

    await issue(fixtures.deps.db, issueInput([MED_AMOXI]), CTX);

    expect(fixtures.policy.calls).toHaveLength(0);
  });

  it("recusa sem medicamentos (VALIDATION_ERROR) e não grava nada", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issue = createIssuePrescriptionForProfessionalUseCase(fixtures.deps);

    await expect(issue(fixtures.deps.db, issueInput([]), CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(fixtures.prescriptionsRepo.byId.size).toBe(0);
    expect(fixtures.medications.createForProfessionalCalls).toHaveLength(0);
    expect(fixtures.audit.events).toHaveLength(0);
  });

  it("getProfessionalPrescription devolve o conteúdo ao profissional emissor", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issue = createIssuePrescriptionForProfessionalUseCase(fixtures.deps);
    const getProfessionalPrescription = createGetProfessionalPrescriptionUseCase(fixtures.deps);
    await issue(fixtures.deps.db, issueInput([MED_AMOXI], "Tomar após as refeições"), CTX);

    const content = await getProfessionalPrescription(fixtures.deps.db, BOOKING_ID, PROFESSIONAL_ID);

    expect(content).not.toBeNull();
    expect(content).toMatchObject({
      issuedOn: "2026-01-10",
      notes: "Tomar após as refeições",
    });
    expect(content?.medications).toHaveLength(1);
    expect(content?.medications[0]).toMatchObject({ name: "Amoxicilina", dosage: "500mg", scheduleType: "FIXED_TIMES", continuous: true });
  });

  it("getProfessionalPrescription devolve null para outro profissional", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issue = createIssuePrescriptionForProfessionalUseCase(fixtures.deps);
    const getProfessionalPrescription = createGetProfessionalPrescriptionUseCase(fixtures.deps);
    await issue(fixtures.deps.db, issueInput([MED_AMOXI]), CTX);

    await expect(getProfessionalPrescription(fixtures.deps.db, BOOKING_ID, "outro-prof")).resolves.toBeNull();
  });

  it("getProfessionalPrescription devolve null para marcação sem receita", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const getProfessionalPrescription = createGetProfessionalPrescriptionUseCase(fixtures.deps);

    await expect(getProfessionalPrescription(fixtures.deps.db, "booking-sem-receita", PROFESSIONAL_ID)).resolves.toBeNull();
  });

  it("getProfessionalPrescription devolve null para receita FAMILY da mesma marcação", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const getProfessionalPrescription = createGetProfessionalPrescriptionUseCase(fixtures.deps);
    fixtures.prescriptionsRepo.seed({
      id: "rx-family",
      familyId: FAMILY_ID,
      memberId: MEMBER_ID,
      issuedOn: "2026-01-10",
      status: "ACTIVE",
      issuedBy: "FAMILY",
      bookingId: "booking-family",
      issuedByProfessionalId: PROFESSIONAL_ID,
      createdAt: NOW,
    });

    await expect(getProfessionalPrescription(fixtures.deps.db, "booking-family", PROFESSIONAL_ID)).resolves.toBeNull();
  });

  it("findPrescriptionIdsByBookings devolve bookingId -> prescriptionId em lote", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issue = createIssuePrescriptionForProfessionalUseCase(fixtures.deps);
    const findIds = createFindPrescriptionIdsByBookingsUseCase(fixtures.deps);
    const { prescriptionId } = await issue(fixtures.deps.db, issueInput([MED_AMOXI]), CTX);

    const map = await findIds(fixtures.deps.db, [BOOKING_ID, "booking-sem-receita"]);

    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(1);
    expect(map.get(BOOKING_ID)).toBe(prescriptionId);
    expect(map.has("booking-sem-receita")).toBe(false);
  });

  it("isContentReadOnly é true só para receitas PROFESSIONAL", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issue = createIssuePrescriptionForProfessionalUseCase(fixtures.deps);
    const isContentReadOnly = createIsContentReadOnlyUseCase(fixtures.deps);
    const { prescriptionId } = await issue(fixtures.deps.db, issueInput([MED_AMOXI]), CTX);
    fixtures.prescriptionsRepo.seed({ id: "rx-family", familyId: FAMILY_ID, memberId: MEMBER_ID, issuedOn: "2026-01-10", status: "ACTIVE", issuedBy: "FAMILY", createdAt: NOW });
    fixtures.prescriptionsRepo.seed({
      id: "rx-clinic",
      familyId: FAMILY_ID,
      memberId: MEMBER_ID,
      issuedOn: "2026-01-10",
      status: "ACTIVE",
      issuedBy: "CLINIC",
      issuedByClinicAccountId: "clinic-1",
      appointmentId: "appointment-1",
      createdAt: NOW,
    });

    await expect(isContentReadOnly(fixtures.deps.db, FAMILY_ID, MEMBER_ID, prescriptionId)).resolves.toBe(true);
    await expect(isContentReadOnly(fixtures.deps.db, FAMILY_ID, MEMBER_ID, "rx-family")).resolves.toBe(false);
    await expect(isContentReadOnly(fixtures.deps.db, FAMILY_ID, MEMBER_ID, "rx-clinic")).resolves.toBe(false);
    await expect(isContentReadOnly(fixtures.deps.db, FAMILY_ID, MEMBER_ID, "inexistente")).resolves.toBe(false);
  });
});
