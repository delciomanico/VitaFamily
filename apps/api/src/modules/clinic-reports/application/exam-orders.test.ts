// AC-CLN-34/35/36 / TC-CLN-25/26/27 / TC-AZ-CLN-V7 (regras de aplicação sobre fakes): pedido de exame (só o Médico escreve; Admin/Gestor
// leem), limites, atomicidade com `complete`, máscara `booked_here`, ponte/alerta, linker, família (SELF/TUTOR_OF), declaração de presença.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createGetAttendanceStatementPdfUseCase } from "./attendance-statement.js";
import {
  createAppointmentExamOrderCountsUseCase,
  createCancelExamOrderUseCase,
  createCreateExamOrdersUseCase,
  createCreateWithCompleteUseCase,
  createExamOrderCountsUseCase,
  createGetExamOrdersPdfUseCase,
  createListExamOrdersUseCase,
} from "./exam-orders.js";
import { createExamOrderLinker, createListFamilyExamOrdersUseCase } from "./family-exam-orders.js";
import { createClinicReportsFixtures } from "./fixtures.js";
import type { ClinicPortalActor } from "./ports.js";

const NOW = new Date("2026-11-10T10:00:00Z");
const CTX = { requestId: "req-1" };
const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";
const FAMILY = "fam-1";
const MEMBER = "mem-1";
const DOCTOR: ClinicPortalActor = { clinicAccountId: "doc-1", clinicId: CLINIC_A, role: "CLINIC_DOCTOR", professionalId: "prof-1" };
const OTHER_DOCTOR: ClinicPortalActor = { clinicAccountId: "doc-2", clinicId: CLINIC_A, role: "CLINIC_DOCTOR", professionalId: "prof-2" };
const ADMIN: ClinicPortalActor = { clinicAccountId: "adm-1", clinicId: CLINIC_A, role: "CLINIC_ADMIN" };
const MANAGER: ClinicPortalActor = { clinicAccountId: "man-1", clinicId: CLINIC_A, role: "CLINIC_MANAGER" };
const DOCTOR_B: ClinicPortalActor = { clinicAccountId: "doc-b", clinicId: CLINIC_B, role: "CLINIC_DOCTOR", professionalId: "prof-b" };
const MANAGER_B: ClinicPortalActor = { clinicAccountId: "man-b", clinicId: CLINIC_B, role: "CLINIC_MANAGER" };
const SELF = { userId: "u-self", platformAdmin: false };
const TUTOR = { userId: "u-tutor", platformAdmin: false };
const OTHER = { userId: "u-other", platformAdmin: false };
const DEP = { userId: "u-dep", platformAdmin: false };
const SECRET = "Teste de VIH confidencial";
const SERVICE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";

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
  f.professionals.slots.set(`${CLINIC_B}|slot-b`, "prof-b");
  const vita = { vitaMember: { familyId: FAMILY, memberId: MEMBER } };
  f.bookings.seed("APPOINTMENT", "apt-1", CLINIC_A, { slotId: "slot-1", clinicPatientId: "cp-1", patientBirthDate: "1990-03-04", ...vita });
  f.bookings.seed("APPOINTMENT", "apt-2", CLINIC_A, { slotId: "slot-2", ...vita });
  f.bookings.seed("APPOINTMENT", "apt-done", CLINIC_A, { slotId: "slot-1", status: "COMPLETED", ...vita });
  f.bookings.seed("APPOINTMENT", "apt-cancelled", CLINIC_A, { slotId: "slot-1", status: "CANCELLED", ...vita });
  f.bookings.seed("APPOINTMENT", "apt-noshow", CLINIC_A, { slotId: "slot-1", status: "NO_SHOW", ...vita });
  f.bookings.seed("APPOINTMENT", "apt-requested", CLINIC_A, { slotId: "slot-1", status: "REQUESTED", ...vita });
  f.bookings.seed("APPOINTMENT", "apt-arrived", CLINIC_A, { slotId: "slot-1", arrivedAt: new Date("2026-11-10T09:00:00Z"), ...vita });
  f.bookings.seed("VISIT", "visit-1", CLINIC_A, { slotId: "slot-1", status: "SCHEDULED" });
  f.bookings.seed("APPOINTMENT", "apt-b", CLINIC_B, { slotId: "slot-b", ...vita });
  f.patientAccess.relations.set(`${SELF.userId}:${MEMBER}`, "SELF");
  f.patientAccess.relations.set(`${TUTOR.userId}:${MEMBER}`, "TUTOR_OF");
  f.patientAccess.relations.set(`${OTHER.userId}:${MEMBER}`, "OTHER");
  f.patientAccess.relations.set(`${DEP.userId}:${MEMBER}`, "DEPENDENT_SELF");
  f.services.services.set(`${CLINIC_A}|${SERVICE}`, { id: SERVICE, name: "Ecografia abdominal", kind: "EXAM", active: true });
  f.services.services.set(`${CLINIC_A}|svc-consult`, { id: "svc-consult", name: "Consulta", kind: "APPOINTMENT", active: true });
  f.services.services.set(`${CLINIC_A}|svc-off`, { id: "svc-off", name: "Inativo", kind: "EXAM", active: false });
  return {
    ...f,
    clock,
    pdf_renderer_last: () => {
      const last = f.pdf.rendered.at(-1);
      if (!last) throw new Error("nenhum PDF renderizado");
      return last;
    },
    create: createCreateExamOrdersUseCase(f.deps),
    complete: createCreateWithCompleteUseCase(f.deps),
    list: createListExamOrdersUseCase(f.deps),
    cancel: createCancelExamOrderUseCase(f.deps),
    pdf: createGetExamOrdersPdfUseCase(f.deps),
    statement: createGetAttendanceStatementPdfUseCase(f.deps),
    counts: createExamOrderCountsUseCase(f.deps),
    appointmentCounts: createAppointmentExamOrderCountsUseCase(f.deps),
    linker: createExamOrderLinker(f.deps),
    familyList: createListFamilyExamOrdersUseCase(f.deps),
  };
}
type Setup = ReturnType<typeof setup>;

