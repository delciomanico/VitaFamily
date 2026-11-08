// AC-CLN-25..29 / TC-CLN-17..20 (regras de aplicação sobre fakes): emissão "um toque", numeração por clínica, imutabilidade/
// anulação, retrato, ligação ao paciente só com consentimento, Financeiro (total do período, anulados não somam), lado família.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createReceiptInsurerSummariesUseCase, createLockVisibleReceiptsUseCase } from "./claim-lookup.js";
import { createGetFamilyReceiptUseCase, createListFamilyReceiptsUseCase } from "./family-receipts.js";
import { createClinicReceiptsFixtures } from "./fixtures.js";
import { createIssueReceiptUseCase } from "./issue-receipt.js";
import { createGetReceiptUseCase, createListReceiptsUseCase } from "./list-receipts.js";
import type { ClinicPortalActor } from "./ports.js";
import { createVoidReceiptUseCase } from "./void-receipt.js";

const NOW = new Date("2026-11-08T10:00:00Z");
const CTX = { requestId: "req-1" };
const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";
const ADMIN: ClinicPortalActor = { clinicAccountId: "admin-a", clinicId: CLINIC_A, role: "CLINIC_ADMIN" };
const MANAGER: ClinicPortalActor = { ...ADMIN, clinicAccountId: "manager-a", role: "CLINIC_MANAGER" };
const DOCTOR: ClinicPortalActor = { ...ADMIN, clinicAccountId: "doctor-a", role: "CLINIC_DOCTOR" };
const ADMIN_B: ClinicPortalActor = { clinicAccountId: "admin-b", clinicId: CLINIC_B, role: "CLINIC_ADMIN" };

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
  const f = createClinicReceiptsFixtures(clock);
  f.services.services.set("svc-1", { id: "svc-1", clinicId: CLINIC_A, name: "Consulta de Cardiologia", priceMinor: 1_500_000 });
  f.services.services.set("svc-free", { id: "svc-free", clinicId: CLINIC_A, name: "Sem preço", priceMinor: null });
  f.services.services.set("svc-b", { id: "svc-b", clinicId: CLINIC_B, name: "Outra clínica", priceMinor: 5 });
  f.bookings.seed("APPOINTMENT", "apt-1", CLINIC_A, { status: "COMPLETED", patientName: "Maria Silva", serviceTypeId: "svc-1", vita: { familyId: "fam-1", memberId: "mem-1" } });
  f.bookings.seed("APPOINTMENT", "apt-2", CLINIC_A, { status: "COMPLETED", patientName: "João Pires", serviceTypeId: "svc-1", vita: { familyId: "fam-1", memberId: "mem-2" } });
  f.bookings.seed("APPOINTMENT", "apt-open", CLINIC_A, { status: "SCHEDULED", patientName: "Ana", serviceTypeId: "svc-1" });
  f.bookings.seed("APPOINTMENT", "apt-noservice", CLINIC_A, { status: "COMPLETED", patientName: "Rui" });
  f.bookings.seed("VISIT", "visit-1", CLINIC_A, { status: "COMPLETED", patientName: "Zé Manual", serviceTypeId: "svc-1" });
  f.bookings.seed("EXAM", "exam-1", CLINIC_A, { status: "COMPLETED", patientName: "Maria Silva", vita: { familyId: "fam-1", memberId: "mem-1" } });
  return { ...f, clock, issue: createIssueReceiptUseCase(f.deps), voidReceipt: createVoidReceiptUseCase(f.deps), list: createListReceiptsUseCase(f.deps), get: createGetReceiptUseCase(f.deps) };
}

