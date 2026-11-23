/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- corpos JSON de respostas HTTP e protótipo do cliente `pg` lidos de forma dinâmica nos testes */
// Auditoria e canário de logs do Resumo de saúde (M17) com PostgreSQL real: TC-RPT-12 (REPORT_VIEW `kind=HEALTH_SUMMARY` só ao ver outro titular;
// conteúdo ausente de logs), AC-RPT-09; audit.md §2 (metadata sem dados de saúde, nunca o período), §3 (HEALTH_VIEW por leituras de outro titular),
// privacy.md/conventions.md §3.7 (nenhum dado de saúde em logs, erros ou auditoria).
import request from "supertest";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START, startSummaryHarness, type SummaryHarness, type SummaryUser } from "../support/health-summary-harness.js";

let s: SummaryHarness;
const LOGS: string[] = [];
let tick = 0;
beforeAll(async () => {
  s = await startSummaryHarness({ logStream: LOGS });
}, 300_000);
afterAll(async () => {
  await s.stop();
});
beforeEach(() => {
  s.h.clock.set(new Date(START.getTime() + ++tick * 120_000));
});

const bearer = (u: SummaryUser) => ({ Authorization: `Bearer ${u.token}` });
const PERIOD = "?from=2026-10-01&to=2026-11-16";
const member = (u: SummaryUser, fam: string, m: string, query = PERIOD) => request(s.h.app).get(`${API}/families/${fam}/members/${m}/health-summary${query}`).set(bearer(u));
const family = (u: SummaryUser, fam: string, query = PERIOD) => request(s.h.app).get(`${API}/families/${fam}/health-summary${query}`).set(bearer(u));
const auditOf = (actor: string) => s.h.pool.query("SELECT * FROM audit_logs WHERE actor_user_id = $1 ORDER BY id", [actor]).then((r) => r.rows);

// Valores ÚNICOS em cada campo de texto livre de saúde/identificação. A resposta só pode devolver (por contrato) o nome do medicamento e o do parâmetro.
const C = {
  member: "CAN-NOME-MEMBRO-7q1",
  family: "CAN-NOME-FAMILIA-7q2",
  plan: "CAN-MEDICAMENTO-7q3",
  planNotes: "CAN-NOTAS-PLANO-7q4",
  doctor: "CAN-MEDICO-7q5",
  rxNotes: "CAN-NOTAS-RECEITA-7q6",
  apptReason: "CAN-MOTIVO-CONSULTA-7q7",
  apptNotes: "CAN-NOTAS-CONSULTA-7q8",
  apptClinic: "CAN-CLINICA-7q9",
  exam: "CAN-NOME-EXAME-7r1",
  examNotes: "CAN-NOTAS-EXAME-7r2",
  param: "CAN-PARAMETRO-7r3",
  text: "CAN-VALOR-TEXTO-7r4",
  unit: "CAN-UNIDADE-7r5",
  doc: "CAN-FICHEIRO-7r6",
  email: "canario-email",
  query: "CAN-QUERY-7r7",
};
/** O que o contrato devolve de propósito ao pedinte autorizado. */
const LEGIT_IN_BODY = [C.plan, C.param, C.unit, C.member];

let owner: SummaryUser; // titular dos dados
let viewer: SummaryUser; // outro membro com partilha total
let fam: string;
let mOwner: string;
let mViewer: string;

beforeAll(async () => {
  s.h.clock.set(START);
  owner = await s.user(C.email);
  viewer = await s.user("leitor");
  fam = await s.family(C.family);
  mOwner = await s.member(fam, { userId: owner.id, role: "FAMILY_ADMIN", name: C.member, bloodType: "A_POS" });
  mViewer = await s.member(fam, { userId: viewer.id, role: "FAMILY_MEMBER", name: "Leitor" });
  for (const category of ["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"]) await s.grant(fam, mOwner, mViewer, category);
  const plan = await s.plan({ familyId: fam, memberId: mOwner, name: C.plan, startAt: new Date("2026-09-01T00:00:00Z") });
  await s.h.pool.query("UPDATE medication_plans SET notes = $2, dosage = $3 WHERE id = $1", [plan, C.planNotes, C.doc]);
  await s.doses(plan, fam, mOwner, [
    { at: "2026-10-10T07:00:00Z", status: "TAKEN" },
    { at: "2026-10-11T07:00:00Z", status: "UNCONFIRMED" },
  ]);
  const rx = await s.prescription({ familyId: fam, memberId: mOwner, issuedOn: "2026-10-02" });
  await s.h.pool.query("UPDATE prescriptions SET doctor_name = $2, notes = $3 WHERE id = $1", [rx, C.doctor, C.rxNotes]);
  const appt = await s.appointment({ familyId: fam, memberId: mOwner, scheduledAt: "2026-10-20T09:00:00Z", status: "SCHEDULED", reason: C.apptReason });
  await s.h.pool.query("UPDATE appointments SET notes = $2, clinic_name = $3, professional_name = $4 WHERE id = $1", [appt, C.apptNotes, C.apptClinic, C.doctor]);
  const exam = await s.exam({ familyId: fam, memberId: mOwner, examDate: "2026-10-15", name: C.exam, results: [{ parameter: C.param, value: 5, unit: C.unit }, { parameter: "Texto", text: C.text }] });
  await s.h.pool.query("UPDATE examinations SET notes = $2 WHERE id = $1", [exam, C.examNotes]);
  await s.alert({ recipientUserId: viewer.id, familyId: fam, memberId: mOwner, type: "EXAM_REMINDER", triggerAt: "2026-10-14T08:00:00Z" });
}, 120_000);

