// AC-CLN-30/31 / TC-CLN-21/22 / TC-AZ-CLN-V6 (regras de aplicação sobre fakes): autoria só do Médico (nas suas marcações),
// Admin/Gestor leem; rascunho/finalização/adenda; atomicidade com `complete`; isolamento por clínica; lado família (SELF/TUTOR_OF,
// DEPENDENT_SELF/OTHER => FORBIDDEN, partilha, visita manual, auditoria sem texto); PDF; limites de pedidos.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createAddAddendumUseCase, createFinalizeReportUseCase, createFinalizeWithCompleteUseCase, createGetReportPdfUseCase, createGetReportUseCase, createReportStatusesUseCase, createSaveReportUseCase, createSharedReportAvailabilityUseCase } from "./clinic-reports.js";
import { createExamReportGeneratorUseCase } from "./exam-report.js";
import { createGetFamilyReportPdfUseCase, createGetFamilyReportUseCase } from "./family-reports.js";
import { createClinicReportsFixtures } from "./fixtures.js";
import type { ClinicPortalActor } from "./ports.js";

const NOW = new Date("2026-11-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";
const DOCTOR: ClinicPortalActor = { clinicAccountId: "doc-1", clinicId: CLINIC_A, role: "CLINIC_DOCTOR", professionalId: "prof-1" };
const OTHER_DOCTOR: ClinicPortalActor = { clinicAccountId: "doc-2", clinicId: CLINIC_A, role: "CLINIC_DOCTOR", professionalId: "prof-2" };
const ADMIN: ClinicPortalActor = { clinicAccountId: "adm-1", clinicId: CLINIC_A, role: "CLINIC_ADMIN" };
const MANAGER: ClinicPortalActor = { clinicAccountId: "man-1", clinicId: CLINIC_A, role: "CLINIC_MANAGER" };
const DOCTOR_B: ClinicPortalActor = { clinicAccountId: "doc-b", clinicId: CLINIC_B, role: "CLINIC_DOCTOR", professionalId: "prof-b" };
const SECRET = "Diagnóstico confidencial XYZ";
const BODY = { reason: "Dor lombar.", findings: "Sem défice neurológico.", impression: SECRET, plan: "Repouso 3 dias.", sharedWithPatient: true };

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function setup() {
  const clock = new FixedClock(NOW);
  const f = createClinicReportsFixtures(clock);
  f.professionals.names.set(`${CLINIC_A}|prof-1`, "Dr. João Costa");
  f.professionals.names.set(`${CLINIC_A}|prof-2`, "Dra. Lima");
  f.professionals.names.set(`${CLINIC_B}|prof-b`, "Dr. Outro");
  f.professionals.slots.set(`${CLINIC_A}|slot-1`, "prof-1");
  f.professionals.slots.set(`${CLINIC_A}|slot-2`, "prof-2");
  f.professionals.slots.set(`${CLINIC_A}|slot-free`, null);
  f.bookings.seed("APPOINTMENT", "apt-1", CLINIC_A, { slotId: "slot-1", clinicPatientId: "cp-1", patientBirthDate: "1990-03-04" });
  f.bookings.seed("APPOINTMENT", "apt-2", CLINIC_A, { slotId: "slot-2" });
  f.bookings.seed("APPOINTMENT", "apt-noslot", CLINIC_A, { slotId: undefined as never });
  f.bookings.seed("APPOINTMENT", "apt-done", CLINIC_A, { slotId: "slot-1", status: "COMPLETED" });
  f.bookings.seed("APPOINTMENT", "apt-cancelled", CLINIC_A, { slotId: "slot-1", status: "CANCELLED" });
  f.bookings.seed("APPOINTMENT", "apt-noshow", CLINIC_A, { slotId: "slot-1", status: "NO_SHOW" });
  f.bookings.seed("VISIT", "visit-1", CLINIC_A, { slotId: "slot-1", status: "COMPLETED" });
  f.bookings.seed("APPOINTMENT", "apt-b", CLINIC_B, { slotId: "slot-b" });
  f.professionals.slots.set(`${CLINIC_B}|slot-b`, "prof-b");
  return {
    ...f,
    clock,
    save: createSaveReportUseCase(f.deps),
    finalize: createFinalizeReportUseCase(f.deps),
    addendum: createAddAddendumUseCase(f.deps),
    get: createGetReportUseCase(f.deps),
    pdfOf: createGetReportPdfUseCase(f.deps),
    complete: createFinalizeWithCompleteUseCase(f.deps),
    familyGet: createGetFamilyReportUseCase(f.deps),
    familyPdf: createGetFamilyReportPdfUseCase(f.deps),
    statuses: createReportStatusesUseCase(f.deps),
    availability: createSharedReportAvailabilityUseCase(f.deps),
  };
}

describe("rascunho (UC-CLN-32, BR-CLN-41/42/44)", () => {
  it("o Médico guarda o rascunho da marcação do seu profissional: retrato, assinatura e auditoria sem texto", async () => {
    const s = setup();
    const saved = await s.save(DOCTOR, "apt-1", BODY, CTX);
    expect(saved).toMatchObject({ bookingKind: "APPOINTMENT", bookingId: "apt-1", status: "DRAFT", reason: "Dor lombar.", sharedWithPatient: true, patientName: "Maria Silva", patientBirthDate: "1990-03-04", specialty: "Medicina Geral", authorName: "Dr. João Costa", authorAccountId: "doc-1", finalizedAt: null, addenda: [] });
    expect(s.audit.events).toHaveLength(1);
    expect(s.audit.events[0]).toMatchObject({ action: "CONSULT_REPORT_SAVED", actorType: "CLINIC_ACCOUNT", actorClinicId: CLINIC_A, actorClinicAccountId: "doc-1", resourceType: "ConsultationReport", metadata: { bookingKind: "APPOINTMENT", sectionsCount: 4 } });
    expect(JSON.stringify(s.audit.events)).not.toContain(SECRET);
    expect(JSON.stringify(s.audit.events)).not.toContain("Maria");
  });

  it("última escrita ganha; sharedWithPatient omitido mantém o valor; secções omitidas passam a nulas", async () => {
    const s = setup();
    await s.save(DOCTOR, "apt-1", { ...BODY, sharedWithPatient: false }, CTX);
    const second = await s.save(DOCTOR, "apt-1", { reason: "Só o motivo" }, CTX);
    expect(second).toMatchObject({ reason: "Só o motivo", findings: null, impression: null, plan: null, sharedWithPatient: false, status: "DRAFT" });
    expect(s.reportsRepo.reports.size).toBe(1);
  });

  it("Admin e Gestor => FORBIDDEN (nada se grava); Médico de outro profissional ou marcação sem horário => NOT_FOUND", async () => {
    const s = setup();
    expect(await codeOf(s.save(ADMIN, "apt-1", BODY, CTX))).toBe("FORBIDDEN");
    expect(await codeOf(s.save(MANAGER, "apt-1", BODY, CTX))).toBe("FORBIDDEN");
    expect(await codeOf(s.save(OTHER_DOCTOR, "apt-1", BODY, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.save(DOCTOR, "apt-noslot", BODY, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.save(DOCTOR, "inexistente", BODY, CTX))).toBe("NOT_FOUND");
    expect(s.reportsRepo.reports.size).toBe(0);
    expect(s.audit.events).toHaveLength(0);
  });

  it("isolamento por clínica: outra clínica => NOT_FOUND (404 sem enumeração), em todas as operações", async () => {
    const s = setup();
    expect(await codeOf(s.save(DOCTOR_B, "apt-1", BODY, CTX))).toBe("NOT_FOUND");
    await s.save(DOCTOR, "apt-1", BODY, CTX);
    expect(await codeOf(s.get({ ...ADMIN, clinicId: CLINIC_B }, "apt-1", CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.finalize(DOCTOR_B, "apt-1", CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.addendum(DOCTOR_B, "apt-1", { text: "x" }, CTX))).toBe("NOT_FOUND");
  });

  it.each([["apt-cancelled"], ["apt-noshow"]])("marcação %s => INVALID_STATE_TRANSITION; SCHEDULED, COMPLETED e visita concluída admitem", async (id) => {
    const s = setup();
    expect(await codeOf(s.save(DOCTOR, id, BODY, CTX))).toBe("INVALID_STATE_TRANSITION");
    expect((await s.save(DOCTOR, "apt-done", BODY, CTX)).status).toBe("DRAFT");
    expect((await s.save(DOCTOR, "visit-1", BODY, CTX)).bookingKind).toBe("VISIT");
  });

  it("visita manual nunca é partilhada, mesmo que o pedido diga true", async () => {
    const s = setup();
    expect((await s.save(DOCTOR, "visit-1", { ...BODY, sharedWithPatient: true }, CTX)).sharedWithPatient).toBe(false);
  });

  it("validação: sem secções, acima do limite, com controlo => VALIDATION_ERROR (sem efeito)", async () => {
    const s = setup();
    for (const body of [{}, { reason: "x".repeat(301) }, { findings: "a\u0000" }]) {
      expect(await codeOf(s.save(DOCTOR, "apt-1", body, CTX))).toBe("VALIDATION_ERROR");
    }
    expect(s.reportsRepo.reports.size).toBe(0);
  });

  it("rate limit de escrita: 60/min por conta (RATE_LIMITED à 61.ª); outra conta não é afetada", async () => {
    const s = setup();
    for (let i = 0; i < 60; i += 1) await s.save(DOCTOR, "apt-1", BODY, CTX);
    expect(await codeOf(s.save(DOCTOR, "apt-1", BODY, CTX))).toBe("RATE_LIMITED");
    expect((await s.save(OTHER_DOCTOR, "apt-2", BODY, CTX)).status).toBe("DRAFT");
  });
});

describe("finalizar e adendas (UC-CLN-33/34, BR-CLN-42/43)", () => {
  it("finalize: DRAFT -> FINAL com retrato do perfil e finalizedAt; idempotente (200 sem novo registo nem auditoria); depois PUT => INVALID_STATE_TRANSITION", async () => {
    const s = setup();
    await s.save(DOCTOR, "apt-done", BODY, CTX);
    const final = await s.finalize(DOCTOR, "apt-done", CTX);
    expect(final).toMatchObject({ status: "FINAL", finalizedAt: NOW.toISOString(), sharedWithPatient: true });
    expect(s.reportsRepo.reports.get(`${CLINIC_A}|APPOINTMENT|apt-done`)?.issuer).toEqual({ name: "Clínica Sol", address: "Rua 1", phone: null, email: null });
    expect(s.audit.events.at(-1)).toMatchObject({ action: "CONSULT_REPORT_FINALIZED", metadata: { bookingKind: "APPOINTMENT", sharedWithPatient: true, viaComplete: false } });
    const events = s.audit.events.length;
    expect(await s.finalize(DOCTOR, "apt-done", CTX)).toEqual(final);
    expect(s.audit.events).toHaveLength(events);
    expect(await codeOf(s.save(DOCTOR, "apt-done", BODY, CTX))).toBe("INVALID_STATE_TRANSITION");
  });

  it("finalize sem relatório => NOT_FOUND; Admin/Gestor => FORBIDDEN; marcação cancelada com rascunho => INVALID_STATE_TRANSITION", async () => {
    const s = setup();
    expect(await codeOf(s.finalize(DOCTOR, "apt-1", CTX))).toBe("NOT_FOUND");
    await s.save(DOCTOR, "apt-1", BODY, CTX);
    expect(await codeOf(s.finalize(ADMIN, "apt-1", CTX))).toBe("FORBIDDEN");
    s.bookings.setStatus("APPOINTMENT", "apt-1", CLINIC_A, "NO_SHOW");
    expect(await codeOf(s.finalize(DOCTOR, "apt-1", CTX))).toBe("INVALID_STATE_TRANSITION");
  });

  it("NO_SHOW por correção do titular mantém o relatório; o rascunho deixa de ser editável mas continua legível", async () => {
    const s = setup();
    await s.save(DOCTOR, "apt-1", BODY, CTX);
    s.bookings.setStatus("APPOINTMENT", "apt-1", CLINIC_A, "NO_SHOW");
    expect(await codeOf(s.save(DOCTOR, "apt-1", BODY, CTX))).toBe("INVALID_STATE_TRANSITION");
    expect((await s.get(ADMIN, "apt-1", CTX)).status).toBe("DRAFT");
  });

  it("adenda: só sobre FINAL (DRAFT => INVALID_STATE_TRANSITION), datada, com retrato do autor, até 20 (LIMIT_EXCEEDED), imutável; devolve o relatório completo", async () => {
    const s = setup();
    await s.save(DOCTOR, "apt-1", BODY, CTX);
    expect(await codeOf(s.addendum(DOCTOR, "apt-1", { text: "Antes de finalizar" }, CTX))).toBe("INVALID_STATE_TRANSITION");
    await s.finalize(DOCTOR, "apt-1", CTX);
    const first = await s.addendum(DOCTOR, "apt-1", { text: "Resultado recebido." }, CTX);
    expect(first.addenda).toEqual([{ id: expect.any(String) as string, text: "Resultado recebido.", authorName: "Dr. João Costa", createdAt: NOW.toISOString() }]);
    expect(first.impression).toBe(SECRET);
    expect(s.audit.events.at(-1)).toMatchObject({ action: "CONSULT_REPORT_AMENDED", metadata: { bookingKind: "APPOINTMENT", addendaCount: 1 } });
    for (let i = 1; i < 20; i += 1) await s.addendum(DOCTOR, "apt-1", { text: `Adenda ${String(i)}` }, CTX);
    expect(await codeOf(s.addendum(DOCTOR, "apt-1", { text: "21.ª" }, CTX))).toBe("LIMIT_EXCEEDED");
    expect((await s.get(DOCTOR, "apt-1", CTX)).addenda).toHaveLength(20);
    expect(await codeOf(s.addendum(ADMIN, "apt-1", { text: "x" }, CTX))).toBe("FORBIDDEN");
    expect(await codeOf(s.addendum(OTHER_DOCTOR, "apt-1", { text: "x" }, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.addendum(DOCTOR, "apt-1", { text: "" }, CTX))).toBe("VALIDATION_ERROR");
  });
});

describe("report em complete (BR-CLN-42/44)", () => {
  it("grava e finaliza (viaComplete) na transação do chamador; relatório já FINAL => INVALID_STATE_TRANSITION", async () => {
    const s = setup();
    s.bookings.setStatus("APPOINTMENT", "apt-1", CLINIC_A, "COMPLETED");
    await s.complete({}, DOCTOR, "APPOINTMENT", "apt-1", BODY, CTX);
    expect(s.reportsRepo.reports.get(`${CLINIC_A}|APPOINTMENT|apt-1`)).toMatchObject({ status: "FINAL", authorName: "Dr. João Costa" });
    expect(s.audit.events.at(-1)).toMatchObject({ action: "CONSULT_REPORT_FINALIZED", metadata: { viaComplete: true } });
    expect(await codeOf(s.complete({}, DOCTOR, "APPOINTMENT", "apt-1", BODY, CTX))).toBe("INVALID_STATE_TRANSITION");
  });

  it("Admin/Gestor com report => FORBIDDEN sem efeito; corpo inválido => VALIDATION_ERROR sem efeito; visita funciona igual", async () => {
    const s = setup();
    expect(await codeOf(s.complete({}, ADMIN, "APPOINTMENT", "apt-1", BODY, CTX))).toBe("FORBIDDEN");
    expect(await codeOf(s.complete({}, MANAGER, "APPOINTMENT", "apt-1", BODY, CTX))).toBe("FORBIDDEN");
    expect(await codeOf(s.complete({}, DOCTOR, "APPOINTMENT", "apt-1", {}, CTX))).toBe("VALIDATION_ERROR");
    expect(s.reportsRepo.reports.size).toBe(0);
    await s.complete({}, DOCTOR, "VISIT", "visit-1", BODY, CTX);
    expect(s.reportsRepo.reports.get(`${CLINIC_A}|VISIT|visit-1`)).toMatchObject({ status: "FINAL", sharedWithPatient: false });
  });

  it("rascunho existente é finalizado com as secções do corpo (substitui o rascunho)", async () => {
    const s = setup();
    await s.save(DOCTOR, "apt-1", { reason: "Rascunho" }, CTX);
    await s.complete({}, DOCTOR, "APPOINTMENT", "apt-1", { plan: "Plano final" }, CTX);
    expect(s.reportsRepo.reports.get(`${CLINIC_A}|APPOINTMENT|apt-1`)).toMatchObject({ status: "FINAL", reason: null, plan: "Plano final" });
  });
});

describe("leitura e PDF da clínica (UC-CLN-35, BR-CLN-44/46)", () => {
  it("Admin e Gestor leem qualquer marcação; o Médico as suas; leitura auditada sem texto", async () => {
    const s = setup();
    await s.save(DOCTOR, "apt-1", BODY, CTX);
    expect((await s.get(ADMIN, "apt-1", CTX)).impression).toBe(SECRET);
    expect((await s.get(MANAGER, "apt-1", CTX)).status).toBe("DRAFT");
    expect((await s.get(DOCTOR, "apt-1", CTX)).authorName).toBe("Dr. João Costa");
    expect(await codeOf(s.get(OTHER_DOCTOR, "apt-1", CTX))).toBe("NOT_FOUND");
    expect(s.audit.events.filter((e) => e.action === "CONSULT_REPORT_VIEWED")).toHaveLength(3);
    expect(s.audit.events.at(-1)?.metadata).toEqual({ bookingKind: "APPOINTMENT", format: "JSON" });
    expect(JSON.stringify(s.audit.events)).not.toContain(SECRET);
  });

  it("sem relatório => NOT_FOUND; relatório de marcação já apagada: Admin lê (sobrevive), Médico => NOT_FOUND", async () => {
    const s = setup();
    expect(await codeOf(s.get(ADMIN, "apt-1", CTX))).toBe("NOT_FOUND");
    await s.save(DOCTOR, "apt-1", BODY, CTX);
    s.bookings.setStatus("APPOINTMENT", "apt-1", CLINIC_A, "COMPLETED");
    // Simula o apagamento da consulta Vita: a marcação deixa de existir, o relatório não.
    const gone = { find: () => Promise.resolve(null) };
    const orphan = createGetReportUseCase({ ...s.deps, bookings: gone });
    expect((await orphan(ADMIN, "apt-1", CTX)).bookingId).toBe("apt-1");
    expect(await codeOf(orphan(DOCTOR, "apt-1", CTX))).toBe("NOT_FOUND");
  });

  it("PDF: DRAFT usa o perfil atual e a marca de rascunho; FINAL usa o retrato; nome sem dados pessoais; 30/min", async () => {
    const s = setup();
    await s.save(DOCTOR, "apt-done", BODY, CTX);
    const draft = await s.pdfOf(MANAGER, "apt-done", CTX);
    expect(draft.filename).toBe("relatorio-20261108.pdf");
    expect(s.pdf.rendered.at(-1)?.watermark).toBe("RASCUNHO — sem valor");
    expect(s.audit.events.at(-1)).toMatchObject({ action: "CONSULT_REPORT_VIEWED", metadata: { format: "PDF" } });
    await s.finalize(DOCTOR, "apt-done", CTX);
    s.profile.issuer = { name: "Clínica Renomeada" };
    await s.pdfOf(ADMIN, "apt-done", CTX);
    const finalDoc = s.pdf.rendered.at(-1);
    expect(finalDoc?.watermark).toBeUndefined();
    expect(finalDoc?.header[0]).toBe("Clínica Sol");
    for (let i = 0; i < 29; i += 1) await s.pdfOf(ADMIN, "apt-done", CTX);
    expect(await codeOf(s.pdfOf(ADMIN, "apt-done", CTX))).toBe("RATE_LIMITED");
  });
});

describe("lado família (UC-CLN-36, BR-CLN-45, authorization.md §6.6)", () => {
  async function finalShared(s: ReturnType<typeof setup>, body: Record<string, unknown> = BODY) {
    s.familyAppointments.seed("fam-1", "mem-1", "apt-1", CLINIC_A);
    s.patientAccess.relations.set("user-self:mem-1", "SELF");
    s.patientAccess.relations.set("user-tutor:mem-1", "TUTOR_OF");
    s.patientAccess.relations.set("user-dep:mem-1", "DEPENDENT_SELF");
    s.patientAccess.relations.set("user-other:mem-1", "OTHER");
    await s.save(DOCTOR, "apt-1", body, CTX);
    s.bookings.setStatus("APPOINTMENT", "apt-1", CLINIC_A, "COMPLETED");
    await s.finalize(DOCTOR, "apt-1", CTX);
    await s.addendum(DOCTOR, "apt-1", { text: "Adenda visível" }, CTX);
  }
  const self = { userId: "user-self", platformAdmin: false };
  const tutor = { userId: "user-tutor", platformAdmin: false };

  it("titular e tutor leem o FINAL partilhado, sem ids da clínica nem da conta autora; sem consentimento", async () => {
    const s = setup();
    await finalShared(s);
    const view = await s.familyGet(self, "fam-1", "mem-1", "apt-1", CTX);
    expect(view).toEqual({
      appointmentId: "apt-1",
      clinicName: "Clínica Sol",
      consultationAt: "2026-11-08T09:30:00.000Z",
      specialty: "Medicina Geral",
      authorName: "Dr. João Costa",
      reason: "Dor lombar.",
      findings: "Sem défice neurológico.",
      impression: SECRET,
      plan: "Repouso 3 dias.",
      finalizedAt: NOW.toISOString(),
      addenda: [{ id: expect.any(String) as string, text: "Adenda visível", authorName: "Dr. João Costa", createdAt: NOW.toISOString() }],
      notice: "Documento não fiscal. Não substitui receita médica nem atestado.",
    });
    expect(JSON.stringify(view)).not.toMatch(/clinicId|authorAccountId|clinic-a|doc-1/);
    expect((await s.familyGet(tutor, "fam-1", "mem-1", "apt-1", CTX)).authorName).toBe("Dr. João Costa");
  });

  it("DEPENDENT_SELF e OTHER (mesmo com SharingGrant) => FORBIDDEN; membro de outra família => NOT_FOUND; Platform Admin recusado pela política", async () => {
    const s = setup();
    await finalShared(s);
    expect(await codeOf(s.familyGet({ userId: "user-dep", platformAdmin: false }, "fam-1", "mem-1", "apt-1", CTX))).toBe("FORBIDDEN");
    expect(await codeOf(s.familyGet({ userId: "user-other", platformAdmin: false }, "fam-1", "mem-1", "apt-1", CTX))).toBe("FORBIDDEN");
    expect(await codeOf(s.familyPdf({ userId: "user-other", platformAdmin: false }, "fam-1", "mem-1", "apt-1", CTX))).toBe("FORBIDDEN");
    expect(await codeOf(s.familyGet({ userId: "estranho", platformAdmin: false }, "fam-1", "mem-1", "apt-1", CTX))).toBe("NOT_FOUND");
  });

  it("DRAFT, não partilhado, visita manual ou consulta de outra família => NOT_FOUND (a clínica nunca escreve nem lê por esta via)", async () => {
    const s = setup();
    s.familyAppointments.seed("fam-1", "mem-1", "apt-1", CLINIC_A);
    s.patientAccess.relations.set("user-self:mem-1", "SELF");
    await s.save(DOCTOR, "apt-1", BODY, CTX);
    expect(await codeOf(s.familyGet(self, "fam-1", "mem-1", "apt-1", CTX))).toBe("NOT_FOUND"); // DRAFT
    s.bookings.setStatus("APPOINTMENT", "apt-1", CLINIC_A, "COMPLETED");
    await s.finalize(DOCTOR, "apt-1", CTX);
    expect((await s.familyGet(self, "fam-1", "mem-1", "apt-1", CTX)).appointmentId).toBe("apt-1");
    expect(await codeOf(s.familyGet(self, "fam-1", "mem-1", "apt-desconhecida", CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.familyGet(self, "fam-2", "mem-1", "apt-1", CTX))).toBe("NOT_FOUND");

    const t = setup();
    t.familyAppointments.seed("fam-1", "mem-1", "apt-1", CLINIC_A);
    t.patientAccess.relations.set("user-self:mem-1", "SELF");
    await t.save(DOCTOR, "apt-1", { ...BODY, sharedWithPatient: false }, CTX);
    t.bookings.setStatus("APPOINTMENT", "apt-1", CLINIC_A, "COMPLETED");
    await t.finalize(DOCTOR, "apt-1", CTX);
    expect(await codeOf(t.familyGet(self, "fam-1", "mem-1", "apt-1", CTX))).toBe("NOT_FOUND"); // não partilhado

    const v = setup();
    v.familyAppointments.seed("fam-1", "mem-1", "visit-1", CLINIC_A); // um id de visita nunca é consulta Vita da família
    v.patientAccess.relations.set("user-self:mem-1", "SELF");
    await v.complete({}, DOCTOR, "VISIT", "visit-1", BODY, CTX);
    expect(await codeOf(v.familyGet(self, "fam-1", "mem-1", "visit-1", CTX))).toBe("NOT_FOUND"); // visita: booking_kind=VISIT
  });

  it("auditoria: leitura JSON do titular não se audita, a do tutor sim; o PDF audita-se sempre; nunca com texto", async () => {
    const s = setup();
    await finalShared(s);
    const before = s.audit.events.length;
    await s.familyGet(self, "fam-1", "mem-1", "apt-1", CTX);
    expect(s.audit.events).toHaveLength(before);
    await s.familyGet(tutor, "fam-1", "mem-1", "apt-1", CTX);
    await s.familyPdf(self, "fam-1", "mem-1", "apt-1", CTX);
    const viewed = s.audit.events.slice(before);
    expect(viewed).toHaveLength(2);
    expect(viewed[0]).toMatchObject({ action: "CONSULT_REPORT_VIEWED", actorType: "USER", actorUserId: "user-tutor", resourceType: "Appointment", resourceId: "apt-1", familyId: "fam-1", subjectMemberId: "mem-1", metadata: { format: "JSON" } });
    expect(viewed[1]).toMatchObject({ actorUserId: "user-self", metadata: { format: "PDF" } });
    expect(JSON.stringify(viewed)).not.toContain(SECRET);
  });

  it("PDF da família: retrato do FINAL, sem marca de rascunho, nome sem dados pessoais", async () => {
    const s = setup();
    await finalShared(s);
    s.profile.issuer = { name: "Outro nome" };
    const pdf = await s.familyPdf(self, "fam-1", "mem-1", "apt-1", CTX);
    expect(pdf.filename).toBe("relatorio-20261108.pdf");
    expect(s.pdf.rendered.at(-1)).toMatchObject({ header: ["Clínica Sol", "Rua 1"], footer: "Documento não fiscal. Não substitui receita médica nem atestado." });
    expect(s.pdf.rendered.at(-1)?.watermark).toBeUndefined();
  });

  it("reportAvailable/reportStatus: só FINAL partilhado de consulta Vita conta como disponível; estados por marcação", async () => {
    const s = setup();
    await s.save(DOCTOR, "apt-1", BODY, CTX);
    await s.save(DOCTOR, "apt-done", { ...BODY, sharedWithPatient: false }, CTX);
    s.bookings.setStatus("APPOINTMENT", "apt-1", CLINIC_A, "COMPLETED");
    expect([...(await s.statuses({}, CLINIC_A, "APPOINTMENT", ["apt-1", "apt-done", "apt-2"]))]).toEqual([["apt-1", "DRAFT"], ["apt-done", "DRAFT"]]);
    expect((await s.availability({}, [{ clinicId: CLINIC_A, bookingId: "apt-1" }])).size).toBe(0);
    await s.finalize(DOCTOR, "apt-1", CTX);
    await s.finalize(DOCTOR, "apt-done", CTX);
    const available = await s.availability({}, [{ clinicId: CLINIC_A, bookingId: "apt-1" }, { clinicId: CLINIC_A, bookingId: "apt-done" }, { clinicId: CLINIC_B, bookingId: "apt-1" }]);
    expect([...available]).toEqual(["apt-1"]);
  });
});

describe("laudo gerado (BR-CLN-48)", () => {
  it("gera com o perfil da clínica e o profissional do horário; devolve contagens aritméticas", async () => {
    const s = setup();
    const generate = createExamReportGeneratorUseCase(s.deps);
    const result = await generate({}, {
      clinicId: CLINIC_A,
      slotId: "slot-1",
      patientName: "Maria Silva",
      examName: "Análises",
      examDate: "2026-11-08",
      results: [
        { parameter: "Hemoglobina", valueNumeric: 11.2, unit: "g/dL", referenceMin: 12, referenceMax: 16 },
        { parameter: "Glicose", valueNumeric: 99, referenceMin: 70, referenceMax: 99 },
      ],
      resultNote: null,
    });
    expect(result).toMatchObject({ resultsCount: 2, outOfReferenceCount: 1 });
    expect(s.pdf.rendered.at(-1)).toMatchObject({ header: ["Clínica Sol", "Rua 1"], title: "Laudo de exame" });
    expect(JSON.stringify(s.pdf.rendered.at(-1)?.blocks)).toContain("Profissional: Dr. João Costa");
  });

  it("falha do renderizador propaga-se (examinations converte em INTERNAL_ERROR e reverte)", async () => {
    const s = setup();
    s.pdf.failWith = new Error("boom");
    const generate = createExamReportGeneratorUseCase(s.deps);
    await expect(generate({}, { clinicId: CLINIC_A, patientName: "M", examName: "E", examDate: "2026-11-08", results: [{ parameter: "P", valueNumeric: 1 }], resultNote: null })).rejects.toThrow("boom");
  });
});