describe("emitir recibo (UC-CLN-25, BR-CLN-31/32/34)", () => {
  it("um toque: linha do serviço do horário pré-preenchida, número R-000001, retrato e aviso fixo", async () => {
    const s = setup();
    const receipt = await s.issue(MANAGER, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX);
    expect(receipt).toMatchObject({ number: 1, status: "ISSUED", currency: "AOA", totalMinor: 1_500_000, patientName: "Maria Silva", notice: "Documento não fiscal — não substitui fatura", availableToPatient: false });
    expect(receipt.lines).toEqual([{ position: 1, description: "Consulta de Cardiologia", amountMinor: 1_500_000, serviceTypeId: "svc-1" }]);
    expect(receipt.issuer).toMatchObject({ name: "Clínica Sol" });
  });

  it("numeração por clínica, sem repetições nem buracos; outra clínica começa em 1", async () => {
    const s = setup();
    s.bookings.seed("APPOINTMENT", "apt-b", CLINIC_B, { status: "COMPLETED", patientName: "B", serviceTypeId: "svc-b" });
    s.services.services.set("svc-b", { id: "svc-b", clinicId: CLINIC_B, name: "S", priceMinor: 10 });
    const a1 = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CARD" }, CTX);
    const a2 = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-2", paymentMethod: "CARD" }, CTX);
    const b1 = await s.issue(ADMIN_B, { bookingKind: "APPOINTMENT", bookingId: "apt-b", paymentMethod: "CARD" }, CTX);
    expect([a1.number, a2.number, b1.number]).toEqual([1, 2, 1]);
  });

  it("linhas ajustadas e livres somam no servidor; nota guardada", async () => {
    const s = setup();
    const receipt = await s.issue(ADMIN, { bookingKind: "VISIT", bookingId: "visit-1", paymentMethod: "TRANSFER", note: "Pago", lines: [{ serviceTypeId: "svc-1", amountMinor: 1000 }, { description: "Material", amountMinor: 250 }] }, CTX);
    expect(receipt.totalMinor).toBe(1250);
    expect(receipt.note).toBe("Pago");
  });

  it.each([
    ["marcação não concluída", { bookingKind: "APPOINTMENT", bookingId: "apt-open", paymentMethod: "CASH" }, "INVALID_STATE_TRANSITION"],
    ["marcação inexistente", { bookingKind: "APPOINTMENT", bookingId: "nao-existe", paymentMethod: "CASH" }, "NOT_FOUND"],
    ["tipo errado do mesmo id", { bookingKind: "EXAM", bookingId: "apt-1", paymentMethod: "CASH" }, "NOT_FOUND"],
    ["sem serviço no horário e sem linhas", { bookingKind: "APPOINTMENT", bookingId: "apt-noservice", paymentMethod: "CASH" }, "VALIDATION_ERROR"],
    ["linha de catálogo sem preço", { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH", lines: [{ serviceTypeId: "svc-free" }] }, "VALIDATION_ERROR"],
    ["total 0", { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH", lines: [{ description: "x", amountMinor: 0 }] }, "VALIDATION_ERROR"],
    ["serviço de outra clínica", { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH", lines: [{ serviceTypeId: "svc-b" }] }, "NOT_FOUND"],
    ["método de pagamento inválido", { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "BITCOIN" }, "VALIDATION_ERROR"],
  ])("%s", async (_name, body, code) => {
    const s = setup();
    expect(await codeOf(s.issue(ADMIN, body, CTX))).toBe(code);
    expect(s.receiptsRepo.counters.get(CLINIC_A) ?? 0).toBe(0);
  });

  it("marcação de outra clínica => NOT_FOUND; Médico => FORBIDDEN", async () => {
    const s = setup();
    expect(await codeOf(s.issue(ADMIN_B, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.issue(DOCTOR, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX))).toBe("FORBIDDEN");
  });

  it("segundo recibo ISSUED da mesma marcação => CONFLICT; depois de anulado pode emitir-se outro (número novo)", async () => {
    const s = setup();
    const first = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX);
    expect(await codeOf(s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX))).toBe("CONFLICT");
    await s.voidReceipt(ADMIN, first.id, { reason: "Valor errado" }, CTX);
    const second = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX);
    expect(second.number).toBe(2);
  });
});

describe("ligação ao paciente (BR-CLN-35)", () => {
  it("marcação Vita com consentimento => ligado; sem consentimento e visita manual => só a clínica", async () => {
    const s = setup();
    s.consents.consents.add(`${CLINIC_A}:mem-1`);
    const withConsent = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX);
    const without = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-2", paymentMethod: "CASH" }, CTX);
    const visit = await s.issue(ADMIN, { bookingKind: "VISIT", bookingId: "visit-1", paymentMethod: "CASH" }, CTX);
    expect([withConsent.availableToPatient, without.availableToPatient, visit.availableToPatient]).toEqual([true, false, false]);
    expect([...s.receiptsRepo.links.keys()]).toEqual([withConsent.id]);
  });

  it("consentimento dado depois da emissão nunca liga retroativamente", async () => {
    const s = setup();
    const receipt = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX);
    s.consents.consents.add(`${CLINIC_A}:mem-1`);
    expect((await s.get(ADMIN, receipt.id)).availableToPatient).toBe(false);
  });
});

describe("anular recibo (UC-CLN-26, BR-CLN-33)", () => {
  it("ISSUED -> VOIDED com motivo interno; repetir => INVALID_STATE_TRANSITION; motivo curto => 422; outra clínica => 404; Médico => 403", async () => {
    const s = setup();
    const receipt = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX);
    expect(await codeOf(s.voidReceipt(ADMIN, receipt.id, { reason: "ab" }, CTX))).toBe("VALIDATION_ERROR");
    expect(await codeOf(s.voidReceipt(ADMIN_B, receipt.id, { reason: "Motivo válido" }, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.voidReceipt(DOCTOR, receipt.id, { reason: "Motivo válido" }, CTX))).toBe("FORBIDDEN");
    const voided = await s.voidReceipt(MANAGER, receipt.id, { reason: "Motivo válido" }, CTX);
    expect(voided).toMatchObject({ status: "VOIDED", number: 1, voidReason: "Motivo válido", totalMinor: 1_500_000 });
    expect(await codeOf(s.voidReceipt(ADMIN, receipt.id, { reason: "Outra vez" }, CTX))).toBe("INVALID_STATE_TRANSITION");
  });

  it("imutável: as linhas e o total mantêm-se após anular", async () => {
    const s = setup();
    const receipt = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX);
    const voided = await s.voidReceipt(ADMIN, receipt.id, { reason: "Motivo válido" }, CTX);
    expect({ lines: voided.lines, total: voided.totalMinor, issuer: voided.issuer, patientName: voided.patientName }).toEqual({ lines: receipt.lines, total: receipt.totalMinor, issuer: receipt.issuer, patientName: receipt.patientName });
  });
});

describe("auditoria sem PII (audit.md §3)", () => {
  it("CLINIC_RECEIPT_ISSUE/VOID só com tipo, método, nº de linhas e flag; nunca nome, descrições, valores nem motivo", async () => {
    const s = setup();
    const receipt = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH", note: "NOTA-SECRETA" }, CTX);
    await s.voidReceipt(ADMIN, receipt.id, { reason: "MOTIVO-SECRETO" }, CTX);
    expect(s.audit.events.map((e) => e.action)).toEqual(["CLINIC_RECEIPT_ISSUE", "CLINIC_RECEIPT_VOID"]);
    expect(s.audit.events[0]?.metadata).toEqual({ bookingKind: "APPOINTMENT", paymentMethod: "CASH", lineCount: 1, linkedToPatient: false });
    const dump = JSON.stringify(s.audit.events);
    for (const secret of ["Maria", "Silva", "Cardiologia", "1500000", "NOTA-SECRETA", "MOTIVO-SECRETO", "fam-1", "mem-1"]) expect(dump).not.toContain(secret);
    expect(s.audit.events.every((e) => e.actorType === "CLINIC_ACCOUNT" && e.familyId === undefined && e.subjectMemberId === undefined && e.actorClinicId === CLINIC_A)).toBe(true);
  });
});

describe("Financeiro (UC-CLN-27, BR-CLN-37)", () => {
  it("lista por período com total do período INTEIRO; anulados não somam; filtro de estado; cursor", async () => {
    const s = setup();
    const r1 = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX);
    s.clock.advance(60_000);
    await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-2", paymentMethod: "CARD", lines: [{ description: "X", amountMinor: 500 }] }, CTX);
    s.clock.advance(60_000);
    await s.issue(ADMIN, { bookingKind: "VISIT", bookingId: "visit-1", paymentMethod: "CASH", lines: [{ description: "Y", amountMinor: 700 }] }, CTX);
    await s.voidReceipt(ADMIN, r1.id, { reason: "Motivo válido" }, CTX);

    const page = await s.list(MANAGER, { from: "2026-11-08", to: "2026-11-08", limit: "2" });
    expect(page.summary).toEqual({ issuedCount: 2, issuedTotalMinor: 1200, voidedCount: 1, currency: "AOA" });
    expect(page.items.map((r) => r.number)).toEqual([3, 2]);
    expect(page.nextCursor).not.toBeNull();
    const next = await s.list(MANAGER, { from: "2026-11-08", to: "2026-11-08", limit: "2", ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });
    expect(next.items.map((r) => r.number)).toEqual([1]);
    expect((await s.list(MANAGER, { from: "2026-11-08", to: "2026-11-08", status: "VOIDED" })).items.map((r) => r.number)).toEqual([1]);
    expect((await s.list(MANAGER, { from: "2026-11-09", to: "2026-11-09" })).summary.issuedCount).toBe(0);
  });

  it.each([
    [{ from: "2026-11-08" }, "to em falta"],
    [{ from: "2026-11-09", to: "2026-11-08" }, "to < from"],
    [{ from: "2025-01-01", to: "2026-11-08" }, "> 366 dias"],
    [{ from: "x", to: "y" }, "datas inválidas"],
    [{ from: "2026-11-08", to: "2026-11-08", status: "OTHER" }, "estado inválido"],
  ])("janela/filtro inválido %j (%s) => VALIDATION_ERROR", async (query) => {
    const s = setup();
    expect(await codeOf(s.list(ADMIN, query))).toBe("VALIDATION_ERROR");
  });

  it("Médico => FORBIDDEN; outra clínica não vê recibos (404 no detalhe); 61.º pedido/min => RATE_LIMITED", async () => {
    const s = setup();
    const receipt = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX);
    expect(await codeOf(s.list(DOCTOR, { from: "2026-11-08", to: "2026-11-08" }))).toBe("FORBIDDEN");
    expect(await codeOf(s.get(DOCTOR, receipt.id))).toBe("FORBIDDEN");
    expect(await codeOf(s.get(ADMIN_B, receipt.id))).toBe("NOT_FOUND");
    expect((await s.list(ADMIN_B, { from: "2026-11-08", to: "2026-11-08" })).items).toEqual([]);
    let last: string | undefined;
    for (let i = 0; i < 61; i++) last = await codeOf(s.list(MANAGER, { from: "2026-11-08", to: "2026-11-08" }));
    expect(last).toBe("RATE_LIMITED");
  });
});

