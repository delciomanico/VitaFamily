/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/restrict-plus-operands, @typescript-eslint/restrict-template-expressions -- corpos JSON de respostas HTTP e protótipo do cliente `pg` lidos de forma dinâmica nos testes */
// Resumo de saúde (M17) ponta a ponta contra PostgreSQL real: HTTP -> casos de uso -> repositórios reais, com dados semeados e verificação numérica
// exata do contrato (BR-RPT-11..17). TC-RPT-05 (período), TC-RPT-06 (adesão, fusos), TC-RPT-07 (séries de exames), TC-RPT-08 (sem juízo),
// TC-RPT-10 e TC-RPT-11 (contagens e completude, «I»); AC-RPT-04, AC-RPT-05, AC-RPT-06, AC-RPT-08. Mais `alerts.summarizeForMember` (BR-RPT-15).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KyselyAlertsRepository } from "../../src/modules/alerts/infrastructure/repo.js";
import { withTransaction } from "../../src/platform/db/index.js";
import { API, START, startSummaryHarness, type SummaryHarness, type SummaryUser } from "../support/health-summary-harness.js";
import { installQueryRecorder } from "../support/query-recorder.js";

let s: SummaryHarness;
const recorder = installQueryRecorder();
beforeAll(async () => {
  s = await startSummaryHarness();
}, 300_000);
afterAll(async () => {
  await s.stop();
});

const get = (user: SummaryUser, path: string) => request(s.h.app).get(`${API}${path}`).set("Authorization", `Bearer ${user.token}`);
const summary = (user: SummaryUser, fam: string, member: string, query = "") => get(user, `/families/${fam}/members/${member}/health-summary${query}`);
const at = (iso: string) => new Date(iso);

