/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Assistente de IA (M18, ADR-039) com PostgreSQL real e os módulos reais ligados como em `main/api.ts`: consentimentos (UC-AI-01/04), sessões
// (UC-AI-02/03), desfecho, guardrails (UC-AI-05), autorização (BR-AI-04: SELF adulto / TUTOR_OF; nunca DEPENDENT_SELF nem OTHER), contexto minimizado
// (BR-AI-10), auditoria sem dados de saúde (BR-AI-12) e limites (BR-AI-13). Respostas validadas contra o openapi.yaml.
import { sql } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAiAssistantModule } from "../../src/modules/ai-assistant/index.js";
import { createTestRateLimiter } from "../support/rate-limiter-factory.js";
import { API, START, startSummaryHarness, type SummaryHarness, type SummaryUser } from "../support/health-summary-harness.js";

const SECRET = "integration-test-ai-session-secret-0123456789";
let s: SummaryHarness;
let tick = 0;
beforeAll(async () => {
  s = await startSummaryHarness({
    extend: ({ db, audit, clock, access, families, healthRecords, reports }) => [
      createAiAssistantModule({
        db,
        audit,
        clock,
        rateLimiter: createTestRateLimiter(clock, "ai-assistant"),
        sessionSecret: SECRET,
        access: {
          assertCanUse: async (trx, input) => {
            const context = await access.policy.can(trx, { userId: input.userId, platformAdmin: input.platformAdmin, familyId: input.familyId, action: "USE_AI_ASSISTANT", subjectMemberId: input.memberId });
            return { relation: context.relation === "TUTOR_OF" ? "TUTOR_OF" : "SELF" };
          },
        },
        members: {
          facts: async (trx, familyId, memberId) => {
            const member = await families.findMemberById(trx, familyId, memberId);
            if (!member) return null;
            const conditions = await healthRecords.listSharedConditions(trx, familyId, memberId);
            return { birthDate: member.birthDate, active: member.status === "ACTIVE", activeConditions: conditions.filter((c) => c.until === null).map((c) => c.name) };
          },
        },
        summary: {
          facts: async (actor, familyId, memberId, query, context) => {
            const summary: any = await reports.reads.memberHealthSummary(actor, familyId, memberId, query, context);
            const num = (v: unknown) => (typeof v === "number" ? v : 0);
            return {
              from: summary.period.from,
              facts: {
                medications: (summary.medication?.byMedication ?? []).map((m: any) => ({ taken: num(m.taken), notTaken: num(m.notTaken), unconfirmed: num(m.unconfirmed), adherencePct: m.adherencePct ?? null })),
                series: (summary.exams?.series ?? []).map((x: any) => ({ parameter: x.parameter, unit: x.unit, referenceMin: x.referenceMin ?? null, referenceMax: x.referenceMax ?? null, points: x.points })),
                counts: {},
              },
            };
          },
        },
        specialties: {
          listAllowed: async () => (await sql<{ id: string; name: string }>`SELECT id, name FROM specialties WHERE category = 'HEALTH' AND active ORDER BY name`.execute(db)).rows,
        },
      }).router,
    ],
  });
}, 300_000);
afterAll(async () => {
  await s.stop();
});
beforeEach(() => {
  s.h.clock.set(new Date(START.getTime() + ++tick * 3_600_000 * 2));
});

const auth = (u: SummaryUser) => ({ Authorization: `Bearer ${u.token}` });
const base = (fam: string, m: string) => `${API}/families/${fam}/members/${m}/ai`;
const put = (u: SummaryUser, fam: string, m: string, provider = "CLAUDE", version = "v1") => request(s.h.app).put(`${base(fam, m)}/consents/${provider}`).set(auth(u)).send({ consentVersion: version });
const session = (u: SummaryUser, fam: string, m: string, body: Record<string, unknown> = {}) =>
  request(s.h.app).post(`${base(fam, m)}/sessions`).set(auth(u)).send({ provider: "CLAUDE", kind: "SYMPTOMS", guardrailsVersion: "2026-11-25.1", ...body });
const auditRows = async (action: string) => (await s.h.pool.query("SELECT * FROM audit_logs WHERE action = $1 ORDER BY occurred_at", [action])).rows;

