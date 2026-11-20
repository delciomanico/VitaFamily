// Integração (PostgreSQL real, app real com validação de pedidos E respostas contra o openapi.yaml) do lado da FAMÍLIA de `record-sharing` (MK4 S6):
// TC-MKT-120 (criação feliz, corpo e auditoria), TC-MKT-121 (prazos, categorias, limites, idempotência e corridas), TC-MKT-122 (listas, detalhe e
// vistas), TC-MKT-126 (leituras não auditadas e limite de taxa), TC-MKT-127 (revogação), TC-MKT-130 (IDOR) e TC-AZ-MKT-27 (matriz de autorização
// nas seis rotas). Partilhas terminadas ou com vistas entram por SQL (o lado do profissional e a abertura são outras fatias).
// Relógio do harness fixo em `START`; cada teste volta a ele (`beforeEach`).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIN = 60_000;
/** Canário de PII (BR-MKT-75): nunca em auditoria, respostas de erro nem logs. */
const LABEL = "canario-s6-partilha";
const LOGS: string[] = [];
/** Categorias HEALTH na ordem do domínio (`DATA_CATEGORIES`). */
const HEALTH_CATEGORIES = ["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"];

type Json = Record<string, unknown>;
interface Page {
  items: Json[];
  nextCursor: string | null;
}
type Validity = "H24" | "D7" | "D30" | "UNTIL_CONSULTATION_END_PLUS_24H";

let c: ConsultationsHarness;
let slotSeq = 0;

const at = (ms: number): Date => new Date(START.getTime() + ms);
/** Início de consulta único: horários do mesmo profissional não se sobrepõem. */
const nextStart = (): Date => at((10 + slotSeq++) * HOUR);
const sharesOf = (fam: string, m: string): string => `${API}/families/${fam}/members/${m}/record-shares`;
const authOf = (token: string | undefined): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
const bodyOf = (res: { body: unknown }): Json => res.body as Json;
const pageOf = (res: { body: unknown }): Page => res.body as Page;
const textOf = (v: unknown): string => {
  if (typeof v !== "string") throw new Error("esperado texto");
  return v;
};
/** Campos de transporte (pedido/instância) que variam por pedido; o resto tem de ser idêntico para não haver enumeração. */
const stripTransport = (body: unknown): unknown => ({ ...(body as object), requestId: 0, instance: 0 });
const idsOf = (res: { body: unknown }): string[] => pageOf(res).items.map((i) => textOf(i.id)).sort();

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

interface AuditRow {
  action: string;
  result: string;
  actor_type: string;
  actor_user_id: string | null;
  family_id: string | null;
  subject_member_id: string | null;
  resource_id: string | null;
  metadata: Json | null;
}

async function auditRows(action: string, resourceId: string): Promise<AuditRow[]> {
  const { rows } = await c.h.pool.query<AuditRow>(
    "SELECT action, result, actor_type, actor_user_id, family_id, subject_member_id, resource_id, metadata FROM audit_logs WHERE action = $1 AND resource_id = $2",
    [action, resourceId],
  );
  return rows;
}

// ---- Pedidos HTTP (a família) ----

const optionsOf = (token: string | undefined, fam: string, m: string, bookingId: string) =>
  request(c.h.app).get(`${sharesOf(fam, m)}/options?bookingId=${bookingId}`).set(authOf(token));
const listOf = (token: string | undefined, fam: string, m: string, query = "") => request(c.h.app).get(`${sharesOf(fam, m)}${query}`).set(authOf(token));
const createOf = (token: string | undefined, fam: string, m: string, body: Json) => request(c.h.app).post(sharesOf(fam, m)).set(authOf(token)).send(body);
const getOf = (token: string | undefined, fam: string, m: string, shareId: string) => request(c.h.app).get(`${sharesOf(fam, m)}/${shareId}`).set(authOf(token));
const viewsOf = (token: string | undefined, fam: string, m: string, shareId: string, query = "") =>
  request(c.h.app).get(`${sharesOf(fam, m)}/${shareId}/views${query}`).set(authOf(token));
const revokeOf = (token: string | undefined, fam: string, m: string, shareId: string) => request(c.h.app).post(`${sharesOf(fam, m)}/${shareId}/revoke`).set(authOf(token));

// ---- Fixtures ----

interface Scene {
  pro: ProfessionalFixture;
  offer: OfferFixture;
  u: UserFixture;
  fam: string;
  m: string;
}

/** Profissional APPROVED (HEALTH, VIDEO 30 min, 5000 Kz) e uma família com um titular adulto (`u`, membro `m`, FAMILY_ADMIN). */
async function scene(name = "Dra. Partilha"): Promise<Scene> {
  const pro = await c.professional({ name });
  const offer = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
  const u = await c.user("ana");
  const fam = await c.family("Família Partilha");
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: "Ana" });
  return { pro, offer, u, fam, m };
}

/** Marcação gerada por SQL (REQUESTED por omissão). Horário por omissão único. */
async function bookingOf(s: Scene, o: { memberId?: string; startsAt?: Date; status?: "REQUESTED" | "CONFIRMED"; label?: string } = {}): Promise<string> {
  const { bookingId } = await c.seedBooking({
    familyId: s.fam,
    memberId: o.memberId ?? s.m,
    offer: s.offer,
    startsAt: o.startsAt ?? nextStart(),
    status: o.status ?? "REQUESTED",
    label: o.label ?? "Ana",
  });
  return bookingId;
}

/** Passa a marcação a COMPLETED (com `completed_at`) ou a CANCELLED pela família (libertando o horário). */
async function setBookingStatus(bookingId: string, status: "COMPLETED" | "CANCELLED", when: Date): Promise<void> {
  if (status === "COMPLETED") {
    await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2 WHERE id = $1", [bookingId, when]);
  } else {
    await c.h.pool.query("UPDATE bookings SET status = 'CANCELLED', cancelled_by = 'FAMILY', cancelled_at = $2, slot_id = NULL WHERE id = $1", [bookingId, when]);
  }
}