async function ordered(s: Setup, bookingId = "apt-1", items: object[] = [{ name: SECRET, note: "Jejum", urgent: true }]) {
  return s.create(DOCTOR, bookingId, { items }, CTX);
}

describe("criar pedidos (UC-CLN-39, BR-CLN-51)", () => {
  it("o Médico cria 1–5 pedidos na marcação do seu profissional: retrato, assinatura, ponte e UM alerta; auditoria só com contagens", async () => {
    const s = setup();
    const created = await ordered(s, "apt-1", [{ name: SECRET, note: "Jejum", urgent: true }, { serviceTypeId: SERVICE }]);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ bookingKind: "APPOINTMENT", bookingId: "apt-1", name: SECRET, note: "Jejum", urgent: true, status: "ORDERED", patientName: "Maria Silva", patientBirthDate: "1990-03-04", authorName: "Dr. João Costa" });
    expect(created[1]).toMatchObject({ name: "Ecografia abdominal", serviceTypeId: SERVICE, urgent: false });
    expect(s.ordersRepo.locked).toEqual(["apt-1"]);
    expect(s.ordersRepo.links.size).toBe(2);
    expect(s.orderAlerts.raised).toEqual([{ appointmentId: "apt-1", familyId: FAMILY, memberId: MEMBER }]);
    const audit = s.audit.events.filter((e) => e.action === "EXAM_ORDER_CREATED");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "CLINIC_ACCOUNT", actorClinicId: CLINIC_A, resourceType: "Appointment", resourceId: "apt-1", metadata: { bookingKind: "APPOINTMENT", count: 2, urgentCount: 1, viaComplete: false } });
    expect(JSON.stringify(s.audit.events)).not.toContain("VIH");
    expect(JSON.stringify(s.audit.events)).not.toContain("Maria");
    expect(JSON.stringify(s.orderAlerts.raised)).not.toContain("VIH");
  });

  it("visita manual: sem ponte nem alerta; auditoria com ClinicVisit", async () => {
    const s = setup();
    await ordered(s, "visit-1");
    expect(s.ordersRepo.links.size).toBe(0);
    expect(s.orderAlerts.raised).toEqual([]);
    expect(s.audit.events.at(-1)).toMatchObject({ action: "EXAM_ORDER_CREATED", resourceType: "ClinicVisit", metadata: { bookingKind: "VISIT" } });
  });

  it("consulta COMPLETED também admite pedidos; CANCELLED/NO_SHOW/REQUESTED => INVALID_STATE_TRANSITION", async () => {
    const s = setup();
    expect(await ordered(s, "apt-done")).toHaveLength(1);
    for (const id of ["apt-cancelled", "apt-noshow", "apt-requested"]) expect(await codeOf(ordered(s, id))).toBe("INVALID_STATE_TRANSITION");
  });

  it("Admin e Gestor => FORBIDDEN sem efeito; Médico de outro profissional ou outra clínica => NOT_FOUND", async () => {
    const s = setup();
    for (const actor of [ADMIN, MANAGER]) expect(await codeOf(s.create(actor, "apt-1", { items: [{ name: "x" }] }, CTX))).toBe("FORBIDDEN");
    expect(await codeOf(s.create(OTHER_DOCTOR, "apt-1", { items: [{ name: "x" }] }, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.create(DOCTOR_B, "apt-1", { items: [{ name: "x" }] }, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.create(DOCTOR, "nope", { items: [{ name: "x" }] }, CTX))).toBe("NOT_FOUND");
    expect(s.ordersRepo.orders.size).toBe(0);
    expect(s.orderAlerts.raised).toEqual([]);
  });

  it("serviço de outra clínica/inexistente => NOT_FOUND; nada fica gravado", async () => {
    const s = setup();
    expect(await codeOf(s.create(DOCTOR, "apt-1", { items: [{ name: "ok" }, { serviceTypeId: "6f9619ff-8b86-4011-b42d-00c04fc964aa" }] }, CTX))).toBe("NOT_FOUND");
    expect(s.ordersRepo.orders.size).toBe(0);
  });

  it("serviço APPOINTMENT ou inativo => VALIDATION_ERROR", async () => {
    const s = setup();
    s.services.services.set(`${CLINIC_A}|6f9619ff-8b86-4011-b42d-00c04fc964a1`, { id: "6f9619ff-8b86-4011-b42d-00c04fc964a1", name: "Consulta", kind: "APPOINTMENT", active: true });
    s.services.services.set(`${CLINIC_A}|6f9619ff-8b86-4011-b42d-00c04fc964a2`, { id: "6f9619ff-8b86-4011-b42d-00c04fc964a2", name: "Inativo", kind: "EXAM", active: false });
    expect(await codeOf(s.create(DOCTOR, "apt-1", { items: [{ serviceTypeId: "6f9619ff-8b86-4011-b42d-00c04fc964a1" }] }, CTX))).toBe("VALIDATION_ERROR");
    expect(await codeOf(s.create(DOCTOR, "apt-1", { items: [{ serviceTypeId: "6f9619ff-8b86-4011-b42d-00c04fc964a2" }] }, CTX))).toBe("VALIDATION_ERROR");
  });

  it("o nome copiado do serviço é truncado a 80", async () => {
    const s = setup();
    s.services.services.set(`${CLINIC_A}|${SERVICE}`, { id: SERVICE, name: "E".repeat(120), kind: "EXAM", active: true });
    expect((await ordered(s, "apt-1", [{ serviceTypeId: SERVICE }]))[0]?.name).toHaveLength(80);
  });

  it("no máximo 5 pedidos ativos por marcação (LIMIT_EXCEEDED); cancelados não contam", async () => {
    const s = setup();
    const first = await ordered(s, "apt-1", Array.from({ length: 5 }, (_, i) => ({ name: `E${String(i)}` })));
    expect(first).toHaveLength(5);
    expect(await codeOf(ordered(s, "apt-1", [{ name: "sexto" }]))).toBe("LIMIT_EXCEEDED");
    await s.cancel(DOCTOR, "apt-1", first[0]?.id ?? "", CTX);
    expect(await ordered(s, "apt-1", [{ name: "sexto" }])).toHaveLength(6); // lista completa inclui o cancelado
    expect(await codeOf(ordered(s, "apt-1", [{ name: "sétimo" }]))).toBe("LIMIT_EXCEEDED");
  });

  it("validação: 0/6 itens, nome e serviço ambos/nenhum => VALIDATION_ERROR (sem alerta)", async () => {
    const s = setup();
    for (const items of [[], Array.from({ length: 6 }, () => ({ name: "x" })), [{ name: "x", serviceTypeId: SERVICE }], [{}]]) {
      expect(await codeOf(s.create(DOCTOR, "apt-1", { items }, CTX))).toBe("VALIDATION_ERROR");
    }
    expect(s.orderAlerts.raised).toEqual([]);
  });

  it("rate limit de escrita: 30/min por conta (RATE_LIMITED à 31.ª)", async () => {
    const s = setup();
    for (let i = 0; i < 30; i += 1) await s.cancel(DOCTOR, "apt-1", "nope", CTX).catch(() => undefined);
    expect(await codeOf(s.cancel(DOCTOR, "apt-1", "nope", CTX))).toBe("RATE_LIMITED");
  });
});

