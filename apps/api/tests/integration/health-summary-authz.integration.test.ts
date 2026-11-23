/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Matriz de autorização e IDOR do Resumo de saúde (M17) com dados reais em PostgreSQL: TC-RPT-09, TC-RPT-12 (limite 30/min), AC-RPT-07, AC-RPT-08
// (`sourceIds` só a quem escreve), AC-RPT-09; authorization.md §3/§4 (BR-RPT-01/16/17/18). Relações: SELF, TUTOR_OF, DEPENDENT_SELF, OTHER com e sem
// partilha por categoria (e o Family Admin como OTHER); família alheia, membro inexistente, membro bloqueado e removido, Platform Admin e tokens cruzados.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START, startSummaryHarness, type SummaryHarness, type SummaryUser } from "../support/health-summary-harness.js";

let s: SummaryHarness;
let tick = 0;
beforeAll(async () => {
  // Sem validação de RESPOSTAS (a validação já corre em health-summary-data): o contrato não descreve o 423 MEMBER_BLOCKED destas operações e o validador
  // transformaria essa resposta real num 500 do próprio teste.
  s = await startSummaryHarness({ validateResponses: false });
}, 300_000);
afterAll(async () => {
  await s.stop();
});
// Cada teste corre numa janela de 1 minuto própria: o limite de 30/min por utilizador não interfere entre testes.
beforeEach(() => {
  s.h.clock.set(new Date(START.getTime() + ++tick * 120_000));
});

const SECTIONS = ["medication", "prescriptions", "exams", "appointments"];
const sectionsOf = (body: Record<string, unknown>): string[] => SECTIONS.filter((k) => k in body);
const withToken = (token: string) => ({ Authorization: `Bearer ${token}` });
const memberUrl = (fam: string, m: string, query = "?from=2026-10-01&to=2026-11-16") => `${API}/families/${fam}/members/${m}/health-summary${query}`;
const getMember = (u: SummaryUser, fam: string, m: string, query?: string) => request(s.h.app).get(memberUrl(fam, m, query)).set(withToken(u.token));
const getFamily = (u: SummaryUser, fam: string, query = "?from=2026-10-01&to=2026-11-16") => request(s.h.app).get(`${API}/families/${fam}/health-summary${query}`).set(withToken(u.token));
/** Corpo de erro sem o que muda de pedido para pedido. */
const stable = (body: any) => JSON.stringify({ ...body, requestId: undefined });

// ---------------------------------------------------------------------------------------------------------------------------------
interface World {
  fam: string;
  other: string;
  uA: SummaryUser; // Family Admin
  uB: SummaryUser; // membro comum
  uC: SummaryUser; // membro comum, tutor de MD e ME
  uE: SummaryUser; // dependente com conta
  uX: SummaryUser; // outra família
  uR: SummaryUser; // sairá da família
  mA: string;
  mB: string;
  mC: string;
  mD: string; // dependente sem conta (tutor C)
  mE: string; // dependente com conta (tutor C)
  mK: string; // bloqueado (tutor C)
  mR: string;
  mX: string;
}
let w: World;

/** Dados nas 4 categorias de saúde de um membro, com um exemplo de cada item de completude que depende de escrita. */
async function seedAll(fam: string, m: string, recipient?: string): Promise<void> {
  const plan = await s.plan({ familyId: fam, memberId: m, name: "Med", startAt: new Date("2026-09-01T00:00:00Z") });
  await s.doses(plan, fam, m, [
    { at: "2026-10-10T07:00:00Z", status: "TAKEN" },
    { at: "2026-10-11T07:00:00Z", status: "UNCONFIRMED" },
  ]);
  await s.prescription({ familyId: fam, memberId: m, issuedOn: "2026-10-02" });
  await s.appointment({ familyId: fam, memberId: m, scheduledAt: "2026-10-20T09:00:00Z", status: "SCHEDULED" });
  await s.exam({ familyId: fam, memberId: m, examDate: "2026-10-15" });
  if (recipient) await s.alert({ recipientUserId: recipient, familyId: fam, memberId: m, type: "MEDICATION_DUE", triggerAt: "2026-10-12T08:00:00Z" });
}