describe("lado família (UC-CLN-28, BR-CLN-35, authorization.md §6.5)", () => {
  async function linked() {
    const s = setup();
    s.consents.consents.add(`${CLINIC_A}:mem-1`);
    const receipt = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX);
    s.policy.relations.set("u-self:mem-1", "SELF");
    s.policy.relations.set("u-other:mem-1", "OTHER");
    s.policy.relations.set("u-dep:mem-1", "DEPENDENT_SELF");
    s.policy.relations.set("u-tutor:mem-1", "TUTOR_OF");
    return { s, receipt };
  }
  const actor = (userId: string) => ({ userId, platformAdmin: false });

  it("SELF e TUTOR_OF veem; OTHER e DEPENDENT_SELF => FORBIDDEN; estranho => NOT_FOUND", async () => {
    const { s, receipt } = await linked();
    const list = createListFamilyReceiptsUseCase(s.deps);
    const get = createGetFamilyReceiptUseCase(s.deps);
    expect((await list(actor("u-self"), "fam-1", "mem-1", {})).items.map((r) => r.id)).toEqual([receipt.id]);
    expect((await get(actor("u-tutor"), "fam-1", "mem-1", receipt.id)).number).toBe(1);
    expect(await codeOf(list(actor("u-other"), "fam-1", "mem-1", {}))).toBe("FORBIDDEN");
    expect(await codeOf(get(actor("u-dep"), "fam-1", "mem-1", receipt.id))).toBe("FORBIDDEN");
    expect(await codeOf(list(actor("u-stranger"), "fam-1", "mem-1", {}))).toBe("NOT_FOUND");
  });

  it("cópia do paciente sem motivo da anulação nem ids da clínica/conta; mostra 'Anulado' e sobrevive à revogação do consentimento", async () => {
    const { s, receipt } = await linked();
    await s.voidReceipt(ADMIN, receipt.id, { reason: "MOTIVO-INTERNO" }, CTX);
    s.consents.consents.clear(); // revogação: a ligação sobrevive (comprovativo recebido)
    s.attachedClaims.byReceipt.set(receipt.id, ["claim-1"]);
    const view = await createGetFamilyReceiptUseCase(s.deps)(actor("u-self"), "fam-1", "mem-1", receipt.id);
    expect(view).toMatchObject({ status: "VOIDED", clinicName: "Clínica Sol", attachedToClaimIds: ["claim-1"], notice: "Documento não fiscal — não substitui fatura" });
    const dump = JSON.stringify(view);
    for (const forbidden of ["MOTIVO-INTERNO", "voidReason", "clinicId", "clinic-a", "admin-a", "issuedBy"]) expect(dump).not.toContain(forbidden);
  });

  it("recibo de outro membro/família => NOT_FOUND", async () => {
    const { s, receipt } = await linked();
    s.policy.relations.set("u-self:mem-9", "SELF");
    expect(await codeOf(createGetFamilyReceiptUseCase(s.deps)(actor("u-self"), "fam-1", "mem-9", receipt.id))).toBe("NOT_FOUND");
  });
});

describe("leitura para pedidos de reembolso (BR-CLN-36)", () => {
  it("só devolve recibos visíveis ao membro e o resumo mínimo para a seguradora", async () => {
    const s = setup();
    s.consents.consents.add(`${CLINIC_A}:mem-1`);
    const visible = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-1", paymentMethod: "CASH" }, CTX);
    const hidden = await s.issue(ADMIN, { bookingKind: "APPOINTMENT", bookingId: "apt-2", paymentMethod: "CASH" }, CTX);
    const locked = await createLockVisibleReceiptsUseCase(s.deps)(undefined as never, "fam-1", "mem-1", [visible.id, hidden.id]);
    expect(locked.map((r) => r.id)).toEqual([visible.id]);
    const [summary] = await createReceiptInsurerSummariesUseCase(s.deps)(undefined as never, [visible.id]);
    expect(Object.keys(summary ?? {}).sort()).toEqual(["clinicName", "currency", "id", "issuedAt", "lines", "number", "status", "totalMinor"]);
  });
});