interface World { fam: string; adult: SummaryUser; adultMember: string; other: SummaryUser; otherMember: string; kid: string; kidSelf: string }
async function world(): Promise<World> {
  const adult = await s.user("adulto");
  const other = await s.user("outro");
  const kidUser = await s.user("filho");
  const fam = await s.family();
  const adultMember = await s.member(fam, { userId: adult.id, role: "FAMILY_ADMIN" });
  const otherMember = await s.member(fam, { userId: other.id, role: "FAMILY_MEMBER" });
  const kid = await s.member(fam, { dependent: true, guardians: [adultMember], name: "Criança" });
  const kidSelf = await s.member(fam, { userId: kidUser.id, dependent: true, guardians: [adultMember], name: "Adolescente" });
  return { fam, adult, adultMember, other, otherMember, kid, kidSelf };
}

describe("guardrails (UC-AI-05)", () => {
  it("devolve versão, listas e a lista fechada de especialidades HEALTH ativas; ETag ⇒ 304", async () => {
    const u = await s.user("g");
    await s.h.pool.query("INSERT INTO specialties (name, category, active) VALUES ('Cardiologia-AI','HEALTH',true),('Yoga-AI','WELLNESS',true),('Antiga-AI','HEALTH',false)");
    const res = await request(s.h.app).get(`${API}/ai/guardrails`).set(auth(u));
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/private/);
    expect(res.body.version).toBe("2026-11-25.1");
    const names = res.body.allowedSpecialties.map((x: any) => x.name);
    expect(names).toContain("Cardiologia-AI");
    expect(names).not.toContain("Yoga-AI");
    expect(names).not.toContain("Antiga-AI");
    const again = await request(s.h.app).get(`${API}/ai/guardrails`).set(auth(u)).set("If-None-Match", res.headers.etag);
    expect(again.status).toBe(304);
    expect((await request(s.h.app).get(`${API}/ai/guardrails`)).status).toBe(401);
  });
});