/** Especialidade do profissional passa a WELLNESS (só MEDICATION é partilhável, BR-MKT-68). */
async function makeWellness(s: Scene): Promise<void> {
  await c.h.pool.query("UPDATE specialties SET category = 'WELLNESS' WHERE id = $1", [s.pro.specialtyId]);
}

interface SeedShare {
  familyId: string;
  memberId: string;
  professionalId: string;
  bookingId: string;
  label?: string;
  professionalCategory?: "HEALTH" | "WELLNESS";
  categories?: string[];
  validity?: Validity;
  viewOnce?: boolean;
  createdAt?: Date;
  expiresAt?: Date;
  status?: "ACTIVE" | "REVOKED" | "CONSUMED";
  revokedAt?: Date | null;
  consumedAt?: Date | null;
  viewCount?: number;
  lastViewedAt?: Date | null;
  createdByUserId?: string | null;
}

/** Partilha inserida por SQL (respeita as CHECK da migração 0046; o trigger só age em UPDATE). */
async function seedShare(p: SeedShare): Promise<string> {
  const id = randomUUID();
  const createdAt = p.createdAt ?? START;
  await c.h.pool.query(
    `INSERT INTO record_shares (id, family_id, member_id, professional_id, booking_id, participant_label, professional_category, categories, validity,
       view_once, expires_at, status, revoked_at, consumed_at, view_count, last_viewed_at, created_by_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::specialty_category,$8::data_category[],$9::share_validity,$10,$11,$12::record_share_status,$13,$14,$15,$16,$17,$18,$18)`,
    [
      id,
      p.familyId,
      p.memberId,
      p.professionalId,
      p.bookingId,
      p.label ?? "Semente",
      p.professionalCategory ?? "HEALTH",
      p.categories ?? ["MEDICATION"],
      p.validity ?? "H24",
      p.viewOnce ?? false,
      p.expiresAt ?? new Date(createdAt.getTime() + DAY),
      p.status ?? "ACTIVE",
      p.revokedAt ?? null,
      p.consumedAt ?? null,
      p.viewCount ?? 0,
      p.lastViewedAt ?? null,
      p.createdByUserId ?? null,
      createdAt,
    ],
  );
  return id;
}

interface ViewSeed {
  viewNo: number;
  viewedAt: Date;
  categories: string[];
}

/** Vistas de uma partilha ACTIVE: linhas em `record_share_views` e contadores coerentes em `record_shares`. */
async function addViews(shareId: string, views: ViewSeed[]): Promise<void> {
  for (const v of views) {
    await c.h.pool.query("INSERT INTO record_share_views (share_id, view_no, viewed_at, categories) VALUES ($1,$2,$3,$4::data_category[])", [shareId, v.viewNo, v.viewedAt, v.categories]);
  }
  const last = views.at(-1);
  await c.h.pool.query("UPDATE record_shares SET view_count = $2, last_viewed_at = $3 WHERE id = $1", [shareId, views.length, last?.viewedAt ?? null]);
}

/** Partilha criada pela API (201) com o pedido dado; falha o teste se não for 201. */
async function createdShare(token: string, fam: string, m: string, bookingId: string, extra: Json = {}): Promise<string> {
  const res = await createOf(token, fam, m, { bookingId, categories: ["MEDICATION"], validity: "H24", ...extra });
  expect(res.status).toBe(201);
  return textOf(bodyOf(res).id);
}

// ---- Matriz de autorização (TC-AZ-MKT-27) ----

interface Cenario {
  token: string | undefined;
  fam: string;
  m: string;
  bookingId: string;
}

/** Estados das seis rotas, por ordem: opções, lista, criação, detalhe, vistas e revogação (a criação só persiste se 201). */
async function seisRotas(w: Cenario): Promise<number[]> {
  const opt = await optionsOf(w.token, w.fam, w.m, w.bookingId);
  const lst = await listOf(w.token, w.fam, w.m);
  const cre = await createOf(w.token, w.fam, w.m, { bookingId: w.bookingId, categories: ["MEDICATION"], validity: "H24" });
  const shareId = cre.status === 201 ? textOf(bodyOf(cre).id) : randomUUID();
  const get = await getOf(w.token, w.fam, w.m, shareId);
  const vis = await viewsOf(w.token, w.fam, w.m, shareId);
  const rev = await revokeOf(w.token, w.fam, w.m, shareId);
  return [opt.status, lst.status, cre.status, get.status, vis.status, rev.status];
}

async function alvoAdulto(): Promise<Cenario> {
  const s = await scene();
  return { token: s.u.token, fam: s.fam, m: s.m, bookingId: await bookingOf(s, { status: "CONFIRMED" }) };
}

async function tutorDeDependente(): Promise<Cenario> {
  const s = await scene();
  const d = await c.member(s.fam, { dependent: true, guardians: [s.m], name: "Filho" });
  return { token: s.u.token, fam: s.fam, m: d, bookingId: await bookingOf(s, { memberId: d, status: "CONFIRMED" }) };
}

async function dependenteComConta(): Promise<Cenario> {
  const s = await scene();
  const dep = await c.user("dependente", { birth: "2012-01-01" });
  const d = await c.member(s.fam, { dependent: true, userId: dep.id, guardians: [s.m], name: "Dependente" });
  return { token: dep.token, fam: s.fam, m: d, bookingId: await bookingOf(s, { memberId: d, status: "CONFIRMED" }) };
}

function outroAdultoComGrant(categoria: string): () => Promise<Cenario> {
  return async () => {
    const s = await scene();
    const outro = await c.user("outro");
    const mOutro = await c.member(s.fam, { userId: outro.id, role: "FAMILY_MEMBER", name: "Outro" });
    await c.sharing(s.fam, s.m, mOutro, categoria);
    return { token: outro.token, fam: s.fam, m: s.m, bookingId: await bookingOf(s, { status: "CONFIRMED" }) };
  };
}