describe("`examOrders` em complete (BR-CLN-51)", () => {
  it("cria na transação do chamador, marca viaComplete e alerta uma vez", async () => {
    const s = setup();
    await s.complete({}, DOCTOR, "APPOINTMENT", "apt-1", [{ name: "Hemograma" }, { name: "Glicemia" }], CTX);
    expect(s.ordersRepo.orders.size).toBe(2);
    expect(s.orderAlerts.raised).toHaveLength(1);
    expect(s.audit.events.at(-1)).toMatchObject({ action: "EXAM_ORDER_CREATED", metadata: { viaComplete: true, count: 2 } });
  });

  it("Admin/Gestor => FORBIDDEN sem efeito; outro profissional => NOT_FOUND; inválido => VALIDATION_ERROR; >5 ativos => LIMIT_EXCEEDED", async () => {
    const s = setup();
    for (const actor of [ADMIN, MANAGER]) expect(await codeOf(s.complete({}, actor, "APPOINTMENT", "apt-1", [{ name: "x" }], CTX))).toBe("FORBIDDEN");
    expect(await codeOf(s.complete({}, OTHER_DOCTOR, "APPOINTMENT", "apt-1", [{ name: "x" }], CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.complete({}, DOCTOR, "APPOINTMENT", "apt-1", [], CTX))).toBe("VALIDATION_ERROR");
    await ordered(s, "apt-1", Array.from({ length: 5 }, (_, i) => ({ name: `E${String(i)}` })));
    expect(await codeOf(s.complete({}, DOCTOR, "APPOINTMENT", "apt-1", [{ name: "x" }], CTX))).toBe("LIMIT_EXCEEDED");
    expect(s.ordersRepo.orders.size).toBe(5);
  });
});

describe("listar e imprimir (UC-CLN-41, BR-CLN-54)", () => {
  it("Admin, Gestor e Médico (suas) leem; outro Médico/clínica => NOT_FOUND; leitura auditada sem texto", async () => {
    const s = setup();
    await ordered(s);
    for (const actor of [ADMIN, MANAGER, DOCTOR]) expect(await s.list(actor, "apt-1", CTX)).toHaveLength(1);
    expect(await codeOf(s.list(OTHER_DOCTOR, "apt-1", CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.list(MANAGER_B, "apt-1", CTX))).toBe("NOT_FOUND");
    const viewed = s.audit.events.filter((e) => e.action === "EXAM_ORDER_VIEWED");
    expect(viewed).toHaveLength(3);
    expect(viewed[0]).toMatchObject({ metadata: { bookingKind: "APPOINTMENT", format: "JSON" } });
    expect(JSON.stringify(viewed)).not.toContain("VIH");
  });

  it("marcação sem pedidos: lista vazia (200)", async () => {
    expect(await setup().list(MANAGER, "apt-1", CTX)).toEqual([]);
  });

  it("PDF só com os pedidos ativos, perfil atual, nome sem dados pessoais e auditoria format=PDF; sem ativos => NOT_FOUND", async () => {
    const s = setup();
    const created = await ordered(s, "apt-1", [{ name: "Hemograma" }, { name: "Glicemia", urgent: true }]);
    await s.cancel(DOCTOR, "apt-1", created[0]?.id ?? "", CTX);
    const pdf = await s.pdf(MANAGER, "apt-1", CTX);
    expect(pdf.filename).toBe("pedido-exame-20261108.pdf");
    expect(pdf.bytes.length).toBeGreaterThan(0);
    const doc = s.pdf_renderer_last();
    expect(JSON.stringify(doc.blocks)).toContain("Glicemia — URGENTE");
    expect(JSON.stringify(doc.blocks)).not.toContain("Hemograma");
    expect(s.audit.events.at(-1)).toMatchObject({ action: "EXAM_ORDER_VIEWED", metadata: { format: "PDF" } });
    await s.cancel(DOCTOR, "apt-1", created[1]?.id ?? "", CTX);
    expect(await codeOf(s.pdf(MANAGER, "apt-1", CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.pdf(DOCTOR_B, "apt-1", CTX))).toBe("NOT_FOUND");
  });

  it("os PDF partilham a bolsa de 30/min com a declaração (RATE_LIMITED à 31.ª)", async () => {
    const s = setup();
    await ordered(s);
    for (let i = 0; i < 15; i += 1) await s.pdf(MANAGER, "apt-1", CTX);
    for (let i = 0; i < 15; i += 1) await s.statement(MANAGER, "apt-arrived", false, CTX);
    expect(await codeOf(s.pdf(MANAGER, "apt-1", CTX))).toBe("RATE_LIMITED");
    expect(await codeOf(s.statement(MANAGER, "apt-arrived", false, CTX))).toBe("RATE_LIMITED");
  });
});

describe("cancelar (UC-CLN-40, BR-CLN-52)", () => {
  it("só o Médico (suas); idempotente; Admin/Gestor => FORBIDDEN; outro Médico/clínica => NOT_FOUND; auditoria só com ids", async () => {
    const s = setup();
    const [order] = await ordered(s);
    const id = order?.id ?? "";
    for (const actor of [ADMIN, MANAGER]) expect(await codeOf(s.cancel(actor, "apt-1", id, CTX))).toBe("FORBIDDEN");
    expect(await codeOf(s.cancel(OTHER_DOCTOR, "apt-1", id, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.cancel(DOCTOR_B, "apt-1", id, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.cancel(DOCTOR, "apt-1", "nope", CTX))).toBe("NOT_FOUND");
    const cancelled = await s.cancel(DOCTOR, "apt-1", id, CTX);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
    const again = await s.cancel(DOCTOR, "apt-1", id, CTX);
    expect(again.status).toBe("CANCELLED");
    expect(s.audit.events.filter((e) => e.action === "EXAM_ORDER_CANCELLED")).toHaveLength(1);
    expect(s.audit.events.at(-1)).toMatchObject({ resourceType: "ExamOrder", resourceId: id });
    expect(JSON.stringify(s.audit.events)).not.toContain("VIH");
  });

  it("FULFILLED visível (exame na própria clínica) => INVALID_STATE_TRANSITION; marcado noutra clínica aparece ORDERED e cancela-se sem tocar na ligação do paciente", async () => {
    const s = setup();
    const [a, b] = await ordered(s, "apt-1", [{ name: "Hemograma" }, { name: "Glicemia" }]);
    // a: cumprido na própria clínica; b: cumprido noutra clínica
    await s.linker.link({}, { actor: SELF, familyId: FAMILY, memberId: MEMBER, orderId: a?.id ?? "", examinationId: "ex-a", examClinicId: CLINIC_A, status: "COMPLETED" }, CTX);
    await s.linker.link({}, { actor: SELF, familyId: FAMILY, memberId: MEMBER, orderId: b?.id ?? "", examinationId: "ex-b", examClinicId: CLINIC_B, status: "COMPLETED" }, CTX);
    const listed = await s.list(MANAGER, "apt-1", CTX);
    expect(listed.map((o) => o.status)).toEqual(["FULFILLED", "ORDERED"]);
    expect(await codeOf(s.cancel(DOCTOR, "apt-1", a?.id ?? "", CTX))).toBe("INVALID_STATE_TRANSITION");
    expect((await s.cancel(DOCTOR, "apt-1", b?.id ?? "", CTX)).status).toBe("CANCELLED");
    // para o paciente o pedido b fica CANCELLED e a ligação desfaz-se (o exame é do paciente e não é tocado aqui)
    expect(s.ordersRepo.links.get(b?.id ?? "")?.examinationId).toBeNull();
  });
});

describe("ligação ao exame e máscara booked_here (BR-CLN-52, `ExamOrderLinker`)", () => {
  it("link: ORDERED -> SCHEDULED; booked_here só se o exame é da clínica do pedido; a clínica de origem vê ORDERED se foi marcado fora", async () => {
    const s = setup();
    const [a, b] = await ordered(s, "apt-1", [{ name: "Hemograma" }, { name: "Glicemia" }]);
    await s.linker.link({}, { actor: SELF, familyId: FAMILY, memberId: MEMBER, orderId: a?.id ?? "", examinationId: "ex-a", examClinicId: CLINIC_A, status: "SCHEDULED" }, CTX);
    await s.linker.link({}, { actor: TUTOR, familyId: FAMILY, memberId: MEMBER, orderId: b?.id ?? "", examinationId: "ex-b", examClinicId: CLINIC_B, status: "SCHEDULED" }, CTX);
    expect((await s.list(MANAGER, "apt-1", CTX)).map((o) => o.status)).toEqual(["SCHEDULED", "ORDERED"]);
    // o paciente vê o estado real em qualquer clínica
    expect((await s.familyList(SELF, FAMILY, MEMBER)).map((o) => `${o.name}:${o.status}:${String(o.examinationId)}`).sort()).toEqual(["Glicemia:SCHEDULED:ex-b", "Hemograma:SCHEDULED:ex-a"]);
    expect(s.audit.events.filter((e) => e.action === "EXAM_ORDER_LINKED")).toHaveLength(2);
    expect(s.audit.events.filter((e) => e.action === "EXAM_ORDER_LINKED").at(-1)).toMatchObject({ actorType: "USER", resourceType: "ExamOrder", familyId: FAMILY, subjectMemberId: MEMBER, metadata: { examinationId: "ex-b" } });
  });

  it("exame sem clínica (privado) liga com booked_here=false; exame que nasce COMPLETED => FULFILLED", async () => {
    const s = setup();
    const [a] = await ordered(s);
    await s.linker.link({}, { actor: SELF, familyId: FAMILY, memberId: MEMBER, orderId: a?.id ?? "", examinationId: "ex-a", status: "COMPLETED" }, CTX);
    expect(s.ordersRepo.orders.get(a?.id ?? "")).toMatchObject({ status: "FULFILLED", bookedHere: false });
  });

  it("link: já não ORDERED => CONFLICT; de outro membro/inexistente => NOT_FOUND; DEPENDENT_SELF/OTHER => FORBIDDEN; sem efeitos", async () => {
    const s = setup();
    const [a] = await ordered(s);
    const input = { familyId: FAMILY, memberId: MEMBER, orderId: a?.id ?? "", examinationId: "ex-a", examClinicId: CLINIC_A, status: "SCHEDULED" as const };
    await s.linker.link({}, { ...input, actor: SELF }, CTX);
    expect(await codeOf(s.linker.link({}, { ...input, examinationId: "ex-2", actor: SELF }, CTX))).toBe("CONFLICT");
    expect(await codeOf(s.linker.link({}, { ...input, orderId: "nope", actor: SELF }, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.linker.link({}, { ...input, memberId: "other-member", actor: SELF }, CTX))).toBe("NOT_FOUND");
    for (const actor of [OTHER, DEP]) expect(await codeOf(s.linker.link({}, { ...input, actor }, CTX))).toBe("FORBIDDEN");
    // cancelado pela clínica => CONFLICT
    const [c] = await ordered(s, "apt-2".replace("apt-2", "apt-1"), [{ name: "Outro" }]).then((all) => all.slice(-1));
    await s.cancel(DOCTOR, "apt-1", c?.id ?? "", CTX);
    expect(await codeOf(s.linker.link({}, { ...input, orderId: c?.id ?? "", examinationId: "ex-9", actor: SELF }, CTX))).toBe("CONFLICT");
  });

  it("fulfil e release: SCHEDULED -> FULFILLED -> (apagado) ORDERED; cancelado fica CANCELLED; sem ligação não faz nada", async () => {
    const s = setup();
    const [a, b] = await ordered(s, "apt-1", [{ name: "Hemograma" }, { name: "Glicemia" }]);
    await s.linker.link({}, { actor: SELF, familyId: FAMILY, memberId: MEMBER, orderId: a?.id ?? "", examinationId: "ex-a", examClinicId: CLINIC_A, status: "SCHEDULED" }, CTX);
    await s.linker.fulfil({}, "ex-a");
    expect(s.ordersRepo.orders.get(a?.id ?? "")?.status).toBe("FULFILLED");
    await s.linker.release({}, "ex-a");
    expect(s.ordersRepo.orders.get(a?.id ?? "")).toMatchObject({ status: "ORDERED", bookedHere: false });
    await s.linker.release({}, "ex-a"); // idempotente
    await s.linker.fulfil({}, "ex-desconhecido");
    expect(s.ordersRepo.orders.get(b?.id ?? "")?.status).toBe("ORDERED");
  });
});

describe("lado família (UC-CLN-42, BR-CLN-53, authorization.md §6.7)", () => {
  it("SELF e TUTOR_OF leem; DEPENDENT_SELF/OTHER => FORBIDDEN (mesmo com SharingGrant); desconhecido => NOT_FOUND; exclui CANCELLED por omissão", async () => {
    const s = setup();
    const [a] = await ordered(s, "apt-1", [{ name: "Hemograma", note: "Jejum" }, { name: "Glicemia" }]);
    await s.cancel(DOCTOR, "apt-1", a?.id ?? "", CTX);
    for (const actor of [SELF, TUTOR]) {
      const items = await s.familyList(actor, FAMILY, MEMBER);
      expect(items.map((o) => o.name)).toEqual(["Glicemia"]);
      expect(items[0]).toMatchObject({ appointmentId: "apt-1", clinicId: CLINIC_A, clinicName: "Clínica Sol", status: "ORDERED", examinationId: null });
    }
    expect((await s.familyList(SELF, FAMILY, MEMBER, { status: "CANCELLED" })).map((o) => o.name)).toEqual(["Hemograma"]);
    expect(await s.familyList(SELF, FAMILY, MEMBER, { appointmentId: "outra" })).toEqual([]);
    for (const actor of [OTHER, DEP]) expect(await codeOf(s.familyList(actor, FAMILY, MEMBER))).toBe("FORBIDDEN");
    expect(await codeOf(s.familyList({ userId: "estranho", platformAdmin: false }, FAMILY, MEMBER))).toBe("NOT_FOUND");
  });

  it("a visão da família não expõe conta autora nem ids Vita da ponte além do pedido", async () => {
    const s = setup();
    await ordered(s);
    const [item] = await s.familyList(SELF, FAMILY, MEMBER);
    expect(Object.keys(item ?? {}).sort()).toEqual(["appointmentId", "clinicId", "clinicName", "examinationId", "id", "name", "note", "orderedAt", "status", "urgent"]);
  });

  it("visita manual não aparece na família; examOrderCount só conta consultas Vita não canceladas", async () => {
    const s = setup();
    await ordered(s, "visit-1");
    expect(await s.familyList(SELF, FAMILY, MEMBER)).toEqual([]);
    const created = await ordered(s, "apt-1", [{ name: "A" }, { name: "B" }]);
    expect((await s.appointmentCounts({}, ["apt-1", "visit-1"])).get("apt-1")).toBe(2);
    await s.cancel(DOCTOR, "apt-1", created[0]?.id ?? "", CTX);
    expect((await s.appointmentCounts({}, ["apt-1"])).get("apt-1")).toBe(1);
    expect((await s.counts({}, CLINIC_A, ["apt-1", "visit-1"])).get("visit-1")).toBe(1);
    expect((await s.counts({}, CLINIC_B, ["apt-1"])).size).toBe(0);
  });
});

describe("isolamento entre clínicas", () => {
  it("a clínica B não lê nem cancela os pedidos da A, nem os vê no PDF; os pedidos de B não aparecem em A", async () => {
    const s = setup();
    const [order] = await ordered(s);
    await s.create(DOCTOR_B, "apt-b", { items: [{ name: "Raio-X" }] }, CTX);
    expect(await codeOf(s.list(MANAGER_B, "apt-1", CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.cancel(DOCTOR_B, "apt-1", order?.id ?? "", CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.cancel(DOCTOR_B, "apt-b", order?.id ?? "", CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.pdf(MANAGER_B, "apt-1", CTX))).toBe("NOT_FOUND");
    expect((await s.list(MANAGER, "apt-1", CTX)).map((o) => o.name)).toEqual([SECRET]);
  });
});

describe("declaração de presença (UC-CLN-43, BR-CLN-55)", () => {
  it("COMPLETED ou SCHEDULED com chegada: Admin, Gestor e Médico (suas) emitem; auditoria sem dados pessoais; nada se guarda", async () => {
    const s = setup();
    for (const [actor, id] of [[ADMIN, "apt-done"], [MANAGER, "apt-arrived"], [DOCTOR, "apt-arrived"]] as const) {
      const pdf = await s.statement(actor, id, false, CTX);
      expect(pdf.filename).toBe("declaracao-20261108.pdf");
    }
    const events = s.audit.events.filter((e) => e.action === "ATTENDANCE_STATEMENT_ISSUED");
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ actorType: "CLINIC_ACCOUNT", actorClinicId: CLINIC_A, resourceType: "Appointment", resourceId: "apt-done", metadata: { bookingKind: "APPOINTMENT", includeProfessional: false } });
    expect(JSON.stringify(events)).not.toContain("Maria");
    expect(s.ordersRepo.orders.size).toBe(0);
  });

  it("visita manual elegível (COMPLETED); SCHEDULED sem chegada, NO_SHOW, CANCELLED, REQUESTED => INVALID_STATE_TRANSITION", async () => {
    const s = setup();
    s.bookings.seed("VISIT", "visit-done", CLINIC_A, { slotId: "slot-1", status: "COMPLETED" });
    expect((await s.statement(MANAGER, "visit-done", false, CTX)).bytes.length).toBeGreaterThan(0);
    expect(s.audit.events.at(-1)).toMatchObject({ resourceType: "ClinicVisit", metadata: { bookingKind: "VISIT" } });
    for (const id of ["apt-1", "visit-1", "apt-noshow", "apt-cancelled", "apt-requested"]) expect(await codeOf(s.statement(MANAGER, id, false, CTX))).toBe("INVALID_STATE_TRANSITION");
  });

  it("outra clínica/Médico de outro profissional => NOT_FOUND", async () => {
    const s = setup();
    expect(await codeOf(s.statement(MANAGER_B, "apt-done", false, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.statement(OTHER_DOCTOR, "apt-done", false, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.statement(MANAGER, "nope", false, CTX))).toBe("NOT_FOUND");
  });

  it("o profissional só aparece com includeProfessional=true; nunca especialidade", async () => {
    const s = setup();
    await s.statement(MANAGER, "apt-done", false, CTX);
    expect(JSON.stringify(s.pdf_renderer_last().blocks)).not.toContain("Profissional");
    await s.statement(MANAGER, "apt-done", true, CTX);
    const text = JSON.stringify(s.pdf_renderer_last().blocks);
    expect(text).toContain("Profissional: Dr. João Costa");
    expect(text).not.toContain("Medicina Geral");
    expect(s.audit.events.at(-1)).toMatchObject({ metadata: { includeProfessional: true } });
  });
});