beforeAll(async () => {
  s.h.clock.set(START);
  const [uA, uB, uC, uE, uX, uR] = await Promise.all(["admin", "b", "c", "e", "x", "r"].map((n) => s.user(`authz-${n}`)));
  if (!uA || !uB || !uC || !uE || !uX || !uR) throw new Error("utilizadores");
  const fam = await s.family("Família A");
  const other = await s.family("Família X");
  const mA = await s.member(fam, { userId: uA.id, role: "FAMILY_ADMIN", name: "A", bloodType: "A_POS" });
  const mB = await s.member(fam, { userId: uB.id, role: "FAMILY_MEMBER", name: "B", bloodType: "A_POS" });
  const mC = await s.member(fam, { userId: uC.id, role: "FAMILY_MEMBER", name: "C", bloodType: "A_POS" });
  const mD = await s.member(fam, { dependent: true, guardians: [mC], name: "D", bloodType: "A_POS" });
  const mE = await s.member(fam, { dependent: true, guardians: [mC], userId: uE.id, role: "FAMILY_MEMBER", name: "E", bloodType: "A_POS" });
  const mK = await s.member(fam, { dependent: true, guardians: [mC], blocked: true, name: "K bloqueado", bloodType: "A_POS" });
  const mR = await s.member(fam, { userId: uR.id, role: "FAMILY_MEMBER", name: "R", bloodType: "A_POS" });
  const mX = await s.member(other, { userId: uX.id, role: "FAMILY_ADMIN", name: "X", bloodType: "A_POS" });
  w = { fam, other, uA, uB, uC, uE, uX, uR, mA, mB, mC, mD, mE, mK, mR, mX };
  for (const [m, recipient] of [[mA, uA.id], [mB, uB.id], [mC, uC.id], [mD, uC.id], [mE, uE.id], [mK, uC.id], [mR, uR.id]] as const) await seedAll(fam, m, recipient);
  await seedAll(other, mX, uX.id);
}, 180_000);

const clearGrants = () => s.h.pool.query("DELETE FROM sharing_grants WHERE family_id = $1", [w.fam]);
const auditRows = (viewer: string) => s.h.pool.query("SELECT subject_member_id, metadata FROM audit_logs WHERE action = 'REPORT_VIEW' AND actor_user_id = $1", [viewer]).then((r) => r.rows);

