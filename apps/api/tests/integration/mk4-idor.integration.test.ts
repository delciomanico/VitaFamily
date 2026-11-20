/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Matriz IDOR e de autorização de TODAS as rotas MK4 (S10; TC-AZ-MKT-26..32; BR-MKT-67..75, 79..81; authorization.md §13). PostgreSQL real + API
// real validada contra o openapi.yaml, com a flag da receita LIGADA. As matrizes geram-se do inventário do yaml: operação nova sem linha falha.
//   - Família (/families/{f}/members/{m}/record-shares*), TC-AZ-MKT-26/27: papéis SELF, TUTOR_OF, DEPENDENT_SELF, OTHER (Family Admin e membro comum
//     sem relação), `SharingGrant` (lê o registo mas NÃO partilha) × 6 operações. Permitidos ⇒ 200/201; negados ⇒ 403 idêntico e SEM efeito. Outra
//     família, utilizador sem família, ids inexistentes, partilha/marcação de outro membro, partilha de outra família ⇒ 404 IDÊNTICO ao de ids novos.
//   - Profissional (/professional-portal/shares* e …/prescription*), TC-AZ-MKT-28/29: sem token/User/admin/clínica ⇒ 401; recurso de outro
//     profissional ou inexistente ⇒ 404 idêntico; listas só devolvem o que é seu; matriz estado de validação × operação.
//   - Tokens cruzados, TC-AZ-MKT-32. Admin sem rota de partilhas/receitas, TC-AZ-MKT-31 (inventário do yaml e pedidos reais).
// Em TODOS os erros o corpo não contém nenhum id do cenário nem dados pessoais.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openApiSpecPath } from "../support/openapi-spec.js";
import { isMk4Path, makeCaller, parseOpsWithCodes, seedShareRow, stripTransport, type CallOptions, type Mk4Op } from "../support/mk4-ops.js";
import { MK4_OPERATION_IDS } from "../support/mk4-pending.js";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const yaml = readFileSync(openApiSpecPath(REPO_ROOT), "utf8");
const ALL_OPS = parseOpsWithCodes(yaml);
const OPS = new Map<string, Mk4Op>(ALL_OPS.filter((op) => MK4_OPERATION_IDS.has(op.id)).map((op) => [op.id, op] as const));

let c: ConsultationsHarness;
let call: ReturnType<typeof makeCaller>;

const bodyOf = (res: { body: unknown }): Record<string, any> => res.body as Record<string, any>;
const at = (ms: number): Date => new Date(START.getTime() + ms);
let hourSeq = 0;
const nextStart = (): Date => at((10 + hourSeq++) * HOUR);
const medication = () => ({ name: "Amoxicilina IDOR", dosage: "500 mg", scheduleType: "FIXED_TIMES", times: ["08:00"], startAt: at(DAY).toISOString(), endAt: at(8 * DAY).toISOString(), continuous: false });

interface Side {
  pro: ProfessionalFixture;
  token: string;
  offer: OfferFixture;
  u: UserFixture;
  fam: string;
  m: string;
  /** Marcação CONFIRMED, partilha ACTIVE sobre ela, e marcação COMPLETED (há 1 h) ainda sem receita. */
  bk: string;
  share: string;
  done: string;
}