// ---------------------------------------------------------------------------------------------------------------------------------
describe("Auditoria do Resumo de saúde contra audit_logs real (TC-RPT-12, AC-RPT-09, audit.md)", () => {
  it("ver outro titular grava UM `REPORT_VIEW` (resourceType=HealthSummary, kind=HEALTH_SUMMARY) sem dados de saúde nem período, na família e membro certos", async () => {
    const res = await member(viewer, fam, mOwner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = (await auditOf(viewer.id)).filter((r) => r.action === "REPORT_VIEW");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      actor_type: "USER",
      actor_user_id: viewer.id,
      action: "REPORT_VIEW",
      resource_type: "HealthSummary",
      resource_id: mOwner,
      family_id: fam,
      subject_member_id: mOwner,
      result: "SUCCESS",
    });
    expect(typeof row.request_id).toBe("string");
    expect(row.request_id).toBe(res.headers["x-request-id"]);
    // `metadata` só tem `kind`: nada de período, contagens, valores, nomes ou secções.
    expect(row.metadata).toEqual({ kind: "HEALTH_SUMMARY" });
  });

  it("ver o próprio Resumo não grava REPORT_VIEW nem leituras de saúde (titular adulto)", async () => {
    const before = (await auditOf(owner.id)).length;
    const res = await member(owner, fam, mOwner);
    expect(res.status).toBe(200);
    const after = await auditOf(owner.id);
    expect(after.length).toBe(before);
    expect(after.filter((r) => r.action === "REPORT_VIEW" || r.action === "HEALTH_VIEW")).toEqual([]);
  });

  it("as leituras de saúde de outro titular geram `HEALTH_VIEW` (um evento por leitura, sujeito = o membro), sem metadata de saúde", async () => {
    await s.h.pool.query("DELETE FROM audit_logs WHERE actor_user_id = $1", [viewer.id]);
    const res = await member(viewer, fam, mOwner);
    expect(res.status).toBe(200);
    const rows = await auditOf(viewer.id);
    const health = rows.filter((r) => r.action === "HEALTH_VIEW");
    expect(health.length).toBeGreaterThan(0);
    expect(new Set(health.map((r) => r.resource_type))).toEqual(new Set(["BloodType", "Prescription", "MedicationPlan", "DoseOccurrence", "Appointment", "Examination"]));
    for (const row of health) {
      expect(row).toMatchObject({ actor_user_id: viewer.id, family_id: fam, subject_member_id: mOwner, result: "SUCCESS" });
      expect(row.request_id).toBe(res.headers["x-request-id"]);
      expect(row.metadata ?? {}).toEqual({});
    }
    // Todos os eventos do pedido são de leitura (nenhuma escrita, nenhum ACCESS_DENIED indevido).
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(["HEALTH_VIEW", "REPORT_VIEW"]));
  });

  it("pedidos sem leitura (404, 422, 429) não gravam REPORT_VIEW", async () => {
    await s.h.pool.query("DELETE FROM audit_logs WHERE actor_user_id = $1", [viewer.id]);
    expect((await member(viewer, fam, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await member(viewer, fam, mOwner, "?from=2026-02-01&to=2026-01-01")).status).toBe(422);
    expect((await auditOf(viewer.id)).filter((r) => r.action === "REPORT_VIEW")).toEqual([]);
  });

  it("vista da família: um REPORT_VIEW por OUTRO titular visível (nunca pelo próprio), com o mesmo metadata mínimo", async () => {
    await s.h.pool.query("DELETE FROM audit_logs WHERE actor_user_id IN ($1, $2)", [viewer.id, owner.id]);
    const asViewer = await family(viewer, fam);
    expect(asViewer.status, JSON.stringify(asViewer.body)).toBe(200);
    const rows = (await auditOf(viewer.id)).filter((r) => r.action === "REPORT_VIEW");
    expect(rows.map((r) => r.subject_member_id)).toEqual([mOwner]);
    expect(rows[0].metadata).toEqual({ kind: "HEALTH_SUMMARY" });
    expect(rows[0]).toMatchObject({ resource_type: "HealthSummary", resource_id: mOwner, family_id: fam });
    // O titular vê a família: só o próprio bloco (o leitor não lhe partilhou nada) => nada auditado.
    const asOwner = await family(owner, fam);
    expect(asOwner.status).toBe(200);
    expect((await auditOf(owner.id)).filter((r) => r.action === "REPORT_VIEW")).toEqual([]);
  });

  it("nenhuma coluna de audit_logs contém dados de saúde (canário em todas as linhas e colunas, `metadata` incluída)", async () => {
    await member(viewer, fam, mOwner);
    await family(viewer, fam);
    const all = await s.h.pool.query("SELECT row_to_json(a)::text AS row FROM audit_logs a");
    expect(all.rows.length).toBeGreaterThan(0);
    const text = all.rows.map((r) => r.row as string).join("\n");
    for (const [label, value] of Object.entries(C)) {
      if (label === "email") continue; // o e-mail do titular só existe em `users`
      expect(text, label).not.toContain(value);
    }
    expect(text).not.toContain("2026-10-01"); // o período nunca é auditado
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("Canário de logs e respostas (conventions.md §3.7, BR-RPT-18): nenhum dado de saúde em logs nem em erros", () => {
  const logsText = () => LOGS.join("\n");

  it("respostas 200 só levam o que o contrato define (nome do medicamento e do parâmetro) — nunca notas, médicos, motivos, nomes de exame/ficheiro", async () => {
    const res = await member(viewer, fam, mOwner);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    for (const [label, value] of Object.entries(C)) {
      if (LEGIT_IN_BODY.includes(value)) continue;
      expect(text, `corpo do membro leva ${label}`).not.toContain(value);
    }
    expect(text).toContain(C.plan);
    expect(text).toContain(C.param);
    const fam200 = await family(viewer, fam);
    const famText = JSON.stringify(fam200.body);
    for (const [label, value] of Object.entries(C)) {
      if (value === C.member || value === C.plan) continue; // `displayName` e nome do medicamento são do contrato
      if (label === "param" || label === "unit") continue;
      expect(famText, `corpo da família leva ${label}`).not.toContain(value);
    }
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("erros 4xx (404, 422, 429, 401, 423) não ecoam dados de saúde, nomes, ids nem a query string", async () => {
    const bodies: string[] = [];
    const record = (r: request.Response) => bodies.push(r.text);
    record(await member(viewer, fam, "00000000-0000-4000-8000-000000000000"));
    record(await member(viewer, fam, mOwner, `?from=${C.query}&to=${C.query}`));
    record(await member(viewer, fam, mOwner, "?from=2026-02-01&to=2026-01-01"));
    record(await request(s.h.app).get(`${API}/families/${fam}/members/${mOwner}/health-summary?from=${C.query}`));
    const outsider = await s.user("fora");
    record(await member(outsider, fam, mOwner));
    // 429: gasta o orçamento de um utilizador dedicado.
    const burner = await s.user("burner");
    const bf = await s.family(C.family);
    const bm = await s.member(bf, { userId: burner.id, role: "FAMILY_ADMIN", name: C.member });
    let last: request.Response | undefined;
    for (let i = 0; i < 31; i++) last = await member(burner, bf, bm);
    expect(last?.status).toBe(429);
    if (last) record(last);
    const text = bodies.join("\n");
    for (const value of Object.values(C)) expect(text).not.toContain(value);
    for (const id of [fam, mOwner, owner.id, viewer.id]) expect(text).not.toContain(id);
  });

  it("falha interna (erro do driver com `detail`/`where`/`parameters` com valores de linhas) => 500 genérico e logs redigidos", async () => {
    const proto = pg.Client.prototype as any;
    const original = proto.query;
    let injected = 0;
    proto.query = function patched(this: unknown, ...args: any[]) {
      const first = args[0];
      const text: string = typeof first === "string" ? first : (first?.text ?? "");
      if (/from "examinations"/i.test(text) && injected++ < 1) {
        const error: any = new Error("insert or update on table \"x\" violates foreign key constraint");
        error.code = "23503";
        error.detail = `Key (value)=(${C.text}) conflicts ${C.doctor}`;
        error.where = `PL/pgSQL ${C.rxNotes} ${C.exam}`;
        error.parameters = [C.apptNotes, C.examNotes];
        error.hint = C.param;
        error.internalQuery = `SELECT '${C.unit}'`;
        return Promise.reject(error as Error);
      }
      return original.apply(this, args);
    };
    let res: request.Response;
    try {
      res = await member(viewer, fam, mOwner);
    } finally {
      proto.query = original;
    }
    expect(injected).toBeGreaterThan(0);
    expect(res.status).toBe(500);
    expect(res.text).not.toMatch(/CAN-/);
    // O erro foi mesmo registado (e sem valores de linhas).
    expect(logsText()).toMatch(/unhandled_error|"level":50/);
  });

  it("logs técnicos (nível debug, TODOS os pedidos deste ficheiro): nenhum valor de saúde, nome, e-mail, query string ou id de membro", () => {
    const text = logsText();
    expect(text.length).toBeGreaterThan(0);
    for (const [label, value] of Object.entries(C)) expect(text, `logs levam ${label}`).not.toContain(value);
    // Nem a query string do pedido nem os parâmetros de período.
    expect(text).not.toContain("from=");
    expect(text).not.toContain("2026-10-01");
    // Nem o Authorization (token) nem cookies.
    expect(text).not.toMatch(/Bearer\s|eyJ[A-Za-z0-9_-]{10,}/);
  });
});