// ---------------------------------------------------------------------------------------------------------------------------------
describe("TC-RPT-09 / AC-RPT-07: relações SELF, TUTOR_OF e DEPENDENT_SELF", () => {
  it("SELF (adulto, incl. Family Admin): todas as secções, `sourceIds` de completude, nada auditado", async () => {
    for (const [u, m] of [[w.uA, w.mA], [w.uB, w.mB]] as const) {
      const res = await getMember(u, w.fam, m);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(sectionsOf(res.body)).toEqual(SECTIONS);
      expect(res.body.alerts).toEqual({ total: 1, unread: 1, byType: { MEDICATION_DUE: 1 } });
      expect((res.body.missing as any[]).some((x) => Array.isArray(x.sourceIds) && x.sourceIds.length > 0)).toBe(true);
      expect(await auditRows(u.id)).toEqual([]);
    }
  });

  it("TUTOR_OF (dependente com e sem conta): todas as secções e `sourceIds`; ver outro titular audita REPORT_VIEW", async () => {
    for (const m of [w.mD, w.mE]) {
      const res = await getMember(w.uC, w.fam, m);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(sectionsOf(res.body)).toEqual(SECTIONS);
      const withIds = (res.body.missing as any[]).filter((x) => x.sourceIds);
      expect(withIds.map((x) => x.code).sort()).toEqual(["APPOINTMENT_PAST_OPEN", "DOSES_UNCONFIRMED", "EXAM_WITHOUT_RESULTS", "PRESCRIPTION_WITHOUT_DOCUMENT"]);
    }
    const audited = (await auditRows(w.uC.id)).map((r) => r.subject_member_id).sort();
    expect(audited).toEqual([w.mD, w.mE].sort());
  });

  it("DEPENDENT_SELF: só medicação, receitas e consultas (o que já vê); exames omitidos; sem `sourceIds` (não escreve)", async () => {
    const res = await getMember(w.uE, w.fam, w.mE);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(sectionsOf(res.body)).toEqual(["medication", "prescriptions", "appointments"]);
    // Só confirmar tomas (CONFIRM_DOSE) lhe é permitido: `sourceIds` apenas nas tomas por confirmar.
    for (const item of res.body.missing as any[]) if (item.code !== "DOSES_UNCONFIRMED") expect(item.sourceIds, item.code).toBeUndefined();
    expect((res.body.missing as any[]).map((x) => x.code)).not.toContain("EXAM_WITHOUT_RESULTS");
    expect(await auditRows(w.uE.id)).toEqual([]);
  });

  it("OTHER sem partilha (incl. Family Admin como OTHER): 404 sem revelar nada; tutor de outro, dependente sobre adulto também", async () => {
    await clearGrants();
    const cases: [SummaryUser, string][] = [
      [w.uA, w.mB], // Family Admin sobre um adulto
      [w.uA, w.mD], // Family Admin sobre um dependente que não tutela
      [w.uA, w.mE],
      [w.uB, w.mA],
      [w.uB, w.mD],
      [w.uE, w.mA], // dependente sobre um adulto
      [w.uC, w.mA], // tutor sobre um adulto que não é dependente dele
    ];
    const bodies = new Set<string>();
    for (const [u, m] of cases) {
      const res = await getMember(u, w.fam, m);
      expect(res.status, `${u.email} -> ${m}`).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      bodies.add(stable(res.body));
    }
    expect(bodies.size).toBe(1);
    expect(await auditRows(w.uA.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("AC-RPT-07: OTHER com partilha por categoria — só vê as secções das categorias legíveis; o Family Admin não vê mais", () => {
  beforeEach(clearGrants);

  it.each([
    [["MEDICATION"], ["medication", "prescriptions"]],
    [["APPOINTMENTS"], ["appointments"]],
    [["EXAMS"], ["exams"]],
    [["MEDICATION", "EXAMS"], ["medication", "prescriptions", "exams"]],
    [["APPOINTMENTS", "EXAMS"], ["exams", "appointments"]],
    [["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"], SECTIONS],
  ])("partilha %j => secções %j; sem `sourceIds` (só leitura)", async (categories, expected) => {
    for (const category of categories) await s.grant(w.fam, w.mA, w.mB, category);
    const res = await getMember(w.uB, w.fam, w.mA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(sectionsOf(res.body)).toEqual(expected);
    for (const item of (res.body.missing ?? []) as any[]) expect(item.sourceIds, item.code).toBeUndefined();
    // Completude só das categorias legíveis: sem leitura de exames, nada de `EXAM_*`.
    const codes = ((res.body.missing ?? []) as any[]).map((x) => x.code as string);
    if (!expected.includes("exams")) expect(codes.filter((c) => c.startsWith("EXAM_"))).toEqual([]);
    if (!expected.includes("appointments")) expect(codes).not.toContain("APPOINTMENT_PAST_OPEN");
    if (!expected.includes("medication")) expect(codes).not.toContain("DOSES_UNCONFIRMED");
    // Os alertas são os do PRÓPRIO pedinte (B) sobre A: nenhum.
    expect(res.body.alerts).toEqual({ total: 0, unread: 0, byType: {} });
    // O titular é outro => REPORT_VIEW com kind=HEALTH_SUMMARY.
    expect((await auditRows(w.uB.id)).length).toBeGreaterThan(0);
  });

  it("só `ALLERGIES` (única categoria legível sem secção do Resumo): 200 só com alertas; só `CONDITIONS`: 404 uniforme", async () => {
    await s.grant(w.fam, w.mA, w.mB, "ALLERGIES");
    const allergies = await getMember(w.uB, w.fam, w.mA);
    expect(allergies.status).toBe(200);
    expect(sectionsOf(allergies.body)).toEqual([]);
    expect(Object.keys(allergies.body).sort()).toEqual(["alerts", "generatedAt", "memberId", "missing", "period"]);
    expect(allergies.body.missing).toEqual([]);
    await clearGrants();
    await s.grant(w.fam, w.mA, w.mB, "CONDITIONS");
    const conditions = await getMember(w.uB, w.fam, w.mA);
    expect(conditions.status).toBe(404);
  });

  it("Family Admin como OTHER: com partilha de APPOINTMENTS só vê consultas (não ganha mais por ser Admin)", async () => {
    await s.grant(w.fam, w.mB, w.mA, "APPOINTMENTS");
    const res = await getMember(w.uA, w.fam, w.mB);
    expect(res.status).toBe(200);
    expect(sectionsOf(res.body)).toEqual(["appointments"]);
  });

  it("partilha com toda a família (grantee nulo) vale para todos; partilha para outro membro não vale para B", async () => {
    await s.grant(w.fam, w.mA, null, "MEDICATION");
    const everyone = await getMember(w.uB, w.fam, w.mA);
    expect(sectionsOf(everyone.body)).toEqual(["medication", "prescriptions"]);
    await clearGrants();
    await s.grant(w.fam, w.mA, w.mC, "MEDICATION");
    expect((await getMember(w.uB, w.fam, w.mA)).status).toBe(404);
    expect((await getMember(w.uC, w.fam, w.mA)).status).toBe(200);
  });

  it("UC-RPT-05b: vista da família só com os membros e categorias visíveis (atividade só das categorias legíveis)", async () => {
    await s.grant(w.fam, w.mA, w.mB, "MEDICATION");
    const res = await getFamily(w.uB, w.fam);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byId = Object.fromEntries((res.body.members as any[]).map((b) => [b.memberId, b]));
    expect(Object.keys(byId).sort()).toEqual([w.mA, w.mB].sort());
    // B (SELF): todas as categorias.
    expect(Object.keys(byId[w.mB].activity).sort()).toEqual(["appointments", "dosesConfirmed", "exams", "lastActivityOn", "prescriptions"]);
    expect(byId[w.mB]).toHaveProperty("upcoming30d");
    // A, com partilha só de medicação: sem consultas/exames (nem `upcoming30d`).
    expect(Object.keys(byId[w.mA].activity).sort()).toEqual(["dosesConfirmed", "lastActivityOn", "prescriptions"]);
    expect(byId[w.mA]).not.toHaveProperty("upcoming30d");
    expect(JSON.stringify(res.body)).not.toContain(w.mC);
    expect(JSON.stringify(res.body)).not.toContain(w.mD);
  });

  it("UC-RPT-05b: o tutor vê o próprio bloco e os dos seus dependentes; o dependente com conta só o que já vê", async () => {
    await clearGrants();
    const tutor = await getFamily(w.uC, w.fam);
    expect(tutor.status, JSON.stringify(tutor.body)).toBe(200);
    expect((tutor.body.members as any[]).map((b) => b.memberId).sort()).toEqual([w.mC, w.mD, w.mE].sort());
    const dependent = await getFamily(w.uE, w.fam);
    expect(dependent.status).toBe(200);
    expect((dependent.body.members as any[]).map((b) => b.memberId)).toEqual([w.mE]);
    expect(Object.keys((dependent.body.members as any[])[0].activity).sort()).toEqual(["appointments", "dosesConfirmed", "lastActivityOn", "prescriptions"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("IDOR: 404 uniforme (família alheia, inexistente, membro de outra família, inexistente) e identidades sem acesso", () => {
  it("todos os casos de não-existência/sem acesso devolvem o MESMO 404 (corpo igual, sem ids)", async () => {
    await clearGrants();
    const ghostFam = randomUUID();
    const ghostMember = randomUUID();
    // (a) Quem NÃO pertence à família pedida (alheia ou inexistente): o mesmo corpo.
    const outsider = [
      await getMember(w.uX, w.fam, w.mA), // utilizador de outra família sobre membro desta
      await getMember(w.uA, w.other, w.mX), // membro de família alheia
      await getMember(w.uA, w.other, w.mA), // família alheia + membro da própria
      await getMember(w.uA, ghostFam, w.mA), // família inexistente
    ];
    // (b) Quem pertence à família: membro inexistente, membro de OUTRA família e membro existente sem categoria legível dão o MESMO corpo
    // (não se revela a existência do membro).
    const insider = [
      await getMember(w.uA, w.fam, w.mX),
      await getMember(w.uA, w.fam, ghostMember),
      await getMember(w.uB, w.fam, w.mA),
    ];
    const responses = [...outsider, ...insider];
    for (const res of responses) expect(res.status).toBe(404);
    expect([...new Set(outsider.map((r) => stable(r.body)))]).toHaveLength(1);
    expect([...new Set(insider.map((r) => stable(r.body)))]).toHaveLength(1);
    const text = responses.map((r) => JSON.stringify(r.body)).join("");
    for (const id of [w.fam, w.other, w.mA, w.mX, ghostFam, ghostMember]) expect(text).not.toContain(id);
    // Vista da família: família alheia / inexistente => o mesmo 404.
    const family = [await getFamily(w.uX, w.fam), await getFamily(w.uA, w.other), await getFamily(w.uA, ghostFam)];
    for (const res of family) expect(res.status).toBe(404);
    expect(new Set(family.map((r) => stable(r.body))).size).toBe(1);
  });

  it("sem sessão, com token de clínica ou token inválido => 401; Platform Admin nunca acede a dados de saúde (404)", async () => {
    expect((await request(s.h.app).get(memberUrl(w.fam, w.mA))).status).toBe(401);
    expect((await request(s.h.app).get(memberUrl(w.fam, w.mA)).set(withToken(await s.h.clinicToken()))).status).toBe(401);
    expect((await request(s.h.app).get(memberUrl(w.fam, w.mA)).set(withToken("nao-e-um-jwt"))).status).toBe(401);
    expect((await request(s.h.app).get(`${API}/families/${w.fam}/health-summary`)).status).toBe(401);
    const adminToken = await s.h.adminToken();
    for (const url of [memberUrl(w.fam, w.mA), `${API}/families/${w.fam}/health-summary`]) {
      const res = await request(s.h.app).get(url).set(withToken(adminToken));
      expect(res.status, url).toBe(404);
    }
  });

  it("nenhuma rota de escrita, PDF ou ligação partilhável do Resumo (AC-RPT-09)", async () => {
    for (const method of ["post", "put", "patch", "delete"] as const) {
      const res = await request(s.h.app)[method](memberUrl(w.fam, w.mA, "")).set(withToken(w.uA.token)).send({});
      expect([400, 404, 405]).toContain(res.status);
    }
    for (const suffix of ["/pdf", "/share", "/export"]) {
      expect((await request(s.h.app).get(memberUrl(w.fam, w.mA, suffix)).set(withToken(w.uA.token))).status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("Membro bloqueado e removido (authorization.md §2 passos 3 e 7)", () => {
  it("bloqueado: o resumo desse membro é recusado (MEMBER_BLOCKED 423), sem dados", async () => {
    const res = await getMember(w.uC, w.fam, w.mK);
    expect(res.status, JSON.stringify(res.body)).toBe(423);
    expect(res.body.code).toBe("MEMBER_BLOCKED");
    expect(JSON.stringify(res.body)).not.toMatch(/"medication"|"exams"/);
  });

  it("bloqueado: a vista da família continua a funcionar para os outros membros (o bloco do bloqueado é omitido)", async () => {
    const res = await getFamily(w.uC, w.fam);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.members as any[]).map((b) => b.memberId);
    expect(ids).toContain(w.mC);
    expect(ids).not.toContain(w.mK);
  });

  it("removido: o utilizador que saiu da família passa a ter 404 (com o token antigo) e o membro removido deixa de existir para os outros", async () => {
    expect((await getMember(w.uR, w.fam, w.mR)).status).toBe(200);
    await s.h.pool.query("DELETE FROM family_members WHERE id = $1", [w.mR]);
    for (const res of [await getMember(w.uR, w.fam, w.mR), await getMember(w.uR, w.fam, w.mA), await getFamily(w.uR, w.fam)]) expect(res.status).toBe(404);
    expect((await getMember(w.uA, w.fam, w.mR)).status).toBe(404);
    // A vista da família dos outros deixa de listar o removido.
    const family = await getFamily(w.uA, w.fam);
    expect((family.body.members as any[]).map((b) => b.memberId)).not.toContain(w.mR);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("TC-RPT-12 / BR-RPT-18: limite de 30 pedidos/min por utilizador (429 + Retry-After)", () => {
  it("o 31.º pedido no minuto => 429 RATE_LIMITED com Retry-After; as duas rotas partilham o orçamento; outro utilizador não é afetado", async () => {
    const [u1, u2] = await Promise.all([s.user("rl1"), s.user("rl2")]);
    const fam = await s.family();
    const m1 = await s.member(fam, { userId: u1.id, role: "FAMILY_ADMIN" });
    await s.member(fam, { userId: u2.id, role: "FAMILY_MEMBER" });
    for (let i = 0; i < 15; i++) expect((await getMember(u1, fam, m1, "")).status).toBe(200);
    for (let i = 0; i < 15; i++) expect((await getFamily(u1, fam, "")).status).toBe(200);
    const limited = await getMember(u1, fam, m1, "");
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    const retry = Number(limited.headers["retry-after"]);
    expect(Number.isInteger(retry)).toBe(true);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    expect((await getFamily(u1, fam, "")).status).toBe(429);
    // Outro utilizador (mesma família) tem o seu orçamento.
    expect((await request(s.h.app).get(`${API}/families/${fam}/health-summary`).set(withToken(u2.token))).status).toBe(200);
    // Passado o Retry-After o orçamento renova.
    s.h.clock.set(new Date(s.h.clock.now().getTime() + 61_000));
    expect((await getMember(u1, fam, m1, "")).status).toBe(200);
  });

  it("pedidos recusados (404/422) também contam para o limite (não se usa o Resumo para sondar membros)", async () => {
    const u = await s.user("rl3");
    const fam = await s.family();
    const m = await s.member(fam, { userId: u.id, role: "FAMILY_ADMIN" });
    for (let i = 0; i < 10; i++) expect((await getMember(u, fam, randomUUID(), "")).status).toBe(404);
    for (let i = 0; i < 10; i++) expect((await getMember(u, fam, m, "?from=2026-02-01&to=2026-01-01")).status).toBe(422);
    for (let i = 0; i < 10; i++) expect((await getMember(u, fam, m, "")).status).toBe(200);
    expect((await getMember(u, fam, m, "")).status).toBe(429);
  });

  it("limitador indisponível (Redis parado) => falha fechada 503 com Retry-After (ADR-038), sem dados", async () => {
    const u = await s.user("rl4");
    const fam = await s.family();
    const m = await s.member(fam, { userId: u.id, role: "FAMILY_ADMIN" });
    s.failLimiter.value = true;
    try {
      const res = await getMember(u, fam, m, "");
      expect(res.status, JSON.stringify(res.body)).toBe(503);
      expect(res.headers["retry-after"]).toBe("5");
      expect(res.body.code).toBe("SERVICE_UNAVAILABLE");
      expect(JSON.stringify(res.body)).not.toContain("medication");
    } finally {
      s.failLimiter.value = false;
    }
  });
});