/** Profissional APPROVED e uma família com titular adulto; marcações semeadas e uma partilha por SQL. */
async function side(label: string): Promise<Side> {
  c.h.clock.set(START);
  const pro = await c.professional({ name: `Dra. ${label}` });
  const offer = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 0 });
  const u = await c.user(`idor-${label}`);
  const fam = await c.family(`Família ${label}`);
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Titular ${label}` });
  const bk = (await c.seedBooking({ familyId: fam, memberId: m, offer, startsAt: nextStart(), status: "CONFIRMED", createdByUserId: u.id })).bookingId;
  const done = await completedFor({ pro, offer, fam, m, u });
  const share = await seedShareRow(c.h.pool, { familyId: fam, memberId: m, professionalId: pro.professionalId, bookingId: bk, createdAt: START, createdByUserId: u.id });
  return { pro, token: await c.professionalToken(pro.professionalId), offer, u, fam, m, bk, share, done };
}

async function completedFor(p: { offer: OfferFixture; fam: string; m: string; u: UserFixture; pro?: ProfessionalFixture }): Promise<string> {
  const id = (await c.seedBooking({ familyId: p.fam, memberId: p.m, offer: p.offer, startsAt: nextStart(), status: "CONFIRMED", createdByUserId: p.u.id })).bookingId;
  await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2 WHERE id = $1", [id, at(-HOUR)]);
  return id;
}

interface Ctx {
  a: Side;
  b: Side;
  admin: UserFixture;
  clinicToken: string;
  none: UserFixture;
  /** Family Admin de A sem relação com `a.m`. */
  fa: UserFixture;
  /** Membro comum de A sem relação com `a.m`. */
  other: UserFixture;
  /** Membro de A que lê `a.m` por `SharingGrant` (MEDICATION). */
  grantee: UserFixture;
  /** Dependente com conta (DEPENDENT_SELF), tutelado por `a.m`, com marcação e partilha. */
  dep: UserFixture;
  depM: string;
  depBk: string;
  depShare: string;
}
let ctx: Ctx;

beforeAll(async () => {
  c = await startConsultationsHarness({ digitalPrescription: true });
  call = makeCaller(c.h.app, OPS);
  const a = await side("A");
  const b = await side("B");
  const fa = await c.user("family-admin");
  await c.member(a.fam, { userId: fa.id, role: "FAMILY_ADMIN", name: "Admin sem relação" });
  const other = await c.user("membro-outro");
  await c.member(a.fam, { userId: other.id, role: "FAMILY_MEMBER", name: "Membro sem relação" });
  const grantee = await c.user("grantee");
  const gM = await c.member(a.fam, { userId: grantee.id, role: "FAMILY_MEMBER", name: "Leitor por concessão" });
  await c.sharing(a.fam, a.m, gM, "MEDICATION");
  const dep = await c.user("dependente", { birth: "2012-01-01" });
  const depM = await c.member(a.fam, { dependent: true, userId: dep.id, guardians: [a.m], name: "Dependente com conta" });
  const depBk = (await c.seedBooking({ familyId: a.fam, memberId: depM, offer: a.offer, startsAt: nextStart(), status: "CONFIRMED", createdByUserId: a.u.id })).bookingId;
  const depShare = await seedShareRow(c.h.pool, { familyId: a.fam, memberId: depM, professionalId: a.pro.professionalId, bookingId: depBk, createdAt: START, createdByUserId: a.u.id });
  ctx = { a, b, admin: await c.admin(), clinicToken: await c.h.clinicToken(), none: await c.user("sem-familia"), fa, other, grantee, dep, depM, depBk, depShare };
}, 300_000);

afterAll(async () => {
  await c.stop();
});

/** Todos os ids do cenário: nenhum pode aparecer em corpos de erro. */
function allIds(): string[] {
  const ids: string[] = [];
  for (const s of [ctx.a, ctx.b]) ids.push(s.fam, s.m, s.bk, s.share, s.done, s.pro.professionalId, s.u.id);
  ids.push(ctx.depM, ctx.depBk, ctx.depShare, ctx.fa.id, ctx.other.id, ctx.grantee.id, ctx.dep.id, ctx.none.id);
  return ids;
}

/** Corpo de erro `application/problem+json` sem nenhum id do cenário (nem dados pessoais). */
function expectCleanProblem(res: request.Response, label: string): void {
  expect(res.headers["content-type"], label).toMatch(/application\/problem\+json/);
  const dump = JSON.stringify(res.body);
  for (const id of allIds()) expect(dump, `${label} contém ${id}`).not.toContain(id);
  expect(dump, label).not.toMatch(/@exemplo\.ao|Dra\. |Titular |Família [AB]\b|Amoxicilina|Semente/);
}

/** Estado das partilhas e das vistas (para provar que um pedido negado não tem efeito). */
async function snapshot(): Promise<unknown> {
  const shares = await c.h.pool.query("SELECT id, status, view_count, revoked_at, consumed_at FROM record_shares ORDER BY id");
  const views = await c.h.pool.query("SELECT count(*)::int AS n FROM record_share_views");
  const rx = await c.h.pool.query("SELECT count(*)::int AS n FROM prescriptions");
  const plans = await c.h.pool.query("SELECT count(*)::int AS n FROM medication_plans");
  return { shares: shares.rows, views: views.rows, rx: rx.rows, plans: plans.rows };
}

// ---------------------------------------------------------------------------------------------------------------------
describe("família: papéis × operações de record-sharing (TC-AZ-MKT-26/27; authorization.md §13.1)", () => {
  interface FamilyRoute {
    op: string;
    /** Parâmetros e corpo para (família, membro, marcação, partilha) dados. */
    build(t: { fam: string; m: string; bk: string; share: string }): CallOptions;
    okStatus: number;
  }
  const FAMILY_ROUTES: FamilyRoute[] = [
    { op: "getRecordShareOptions", okStatus: 200, build: (t) => ({ params: { familyId: t.fam, memberId: t.m }, query: { bookingId: t.bk } }) },
    { op: "listRecordShares", okStatus: 200, build: (t) => ({ params: { familyId: t.fam, memberId: t.m } }) },
    { op: "createRecordShare", okStatus: 201, build: (t) => ({ params: { familyId: t.fam, memberId: t.m }, body: { bookingId: t.bk, categories: ["MEDICATION"], validity: "H24" } }) },
    { op: "getRecordShare", okStatus: 200, build: (t) => ({ params: { familyId: t.fam, memberId: t.m, shareId: t.share } }) },
    { op: "listRecordShareViews", okStatus: 200, build: (t) => ({ params: { familyId: t.fam, memberId: t.m, shareId: t.share } }) },
    { op: "revokeRecordShare", okStatus: 200, build: (t) => ({ params: { familyId: t.fam, memberId: t.m, shareId: t.share } }) },
  ];

  const withToken = (o: CallOptions, token: string | undefined): CallOptions => ({ ...o, token });
  /** Alvo «próprio» de A (membro `a.m`) e do dependente. */
  const target = () => ({ fam: ctx.a.fam, m: ctx.a.m, bk: ctx.a.bk, share: ctx.a.share });
  const depTarget = () => ({ fam: ctx.a.fam, m: ctx.depM, bk: ctx.depBk, share: ctx.depShare });

  interface Role {
    name: string;
    token(): string;
    /** O alvo onde o papel se exerce. */
    on(): { fam: string; m: string; bk: string; share: string };
    expected: { status: number; code: string } | "ALLOW";
  }
  const ROLES: Role[] = [
    { name: "SELF (titular adulto)", token: () => ctx.a.u.token, on: target, expected: "ALLOW" },
    { name: "TUTOR_OF (tutor do dependente)", token: () => ctx.a.u.token, on: depTarget, expected: "ALLOW" },
    { name: "DEPENDENT_SELF (o dependente no seu membro)", token: () => ctx.dep.token, on: depTarget, expected: { status: 403, code: "FORBIDDEN" } },
    { name: "OTHER: Family Admin sem relação", token: () => ctx.fa.token, on: target, expected: { status: 403, code: "FORBIDDEN" } },
    { name: "OTHER: membro comum sem relação", token: () => ctx.other.token, on: target, expected: { status: 403, code: "FORBIDDEN" } },
    { name: "SharingGrant (lê o registo mas não partilha)", token: () => ctx.grantee.token, on: target, expected: { status: 403, code: "FORBIDDEN" } },
    { name: "Family Admin sem relação no dependente", token: () => ctx.fa.token, on: depTarget, expected: { status: 403, code: "FORBIDDEN" } },
  ];

  it("a matriz gerada cobre as operações de família do inventário do yaml (operação nova sem linha falha)", () => {
    const inventory = [...OPS.values()].filter((op) => op.path.startsWith("/families/")).map((op) => op.id).sort();
    expect(inventory).toHaveLength(6);
    expect(FAMILY_ROUTES.map((r) => r.op).sort()).toEqual(inventory);
  });

  describe("negados: 403 idêntico e sem efeito", () => {
    const rows = ROLES.filter((r) => r.expected !== "ALLOW").flatMap((role) => FAMILY_ROUTES.map((route) => [`${role.name} — ${route.op}`, role, route] as const));
    it.each(rows)("%s", async (label, role, route) => {
      const before = await snapshot();
      const res = await call(route.op, withToken(route.build(role.on()), role.token()));
      const expected = role.expected as { status: number; code: string };
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(expected.status);
      expect(bodyOf(res).code, label).toBe(expected.code);
      expectCleanProblem(res, label);
      expect(await snapshot(), `${label}: efeito num pedido negado`).toEqual(before);
    });

    it("os 403 são idênticos entre papéis e operações (sem revelar o motivo nem a relação)", async () => {
      const bodies = new Set<string>();
      for (const role of ROLES.filter((r) => r.expected !== "ALLOW")) {
        for (const route of FAMILY_ROUTES) bodies.add(JSON.stringify(stripTransport((await call(route.op, withToken(route.build(role.on()), role.token()))).body)));
      }
      expect(bodies.size).toBe(1);
    });
  });

  describe("permitidos: SELF e TUTOR_OF (200/201; revogar sobre partilha própria e nova)", () => {
    const rows = ROLES.filter((r) => r.expected === "ALLOW").flatMap((role) => FAMILY_ROUTES.map((route) => [`${role.name} — ${route.op}`, role, route] as const));
    it.each(rows)("%s", async (label, role, route) => {
      const t = role.on();
      // Revogar gasta a partilha: usa-se uma nova (semeada) do mesmo membro e profissional.
      const share = route.op === "revokeRecordShare" ? await seedShareRow(c.h.pool, { familyId: t.fam, memberId: t.m, professionalId: ctx.a.pro.professionalId, bookingId: t.bk, createdAt: START, createdByUserId: ctx.a.u.id }) : t.share;
      const res = await call(route.op, withToken(route.build({ ...t, share }), role.token()));
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(route.okStatus);
      if (route.op === "revokeRecordShare") expect(bodyOf(res).status).toBe("REVOKED");
    });

    it("os dois tutores veem as mesmas partilhas (a autoria não é devolvida)", async () => {
      const res = await call("getRecordShare", { params: { familyId: ctx.a.fam, memberId: ctx.depM, shareId: ctx.depShare }, token: ctx.a.u.token });
      expect(res.status).toBe(200);
      expect(Object.keys(bodyOf(res))).not.toContain("createdByUserId");
      expect(JSON.stringify(res.body)).not.toContain(ctx.a.u.id);
    });
  });

  describe("404 idêntico (alheio ≡ inexistente) e sem efeito", () => {
    interface Alien {
      name: string;
      token(): string;
      /**
       * `all`: família, membro e recurso aleatórios no gémeo; `resource`: só marcação/partilha (a família/membro são os do próprio ator);
       * `member`: membro e recurso (a família é a do próprio ator: o `detail` distingue «Família» de «Membro» só para quem já pertence à família).
       */
      twin: "all" | "resource" | "member";
      build(route: FamilyRoute): CallOptions;
    }
    const mine = (r: FamilyRoute, t: { fam: string; m: string; bk: string; share: string }, token: string): CallOptions => withToken(r.build(t), token);
    const ALIENS: Alien[] = [
      { name: "utilizador da família B nos ids de A", token: () => ctx.b.u.token, twin: "all", build: (r) => mine(r, target(), ctx.b.u.token) },
      { name: "utilizador sem família nos ids de A", token: () => ctx.none.token, twin: "all", build: (r) => mine(r, target(), ctx.none.token) },
      { name: "titular de A com a família inexistente", token: () => ctx.a.u.token, twin: "all", build: (r) => mine(r, { ...target(), fam: randomUUID() }, ctx.a.u.token) },
      { name: "titular de A com o membro inexistente", token: () => ctx.a.u.token, twin: "member", build: (r) => mine(r, { ...target(), m: randomUUID() }, ctx.a.u.token) },
      { name: "titular de A com a partilha/marcação inexistente", token: () => ctx.a.u.token, twin: "resource", build: (r) => mine(r, { ...target(), bk: randomUUID(), share: randomUUID() }, ctx.a.u.token) },
      { name: "titular de A (tutor do dependente) com a partilha/marcação do titular no caminho do dependente", token: () => ctx.a.u.token, twin: "resource", build: (r) => mine(r, { ...depTarget(), bk: ctx.a.bk, share: ctx.a.share }, ctx.a.u.token) },
      { name: "titular de A no seu membro com a partilha/marcação do dependente", token: () => ctx.a.u.token, twin: "resource", build: (r) => mine(r, { ...target(), bk: ctx.depBk, share: ctx.depShare }, ctx.a.u.token) },
      { name: "titular de A no seu membro com a partilha/marcação da família B", token: () => ctx.a.u.token, twin: "resource", build: (r) => mine(r, { ...target(), bk: ctx.b.bk, share: ctx.b.share }, ctx.a.u.token) },
    ];
    // `listRecordShares` não leva marcação nem partilha: nos cenários «de recurso» não há nada alheio a pedir.
    const rows = ALIENS.flatMap((alien) => FAMILY_ROUTES.filter((route) => alien.twin !== "resource" || route.op !== "listRecordShares").map((route) => [`${alien.name} — ${route.op}`, alien, route] as const));

    it.each(rows)("%s", async (label, alien, route) => {
      const before = await snapshot();
      const res = await call(route.op, alien.build(route));
      expect([res.status, bodyOf(res).code], `${label}: ${JSON.stringify(res.body)}`).toEqual([404, "NOT_FOUND"]);
      expectCleanProblem(res, label);
      // gémeo: o mesmo ator no mesmo caminho com ids que não existem ⇒ corpo igual (sem oráculo de existência).
      const real = alien.build(route);
      const fresh = (keys: string[]): Record<string, string> => Object.fromEntries(keys.map((k) => [k, randomUUID()]));
      const twin: CallOptions = {
        ...real,
        params: { ...(real.params ?? {}), ...fresh(Object.keys(real.params ?? {}).filter((k) => (alien.twin === "all" ? true : alien.twin === "member" ? k !== "familyId" : k === "shareId"))) },
        ...(real.query ? { query: { bookingId: randomUUID() } } : {}),
        ...(real.body ? { body: { ...real.body, bookingId: randomUUID() } } : {}),
      };
      const ref = await call(route.op, twin);
      expect(ref.status, `${label} (gémeo)`).toBe(404);
      expect(stripTransport(res.body), label).toEqual(stripTransport(ref.body));
      expect(await snapshot(), `${label}: efeito num pedido negado`).toEqual(before);
    });
  });

  it("criar com a marcação de outro membro/família ou de outro profissional alheio ⇒ 404 e nada criado (TC-AZ-MKT-27: forjar bookingId)", async () => {
    const before = await snapshot();
    for (const bk of [ctx.depBk, ctx.b.bk, randomUUID()]) {
      const res = await call("createRecordShare", { params: { familyId: ctx.a.fam, memberId: ctx.a.m }, token: ctx.a.u.token, body: { bookingId: bk, categories: ["MEDICATION"], validity: "H24" } });
      expect([res.status, bodyOf(res).code]).toEqual([404, "NOT_FOUND"]);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("as listas só trazem as partilhas do membro: nunca as do dependente nem as de outra família", async () => {
    const list = async (token: string, fam: string, m: string): Promise<string[]> => (bodyOf(await call("listRecordShares", { params: { familyId: fam, memberId: m }, token })).items as { id: string }[]).map((i) => i.id);
    const own = await list(ctx.a.u.token, ctx.a.fam, ctx.a.m);
    const dep = await list(ctx.a.u.token, ctx.a.fam, ctx.depM);
    const alien = await list(ctx.b.u.token, ctx.b.fam, ctx.b.m);
    expect(own).toContain(ctx.a.share);
    expect(own).not.toContain(ctx.depShare);
    expect(own).not.toContain(ctx.b.share);
    expect(dep).toContain(ctx.depShare);
    expect(dep).not.toContain(ctx.a.share);
    expect(alien).toContain(ctx.b.share);
    expect(alien).not.toContain(ctx.a.share);
  });

  it("as vistas só se alcançam através da partilha do membro: partilha de outro membro/família ⇒ 404", async () => {
    for (const [fam, m, token, share] of [
      [ctx.a.fam, ctx.a.m, ctx.a.u.token, ctx.depShare],
      [ctx.a.fam, ctx.depM, ctx.a.u.token, ctx.a.share],
      [ctx.b.fam, ctx.b.m, ctx.b.u.token, ctx.a.share],
    ] as const) {
      expect((await call("listRecordShareViews", { params: { familyId: fam, memberId: m, shareId: share }, token })).status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("profissional: atores × operações (TC-AZ-MKT-28/29/32; authorization.md §13.2, §13.4)", () => {
  interface ProRoute {
    op: string;
    /** Parâmetros do recurso de `s` e o corpo. */
    build(s: Side): CallOptions;
    list?: boolean;
  }
  const PRO_ROUTES: ProRoute[] = [
    { op: "listProfessionalShares", list: true, build: () => ({}) },
    { op: "getProfessionalShare", build: (s) => ({ params: { shareId: s.share } }) },
    { op: "openProfessionalShare", build: (s) => ({ params: { shareId: s.share } }) },
    { op: "issueProfessionalPrescription", build: (s) => ({ params: { bookingId: s.done }, body: { medications: [medication()] } }) },
    { op: "getProfessionalBookingPrescription", build: (s) => ({ params: { bookingId: s.done } }) },
  ];

  it("a matriz gerada cobre as operações do portal do inventário do yaml (operação nova sem linha falha)", () => {
    const inventory = [...OPS.values()].filter((op) => op.path.startsWith("/professional-portal/")).map((op) => op.id).sort();
    expect(inventory).toHaveLength(5);
    expect(PRO_ROUTES.map((r) => r.op).sort()).toEqual(inventory);
  });

  const with401 = [
    { name: "sem token", token: (): string | undefined => undefined },
    { name: "token de User (titular da família)", token: (): string | undefined => ctx.a.u.token },
    { name: "token de User de outra família", token: (): string | undefined => ctx.b.u.token },
    { name: "token de User administrador da plataforma", token: (): string | undefined => ctx.admin.token },
    { name: "token de clínica", token: (): string | undefined => ctx.clinicToken },
  ];
  const rows401 = PRO_ROUTES.flatMap((route) => with401.map((who) => [`${route.op} — ${who.name}`, route, who] as const));
  it.each(rows401)("%s ⇒ 401, sem efeito", async (label, route, who) => {
    const before = await snapshot();
    const res = await call(route.op, { ...route.build(ctx.a), token: who.token() });
    expect([res.status, bodyOf(res).code], `${label}: ${JSON.stringify(res.body)}`).toEqual([401, "UNAUTHENTICATED"]);
    expectCleanProblem(res, label);
    expect(await snapshot()).toEqual(before);
  });

  it("outro profissional (P2) nos recursos de P1 ou com ids inexistentes ⇒ 404 idêntico, sem efeito; a lista só traz as próprias partilhas", async () => {
    const before = await snapshot();
    for (const route of PRO_ROUTES.filter((r) => r.list !== true)) {
      const alien = await call(route.op, { ...route.build(ctx.a), token: ctx.b.token });
      const fresh = await call(route.op, { ...route.build({ ...ctx.a, share: randomUUID(), done: randomUUID() }), token: ctx.b.token });
      expect([alien.status, bodyOf(alien).code], `${route.op}: ${JSON.stringify(alien.body)}`).toEqual([404, "NOT_FOUND"]);
      expect(stripTransport(alien.body), route.op).toEqual(stripTransport(fresh.body));
      expectCleanProblem(alien, route.op);
    }
    expect(await snapshot()).toEqual(before);
    const ids = (bodyOf(await call("listProfessionalShares", { token: ctx.b.token })).items as { id: string }[]).map((i) => i.id);
    expect(ids).toContain(ctx.b.share);
    expect(ids).not.toContain(ctx.a.share);
    expect(ids).not.toContain(ctx.depShare);
  });

  it("TC-AZ-MKT-29: o filtro bookingId de outro profissional dá lista vazia; o do próprio dá a sua partilha", async () => {
    const alien = await call("listProfessionalShares", { token: ctx.b.token, query: { bookingId: ctx.a.bk } });
    expect([alien.status, bodyOf(alien).items]).toEqual([200, []]);
    const own = await call("listProfessionalShares", { token: ctx.a.token, query: { bookingId: ctx.a.bk } });
    const items = bodyOf(own).items as { id: string; bookingId: string }[];
    expect(items.map((i) => i.id)).toContain(ctx.a.share);
    for (const item of items) expect(item.bookingId).toBe(ctx.a.bk);
  });

  it("o dono: lista, detalhe e abertura 200; a receita de marcação sem receita ⇒ 404 antes da emissão; emite (201) e lê (200); a de P2 continua 404 idêntico", async () => {
    expect((await call("listProfessionalShares", { token: ctx.a.token })).status).toBe(200);
    expect((await call("getProfessionalShare", { params: { shareId: ctx.a.share }, token: ctx.a.token })).status).toBe(200);
    expect((await call("openProfessionalShare", { params: { shareId: ctx.a.share }, token: ctx.a.token })).status).toBe(200);
    expect((await call("getProfessionalBookingPrescription", { params: { bookingId: ctx.a.done }, token: ctx.a.token })).status).toBe(404);
    expect((await call("issueProfessionalPrescription", { params: { bookingId: ctx.a.done }, token: ctx.a.token, body: { medications: [medication()] } })).status).toBe(201);
    expect((await call("getProfessionalBookingPrescription", { params: { bookingId: ctx.a.done }, token: ctx.a.token })).status).toBe(200);
    const alien = await call("getProfessionalBookingPrescription", { params: { bookingId: ctx.a.done }, token: ctx.b.token });
    const fresh = await call("getProfessionalBookingPrescription", { token: ctx.b.token });
    expect(alien.status).toBe(404);
    expect(stripTransport(alien.body)).toEqual(stripTransport(fresh.body));
    // P2 não emite receita na marcação de P1 (404) e a receita de P1 continua intacta.
    const hijack = await call("issueProfessionalPrescription", { params: { bookingId: ctx.a.done }, token: ctx.b.token, body: { medications: [medication()] } });
    expect(hijack.status).toBe(404);
    expect((await c.h.pool.query("SELECT count(*)::int AS n FROM prescriptions WHERE booking_id = $1", [ctx.a.done])).rows[0]?.n).toBe(1);
  });

  describe("TC-AZ-MKT-28: estado de validação × operação (authorization.md §13.2)", () => {
    const STATES = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "APPROVED", "REJECTED", "SUSPENDED"] as const;
    interface Expected {
      status: number;
      code?: string;
    }
    /** Matriz do contrato: ver/listar e ler a receita em todos os estados; abrir e emitir só com APPROVED. */
    const MATRIX: Record<(typeof PRO_ROUTES)[number]["op"], (state: string) => Expected> = {
      listProfessionalShares: () => ({ status: 200 }),
      getProfessionalShare: () => ({ status: 200 }),
      openProfessionalShare: (state) => (state === "APPROVED" ? { status: 200 } : { status: 403, code: "SHARE_NOT_AVAILABLE" }),
      getProfessionalBookingPrescription: () => ({ status: 200 }),
      issueProfessionalPrescription: (state) => (state === "APPROVED" ? { status: 201 } : { status: 409, code: "PROFESSIONAL_LOCKED" }),
    };

    it("a matriz cobre todas as operações do portal (operação nova sem linha falha)", () => {
      expect(Object.keys(MATRIX).sort()).toEqual(PRO_ROUTES.map((r) => r.op).sort());
    });

    it.each(STATES)("%s", async (state) => {
      const s = await side(`estado-${state}`);
      const issued = await call("issueProfessionalPrescription", { params: { bookingId: s.done }, token: s.token, body: { medications: [medication()] } });
      expect(issued.status).toBe(201);
      const fresh = await completedFor({ offer: s.offer, fam: s.fam, m: s.m, u: s.u });
      await c.h.pool.query("UPDATE professionals SET validation_status = $2::professional_validation_status WHERE id = $1", [s.pro.professionalId, state]);
      const refusedOpen: string[] = [];
      for (const route of PRO_ROUTES) {
        const expected = MATRIX[route.op]?.(state) ?? { status: -1 };
        const o = route.op === "issueProfessionalPrescription" ? { params: { bookingId: fresh }, body: { medications: [medication()] } } : route.build(s);
        const res = await call(route.op, { ...o, token: s.token });
        expect(res.status, `${state} ${route.op}: ${JSON.stringify(res.body)}`).toBe(expected.status);
        if (expected.code) expect(bodyOf(res).code, `${state} ${route.op}`).toBe(expected.code);
        if (route.op === "openProfessionalShare" && expected.status === 403) refusedOpen.push(JSON.stringify(stripTransport(res.body)));
      }
      // Sem emissão fora de APPROVED e sem consumo de partilha: a receita de `fresh` só existe se APPROVED.
      const expectedRx = state === "APPROVED" ? 1 : 0;
      expect((await c.h.pool.query("SELECT count(*)::int AS n FROM prescriptions WHERE booking_id = $1", [fresh])).rows[0]?.n).toBe(expectedRx);
      expect((await c.h.pool.query("SELECT view_count FROM record_shares WHERE id = $1", [s.share])).rows[0]?.view_count).toBe(state === "APPROVED" ? 1 : 0);
      // A recusa de abrir é a mesma (corpo igual) em todos os estados não aprovados: sem oráculo do estado.
      if (state !== "APPROVED") expect(new Set(refusedOpen).size).toBe(1);
    }, 60_000);

    it("a recusa de abrir é idêntica em todos os estados não aprovados e à de uma partilha revogada/expirada (sem oráculo)", async () => {
      const bodies = new Set<string>();
      for (const state of ["DRAFT", "REJECTED", "SUSPENDED"] as const) {
        const s = await side(`oraculo-${state}`);
        await c.h.pool.query("UPDATE professionals SET validation_status = $2::professional_validation_status WHERE id = $1", [s.pro.professionalId, state]);
        bodies.add(JSON.stringify(stripTransport((await call("openProfessionalShare", { params: { shareId: s.share }, token: s.token })).body)));
      }
      const r = await side("oraculo-revogada");
      await c.h.pool.query("UPDATE record_shares SET status = 'REVOKED', revoked_at = $2 WHERE id = $1", [r.share, START]);
      bodies.add(JSON.stringify(stripTransport((await call("openProfessionalShare", { params: { shareId: r.share }, token: r.token })).body)));
      expect(bodies.size).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("tokens cruzados (TC-AZ-MKT-32; TC-AZ-MKT-01 estendido a MK4)", () => {
  const familyOps = (): [string, CallOptions][] => [
    ["getRecordShareOptions", { params: { familyId: ctx.a.fam, memberId: ctx.a.m }, query: { bookingId: ctx.a.bk } }],
    ["listRecordShares", { params: { familyId: ctx.a.fam, memberId: ctx.a.m } }],
    ["createRecordShare", { params: { familyId: ctx.a.fam, memberId: ctx.a.m }, body: { bookingId: ctx.a.bk, categories: ["MEDICATION"], validity: "H24" } }],
    ["getRecordShare", { params: { familyId: ctx.a.fam, memberId: ctx.a.m, shareId: ctx.a.share } }],
    ["listRecordShareViews", { params: { familyId: ctx.a.fam, memberId: ctx.a.m, shareId: ctx.a.share } }],
    ["revokeRecordShare", { params: { familyId: ctx.a.fam, memberId: ctx.a.m, shareId: ctx.a.share } }],
  ];

  it("token de ProfessionalAccount em /families/*/record-shares* ⇒ 401 (e a partilha fica intacta)", async () => {
    const before = await snapshot();
    for (const [op, o] of familyOps()) {
      const res = await call(op, { ...o, token: ctx.a.token });
      expect([res.status, bodyOf(res).code], op).toEqual([401, "UNAUTHENTICATED"]);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("token de ClinicAccount em /families/*/record-shares* ⇒ 401", async () => {
    for (const [op, o] of familyOps()) expect((await call(op, { ...o, token: ctx.clinicToken })).status, op).toBe(401);
  });

  it("token de ProfessionalAccount em /marketplace/* e /admin/* ⇒ 401", async () => {
    for (const url of [`${API}/marketplace/professionals`, `${API}/marketplace/filters`, `${API}/admin/professionals`, `${API}/admin/payment-disputes`, `${API}/admin/specialties`]) {
      const res = await request(c.h.app).get(url).set({ Authorization: `Bearer ${ctx.a.token}` });
      expect(res.status, url).toBe(401);
    }
  });

  it("token de User de outra família a abrir uma partilha ⇒ 401; User do próprio titular também (a abertura é só do profissional)", async () => {
    for (const token of [ctx.b.u.token, ctx.a.u.token]) {
      const res = await call("openProfessionalShare", { params: { shareId: ctx.a.share }, token });
      expect([res.status, bodyOf(res).code]).toEqual([401, "UNAUTHENTICATED"]);
    }
    expect((await c.h.pool.query("SELECT view_count FROM record_shares WHERE id = $1 AND view_count = 0", [ctx.depShare])).rowCount).toBe(1);
  });

  it("o mesmo e-mail em users e professional_accounts não dá acesso cruzado", async () => {
    const email = `dupla-${randomUUID()}@exemplo.ao`;
    const pro = await c.professional({ email });
    const user = await c.user("dupla", { email });
    const proToken = await c.professionalToken(pro.professionalId);
    expect((await call("listProfessionalShares", { token: user.token })).status).toBe(401);
    expect((await call("listRecordShares", { params: { familyId: ctx.a.fam, memberId: ctx.a.m }, token: proToken })).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("admin sem acesso a partilhas, vistas, conteúdo partilhado e receitas (TC-AZ-MKT-31; authorization.md §13.3; D4)", () => {
  it("inventário do yaml: nenhuma rota /admin/* lê ou altera partilhas, vistas, conteúdo partilhado ou receitas de profissional", () => {
    const adminOps = ALL_OPS.filter((op) => op.path.startsWith("/admin/"));
    expect(adminOps.length).toBeGreaterThan(10);
    for (const op of adminOps) {
      expect(isMk4Path(op.path), `${op.id} ${op.path}`).toBe(false);
      expect(op.path, `${op.id} ${op.path}`).not.toMatch(/share|record|prescription|\/views?(\/|\{|$)/i);
      expect(op.id, op.id).not.toMatch(/share|prescription|sharedRecords/i);
    }
    // e nenhuma operação de MK4 é de /admin: todas são da família ou do portal do profissional.
    for (const op of OPS.values()) expect(/^\/(families\/|professional-portal\/)/.test(op.path), op.id).toBe(true);
  });

  it("o administrador (User com a flag de plataforma) não alcança nenhuma rota de MK4: nunca 2xx; sem efeito", async () => {
    const before = await snapshot();
    const attempts: [string, CallOptions][] = [
      ["getRecordShareOptions", { params: { familyId: ctx.a.fam, memberId: ctx.a.m }, query: { bookingId: ctx.a.bk } }],
      ["listRecordShares", { params: { familyId: ctx.a.fam, memberId: ctx.a.m } }],
      ["createRecordShare", { params: { familyId: ctx.a.fam, memberId: ctx.a.m }, body: { bookingId: ctx.a.bk, categories: ["MEDICATION"], validity: "H24" } }],
      ["getRecordShare", { params: { familyId: ctx.a.fam, memberId: ctx.a.m, shareId: ctx.a.share } }],
      ["listRecordShareViews", { params: { familyId: ctx.a.fam, memberId: ctx.a.m, shareId: ctx.a.share } }],
      ["revokeRecordShare", { params: { familyId: ctx.a.fam, memberId: ctx.a.m, shareId: ctx.a.share } }],
      ["listProfessionalShares", {}],
      ["getProfessionalShare", { params: { shareId: ctx.a.share } }],
      ["openProfessionalShare", { params: { shareId: ctx.a.share } }],
      ["issueProfessionalPrescription", { params: { bookingId: ctx.a.done }, body: { medications: [medication()] } }],
      ["getProfessionalBookingPrescription", { params: { bookingId: ctx.a.done } }],
    ];
    expect(attempts.map(([op]) => op).sort()).toEqual([...MK4_OPERATION_IDS].sort());
    for (const [op, o] of attempts) {
      const res = await call(op, { ...o, token: ctx.admin.token });
      expect(res.status, `${op}: ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(400);
      expect(res.status, op).toBeLessThan(500);
      expectCleanProblem(res, op);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("tentativas em /admin/* com nomes de partilhas/receitas: User não-admin nunca 2xx, profissional ⇒ 401, administrador ⇒ 404 (a rota não existe)", async () => {
    for (const path of ["/admin/record-shares", `/admin/record-shares/${ctx.a.share}`, `/admin/record-shares/${ctx.a.share}/views`, "/admin/prescriptions", `/admin/bookings/${ctx.a.done}/prescription`]) {
      const user = await request(c.h.app).get(`${API}${path}`).set({ Authorization: `Bearer ${ctx.a.u.token}` });
      expect([401, 403, 404], `User ${path}: ${String(user.status)}`).toContain(user.status);
      const pro = await request(c.h.app).get(`${API}${path}`).set({ Authorization: `Bearer ${ctx.a.token}` });
      expect([401, 403, 404], `profissional ${path}: ${String(pro.status)}`).toContain(pro.status);
      const admin = await request(c.h.app).get(`${API}${path}`).set({ Authorization: `Bearer ${ctx.admin.token}` });
      expect(admin.status, `admin ${path}`).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("matriz gerada: toda a operação MK4 está numa das tabelas (TC-AZ-MKT-26/28)", () => {
  it("as 11 operações MK4 do inventário estão cobertas pelas matrizes de família (6) e do profissional (5)", () => {
    const covered = new Set([
      "getRecordShareOptions", "listRecordShares", "createRecordShare", "getRecordShare", "listRecordShareViews", "revokeRecordShare",
      "listProfessionalShares", "getProfessionalShare", "openProfessionalShare", "issueProfessionalPrescription", "getProfessionalBookingPrescription",
    ]);
    expect([...MK4_OPERATION_IDS].filter((id) => !covered.has(id))).toEqual([]);
    expect(covered.size).toBe(MK4_OPERATION_IDS.size);
  });
});