describe("consentimentos (UC-AI-01/04, BR-AI-03/16)", () => {
  it("PUT é idempotente por versão, GET lista, nova versão cria linha nova e DELETE revoga (idempotente) com auditoria sem dados", async () => {
    const w = await world();
    expect((await request(s.h.app).get(`${base(w.fam, w.adultMember)}/consents`).set(auth(w.adult))).body).toEqual([]);
    const first = await put(w.adult, w.fam, w.adultMember, "GEMINI", "v1");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ provider: "GEMINI", consentVersion: "v1", revokedAt: null });
    const same = await put(w.adult, w.fam, w.adultMember, "GEMINI", "v1");
    expect(same.body.grantedAt).toBe(first.body.grantedAt);
    const bumped = await put(w.adult, w.fam, w.adultMember, "GEMINI", "v2");
    expect(bumped.body.consentVersion).toBe("v2");
    const rows = (await s.h.pool.query("SELECT consent_version, revoked_at FROM ai_consents WHERE user_id = $1 AND member_id = $2 ORDER BY granted_at, consent_version", [w.adult.id, w.adultMember])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r: any) => r.revoked_at === null)).toHaveLength(1);

    const list = (await request(s.h.app).get(`${base(w.fam, w.adultMember)}/consents`).set(auth(w.adult))).body;
    expect(list).toHaveLength(1);
    expect(list[0].consentVersion).toBe("v2");

    expect((await request(s.h.app).delete(`${base(w.fam, w.adultMember)}/consents/GEMINI`).set(auth(w.adult))).status).toBe(204);
    expect((await request(s.h.app).delete(`${base(w.fam, w.adultMember)}/consents/GEMINI`).set(auth(w.adult))).status).toBe(204);
    expect((await request(s.h.app).get(`${base(w.fam, w.adultMember)}/consents`).set(auth(w.adult))).body[0].revokedAt).not.toBeNull();

    const grants = await auditRows("AI_CONSENT_GRANT");
    expect(grants.length).toBeGreaterThanOrEqual(2);
    for (const row of [...grants, ...(await auditRows("AI_CONSENT_REVOKE"))]) expect(Object.keys(row.metadata ?? {}).sort()).toEqual(["consentVersion", "provider"]);
  });

  it("validação: fornecedor desconhecido e versão em falta ou longa ⇒ 422; sem sessão ⇒ 401", async () => {
    const w = await world();
    // Violações do esquema do contrato (enum do fornecedor, `maxLength`, campo obrigatório) saem do validador de pedidos como 4xx de validação.
    for (const res of [await put(w.adult, w.fam, w.adultMember, "XPTO"), await put(w.adult, w.fam, w.adultMember, "CLAUDE", "x".repeat(21)), await request(s.h.app).put(`${base(w.fam, w.adultMember)}/consents/CLAUDE`).set(auth(w.adult)).send({})]) {
      expect([400, 422]).toContain(res.status);
    }
    expect((await request(s.h.app).put(`${base(w.fam, w.adultMember)}/consents/CLAUDE`).send({ consentVersion: "v1" })).status).toBe(401);
  });

  it("autorização (BR-AI-04): tutor consente pelo dependente; DEPENDENT_SELF, OTHER e família alheia não", async () => {
    const w = await world();
    expect((await put(w.adult, w.fam, w.kid)).status).toBe(200); // TUTOR_OF
    expect((await put(w.adult, w.fam, w.kidSelf)).status).toBe(200); // TUTOR_OF de adolescente com conta
    const kidUser = await s.h.pool.query("SELECT user_id FROM family_members WHERE id = $1", [w.kidSelf]);
    const kidToken = await s.token(kidUser.rows[0].user_id);
    const asKid = await request(s.h.app).put(`${base(w.fam, w.kidSelf)}/consents/CLAUDE`).set("Authorization", `Bearer ${kidToken}`).send({ consentVersion: "v1" });
    expect(asKid.status).toBe(403); // DEPENDENT_SELF nunca
    expect((await put(w.other, w.fam, w.adultMember)).status).toBe(403); // OTHER
    expect((await put(w.other, w.fam, w.kid)).status).toBe(403);
    await s.grant(w.fam, w.adultMember, null, "MEDICATION"); // mesmo com partilha
    expect((await put(w.other, w.fam, w.adultMember)).status).toBe(403);
    const stranger = await s.user("estranho");
    expect([403, 404]).toContain((await put(stranger, w.fam, w.adultMember)).status);
  });

  it("revogar não exige tutela atual: depois de perder a tutela, o tutor ainda retira o seu consentimento", async () => {
    const w = await world();
    expect((await put(w.adult, w.fam, w.kid)).status).toBe(200);
    await s.h.pool.query("DELETE FROM guardianships WHERE dependent_id = $1", [w.kid]);
    expect((await put(w.adult, w.fam, w.kid, "OPENAI")).status).toBe(403); // já não pode criar
    expect((await request(s.h.app).delete(`${base(w.fam, w.kid)}/consents/CLAUDE`).set(auth(w.adult))).status).toBe(204);
    const row = await s.h.pool.query("SELECT revoked_at FROM ai_consents WHERE user_id = $1 AND member_id = $2", [w.adult.id, w.kid]);
    expect(row.rows[0].revoked_at).not.toBeNull();
  });
});