// ---------------------------------------------------------------------------------------------------------------------------------
describe("alerts.summarizeForMember contra a base real (BR-RPT-15, TC-RPT-10)", () => {
  let u1: SummaryUser;
  let u2: SummaryUser;
  let fam: string;
  let other: string;
  let m1: string;
  let m2: string;
  let dep: string;
  let otherM1: string;
  const repo = new KyselyAlertsRepository();
  const summarize = (userId: string, f: string, m: string, from: string, to: string) => withTransaction(s.h.db, (trx) => repo.summarizeForMember(trx, userId, f, m, at(from), at(to)));

  beforeAll(async () => {
    u1 = await s.user("alerts-u1");
    u2 = await s.user("alerts-u2");
    fam = await s.family();
    m1 = await s.member(fam, { userId: u1.id, role: "FAMILY_ADMIN", name: "Titular" });
    m2 = await s.member(fam, { userId: u2.id, role: "FAMILY_MEMBER", name: "Outro" });
    dep = await s.member(fam, { dependent: true, guardians: [m1], name: "Filho" });
    other = await s.family("Outra");
    otherM1 = await s.member(other, { userId: u1.id, role: "FAMILY_ADMIN", name: "Titular noutra família" });
    const a = (recipientUserId: string, familyId: string, memberId: string, type: string, triggerAt: string, read = false) => s.alert({ recipientUserId, familyId, memberId, type, triggerAt, read });
    // U1 sobre M1, dentro de [2026-10-01T00:00Z, 2026-11-01T00:00Z): 6 alertas, 4 por ler.
    await a(u1.id, fam, m1, "MEDICATION_DUE", "2026-10-02T08:00:00Z");
    await a(u1.id, fam, m1, "MEDICATION_DUE", "2026-10-03T08:00:00Z");
    await a(u1.id, fam, m1, "MEDICATION_DUE", "2026-10-04T08:00:00Z", true);
    await a(u1.id, fam, m1, "EXAM_REMINDER", "2026-10-10T08:00:00Z");
    await a(u1.id, fam, m1, "EXAM_REMINDER", "2026-10-11T08:00:00Z");
    await a(u1.id, fam, m1, "APPOINTMENT_REMINDER", "2026-10-12T08:00:00Z", true);
    // Fronteiras: `from` inclusivo, `to` exclusivo; fora do intervalo não conta.
    await a(u1.id, fam, m1, "EXAM_REMINDER", "2026-10-01T00:00:00Z");
    await a(u1.id, fam, m1, "EXAM_REMINDER", "2026-11-01T00:00:00Z");
    await a(u1.id, fam, m1, "EXAM_REMINDER", "2026-09-30T23:59:59Z");
    // Outro destinatário sobre o MESMO membro: nunca conta para U1 (só alertas do próprio pedinte).
    for (let i = 0; i < 5; i++) await a(u2.id, fam, m1, "MEDICATION_DUE", `2026-10-2${String(i)}T08:00:00Z`);
    // U1 sobre outro membro da mesma família: não conta para M1.
    await a(u1.id, fam, dep, "MEDICATION_DUE", "2026-10-05T08:00:00Z");
    await a(u1.id, fam, dep, "MEDICATION_DUE", "2026-10-06T08:00:00Z");
    // U1 noutra família: não conta para a primeira.
    await a(u1.id, other, otherM1, "MEDICATION_DUE", "2026-10-07T08:00:00Z");
  }, 120_000);

  it("conta total, por ler e por tipo só do próprio pedinte e do membro pedido; `from` inclusivo, `to` exclusivo", async () => {
    // Intervalo [2026-10-01T00:00Z, 2026-11-01T00:00Z): os 6 do meio + o de 10-01T00:00Z (inclusivo) = 7; o de 11-01T00:00Z (exclusivo) fica de fora.
    const result = await summarize(u1.id, fam, m1, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");
    expect(result).toEqual({ total: 7, unread: 5, byType: { MEDICATION_DUE: 3, EXAM_REMINDER: 3, APPOINTMENT_REMINDER: 1 } });
  });

  it("outro destinatário vê só os seus; o dependente e a outra família não se misturam", async () => {
    expect(await summarize(u2.id, fam, m1, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")).toEqual({ total: 5, unread: 5, byType: { MEDICATION_DUE: 5 } });
    expect(await summarize(u1.id, fam, dep, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")).toEqual({ total: 2, unread: 2, byType: { MEDICATION_DUE: 2 } });
    expect(await summarize(u1.id, other, otherM1, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")).toEqual({ total: 1, unread: 1, byType: { MEDICATION_DUE: 1 } });
    // Identificadores cruzados (membro de uma família com a outra) não devolvem nada.
    expect(await summarize(u1.id, other, m1, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")).toEqual({ total: 0, unread: 0, byType: {} });
    expect(await summarize(u1.id, fam, otherM1, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")).toEqual({ total: 0, unread: 0, byType: {} });
    expect(await summarize(randomUUID(), fam, m1, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")).toEqual({ total: 0, unread: 0, byType: {} });
  });

  it("a porta pública converte o período local do membro em instantes (fuso do membro, ADR-010)", async () => {
    // Titular em Africa/Luanda (UTC+1): 2026-10-01..2026-10-31 local = [2026-09-30T23:00Z, 2026-10-31T23:00Z). O alerta de 09-30T23:59:59Z entra; o de 11-01T00:00Z não.
    const result = await s.alerts.reads.memberAlertsSummary(u1.id, fam, m1, { from: "2026-10-01", to: "2026-10-31" });
    expect(result).toEqual({ total: 8, unread: 6, byType: { MEDICATION_DUE: 3, EXAM_REMINDER: 4, APPOINTMENT_REMINDER: 1 } });
  });

  it("a consulta usa um índice de `alerts` (sem varrimento sequencial) com a tabela povoada", async () => {
    await s.h.pool.query(
      `INSERT INTO alerts (recipient_user_id, family_id, member_id, type, source_type, source_id, rule_key, dedupe_key, trigger_at)
       SELECT $1, $2, $3, 'MEDICATION_DUE', 'DOSE', gen_random_uuid(), 'bulk', 'bulk-' || g, timestamptz '2025-01-01' + g * interval '10 minutes'
       FROM generate_series(1, 30000) g`,
      [u2.id, fam, m2],
    );
    await s.h.pool.query("ANALYZE alerts");
    recorder.reset();
    await summarize(u1.id, fam, m1, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");
    const select = recorder.statements().find((q) => /from "alerts"/i.test(q.text) && q.text.includes('"trigger_at"'));
    expect(select).toBeDefined();
    const plan = await s.h.pool.query<{ "QUERY PLAN": unknown }>(`EXPLAIN (FORMAT JSON) ${select?.text ?? ""}`, select?.values ?? []);
    const text = JSON.stringify(plan.rows[0]?.["QUERY PLAN"]);
    expect(text).toMatch(/Index|Bitmap/);
    expect(text).not.toContain("Seq Scan");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("Resumo de saúde com dados reais: números exatos (período 2026-10-01..2026-11-16, hoje 2026-11-16 em Luanda)", () => {
  let u: SummaryUser;
  let fam: string;
  let m: string;
  let body: any;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    s.h.clock.set(START);
    u = await s.user("dados");
    fam = await s.family();
    m = await s.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: "Titular" });

    // --- Medicação (AC-RPT-05): 6 tomadas, 2 não tomadas, 2 por confirmar, 4 futuras (hoje depois das 10:00Z).
    const planA = await s.plan({ familyId: fam, memberId: m, name: "Plano A", startAt: at("2026-09-01T00:00:00Z") });
    ids.planA = planA;
    await s.doses(planA, fam, m, [
      { at: "2026-10-06T07:00:00Z", status: "TAKEN" },
      { at: "2026-10-07T07:00:00Z", status: "TAKEN" },
      { at: "2026-10-13T07:00:00Z", status: "TAKEN" },
      { at: "2026-10-14T07:00:00Z", status: "NOT_TAKEN" },
      { at: "2026-10-15T07:00:00Z", status: "TAKEN" },
      { at: "2026-10-20T07:00:00Z", status: "TAKEN" },
      { at: "2026-10-21T07:00:00Z", status: "NOT_TAKEN" },
      { at: "2026-11-03T07:00:00Z", status: "TAKEN" },
      { at: "2026-11-10T07:00:00Z", status: "UNCONFIRMED" },
      { at: "2026-11-12T07:00:00Z", status: "UNCONFIRMED" },
      { at: "2026-11-16T12:00:00Z", status: "PENDING" },
      { at: "2026-11-16T14:00:00Z", status: "PENDING" },
      { at: "2026-11-16T16:00:00Z", status: "PENDING" },
      { at: "2026-11-16T18:00:00Z", status: "PENDING" },
      // Fora do período: não conta em lado nenhum.
      { at: "2026-09-20T07:00:00Z", status: "NOT_TAKEN" },
    ]);
    // Plano só com tomas futuras: aparece em `byMedication` com `adherencePct = null` (nunca 0 %).
    const planB = await s.plan({ familyId: fam, memberId: m, name: "Plano B", startAt: at("2026-11-01T00:00:00Z") });
    ids.planB = planB;
    await s.doses(planB, fam, m, [
      { at: "2026-11-16T15:00:00Z", status: "PENDING" },
      { at: "2026-11-16T17:00:00Z", status: "PENDING" },
    ]);
    // Plano sem tomas no período: não aparece.
    await s.plan({ familyId: fam, memberId: m, name: "Plano C", startAt: at("2026-09-01T00:00:00Z") });

    // --- Receitas (AC-RPT-08): ativas 4 (2 a terminar em 14 dias, a de fronteira incluída), 2 fechadas no período.
    const rx1 = await s.prescription({ familyId: fam, memberId: m, issuedOn: "2026-10-02" });
    await s.plan({ familyId: fam, memberId: m, name: "Rx1", prescriptionId: rx1, startAt: at("2026-10-02T00:00:00Z"), endAt: at("2026-11-25T10:00:00Z") });
    const rx2 = await s.prescription({ familyId: fam, memberId: m, issuedOn: "2026-09-01" });
    await s.plan({ familyId: fam, memberId: m, name: "Rx2 contínuo", prescriptionId: rx2, startAt: at("2026-09-01T00:00:00Z") });
    await s.rxDocument(fam, m, rx2);
    const rx3 = await s.prescription({ familyId: fam, memberId: m, issuedOn: "2026-10-05" });
    await s.plan({ familyId: fam, memberId: m, name: "Rx3 fronteira", prescriptionId: rx3, startAt: at("2026-10-05T00:00:00Z"), endAt: at("2026-11-30T12:00:00Z") });
    const rx4 = await s.prescription({ familyId: fam, memberId: m, issuedOn: "2026-09-20" });
    await s.plan({ familyId: fam, memberId: m, name: "Rx4 longe", prescriptionId: rx4, startAt: at("2026-09-20T00:00:00Z"), endAt: at("2026-12-01T10:00:00Z") });
    await s.prescription({ familyId: fam, memberId: m, issuedOn: "2026-10-10", status: "COMPLETED" });
    await s.prescription({ familyId: fam, memberId: m, issuedOn: "2026-11-02", status: "CANCELLED" });
    await s.prescription({ familyId: fam, memberId: m, issuedOn: "2026-08-01", status: "COMPLETED" });
    ids.rx1 = rx1;
    ids.rx3 = rx3;
    ids.rx4 = rx4;

    // --- Consultas.
    await s.appointment({ familyId: fam, memberId: m, scheduledAt: "2026-10-10T09:00:00Z", status: "COMPLETED" });
    await s.appointment({ familyId: fam, memberId: m, scheduledAt: "2026-10-15T09:00:00Z", status: "NO_SHOW" });
    await s.appointment({ familyId: fam, memberId: m, scheduledAt: "2026-11-03T09:00:00Z", status: "CANCELLED" });
    ids.apptOpen = await s.appointment({ familyId: fam, memberId: m, scheduledAt: "2026-11-05T09:00:00Z", status: "SCHEDULED" });
    await s.appointment({ familyId: fam, memberId: m, scheduledAt: "2026-11-20T09:00:00Z", status: "SCHEDULED" });
    await s.appointment({ familyId: fam, memberId: m, scheduledAt: "2026-12-30T09:00:00Z", status: "SCHEDULED" });
    await s.appointment({ familyId: fam, memberId: m, scheduledAt: "2026-09-15T09:00:00Z", status: "COMPLETED" });

    // --- Exames com séries (AC-RPT-06): Glicose 100, 130, 120 mg/dL (grafias diferentes do nome), mmol/L à parte, texto fora.
    await s.exam({
      familyId: fam,
      memberId: m,
      examDate: "2026-10-05",
      results: [
        { parameter: "Glicose", value: 100, unit: "mg/dL", referenceMin: 70, referenceMax: 99 },
        { parameter: "Hemoglobina", value: 14, unit: "g/dL" },
        { parameter: "Colesterol", text: "elevado" },
        { parameter: "Zero", value: 0, unit: "u" },
      ],
    });
    await s.exam({ familyId: fam, memberId: m, examDate: "2026-10-20", results: [{ parameter: "  glicose ", value: 130, unit: "mg/dL", referenceMin: 70, referenceMax: 99 }, { parameter: "Glicose", value: 7.2, unit: "mmol/L" }] });
    await s.exam({ familyId: fam, memberId: m, examDate: "2026-11-10", results: [{ parameter: "GLICOSE ", value: 120, unit: " mg/dL ", referenceMin: 70, referenceMax: 99 }, { parameter: "Zero", value: 5, unit: "u" }] });
    ids.noResults = await s.exam({ familyId: fam, memberId: m, examDate: "2026-10-25" });
    const withDoc = await s.exam({ familyId: fam, memberId: m, examDate: "2026-10-28" });
    await s.examDocument(fam, m, withDoc);
    ids.examOpen = await s.exam({ familyId: fam, memberId: m, examDate: "2026-11-01", status: "SCHEDULED" });
    await s.exam({ familyId: fam, memberId: m, examDate: "2026-11-30", status: "SCHEDULED" });
    await s.exam({ familyId: fam, memberId: m, examDate: "2026-12-20", status: "SCHEDULED" });
    await s.exam({ familyId: fam, memberId: m, examDate: "2026-09-15", status: "CANCELLED" });

    // --- Alertas do próprio titular sobre si.
    await s.alert({ recipientUserId: u.id, familyId: fam, memberId: m, type: "MEDICATION_DUE", triggerAt: "2026-10-05T08:00:00Z" });
    await s.alert({ recipientUserId: u.id, familyId: fam, memberId: m, type: "MEDICATION_DUE", triggerAt: "2026-10-06T08:00:00Z", read: true });
    await s.alert({ recipientUserId: u.id, familyId: fam, memberId: m, type: "EXAM_REMINDER", triggerAt: "2026-11-09T08:00:00Z" });

    const res = await summary(u, fam, m, "?from=2026-10-01&to=2026-11-16");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    body = res.body;
  }, 180_000);

  it("AC-RPT-04/TC-RPT-05: período devolvido, `generatedAt` do relógio e secções presentes", () => {
    expect(body.memberId).toBe(m);
    expect(body.period).toEqual({ from: "2026-10-01", to: "2026-11-16" });
    expect(body.generatedAt).toBe("2026-11-16T10:00:00.000Z");
    expect(Object.keys(body).sort()).toEqual(["alerts", "appointments", "exams", "generatedAt", "medication", "memberId", "missing", "period", "prescriptions"]);
  });

  it("AC-RPT-05/TC-RPT-06: 6 tomadas, 2 não tomadas, 2 por confirmar, 4 futuras => 60 % e `pending = 4` fora do cálculo", () => {
    expect(body.medication.overall).toEqual({ periodStart: "2026-10-01", taken: 6, notTaken: 2, unconfirmed: 2, adherencePct: 60 });
    const byMed = body.medication.byMedication as any[];
    expect(byMed.map((x) => x.medicationName).sort()).toEqual(["Plano A", "Plano B"]);
    expect(byMed.find((x) => x.planId === ids.planA)).toEqual({ planId: ids.planA, medicationName: "Plano A", taken: 6, notTaken: 2, unconfirmed: 2, pending: 4, adherencePct: 60 });
    // Só tomas futuras: denominador 0 => null, nunca 0.
    expect(byMed.find((x) => x.planId === ids.planB)).toEqual({ planId: ids.planB, medicationName: "Plano B", taken: 0, notTaken: 0, unconfirmed: 0, pending: 2, adherencePct: null });
  });

  it("TC-RPT-06: série semanal (47 dias <= 90) por semana civil, tomas futuras fora, `null` sem tomas e 0 % sem tomadas", () => {
    expect(body.medication.granularity).toBe("WEEK");
    expect(body.medication.series).toEqual([
      { periodStart: "2026-09-28", taken: 0, notTaken: 0, unconfirmed: 0, adherencePct: null },
      { periodStart: "2026-10-05", taken: 2, notTaken: 0, unconfirmed: 0, adherencePct: 100 },
      { periodStart: "2026-10-12", taken: 2, notTaken: 1, unconfirmed: 0, adherencePct: 67 },
      { periodStart: "2026-10-19", taken: 1, notTaken: 1, unconfirmed: 0, adherencePct: 50 },
      { periodStart: "2026-10-26", taken: 0, notTaken: 0, unconfirmed: 0, adherencePct: null },
      { periodStart: "2026-11-02", taken: 1, notTaken: 0, unconfirmed: 0, adherencePct: 100 },
      { periodStart: "2026-11-09", taken: 0, notTaken: 0, unconfirmed: 2, adherencePct: 0 },
      { periodStart: "2026-11-16", taken: 0, notTaken: 0, unconfirmed: 0, adherencePct: null },
    ]);
    const sum = (key: "taken" | "notTaken" | "unconfirmed") => (body.medication.series as any[]).reduce((n, b) => n + b[key], 0);
    expect([sum("taken"), sum("notTaken"), sum("unconfirmed")]).toEqual([6, 2, 2]);
  });

  it("AC-RPT-06/TC-RPT-07: série da Glicose (100, 130, 120 mg/dL) e unidades/nomes agrupados sem conversão; texto fora", () => {
    const series = body.exams.series as any[];
    const glucose = series.find((x) => x.parameter.trim().toLowerCase() === "glicose" && x.unit === "mg/dL");
    expect(glucose).toEqual({
      parameter: "GLICOSE",
      unit: "mg/dL",
      count: 3,
      min: 100,
      max: 130,
      first: 100,
      last: 120,
      variationAbs: 20,
      variationPct: 20,
      referenceMin: 70,
      referenceMax: 99,
      points: [
        { date: "2026-10-05", value: 100 },
        { date: "2026-10-20", value: 130 },
        { date: "2026-11-10", value: 120 },
      ],
      truncated: false,
    });
    // mmol/L é outra série (nunca se converte); 1 ponto => variações nulas; sem referência => null.
    expect(series.find((x) => x.unit === "mmol/L")).toMatchObject({ count: 1, first: 7.2, last: 7.2, variationAbs: null, variationPct: null, referenceMin: null, referenceMax: null });
    // `first = 0` => variationPct nulo mas a variação absoluta existe.
    expect(series.find((x) => x.parameter === "Zero")).toMatchObject({ count: 2, first: 0, last: 5, variationAbs: 5, variationPct: null });
    // O parâmetro só de texto não gera série; ordem: medição mais recente primeiro, depois nome.
    expect(series.map((x) => `${x.parameter}|${x.unit}`)).toEqual(["GLICOSE|mg/dL", "Zero|u", "Glicose|mmol/L", "Hemoglobina|g/dL"]);
    expect(body.exams.truncated).toBe(false);
  });

  it("TC-RPT-08: nenhum campo de juízo/rótulo; valor acima da referência não é assinalado", () => {
    expect(JSON.stringify(body)).not.toMatch(/outOfRange|abnormal|flag|\bhigh\b|\blow\b|"normal"/i);
  });

  it("AC-RPT-08/TC-RPT-10: receitas ativas, a terminar em 14 dias (fronteira inclusiva) e fechadas no período", () => {
    expect(body.prescriptions).toEqual({ active: 4, endingSoon: 2, closedInPeriod: 2 });
  });

  it("TC-RPT-10: consultas e exames por estado e por mês (só no período) e próximos 30 dias", () => {
    expect(body.appointments).toEqual({
      byStatus: { COMPLETED: 1, NO_SHOW: 1, CANCELLED: 1, SCHEDULED: 1 },
      byMonth: [
        { month: "2026-10", count: 2 },
        { month: "2026-11", count: 2 },
      ],
      upcoming30d: 1,
    });
    expect(body.exams.byStatus).toEqual({ COMPLETED: 5, SCHEDULED: 1 });
    expect(body.exams.byMonth).toEqual([
      { month: "2026-10", count: 4 },
      { month: "2026-11", count: 2 },
    ]);
    // SCHEDULED a 30 dias: 2026-11-30 (dentro de 30 d), 2026-12-20 (fora: > 12-16); o passado (11-01) não conta.
    expect(body.exams.upcoming30d).toBe(1);
  });

  it("TC-RPT-10: alertas do próprio pedinte, só contagens e tipos (sem texto)", () => {
    expect(body.alerts).toEqual({ total: 3, unread: 2, byType: { MEDICATION_DUE: 2, EXAM_REMINDER: 1 } });
  });

  it("AC-RPT-08/TC-RPT-11: «o que falta registar» — códigos, contagens, `sourceIds` só a quem escreve; nunca sugere consultas/exames", () => {
    const missing = body.missing as { code: string; count: number; sourceIds?: string[] }[];
    const byCode = Object.fromEntries(missing.map((x) => [x.code, x]));
    expect(Object.keys(byCode).sort()).toEqual(["APPOINTMENT_PAST_OPEN", "BLOOD_TYPE_UNSET", "DOSES_UNCONFIRMED", "EXAM_PAST_OPEN", "EXAM_WITHOUT_RESULTS", "PRESCRIPTION_WITHOUT_DOCUMENT"]);
    expect(byCode.BLOOD_TYPE_UNSET).toEqual({ code: "BLOOD_TYPE_UNSET", count: 1 });
    expect(byCode.APPOINTMENT_PAST_OPEN).toEqual({ code: "APPOINTMENT_PAST_OPEN", count: 1, sourceIds: [ids.apptOpen] });
    expect(byCode.EXAM_PAST_OPEN).toEqual({ code: "EXAM_PAST_OPEN", count: 1, sourceIds: [ids.examOpen] });
    expect(byCode.EXAM_WITHOUT_RESULTS).toEqual({ code: "EXAM_WITHOUT_RESULTS", count: 1, sourceIds: [ids.noResults] });
    // 4 receitas ativas da família; a Rx2 tem documento => 3 sem documento.
    expect(byCode.PRESCRIPTION_WITHOUT_DOCUMENT?.count).toBe(3);
    expect([...(byCode.PRESCRIPTION_WITHOUT_DOCUMENT?.sourceIds ?? [])].sort()).toEqual([ids.rx1, ids.rx3, ids.rx4].sort());
    expect(byCode.DOSES_UNCONFIRMED?.count).toBe(2);
    expect(byCode.DOSES_UNCONFIRMED?.sourceIds).toHaveLength(2);
    // Nada que sugira consultas, exames ou tratamentos: só os códigos de completude do contrato.
    expect(JSON.stringify(missing)).not.toMatch(/ROUTINE|CHECKUP|SUGGEST|RECOMMEND/i);
  });

  it("UC-RPT-05b/BR-RPT-16: bloco da família com adesão, medicamentos ativos, próximos 30 dias, completude e atividade", async () => {
    const res = await get(u, `/families/${fam}/health-summary?from=2026-10-01&to=2026-11-16`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.period).toEqual({ from: "2026-10-01", to: "2026-11-16" });
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0]).toEqual({
      memberId: m,
      displayName: "Titular",
      adherencePct: 60,
      // Planos ACTIVE: A, B, C, Rx1..Rx4.
      activeMedications: 7,
      // Consultas SCHEDULED a 30 dias (11-20) + exames SCHEDULED a 30 dias (11-30).
      upcoming30d: 2,
      // 1 (tipo sanguíneo) + 1 + 1 + 1 + 3 + 2.
      missingCount: 9,
      activity: { prescriptions: 4, appointments: 4, exams: 6, dosesConfirmed: 6, lastActivityOn: "2026-11-10" },
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("Resumo de saúde: período omitido, validação e truncagem (TC-RPT-05, TC-RPT-07)", () => {
  let u: SummaryUser;
  let fam: string;
  let m: string;

  beforeAll(async () => {
    s.h.clock.set(START);
    u = await s.user("truncagem");
    fam = await s.family();
    m = await s.member(fam, { userId: u.id, role: "FAMILY_ADMIN", bloodType: "A_POS" });
    // 25 parâmetros (1 medição cada, datas distintas) + um parâmetro com 120 medições em 120 dias.
    const exam = await s.exam({ familyId: fam, memberId: m, examDate: "2026-11-01" });
    await s.h.pool.query(
      `INSERT INTO exam_results (examination_id, parameter, value_numeric, unit, created_at)
       SELECT $1, 'P' || lpad(g::text, 2, '0'), g, 'u', date_trunc('milliseconds', now()) FROM generate_series(1, 25) g`,
      [exam],
    );
    await s.h.pool.query(
      // `created_at` com precisão de ms, como o gravam os repositórios (relógio da aplicação): o cursor de paginação é de ms.
      `INSERT INTO examinations (id, family_id, member_id, name, exam_date, status, created_at)
       SELECT gen_random_uuid(), $1, $2, 'Seq', (date '2026-07-01' + g), 'COMPLETED', date_trunc('milliseconds', now()) FROM generate_series(1, 120) g`,
      [fam, m],
    );
    await s.h.pool.query(
      `INSERT INTO exam_results (examination_id, parameter, value_numeric, unit)
       SELECT e.id, 'Seq', (e.exam_date - date '2026-07-01'), 'u' FROM examinations e WHERE e.member_id = $1 AND e.name = 'Seq'`,
      [m],
    );
  }, 120_000);

  it("AC-RPT-04/TC-RPT-05: sem `from`/`to` => últimos 12 meses até hoje (Luanda); resposta privada", async () => {
    const res = await summary(u, fam, m);
    expect(res.status).toBe(200);
    expect(res.body.period).toEqual({ from: "2025-11-16", to: "2026-11-16" });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    // MONTH acima de 90 dias: 13 meses civis de 2025-11 a 2026-11.
    expect(res.body.medication.granularity).toBe("MONTH");
    expect(res.body.medication.series).toHaveLength(13);
    expect(res.body.medication.series[0].periodStart).toBe("2025-11-01");
    expect(res.body.medication.series.at(-1).periodStart).toBe("2026-11-01");
  });

  it("AC-RPT-04/TC-RPT-05: 90 dias => semanal; 91 dias => mensal (fronteira)", async () => {
    const week = await summary(u, fam, m, "?from=2026-08-18&to=2026-11-15");
    expect(week.body.medication.granularity).toBe("WEEK");
    const month = await summary(u, fam, m, "?from=2026-08-17&to=2026-11-15");
    expect(month.body.medication.granularity).toBe("MONTH");
  });

  it.each([
    ["from > to", "?from=2026-02-01&to=2026-01-01"],
    ["mais de 5 anos", "?from=2021-11-15&to=2026-11-16"],
  ])("AC-RPT-04: %s => 422 VALIDATION_ERROR; exatamente 5 anos é aceite", async (_label, query) => {
    const res = await summary(u, fam, m, query);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    const edge = await summary(u, fam, m, "?from=2021-11-16&to=2026-11-16");
    expect(edge.status).toBe(200);
  });

  it("TC-RPT-07: corta a 20 séries (as mais recentes) com `truncated = true` e a 100 pontos por série mantendo os mais recentes", async () => {
    const res = await summary(u, fam, m, "?from=2026-06-01&to=2026-11-16");
    expect(res.status).toBe(200);
    const series = res.body.exams.series as any[];
    expect(series).toHaveLength(20);
    expect(res.body.exams.truncated).toBe(true);
    // Medição mais recente primeiro: as P01..P25 de 2026-11-01 e a «Seq» (até 2026-10-29) ficam pelo corte -> 20 das P.. mais recentes (ordem por nome).
    expect(series.every((x) => x.parameter.startsWith("P"))).toBe(true);
    expect(series.map((x) => x.parameter)).toEqual(Array.from({ length: 20 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`));
    // A série «Seq» de 120 pontos aparece quando a janela deixa de ter as P..: período 2026-07-01..2026-10-31.
    const only = await summary(u, fam, m, "?from=2026-07-01&to=2026-10-31");
    const seq = (only.body.exams.series as any[]).find((x) => x.parameter === "Seq");
    expect(seq).toBeDefined();
    expect(seq.count).toBe(120);
    expect(seq.points).toHaveLength(100);
    expect(seq.truncated).toBe(true);
    expect(seq.points[0]).toEqual({ date: "2026-07-22", value: 21 });
    expect(seq.points.at(-1)).toEqual({ date: "2026-10-29", value: 120 });
    // Estatísticas calculadas sobre TODOS os valores, não só os 100 mostrados.
    expect(seq).toMatchObject({ min: 1, max: 120, first: 1, last: 120, variationAbs: 119, variationPct: 11900 });
    expect(only.body.exams.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("Resumo de saúde: fusos horários e fronteira de dia (TC-RPT-06, ADR-010)", () => {
  it("o período por omissão acompanha o dia local do membro (Auckland já é dia 17, Luanda ainda 16)", async () => {
    s.h.clock.set(new Date("2026-11-16T12:00:00Z"));
    const auckland = await s.user("auckland", { timezone: "Pacific/Auckland" });
    const luanda = await s.user("luanda", { timezone: "Africa/Luanda" });
    const honolulu = await s.user("honolulu", { timezone: "Pacific/Honolulu" });
    const results: Record<string, string> = {};
    for (const [name, user] of [["Pacific/Auckland", auckland], ["Africa/Luanda", luanda], ["Pacific/Honolulu", honolulu]] as const) {
      const fam = await s.family();
      const m = await s.member(fam, { userId: user.id, role: "FAMILY_ADMIN" });
      const res = await summary(user, fam, m);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      results[name] = res.body.period.to;
      // Vista da família: o período usa o fuso do próprio pedinte.
      const family = await get(user, `/families/${fam}/health-summary`);
      expect(family.body.period.to).toBe(res.body.period.to);
    }
    expect(results).toEqual({ "Pacific/Auckland": "2026-11-17", "Africa/Luanda": "2026-11-16", "Pacific/Honolulu": "2026-11-16" });
    s.h.clock.set(START);
  });

  it("fronteira de dia (início): toma às 00:30 locais (23:30Z) do 1.º dia entra e a das 23:59 locais da véspera não; total, por medicamento e série concordam", async () => {
    s.h.clock.set(START);
    const u = await s.user("fronteira-inicio", { timezone: "Africa/Luanda" });
    const fam = await s.family();
    const m = await s.member(fam, { userId: u.id, role: "FAMILY_ADMIN" });
    const plan = await s.plan({ familyId: fam, memberId: m, name: "Início", startAt: at("2026-10-01T00:00:00Z") });
    await s.doses(plan, fam, m, [
      { at: "2026-10-31T22:59:00Z", status: "TAKEN" }, // 10-31 23:59 local: fora
      { at: "2026-10-31T23:30:00Z", status: "TAKEN" }, // 11-01 00:30 local: DENTRO (1.º dia)
      { at: "2026-11-08T23:30:00Z", status: "NOT_TAKEN" }, // domingo em UTC mas segunda 11-09 00:30 local: semana 11-09
    ]);
    const res = await summary(u, fam, m, "?from=2026-11-01&to=2026-11-10");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.medication.series.map((b: any) => [b.periodStart, b.taken, b.notTaken])).toEqual([
      ["2026-10-26", 1, 0],
      ["2026-11-02", 0, 0],
      ["2026-11-09", 0, 1],
    ]);
    // O total e o por medicamento têm de usar o MESMO período local (BR-RPT-12/13).
    expect(res.body.medication.overall).toMatchObject({ taken: 1, notTaken: 1, unconfirmed: 0, adherencePct: 50 });
    expect(res.body.medication.byMedication[0]).toMatchObject({ taken: 1, notTaken: 1, pending: 0, adherencePct: 50 });
  });

  it("fronteira de dia (fim): toma às 00:00 locais (23:00Z) do dia seguinte ao `to` fica de fora do total e do por medicamento", async () => {
    s.h.clock.set(START);
    const u = await s.user("fronteira-fim", { timezone: "Africa/Luanda" });
    const fam = await s.family();
    const m = await s.member(fam, { userId: u.id, role: "FAMILY_ADMIN" });
    const plan = await s.plan({ familyId: fam, memberId: m, name: "Fim", startAt: at("2026-10-01T00:00:00Z") });
    await s.doses(plan, fam, m, [
      { at: "2026-11-10T22:59:00Z", status: "TAKEN" }, // 11-10 23:59 local: DENTRO (último dia)
      { at: "2026-11-10T23:00:00Z", status: "TAKEN" }, // 11-11 00:00 local: fora
    ]);
    const res = await summary(u, fam, m, "?from=2026-11-01&to=2026-11-10");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.medication.series.reduce((n: number, b: any) => n + b.taken, 0)).toBe(1);
    expect(res.body.medication.overall).toMatchObject({ taken: 1, adherencePct: 100 });
    expect(res.body.medication.byMedication[0]).toMatchObject({ taken: 1, pending: 0 });
  });
});