async function adminNaoTutor(): Promise<Cenario> {
  const s = await scene();
  const admin = await c.user("admin-familia");
  await c.member(s.fam, { userId: admin.id, role: "FAMILY_ADMIN", name: "Administrador" });
  return { token: admin.token, fam: s.fam, m: s.m, bookingId: await bookingOf(s, { status: "CONFIRMED" }) };
}

async function utilizadorDeOutraFamilia(): Promise<Cenario> {
  const s = await scene();
  const alheia = await c.user("alheia");
  const fg = await c.family("Família alheia");
  await c.member(fg, { userId: alheia.id, role: "FAMILY_ADMIN", name: "Alheia" });
  return { token: alheia.token, fam: s.fam, m: s.m, bookingId: await bookingOf(s, { status: "CONFIRMED" }) };
}

async function membroBloqueado(): Promise<Cenario> {
  const s = await scene();
  const d = await c.member(s.fam, { dependent: true, blocked: true, guardians: [s.m], name: "Bloqueado" });
  return { token: s.u.token, fam: s.fam, m: d, bookingId: await bookingOf(s, { memberId: d, status: "CONFIRMED" }) };
}

async function semToken(): Promise<Cenario> {
  const s = await scene();
  return { token: undefined, fam: s.fam, m: s.m, bookingId: await bookingOf(s, { status: "CONFIRMED" }) };
}

// ---- Testes ----