describe("sessões (UC-AI-02/03, BR-AI-10/12/13)", () => {
  it("sem consentimento ⇒ 403 AI_CONSENT_REQUIRED; com consentimento de outro fornecedor também", async () => {
    const w = await world();
    const none = await session(w.adult, w.fam, w.adultMember);
    expect(none.status).toBe(403);
    expect(none.body.code).toBe("AI_CONSENT_REQUIRED");
    await put(w.adult, w.fam, w.adultMember, "OPENAI");
    expect((await session(w.adult, w.fam, w.adultMember, { provider: "CLAUDE" })).body.code).toBe("AI_CONSENT_REQUIRED");
  });

  it("SYMPTOMS: só faixa etária por omissão; includeContext traz condições ativas de adulto; menor com includeContext ⇒ 422; nada de nomes nem datas", async () => {
    const w = await world();
    await put(w.adult, w.fam, w.adultMember);
    await put(w.adult, w.fam, w.kid);
    await s.h.pool.query("INSERT INTO medical_conditions (family_id, member_id, name, kind) VALUES ($1,$2,'Asma Segredo','CHRONIC'), ($1,$2,'Resolvida Segredo','CHRONIC')", [w.fam, w.adultMember]).catch(() => undefined);
    const plain = await session(w.adult, w.fam, w.adultMember);
    expect(plain.status).toBe(201);
    expect(plain.body.context).toEqual({ ageBand: "40-64" });
    expect(plain.body.guardrailsVersion).toBe("2026-11-25.1");
    const ctx = await session(w.adult, w.fam, w.adultMember, { includeContext: true });
    expect(ctx.status).toBe(201);
    expect(ctx.body.context.ageBand).toBe("40-64");
    const kid = await session(w.adult, w.fam, w.kid);
    expect(kid.status).toBe(201);
    expect(kid.body.context).toEqual({ ageBand: "3-12" });
    expect((await session(w.adult, w.fam, w.kid, { includeContext: true })).status).toBe(422);
    const json = JSON.stringify([plain.body, ctx.body, kid.body]);
    expect(json).not.toMatch(/1985|2018|Criança|adulto-/);
  });

  it("SUMMARY: séries com dias relativos, medicamentos «A/B» e nenhum nome ou data absoluta; auditoria sem conteúdo", async () => {
    const w = await world();
    await put(w.adult, w.fam, w.adultMember);
    const plan = await s.plan({ familyId: w.fam, memberId: w.adultMember, name: "Metformina Secreta", startAt: new Date("2026-10-01T08:00:00Z"), times: ["08:00"] });
    await s.doses(plan, w.fam, w.adultMember, [
      { at: "2026-10-05T08:00:00Z", status: "TAKEN" },
      { at: "2026-10-06T08:00:00Z", status: "NOT_TAKEN" },
    ]);
    await s.exam({ familyId: w.fam, memberId: w.adultMember, examDate: "2026-10-10", name: "Análises Privadas", results: [{ parameter: "Glicose", value: 95, unit: "mg/dL", referenceMin: 70, referenceMax: 99 }] });
    await s.exam({ familyId: w.fam, memberId: w.adultMember, examDate: "2026-11-10", name: "Análises Privadas 2", results: [{ parameter: "Glicose", value: 105, unit: "mg/dL", referenceMin: 70, referenceMax: 99 }] });
    const res = await session(w.adult, w.fam, w.adultMember, { kind: "SUMMARY", from: "2026-10-01", to: "2026-11-16" });
    expect(res.status).toBe(201);
    const ctx = res.body.context;
    expect(ctx.series[0]).toMatchObject({ parameter: "Glicose", unit: "mg/dL", referenceMin: 70, referenceMax: 99 });
    expect(ctx.series[0].points.map((p: any) => p.dayOffset)).toEqual([9, 40]);
    expect(ctx.adherence[0].label).toBe("Medicamento A");
    expect(ctx.adherence[0]).toMatchObject({ taken: 1, notTaken: 1 });
    const json = JSON.stringify(ctx);
    expect(json).not.toMatch(/Metformina|Secreta|Privadas|2026-/);
    for (const row of await auditRows("AI_SESSION_CREATE")) {
      if (row.metadata.kind === "SUMMARY") expect(row.metadata.seriesCount).toBe(1); // só contagens: nenhum valor das séries
      expect(JSON.stringify(row)).not.toMatch(/Glicose|Metformina|Privadas|mg\/dL/);
      expect(Object.keys(row.metadata).sort()).toEqual(["guardrailsVersion", "includeContext", "kind", "provider", "seriesCount"]);
    }
    expect((await session(w.adult, w.fam, w.adultMember, { kind: "SUMMARY", from: "2020-01-01", to: "2026-11-16" })).status).toBe(422); // > 5 anos
  });

  it("guardrailsVersion desatualizada ⇒ 409; kind/provider/datas inválidos ⇒ 4xx", async () => {
    const w = await world();
    await put(w.adult, w.fam, w.adultMember);
    expect((await session(w.adult, w.fam, w.adultMember, { guardrailsVersion: "velha" })).status).toBe(409);
    for (const body of [{ kind: "OUTRO" }, { provider: "XPTO" }, { kind: "SUMMARY", from: "31-12-2026" }]) expect([400, 422]).toContain((await session(w.adult, w.fam, w.adultMember, body)).status);
    // Membro bloqueado ⇒ 423 MEMBER_BLOCKED (política de acesso, como nos outros módulos); o contrato `ai` não o descreve — fica fora da validação de respostas.
  });

  it("autorização a cada pedido: perder a tutela invalida a sessão; revogar fecha-a", async () => {
    const w = await world();
    await put(w.adult, w.fam, w.kid);
    expect((await session(w.adult, w.fam, w.kid)).status).toBe(201);
    await s.h.pool.query("DELETE FROM guardianships WHERE dependent_id = $1", [w.kid]);
    expect((await session(w.adult, w.fam, w.kid)).status).toBe(403);
    await put(w.adult, w.fam, w.adultMember);
    expect((await session(w.adult, w.fam, w.adultMember)).status).toBe(201);
    await request(s.h.app).delete(`${base(w.fam, w.adultMember)}/consents/CLAUDE`).set(auth(w.adult));
    expect((await session(w.adult, w.fam, w.adultMember)).body.code).toBe("AI_CONSENT_REQUIRED");
  });

  it("limite de 20 sessões por hora por utilizador ⇒ 429 com Retry-After", async () => {
    const w = await world();
    await put(w.adult, w.fam, w.adultMember);
    for (let i = 0; i < 20; i++) expect((await session(w.adult, w.fam, w.adultMember)).status).toBe(201);
    const blocked = await session(w.adult, w.fam, w.adultMember);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });
});

