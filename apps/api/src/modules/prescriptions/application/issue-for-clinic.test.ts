import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createIssuePrescriptionForClinicUseCase } from "./issue-for-clinic.js";
import { createPrescriptionsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ORIGIN = { clinicAccountId: "clinic-account-1", appointmentId: "appointment-1" };

const MED_INPUT = { name: "Ibuprofeno", dosage: "400mg", scheduleType: "FIXED_TIMES" as const, times: ["08:00"], startAt: NOW.toISOString(), continuous: true };

describe("issuePrescriptionForClinic (D18, BR-CLN-06/BR-RX-07)", () => {
  it("cria a receita com issuedBy=CLINIC e o plano, sem chamar AccessPolicy", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issueForClinic = createIssuePrescriptionForClinicUseCase(fixtures.deps);

    const prescription = await issueForClinic(fixtures.deps.db, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, ORIGIN, CTX);

    expect(prescription.status).toBe("ACTIVE");
    expect(prescription.issuedBy).toBe("CLINIC");
    expect(prescription.issuedByClinicAccountId).toBe(ORIGIN.clinicAccountId);
    expect(prescription.appointmentId).toBe(ORIGIN.appointmentId);
    expect(fixtures.policy.calls).toHaveLength(0);
    expect(fixtures.medications.createForClinicCalls).toHaveLength(1);
    expect(fixtures.medications.createForClinicCalls[0]).toMatchObject({ clinicAccountId: ORIGIN.clinicAccountId, familyId: FAMILY_ID, memberId: MEMBER_ID });
    expect(fixtures.medications.createCalls).toHaveLength(0);
  });

  it("audita como CLINIC_ACCOUNT (nunca USER)", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issueForClinic = createIssuePrescriptionForClinicUseCase(fixtures.deps);

    await issueForClinic(fixtures.deps.db, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [MED_INPUT] }, ORIGIN, CTX);

    const event = fixtures.audit.events.find((e) => e.action === "PRESCRIPTION_CREATE");
    expect(event).toMatchObject({ actorType: "CLINIC_ACCOUNT", actorClinicAccountId: ORIGIN.clinicAccountId });
  });

  it("recusa sem medicamentos (VALIDATION_ERROR), sem chamar medications", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issueForClinic = createIssuePrescriptionForClinicUseCase(fixtures.deps);

    await expect(issueForClinic(fixtures.deps.db, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-10", medications: [] }, ORIGIN, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(fixtures.medications.createForClinicCalls).toHaveLength(0);
  });

  it("recusa data de emissão futura", async () => {
    const fixtures = createPrescriptionsFixtures(new FixedClock(NOW));
    const issueForClinic = createIssuePrescriptionForClinicUseCase(fixtures.deps);

    await expect(issueForClinic(fixtures.deps.db, FAMILY_ID, MEMBER_ID, { issuedOn: "2026-01-16", medications: [MED_INPUT] }, ORIGIN, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