describe("integração: partilha de registos pela família (MK4 S6)", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness({ logStream: LOGS });
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  beforeEach(() => {
    c.h.clock.set(START);
  });

  describe("TC-AZ-MKT-27: autorização nas seis rotas da família", () => {
    const rows: [string, () => Promise<Cenario>, "OK" | number][] = [
      ["titular adulto (SELF)", alvoAdulto, "OK"],
      ["tutor (TUTOR_OF) de dependente", tutorDeDependente, "OK"],
      ["dependente com conta (DEPENDENT_SELF)", dependenteComConta, 403],
      ["outro adulto com SharingGrant de MEDICATION", outroAdultoComGrant("MEDICATION"), 403],
      ["outro adulto com SharingGrant de APPOINTMENTS", outroAdultoComGrant("APPOINTMENTS"), 403],
      ["Family Admin que não é tutor nem titular", adminNaoTutor, 403],
      ["utilizador de outra família", utilizadorDeOutraFamilia, 404],
      ["membro BLOCKED (pelo próprio tutor)", membroBloqueado, 423],
      ["sem token", semToken, 401],
    ];

    it.each(rows)("%s ⇒ resultado esperado nas seis rotas", async (_nome, construir, esperado) => {
      const w = await construir();
      const previsto = esperado === "OK" ? [200, 200, 201, 200, 200, 200] : [esperado, esperado, esperado, esperado, esperado, esperado];
      expect(await seisRotas(w)).toEqual(previsto);
    });
  });

  describe("opções de partilha (UC-MKT-48)", () => {
    it("CONFIRMED ⇒ 200 com as 5 categorias HEALTH, 4 prazos com expiresAt e eligible, maxActive 20 e activeCount 0", async () => {
      const s = await scene("Dra. Opções");
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const res = await optionsOf(s.u.token, s.fam, s.m, bookingId);
      expect(res.status).toBe(200);
      expect(bodyOf(res)).toMatchObject({
        bookingId,
        professional: { id: s.pro.professionalId, displayName: "Dra. Opções", city: "Luanda" },
        professionalCategory: "HEALTH",
        allowedCategories: HEALTH_CATEGORIES,
        viewOnceAllowed: true,
        maxActive: 20,
        activeCount: 0,
      });
      expect(bodyOf(res).validities).toEqual([
        { validity: "H24", expiresAt: at(24 * HOUR).toISOString(), eligible: true },
        { validity: "D7", expiresAt: at(7 * DAY).toISOString(), eligible: true },
        { validity: "D30", expiresAt: at(30 * DAY).toISOString(), eligible: true },
        { validity: "UNTIL_CONSULTATION_END_PLUS_24H", expiresAt: at(3 * HOUR + 30 * MIN + 24 * HOUR).toISOString(), eligible: true },
      ]);
    });

    it("COMPLETED ⇒ 200 com as mesmas opções", async () => {
      const s = await scene();
      const startsAt = at(3 * HOUR);
      const bookingId = await bookingOf(s, { startsAt, status: "CONFIRMED" });
      await setBookingStatus(bookingId, "COMPLETED", new Date(startsAt.getTime() + 30 * MIN));
      const res = await optionsOf(s.u.token, s.fam, s.m, bookingId);
      expect(res.status).toBe(200);
      expect(bodyOf(res)).toMatchObject({ bookingId, allowedCategories: HEALTH_CATEGORIES, activeCount: 0 });
    });

    it("REQUESTED e CANCELLED ⇒ 409 INVALID_STATE_TRANSITION", async () => {
      const s = await scene();
      const requested = await bookingOf(s, { startsAt: at(3 * HOUR) });
      const cancelled = await bookingOf(s, { startsAt: at(5 * HOUR), status: "CONFIRMED" });
      await setBookingStatus(cancelled, "CANCELLED", at(HOUR));
      for (const bookingId of [requested, cancelled]) {
        const res = await optionsOf(s.u.token, s.fam, s.m, bookingId);
        expect(res.status).toBe(409);
        expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
      }
    });

    it("marcação de outro membro da mesma família ⇒ 404 NOT_FOUND", async () => {
      const s = await scene();
      const outro = await c.member(s.fam, { name: "Outro membro" });
      const bookingId = await bookingOf(s, { memberId: outro, status: "CONFIRMED" });
      const res = await optionsOf(s.u.token, s.fam, s.m, bookingId);
      expect(res.status).toBe(404);
      expect(bodyOf(res).code).toBe("NOT_FOUND");
    });

    it("especialidade WELLNESS ⇒ allowedCategories só [MEDICATION]", async () => {
      const s = await scene();
      await makeWellness(s);
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const res = await optionsOf(s.u.token, s.fam, s.m, bookingId);
      expect(res.status).toBe(200);
      expect(bodyOf(res)).toMatchObject({ professionalCategory: "WELLNESS", allowedCategories: ["MEDICATION"] });
    });

    it("UNTIL_CONSULTATION_END_PLUS_24H com eligible false quando endsAt + 24 h já passou (COMPLETED no passado)", async () => {
      const s = await scene();
      const startsAt = at(-2 * DAY);
      const bookingId = await bookingOf(s, { startsAt, status: "CONFIRMED" });
      await setBookingStatus(bookingId, "COMPLETED", new Date(startsAt.getTime() + 30 * MIN));
      const res = await optionsOf(s.u.token, s.fam, s.m, bookingId);
      expect(res.status).toBe(200);
      const validities = bodyOf(res).validities as Json[];
      expect(validities.find((v) => v.validity === "UNTIL_CONSULTATION_END_PLUS_24H")).toEqual({
        validity: "UNTIL_CONSULTATION_END_PLUS_24H",
        expiresAt: new Date(startsAt.getTime() + 30 * MIN + 24 * HOUR).toISOString(),
        eligible: false,
      });
      expect(validities.filter((v) => v.validity !== "UNTIL_CONSULTATION_END_PLUS_24H").every((v) => v.eligible === true)).toBe(true);
    });

    it("não grava nada (record_shares e audit_logs inalterados) e activeCount conta as partilhas ativas", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const sharesAntes = await count("SELECT count(*) AS n FROM record_shares");
      const auditAntes = await count("SELECT count(*) AS n FROM audit_logs");
      expect((await optionsOf(s.u.token, s.fam, s.m, bookingId)).status).toBe(200);
      expect(await count("SELECT count(*) AS n FROM record_shares")).toBe(sharesAntes);
      expect(await count("SELECT count(*) AS n FROM audit_logs")).toBe(auditAntes);

      await createdShare(s.u.token, s.fam, s.m, bookingId);
      const depois = await optionsOf(s.u.token, s.fam, s.m, bookingId);
      expect(bodyOf(depois).activeCount).toBe(1);
    });
  });

  describe("criação de partilha (UC-MKT-49; TC-MKT-120/121)", () => {
    it("TC-MKT-120: 201 com RecordShare ACTIVE, viewCount 0, sem familyId/memberId/createdByUserId/participantLabel e sem o rótulo no corpo", async () => {
      const s = await scene("Dra. Criação");
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED", label: LABEL });
      const res = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["MEDICATION", "EXAMS"], validity: "H24" });
      expect(res.status).toBe(201);
      const b = bodyOf(res);
      expect(b).toMatchObject({
        bookingId,
        professional: { id: s.pro.professionalId, displayName: "Dra. Criação", city: "Luanda" },
        categories: ["MEDICATION", "EXAMS"],
        validity: "H24",
        viewOnce: false,
        status: "ACTIVE",
        expiresAt: at(24 * HOUR).toISOString(),
        revokedAt: null,
        consumedAt: null,
        viewCount: 0,
        lastViewedAt: null,
      });
      for (const campo of ["familyId", "memberId", "createdByUserId", "participantLabel"]) expect(b).not.toHaveProperty(campo);
      expect(JSON.stringify(b)).not.toContain(LABEL);
      expect((await c.h.pool.query("SELECT status FROM record_shares WHERE id = $1", [b.id])).rows[0]).toEqual({ status: "ACTIVE" });
    });

    it("TC-MKT-121: expiresAt = agora + 24 h / 7 d / 30 d; UNTIL = min(endsAt + 24 h, agora + 30 d)", async () => {
      const s = await scene();
      const perto = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const longe = await bookingOf(s, { startsAt: at(40 * DAY), status: "CONFIRMED" });
      const casos: [Validity, string, string][] = [
        ["H24", perto, at(24 * HOUR).toISOString()],
        ["D7", perto, at(7 * DAY).toISOString()],
        ["D30", perto, at(30 * DAY).toISOString()],
        ["UNTIL_CONSULTATION_END_PLUS_24H", perto, at(3 * HOUR + 30 * MIN + 24 * HOUR).toISOString()],
        ["UNTIL_CONSULTATION_END_PLUS_24H", longe, at(30 * DAY).toISOString()],
      ];
      for (const [validity, bookingId, esperado] of casos) {
        const res = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["EXAMS"], validity });
        expect(res.status, validity).toBe(201);
        expect(bodyOf(res).expiresAt, validity).toBe(esperado);
      }
    });

    it("viewOnce por omissão é false e passa a true quando pedido", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const porOmissao = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["EXAMS"], validity: "D7" });
      const pedido = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["EXAMS"], validity: "D7", viewOnce: true });
      expect(bodyOf(porOmissao).viewOnce).toBe(false);
      expect(bodyOf(pedido).viewOnce).toBe(true);
    });

    it("WELLNESS: categoria fora de MEDICATION ⇒ 422 VALIDATION_ERROR (nada criado); MEDICATION ⇒ 201", async () => {
      const s = await scene();
      await makeWellness(s);
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const recusada = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["ALLERGIES"], validity: "H24" });
      expect(recusada.status).toBe(422);
      expect(bodyOf(recusada).code).toBe("VALIDATION_ERROR");
      expect(await count("SELECT count(*) AS n FROM record_shares WHERE member_id = $1", [s.m])).toBe(0);
      const aceite = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["MEDICATION"], validity: "H24" });
      expect(aceite.status).toBe(201);
    });

    it("categorias repetidas, vazias ou desconhecidas e prazo fora do enumerado ⇒ 422 VALIDATION_ERROR (validador do contrato)", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const invalidos: Json[] = [
        { bookingId, categories: ["EXAMS", "EXAMS"], validity: "H24" },
        { bookingId, categories: [], validity: "H24" },
        { bookingId, categories: ["PRESCRIPTIONS"], validity: "H24" },
        { bookingId, categories: ["EXAMS"], validity: "H48" },
      ];
      for (const body of invalidos) {
        const res = await createOf(s.u.token, s.fam, s.m, body);
        expect(res.status, JSON.stringify(body)).toBe(422);
        expect(bodyOf(res).code).toBe("VALIDATION_ERROR");
      }
      expect(await count("SELECT count(*) AS n FROM record_shares WHERE member_id = $1", [s.m])).toBe(0);
    });

    it("prazo UNTIL_CONSULTATION_END_PLUS_24H já passado ⇒ 422 VALIDATION_ERROR", async () => {
      const s = await scene();
      const startsAt = at(-2 * DAY);
      const bookingId = await bookingOf(s, { startsAt, status: "CONFIRMED" });
      await setBookingStatus(bookingId, "COMPLETED", new Date(startsAt.getTime() + 30 * MIN));
      const res = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["EXAMS"], validity: "UNTIL_CONSULTATION_END_PLUS_24H" });
      expect(res.status).toBe(422);
      expect(bodyOf(res).code).toBe("VALIDATION_ERROR");
    });

    it("marcação REQUESTED ou CANCELLED ⇒ 409 INVALID_STATE_TRANSITION", async () => {
      const s = await scene();
      const requested = await bookingOf(s, { startsAt: at(3 * HOUR) });
      const cancelled = await bookingOf(s, { startsAt: at(5 * HOUR), status: "CONFIRMED" });
      await setBookingStatus(cancelled, "CANCELLED", at(HOUR));
      for (const bookingId of [requested, cancelled]) {
        const res = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["EXAMS"], validity: "H24" });
        expect(res.status).toBe(409);
        expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
      }
    });

    it("marcação de outro membro ou inexistente ⇒ 404 NOT_FOUND", async () => {
      const s = await scene();
      const outro = await c.member(s.fam, { name: "Outro membro" });
      const doOutro = await bookingOf(s, { memberId: outro, status: "CONFIRMED" });
      for (const bookingId of [doOutro, randomUUID()]) {
        const res = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["EXAMS"], validity: "H24" });
        expect(res.status).toBe(404);
        expect(bodyOf(res).code).toBe("NOT_FOUND");
      }
    });

    it("20 partilhas ativas ⇒ a 21.ª ⇒ 409 LIMIT_EXCEEDED e nada criado", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      for (let i = 0; i < 20; i++) {
        await seedShare({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId, categories: ["EXAMS"] });
      }
      const res = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["EXAMS"], validity: "H24" });
      expect(res.status).toBe(409);
      expect(bodyOf(res).code).toBe("LIMIT_EXCEEDED");
      expect(await count("SELECT count(*) AS n FROM record_shares WHERE member_id = $1", [s.m])).toBe(20);
    });

    it("limite de 20 criações por dia e por utilizador (entre membros) ⇒ a 21.ª 429 RATE_LIMITED com Retry-After de 24 h", async () => {
      const s = await scene();
      const d1 = await c.member(s.fam, { dependent: true, guardians: [s.m], name: "Filho 1" });
      const d2 = await c.member(s.fam, { dependent: true, guardians: [s.m], name: "Filho 2" });
      const b1 = await bookingOf(s, { memberId: d1, startsAt: nextStart(), status: "CONFIRMED" });
      const b2 = await bookingOf(s, { memberId: d2, startsAt: nextStart(), status: "CONFIRMED" });
      // Vinte criações de hoje, já revogadas (não contam para as 20 ativas).
      for (let i = 0; i < 20; i++) {
        await seedShare({ familyId: s.fam, memberId: d1, professionalId: s.pro.professionalId, bookingId: b1, status: "REVOKED", revokedAt: START, createdByUserId: s.u.id });
      }
      const res = await createOf(s.u.token, s.fam, d2, { bookingId: b2, categories: ["EXAMS"], validity: "H24" });
      expect(res.status).toBe(429);
      expect(bodyOf(res).code).toBe("RATE_LIMITED");
      expect(res.headers["retry-after"]).toBe("86400");
      expect(await count("SELECT count(*) AS n FROM record_shares WHERE member_id = $1", [d2])).toBe(0);
    });

    it("clientRequestId repetido ⇒ 200 com o mesmo id, uma só linha, uma auditoria e um aviso", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const clientRequestId = randomUUID();
      const body = { bookingId, categories: ["EXAMS"], validity: "D7", clientRequestId };
      const avisosAntes = c.shareNoticeCalls.length;
      const first = await createOf(s.u.token, s.fam, s.m, body);
      expect(first.status).toBe(201);
      const second = await createOf(s.u.token, s.fam, s.m, body);
      expect(second.status).toBe(200);
      const id = textOf(bodyOf(first).id);
      expect(bodyOf(second).id).toBe(id);
      expect(await count("SELECT count(*) AS n FROM record_shares WHERE client_request_id = $1", [clientRequestId])).toBe(1);
      expect(await auditRows("RECORD_SHARE_CREATE", id)).toHaveLength(1);
      expect(c.shareNoticeCalls.length - avisosAntes).toBe(1);
    });

    it("mesmo clientRequestId com outro bookingId ⇒ 409 CONFLICT", async () => {
      const s = await scene();
      const b1 = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const b2 = await bookingOf(s, { startsAt: at(5 * HOUR), status: "CONFIRMED" });
      const clientRequestId = randomUUID();
      expect((await createOf(s.u.token, s.fam, s.m, { bookingId: b1, categories: ["EXAMS"], validity: "H24", clientRequestId })).status).toBe(201);
      const res = await createOf(s.u.token, s.fam, s.m, { bookingId: b2, categories: ["EXAMS"], validity: "H24", clientRequestId });
      expect(res.status).toBe(409);
      expect(bodyOf(res).code).toBe("CONFLICT");
      expect(await count("SELECT count(*) AS n FROM record_shares WHERE member_id = $1", [s.m])).toBe(1);
    });

    it("auditoria: uma linha RECORD_SHARE_CREATE com metadata só de contagens e identificadores; nunca o rótulo nem categorias", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED", label: LABEL });
      const res = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["MEDICATION", "EXAMS"], validity: "H24", viewOnce: true });
      expect(res.status).toBe(201);
      const id = textOf(bodyOf(res).id);
      const rows = await auditRows("RECORD_SHARE_CREATE", id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ result: "SUCCESS", actor_type: "USER", actor_user_id: s.u.id, family_id: s.fam, subject_member_id: s.m });
      expect(rows[0]?.metadata).toEqual({ professionalId: s.pro.professionalId, bookingId, categoryCount: 2, validity: "H24", viewOnce: true });
      const texto = JSON.stringify(rows);
      expect(texto).not.toContain(LABEL);
      expect(texto).not.toContain("MEDICATION");
      expect(texto).not.toContain("EXAMS");
    });

    it("aviso ao profissional: uma entrada {professionalId, shareId} na criação; nenhuma no replay", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const clientRequestId = randomUUID();
      const antes = c.shareNoticeCalls.length;
      const res = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["EXAMS"], validity: "H24", clientRequestId });
      expect(res.status).toBe(201);
      expect(c.shareNoticeCalls.length - antes).toBe(1);
      expect(c.shareNoticeCalls.at(-1)).toEqual({ professionalId: s.pro.professionalId, shareId: textOf(bodyOf(res).id) });
      expect((await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["EXAMS"], validity: "H24", clientRequestId })).status).toBe(200);
      expect(c.shareNoticeCalls.length - antes).toBe(1);
    });

    it("falha do aviso não desfaz a partilha: a criação continua 201 e a partilha existe", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      c.failShareNotice.value = true;
      try {
        const res = await createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["EXAMS"], validity: "H24" });
        expect(res.status).toBe(201);
        expect(await count("SELECT count(*) AS n FROM record_shares WHERE id = $1", [bodyOf(res).id])).toBe(1);
      } finally {
        c.failShareNotice.value = false;
      }
    });
  });

  describe("listas, detalhe e vistas (UC-MKT-50/51; TC-MKT-122, TC-MKT-126)", () => {
    it("lista: mais recentes primeiro, limit=2 seguindo nextCursor sem repetidos", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(await seedShare({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId, createdAt: at(i * MIN), expiresAt: at(i * MIN + DAY) }));
      }
      const vistos: string[] = [];
      let query = "?limit=2";
      let paginas = 0;
      for (let p = 0; p < 10; p++) {
        const res = await listOf(s.u.token, s.fam, s.m, query);
        expect(res.status).toBe(200);
        paginas++;
        const page = pageOf(res);
        vistos.push(...page.items.map((i) => textOf(i.id)));
        if (page.nextCursor === null) break;
        query = `?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`;
      }
      expect(paginas).toBe(3);
      expect(vistos).toEqual([...ids].reverse());
      expect(new Set(vistos).size).toBe(vistos.length);
    });

    it("limit=0 ou limit=101 ⇒ 400 MALFORMED_REQUEST; cursor inválido ⇒ 400 MALFORMED_REQUEST", async () => {
      const s = await scene();
      for (const query of ["?limit=0", "?limit=101", "?cursor=isto-nao-e-um-cursor"]) {
        const res = await listOf(s.u.token, s.fam, s.m, query);
        expect(res.status, query).toBe(400);
        expect(bodyOf(res).code, query).toBe("MALFORMED_REQUEST");
      }
    });

    it("filtros status (ACTIVE, EXPIRED, REVOKED, CONSUMED) e bookingId; status inválido ⇒ 400", async () => {
      const s = await scene();
      const b1 = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const b2 = await bookingOf(s, { startsAt: at(5 * HOUR), status: "CONFIRMED" });
      const base = { familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId };
      const ativa = await seedShare({ ...base, bookingId: b1, expiresAt: at(DAY) });
      const expira = await seedShare({ ...base, bookingId: b1, expiresAt: at(HOUR) });
      const revogada = await seedShare({ ...base, bookingId: b2, status: "REVOKED", revokedAt: START });
      const consumida = await seedShare({ ...base, bookingId: b2, status: "CONSUMED", viewOnce: true, viewCount: 1, lastViewedAt: START, consumedAt: START });
      await c.h.pool.query("INSERT INTO record_share_views (share_id, view_no, viewed_at, categories) VALUES ($1,1,$2,ARRAY['EXAMS']::data_category[])", [consumida, START]);

      const esperado: [string, string[]][] = [
        ["?status=ACTIVE", [ativa, expira].sort()],
        ["?status=REVOKED", [revogada]],
        ["?status=CONSUMED", [consumida]],
        ["?status=EXPIRED", []],
        [`?bookingId=${b2}`, [revogada, consumida].sort()],
      ];
      for (const [query, ids] of esperado) {
        const res = await listOf(s.u.token, s.fam, s.m, query);
        expect(res.status, query).toBe(200);
        expect(idsOf(res), query).toEqual(ids);
      }
      expect((await listOf(s.u.token, s.fam, s.m, "?status=FOO")).status).toBe(400);

      c.h.clock.advance(2 * HOUR);
      expect(idsOf(await listOf(s.u.token, s.fam, s.m, "?status=EXPIRED"))).toEqual([expira]);
      expect(idsOf(await listOf(s.u.token, s.fam, s.m, "?status=ACTIVE"))).toEqual([ativa]);
      expect((await c.h.pool.query("SELECT status FROM record_shares WHERE id = $1", [expira])).rows[0]).toEqual({ status: "ACTIVE" });
    });

    it("estado EXPIRED derivado depois de avançar o relógio (o registo continua ACTIVE)", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      expect(bodyOf(await getOf(s.u.token, s.fam, s.m, id)).status).toBe("ACTIVE");
      c.h.clock.advance(25 * HOUR);
      const res = await getOf(s.u.token, s.fam, s.m, id);
      expect(res.status).toBe(200);
      expect(bodyOf(res)).toMatchObject({ status: "EXPIRED", expiresAt: at(24 * HOUR).toISOString() });
      expect((await c.h.pool.query("SELECT status FROM record_shares WHERE id = $1", [id])).rows[0]).toEqual({ status: "ACTIVE" });
    });

    it("detalhe de partilha de outro membro, de outra família ou inexistente ⇒ 404 idêntico", async () => {
      const s = await scene();
      const outro = await c.member(s.fam, { name: "Outro membro" });
      const doOutro = await seedShare({ familyId: s.fam, memberId: outro, professionalId: s.pro.professionalId, bookingId: await bookingOf(s, { memberId: outro, startsAt: nextStart(), status: "CONFIRMED" }) });
      const fg = await c.family("Família alheia");
      const mg = await c.member(fg, { name: "Alheio" });
      const bg = await c.seedBooking({ familyId: fg, memberId: mg, offer: s.offer, startsAt: nextStart(), status: "CONFIRMED" });
      const daOutraFamilia = await seedShare({ familyId: fg, memberId: mg, professionalId: s.pro.professionalId, bookingId: bg.bookingId });
      const inexistente = randomUUID();
      const corpos: unknown[] = [];
      for (const id of [doOutro, daOutraFamilia, inexistente]) {
        const res = await getOf(s.u.token, s.fam, s.m, id);
        expect(res.status).toBe(404);
        expect(bodyOf(res).code).toBe("NOT_FOUND");
        corpos.push(stripTransport(res.body));
      }
      expect(corpos[1]).toEqual(corpos[2]);
      expect(corpos[0]).toEqual(corpos[2]);
    });

    it("vistas: sem vistas ⇒ items []", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      const res = await viewsOf(s.u.token, s.fam, s.m, id);
      expect(res.status).toBe(200);
      expect(pageOf(res)).toEqual({ items: [], nextCursor: null });
    });

    it("vistas: viewNo decrescente com professionalName e categories, paginação por cursor", async () => {
      const s = await scene("Dra. Vistas");
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { categories: ["MEDICATION", "EXAMS"] });
      await addViews(id, [
        { viewNo: 1, viewedAt: at(MIN), categories: ["MEDICATION"] },
        { viewNo: 2, viewedAt: at(2 * MIN), categories: ["EXAMS"] },
        { viewNo: 3, viewedAt: at(3 * MIN), categories: ["MEDICATION", "EXAMS"] },
      ]);
      const primeira = await viewsOf(s.u.token, s.fam, s.m, id, "?limit=2");
      expect(primeira.status).toBe(200);
      const p1 = pageOf(primeira);
      expect(p1.items).toEqual([
        { viewNo: 3, viewedAt: at(3 * MIN).toISOString(), professionalName: "Dra. Vistas", categories: ["MEDICATION", "EXAMS"] },
        { viewNo: 2, viewedAt: at(2 * MIN).toISOString(), professionalName: "Dra. Vistas", categories: ["EXAMS"] },
      ]);
      expect(p1.nextCursor).not.toBeNull();
      const segunda = pageOf(await viewsOf(s.u.token, s.fam, s.m, id, `?limit=2&cursor=${encodeURIComponent(p1.nextCursor ?? "")}`));
      expect(segunda.items.map((v) => v.viewNo)).toEqual([1]);
      expect(segunda.nextCursor).toBeNull();
    });

    it("as leituras (opções, listas, detalhe e vistas) não escrevem em audit_logs", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      const antes = await count("SELECT count(*) AS n FROM audit_logs");
      await optionsOf(s.u.token, s.fam, s.m, bookingId);
      await listOf(s.u.token, s.fam, s.m);
      await getOf(s.u.token, s.fam, s.m, id);
      await viewsOf(s.u.token, s.fam, s.m, id);
      expect(await count("SELECT count(*) AS n FROM audit_logs")).toBe(antes);
    });

    it("limite de 60 leituras por minuto ⇒ o 61.º pedido 429 RATE_LIMITED com Retry-After; passado 1 min volta a passar", async () => {
      const s = await scene();
      for (let i = 0; i < 60; i++) {
        expect((await listOf(s.u.token, s.fam, s.m)).status, `pedido ${String(i + 1)}`).toBe(200);
      }
      const bloqueado = await listOf(s.u.token, s.fam, s.m);
      expect(bloqueado.status).toBe(429);
      expect(bodyOf(bloqueado).code).toBe("RATE_LIMITED");
      expect(bloqueado.headers["retry-after"]).toBe("60");
      c.h.clock.advance(MIN + 1);
      expect((await listOf(s.u.token, s.fam, s.m)).status).toBe(200);
    });

    it("limitador indisponível ⇒ 503 SERVICE_UNAVAILABLE com Retry-After (fecha, não deixa passar)", async () => {
      const s = await scene();
      c.failRateLimiter.value = true;
      try {
        const res = await listOf(s.u.token, s.fam, s.m);
        expect(res.status).toBe(503);
        expect(bodyOf(res).code).toBe("SERVICE_UNAVAILABLE");
        expect(res.headers["retry-after"]).toBeDefined();
      } finally {
        c.failRateLimiter.value = false;
      }
    });
  });

  describe("revogação (UC-MKT-52; TC-MKT-127)", () => {
    it("ACTIVE ⇒ 200 REVOKED com revokedAt; as vistas mantêm-se; auditoria RECORD_SHARE_REVOKE com fromStatus ACTIVE", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      await addViews(id, [{ viewNo: 1, viewedAt: at(MIN), categories: ["EXAMS"] }]);
      const res = await revokeOf(s.u.token, s.fam, s.m, id);
      expect(res.status).toBe(200);
      expect(bodyOf(res)).toMatchObject({ id, status: "REVOKED", revokedAt: START.toISOString(), viewCount: 1 });
      expect(await count("SELECT count(*) AS n FROM record_share_views WHERE share_id = $1", [id])).toBe(1);
      const rows = await auditRows("RECORD_SHARE_REVOKE", id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ result: "SUCCESS", actor_user_id: s.u.id, family_id: s.fam, subject_member_id: s.m, metadata: { fromStatus: "ACTIVE" } });
    });

    it("outro tutor revoga a partilha criada pelo primeiro", async () => {
      const s = await scene();
      const u2 = await c.user("segundo-tutor");
      const m2 = await c.member(s.fam, { userId: u2.id, role: "FAMILY_MEMBER", name: "Segundo tutor" });
      const d = await c.member(s.fam, { dependent: true, guardians: [s.m, m2], name: "Filho" });
      const bookingId = await bookingOf(s, { memberId: d, startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, d, bookingId);
      const res = await revokeOf(u2.token, s.fam, d, id);
      expect(res.status).toBe(200);
      expect(bodyOf(res).status).toBe("REVOKED");
      expect((await auditRows("RECORD_SHARE_REVOKE", id))[0]?.actor_user_id).toBe(u2.id);
    });

    it("revogar de novo ⇒ 409 INVALID_STATE_TRANSITION", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      expect((await revokeOf(s.u.token, s.fam, s.m, id)).status).toBe(200);
      const res = await revokeOf(s.u.token, s.fam, s.m, id);
      expect(res.status).toBe(409);
      expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
    });

    it("partilha já expirada (relógio avançado) ⇒ 409 INVALID_STATE_TRANSITION e nada gravado", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      c.h.clock.advance(25 * HOUR);
      const res = await revokeOf(s.u.token, s.fam, s.m, id);
      expect(res.status).toBe(409);
      expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
      expect((await c.h.pool.query("SELECT status FROM record_shares WHERE id = $1", [id])).rows[0]).toEqual({ status: "ACTIVE" });
      expect(await auditRows("RECORD_SHARE_REVOKE", id)).toHaveLength(0);
    });

    it("partilha CONSUMED (visualização única já feita) ⇒ 409 INVALID_STATE_TRANSITION", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const id = await seedShare({
        familyId: s.fam,
        memberId: s.m,
        professionalId: s.pro.professionalId,
        bookingId,
        viewOnce: true,
        status: "CONSUMED",
        viewCount: 1,
        lastViewedAt: at(MIN),
        consumedAt: at(MIN),
      });
      const res = await revokeOf(s.u.token, s.fam, s.m, id);
      expect(res.status).toBe(409);
      expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
      expect((await c.h.pool.query("SELECT status FROM record_shares WHERE id = $1", [id])).rows[0]).toEqual({ status: "CONSUMED" });
    });

    it("partilha alheia (de outro membro da família) ⇒ 404 NOT_FOUND e sem efeito", async () => {
      const s = await scene();
      const outro = await c.member(s.fam, { name: "Outro membro" });
      const bookingId = await bookingOf(s, { memberId: outro, startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const id = await seedShare({ familyId: s.fam, memberId: outro, professionalId: s.pro.professionalId, bookingId });
      const res = await revokeOf(s.u.token, s.fam, s.m, id);
      expect(res.status).toBe(404);
      expect(bodyOf(res).code).toBe("NOT_FOUND");
      expect((await c.h.pool.query("SELECT status FROM record_shares WHERE id = $1", [id])).rows[0]).toEqual({ status: "ACTIVE" });
    });
  });

  describe("IDOR entre membros da mesma família (TC-MKT-130)", () => {
    it("partilha do membro A pedida com memberId de B ⇒ 404 em detalhe, vistas e revogação, sem efeito e com corpo idêntico ao de inexistente", async () => {
      const s = await scene();
      const dA = await c.member(s.fam, { dependent: true, guardians: [s.m], name: "Filho A" });
      const dB = await c.member(s.fam, { dependent: true, guardians: [s.m], name: "Filho B" });
      const bookingA = await bookingOf(s, { memberId: dA, startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const shareA = await createdShare(s.u.token, s.fam, dA, bookingA);
      expect((await getOf(s.u.token, s.fam, dA, shareA)).status).toBe(200);

      const get = await getOf(s.u.token, s.fam, dB, shareA);
      const vistas = await viewsOf(s.u.token, s.fam, dB, shareA);
      const revogacao = await revokeOf(s.u.token, s.fam, dB, shareA);
      for (const res of [get, vistas, revogacao]) {
        expect(res.status).toBe(404);
        expect(bodyOf(res).code).toBe("NOT_FOUND");
      }
      const inexistente = await getOf(s.u.token, s.fam, dB, randomUUID());
      expect(stripTransport(get.body)).toEqual(stripTransport(inexistente.body));

      expect((await c.h.pool.query("SELECT status FROM record_shares WHERE id = $1", [shareA])).rows[0]).toEqual({ status: "ACTIVE" });
      expect(await auditRows("RECORD_SHARE_REVOKE", shareA)).toHaveLength(0);
    });
  });

  // Fica no fim: se o pool de ligações ficar preso (ver relatório), não contamina os testes anteriores.
  describe("concorrência de criação (TC-MKT-121)", () => {
    it("25 criações em paralelo para o mesmo membro ⇒ exatamente 20 com 201 e 5 com 409 LIMIT_EXCEEDED", { timeout: 300_000 }, async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED" });
      const respostas = await Promise.all(Array.from({ length: 25 }, () => createOf(s.u.token, s.fam, s.m, { bookingId, categories: ["EXAMS"], validity: "D7" })));
      const estados = respostas.map((r) => r.status).sort((a, b) => a - b);
      expect(estados.filter((x) => x === 201)).toHaveLength(20);
      expect(estados.filter((x) => x === 409)).toHaveLength(5);
      expect(respostas.filter((r) => r.status === 409).every((r) => bodyOf(r).code === "LIMIT_EXCEEDED")).toBe(true);
      expect(await count("SELECT count(*) AS n FROM record_shares WHERE member_id = $1 AND status = 'ACTIVE'", [s.m])).toBe(20);
    });
  });
});