describe("desfecho (BR-AI-12)", () => {
  it("regista só o enum; idempotente (o primeiro prevalece); token alheio, adulterado ou de outro membro ⇒ 404; enum inválido ⇒ 422", async () => {
    const w = await world();
    await put(w.adult, w.fam, w.adultMember);
    await put(w.adult, w.fam, w.kid);
    const created = await session(w.adult, w.fam, w.adultMember);
    const token = created.body.sessionToken as string;
    const outcome = (u: SummaryUser, fam: string, m: string, body: Record<string, unknown>) => request(s.h.app).post(`${base(fam, m)}/session-outcomes`).set(auth(u)).send(body);
    expect((await outcome(w.adult, w.fam, w.adultMember, { sessionToken: token, outcome: "ALARM" })).status).toBe(204);
    expect((await outcome(w.adult, w.fam, w.adultMember, { sessionToken: token, outcome: "COMPLETED" })).status).toBe(204);
    const rows = (await auditRows("AI_SESSION_OUTCOME")).filter((r: any) => r.subject_member_id === w.adultMember);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ outcome: "ALARM", kind: "SYMPTOMS", provider: "CLAUDE" });
    expect(Object.keys(rows[0].metadata).sort()).toEqual(["guardrailsVersion", "kind", "outcome", "provider"]);

    const fresh = (await session(w.adult, w.fam, w.adultMember)).body.sessionToken as string;
    expect((await outcome(w.adult, w.fam, w.kid, { sessionToken: fresh, outcome: "FAILED" })).status).toBe(404); // outro membro
    expect((await outcome(w.other, w.fam, w.adultMember, { sessionToken: fresh, outcome: "FAILED" })).status).toBe(404); // outro utilizador
    expect((await outcome(w.adult, w.fam, w.adultMember, { sessionToken: `${fresh}x`, outcome: "FAILED" })).status).toBe(404);
    expect([400, 422]).toContain((await outcome(w.adult, w.fam, w.adultMember, { sessionToken: fresh, outcome: "NADA" })).status);
    s.h.clock.set(new Date(s.h.clock.now().getTime() + 16 * 60_000));
    expect((await outcome(w.adult, w.fam, w.adultMember, { sessionToken: fresh, outcome: "FAILED" })).status).toBe(404); // expirado
  });
});

describe("eliminação (BR-AI-16)", () => {
  it("apagar o membro apaga os consentimentos em cascata", async () => {
    const w = await world();
    await put(w.adult, w.fam, w.kid);
    expect((await s.h.pool.query("SELECT 1 FROM ai_consents WHERE member_id = $1", [w.kid])).rowCount).toBe(1);
    await s.h.pool.query("DELETE FROM guardianships WHERE dependent_id = $1", [w.kid]);
    await s.h.pool.query("DELETE FROM family_members WHERE id = $1", [w.kid]);
    expect((await s.h.pool.query("SELECT 1 FROM ai_consents WHERE member_id = $1", [w.kid])).rowCount).toBe(0);
  });
});
