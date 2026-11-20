// Integração (PostgreSQL real, app real com validação de pedidos E respostas contra o openapi.yaml) do lado do PROFISSIONAL de `record-sharing`
// (MK4 S7): TC-MKT-123 (lista e detalhe), TC-MKT-125/126 (abertura, vistas, limites), TC-MKT-128 (recusas auditadas), TC-MKT-129 (visualização
// única e corridas), TC-AZ-MKT-28/29 (autorização e IDOR do profissional) e TC-AZ-MKT-30 (chaves proibidas). As partilhas criam-se pela API da
// família (token de User) ou por SQL. Relógio do harness fixo em `START`; cada teste volta a ele (`beforeEach`).
// Concorrência máxima: 15 pedidos em paralelo (o pool de ligações tem 10).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, PROFESSIONAL_API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIN = 60_000;
/** Canário de PII (BR-MKT-75): nunca em auditoria, respostas de erro nem logs. */
const LABEL = "canario-s7-profissional";
const NOME_MEMBRO = "Membro Secreto S7";
const NOME_PROFISSIONAL = "Dra. Abertura";
/** Idade de quem nasce em 1985-01-01 com o relógio em `START` (2026-11-16 em Luanda): 41 anos completos. */
const IDADE_ESPERADA = 41;
/** Dia da abertura em Africa/Luanda para `START` (11:00 locais). */
const DIA_LUANDA = "2026-11-16";
const LOGS: string[] = [];
/** Chaves que nunca podem aparecer em respostas ao profissional (BR-MKT-75; TC-AZ-MKT-30). */
const CHAVES_PROIBIDAS = ["familyId", "memberId", "userId", "createdByUserId", "familyName", "birthDate", "memberName", "revokedByUserId", "issuedByProfessionalId"];
/** Campos de `ProfessionalShare` (openapi), ordenados. */
const CAMPOS_PROFISSIONAL = ["bookingId", "canOpen", "categories", "createdAt", "expiresAt", "id", "lastOpenedAt", "openCount", "participantLabel", "status", "validity", "viewOnce"];
/** Secções de `SharedRecordsView` que dependem das categorias. */
const SECCOES = ["allergies", "bloodType", "conditions", "medications", "appointments", "examinations"];

type Json = Record<string, unknown>;
interface Page {
  items: Json[];
  nextCursor: string | null;
}
type ProStatus = "APPROVED" | "SUSPENDED" | "DRAFT";

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

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/** Chaves (recursivamente, em objetos e arrays) de um corpo de resposta. */
function chavesDe(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(chavesDe);
  if (v !== null && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...chavesDe(x)]);
  return [];
}

interface ProAuditRow {
  result: string;
  actor_type: string;
  actor_user_id: string | null;
  actor_professional_account_id: string | null;
  family_id: string | null;
  subject_member_id: string | null;
  metadata: Json | null;
}

/** Auditoria de abertura (`PROFESSIONAL_SHARE_OPEN`) de uma partilha, por ordem. */
async function proAudit(shareId: string): Promise<ProAuditRow[]> {
  const { rows } = await c.h.pool.query<ProAuditRow>(
    "SELECT result, actor_type, actor_user_id, actor_professional_account_id, family_id, subject_member_id, metadata FROM audit_logs WHERE action = 'PROFESSIONAL_SHARE_OPEN' AND resource_id = $1 ORDER BY id",
    [shareId],
  );
  return rows;
}

interface ShareRow {
  status: string;
  view_count: number;
  last_viewed_at: Date | null;
  consumed_at: Date | null;
}

async function shareRow(id: string): Promise<ShareRow> {
  const { rows } = await c.h.pool.query<ShareRow>("SELECT status, view_count, last_viewed_at, consumed_at FROM record_shares WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) throw new Error("partilha inexistente");
  return row;
}

interface ViewRow {
  view_no: number;
  categories: string[];
  viewed_at: Date;
}

async function viewRows(id: string): Promise<ViewRow[]> {
  const { rows } = await c.h.pool.query<ViewRow>("SELECT view_no, categories::text[] AS categories, viewed_at FROM record_share_views WHERE share_id = $1 ORDER BY view_no", [id]);
  return rows;
}

// ---- Pedidos HTTP (a família) ----

const famCreate = (token: string | undefined, fam: string, m: string, body: Json) => request(c.h.app).post(sharesOf(fam, m)).set(authOf(token)).send(body);
const famGet = (token: string | undefined, fam: string, m: string, shareId: string) => request(c.h.app).get(`${sharesOf(fam, m)}/${shareId}`).set(authOf(token));
const famViews = (token: string | undefined, fam: string, m: string, shareId: string, query = "") =>
  request(c.h.app).get(`${sharesOf(fam, m)}/${shareId}/views${query}`).set(authOf(token));
const famRevoke = (token: string | undefined, fam: string, m: string, shareId: string) => request(c.h.app).post(`${sharesOf(fam, m)}/${shareId}/revoke`).set(authOf(token));

// ---- Pedidos HTTP (o profissional) ----

const proList = (token: string | undefined, query = "") => request(c.h.app).get(`${PROFESSIONAL_API}/shares${query}`).set(authOf(token));
const proGet = (token: string | undefined, shareId: string) => request(c.h.app).get(`${PROFESSIONAL_API}/shares/${shareId}`).set(authOf(token));
const proOpen = (token: string | undefined, shareId: string) => request(c.h.app).post(`${PROFESSIONAL_API}/shares/${shareId}/open`).set(authOf(token));

// ---- Fixtures ----

interface Scene {
  pro: ProfessionalFixture;
  proToken: string;
  offer: OfferFixture;
  u: UserFixture;
  fam: string;
  m: string;
}

/**
 * Profissional (por omissão APPROVED; HEALTH, VIDEO 30 min, 5000 Kz) e uma família com um titular adulto (`u`, membro `m`, FAMILY_ADMIN).
 * O token do profissional é de vida longa (`professionalToken`), para sobreviver a avanços do relógio.
 */
async function scene(name = NOME_PROFISSIONAL, status: ProStatus = "APPROVED"): Promise<Scene> {
  const pro = await c.professional({ name, status });
  const offer = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
  const u = await c.user("ana");
  const fam = await c.family("Família Profissional");
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: NOME_MEMBRO });
  return { pro, proToken: await c.professionalToken(pro.professionalId), offer, u, fam, m };
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

async function suspender(professionalId: string): Promise<void> {
  await c.h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [professionalId]);
}

async function bloquearMembro(memberId: string): Promise<void> {
  await c.h.pool.query("UPDATE family_members SET status = 'BLOCKED', blocked_at = $2 WHERE id = $1", [memberId, START]);
}

interface SeedShare {
  familyId: string;
  memberId: string;
  professionalId: string;
  bookingId: string;
  label?: string;
  categories?: string[];
  validity?: "H24" | "D7" | "D30" | "UNTIL_CONSULTATION_END_PLUS_24H";
  viewOnce?: boolean;
  createdAt?: Date;
  expiresAt?: Date;
  status?: "ACTIVE" | "REVOKED" | "CONSUMED";
  revokedAt?: Date | null;
  consumedAt?: Date | null;
  viewCount?: number;
  lastViewedAt?: Date | null;
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
      "HEALTH",
      p.categories ?? ["MEDICATION"],
      p.validity ?? "H24",
      p.viewOnce ?? false,
      p.expiresAt ?? new Date(createdAt.getTime() + DAY),
      p.status ?? "ACTIVE",
      p.revokedAt ?? null,
      p.consumedAt ?? null,
      p.viewCount ?? 0,
      p.lastViewedAt ?? null,
      null,
      createdAt,
    ],
  );
  return id;
}

/** Partilha criada pela API da família (201) com o pedido dado; falha o teste se não for 201. */
async function createdShare(token: string, fam: string, m: string, bookingId: string, extra: Json = {}): Promise<string> {
  const res = await famCreate(token, fam, m, { bookingId, categories: ["MEDICATION"], validity: "H24", ...extra });
  expect(res.status).toBe(201);
  return textOf(bodyOf(res).id);
}

// ---- Testes ----

describe("integração: partilha de registos, lado do profissional (MK4 S7)", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness({ logStream: LOGS });
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  beforeEach(() => {
    c.h.clock.set(START);
    c.readerCalls.splice(0);
  });

  describe("TC-AZ-MKT-28/29: autorização e IDOR do profissional", () => {
    it("sem token e token de User (família) ⇒ 401 nas três rotas", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      for (const token of [undefined, s.u.token]) {
        expect((await proList(token)).status).toBe(401);
        expect((await proGet(token, id)).status).toBe(401);
        expect((await proOpen(token, id)).status).toBe(401);
      }
      expect(await count("SELECT count(*) AS n FROM audit_logs WHERE action = 'PROFESSIONAL_SHARE_OPEN' AND resource_id = $1", [id])).toBe(0);
    });

    it("profissional de outro: lista sem a partilha; detalhe e abertura ⇒ 404 idêntico ao de inexistente, sem auditoria nem alteração", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      const outro = await c.professional({ name: "Outro profissional" });
      const outroToken = await c.professionalToken(outro.professionalId);
      expect(textOf(pageOf(await proList(s.proToken)).items[0]?.id)).toBe(id);

      const lista = await proList(outroToken);
      expect(lista.status).toBe(200);
      expect(pageOf(lista)).toEqual({ items: [], nextCursor: null });
      // Filtro por marcação de outro profissional: lista vazia (TC-AZ-MKT-29).
      expect(pageOf(await proList(outroToken, `?bookingId=${bookingId}`))).toEqual({ items: [], nextCursor: null });

      const inexistente = randomUUID();
      const detalhes = [await proGet(outroToken, id), await proGet(outroToken, inexistente)];
      const aberturas = [await proOpen(outroToken, id), await proOpen(outroToken, inexistente)];
      for (const res of [...detalhes, ...aberturas]) {
        expect(res.status).toBe(404);
        expect(bodyOf(res).code).toBe("NOT_FOUND");
      }
      expect(stripTransport(detalhes[0]?.body)).toEqual(stripTransport(detalhes[1]?.body));
      expect(stripTransport(aberturas[0]?.body)).toEqual(stripTransport(aberturas[1]?.body));
      expect(stripTransport(aberturas[0]?.body)).toEqual(stripTransport(detalhes[1]?.body));

      expect(await proAudit(id)).toHaveLength(0);
      expect((await shareRow(id)).view_count).toBe(0);
      expect(await viewRows(id)).toHaveLength(0);
    });

    it.each<ProStatus>(["SUSPENDED", "DRAFT"])("profissional %s lê lista e detalhe (200) mas abrir ⇒ 403 SHARE_NOT_AVAILABLE", async (status) => {
      const s = await scene(`Dra. ${status}`, status);
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await seedShare({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId, label: "Rótulo bloqueado" });

      const lista = await proList(s.proToken);
      expect(lista.status).toBe(200);
      expect(pageOf(lista).items.map((i) => i.id)).toEqual([id]);
      const detalhe = await proGet(s.proToken, id);
      expect(detalhe.status).toBe(200);
      expect(bodyOf(detalhe)).toMatchObject({ id, canOpen: false });

      const res = await proOpen(s.proToken, id);
      expect(res.status).toBe(403);
      expect(bodyOf(res).code).toBe("SHARE_NOT_AVAILABLE");
      expect((await shareRow(id)).view_count).toBe(0);
      expect(await viewRows(id)).toHaveLength(0);
    });
  });

  describe("TC-MKT-123: lista e detalhe (leitura não auditada)", () => {
    it("campos do schema ProfessionalShare (só os definidos) e participantLabel do rótulo da marcação", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED", label: "Rótulo visível" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { categories: ["MEDICATION", "EXAMS"], viewOnce: true });
      const res = await proList(s.proToken);
      expect(res.status).toBe(200);
      const item = pageOf(res).items[0];
      expect(Object.keys(item ?? {}).sort()).toEqual([...CAMPOS_PROFISSIONAL].sort());
      expect(item).toMatchObject({
        id,
        bookingId,
        participantLabel: "Rótulo visível",
        categories: ["MEDICATION", "EXAMS"],
        validity: "H24",
        viewOnce: true,
        status: "ACTIVE",
        expiresAt: at(24 * HOUR).toISOString(),
        openCount: 0,
        lastOpenedAt: null,
        canOpen: true,
        createdAt: START.toISOString(),
      });
      expect(await proAudit(id)).toHaveLength(0);
      expect(bodyOf(await proGet(s.proToken, id))).toEqual(item);
    });

    it("filtros status (ACTIVE, EXPIRED, REVOKED, CONSUMED) e bookingId; estado EXPIRED derivado após avançar o relógio", async () => {
      const s = await scene();
      const b1 = await bookingOf(s, { startsAt: at(3 * HOUR), status: "CONFIRMED", label: "Filtro" });
      const b2 = await bookingOf(s, { startsAt: at(5 * HOUR), status: "CONFIRMED", label: "Filtro" });
      const base = { familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId };
      const ativa = await seedShare({ ...base, bookingId: b1, expiresAt: at(DAY) });
      const expira = await seedShare({ ...base, bookingId: b1, expiresAt: at(HOUR) });
      const revogada = await seedShare({ ...base, bookingId: b2, status: "REVOKED", revokedAt: START });
      const consumida = await seedShare({ ...base, bookingId: b2, status: "CONSUMED", viewOnce: true, viewCount: 1, lastViewedAt: START, consumedAt: START });

      const idsDe = async (query: string): Promise<string[]> => {
        const res = await proList(s.proToken, query);
        expect(res.status, query).toBe(200);
        return pageOf(res).items.map((i) => textOf(i.id)).sort();
      };
      const ordenado = (ids: string[]): string[] => [...ids].sort();
      expect(await idsDe("?status=ACTIVE")).toEqual(ordenado([ativa, expira]));
      expect(await idsDe("?status=REVOKED")).toEqual([revogada]);
      expect(await idsDe("?status=CONSUMED")).toEqual([consumida]);
      expect(await idsDe("?status=EXPIRED")).toEqual([]);
      expect(await idsDe(`?bookingId=${b2}`)).toEqual(ordenado([revogada, consumida]));
      expect((await proList(s.proToken, "?status=FOO")).status).toBe(400);

      c.h.clock.advance(2 * HOUR);
      expect(await idsDe("?status=EXPIRED")).toEqual([expira]);
      expect(await idsDe("?status=ACTIVE")).toEqual([ativa]);
      const detalhe = bodyOf(await proGet(s.proToken, expira));
      expect(detalhe).toMatchObject({ status: "EXPIRED", canOpen: false });
      expect((await shareRow(expira)).status).toBe("ACTIVE");
    });

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
        const res = await proList(s.proToken, query);
        expect(res.status).toBe(200);
        paginas++;
        const page = pageOf(res);
        vistos.push(...page.items.map((i) => textOf(i.id)));
        if (page.nextCursor === null) break;
        query = `?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`;
      }
      expect(paginas).toBe(3);
      expect(vistos).toEqual([...ids].reverse());
    });

    it("canOpen true com ACTIVE, não expirada, profissional APPROVED e marcação CONFIRMED", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      expect(bodyOf(await proGet(s.proToken, id))).toMatchObject({ status: "ACTIVE", canOpen: true });
    });

    it("canOpen false depois de expirar (estado EXPIRED derivado)", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      c.h.clock.advance(25 * HOUR);
      expect(bodyOf(await proGet(s.proToken, id))).toMatchObject({ status: "EXPIRED", canOpen: false });
      expect(bodyOf(await proList(s.proToken)).items).toEqual([expect.objectContaining({ id, status: "EXPIRED", canOpen: false })]);
    });

    it("canOpen false com profissional SUSPENDED depois da criação (SQL)", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      await suspender(s.pro.professionalId);
      expect(bodyOf(await proGet(s.proToken, id))).toMatchObject({ status: "ACTIVE", canOpen: false });
    });

    it("canOpen false com marcação CANCELLED (SQL) e com membro BLOCKED (SQL)", async () => {
      const s = await scene();
      const b1 = await bookingOf(s, { status: "CONFIRMED", startsAt: at(3 * HOUR) });
      const cancelada = await createdShare(s.u.token, s.fam, s.m, b1);
      await setBookingStatus(b1, "CANCELLED", at(HOUR));
      expect(bodyOf(await proGet(s.proToken, cancelada))).toMatchObject({ canOpen: false });

      // Membro bloqueado: tem de ser sem conta (CHECK `family_members_blocked_requires_no_account`), por isso um dependente.
      const dependente = await c.member(s.fam, { dependent: true, guardians: [s.m], name: "Dependente" });
      const b2 = await bookingOf(s, { memberId: dependente, status: "CONFIRMED", startsAt: at(5 * HOUR) });
      const bloqueada = await createdShare(s.u.token, s.fam, dependente, b2);
      await bloquearMembro(dependente);
      expect(bodyOf(await proGet(s.proToken, bloqueada))).toMatchObject({ canOpen: false });
    });

    it("openCount e lastOpenedAt acompanham as aberturas do próprio profissional", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      expect(bodyOf(await proGet(s.proToken, id))).toMatchObject({ openCount: 0, lastOpenedAt: null });
      expect((await proOpen(s.proToken, id)).status).toBe(200);
      c.h.clock.advance(5 * MIN);
      expect((await proOpen(s.proToken, id)).status).toBe(200);
      expect(bodyOf(await proGet(s.proToken, id))).toMatchObject({ openCount: 2, lastOpenedAt: at(5 * MIN).toISOString() });
    });

    it("TC-AZ-MKT-30: nenhuma resposta (lista, detalhe e abertura) contém chaves proibidas; só participantLabel", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED", label: "Só o rótulo" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      const respostas = [await proList(s.proToken), await proGet(s.proToken, id), await proOpen(s.proToken, id)];
      for (const res of respostas) {
        expect(res.status).toBe(200);
        expect(chavesDe(res.body).filter((k) => CHAVES_PROIBIDAS.includes(k))).toEqual([]);
        expect(JSON.stringify(res.body)).not.toContain(NOME_MEMBRO);
        expect(JSON.stringify(res.body)).not.toContain(s.fam);
        expect(JSON.stringify(res.body)).not.toContain(s.m);
      }
      expect(pageOf(respostas[0] ?? { body: {} }).items).toEqual([expect.objectContaining({ participantLabel: "Só o rótulo" })]);
    });
  });

  describe("TC-MKT-125/126: abertura, conteúdo concedido, vistas e auditoria", () => {
    it("200 com participantLabel, ageYears, watermark (profissional e dia em Luanda), no-store e sem ETag", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED", label: "Rótulo da abertura" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { categories: ["MEDICATION"] });
      const res = await proOpen(s.proToken, id);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(bodyOf(res)).toMatchObject({
        shareId: id,
        participantLabel: "Rótulo da abertura",
        ageYears: IDADE_ESPERADA,
        openedAt: START.toISOString(),
        expiresAt: at(24 * HOUR).toISOString(),
        viewOnce: false,
        watermark: { professionalName: NOME_PROFISSIONAL, openedOn: DIA_LUANDA },
      });
      expect(bodyOf(res)).not.toHaveProperty("birthDate");
      expect(JSON.stringify(res.body)).not.toContain(NOME_MEMBRO);
    });

    it("a abertura nunca leva cabeçalho ETag (BR-MKT-72: o conteúdo não é revalidado nem guardado)", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { categories: ["MEDICATION"] });
      const res = await proOpen(s.proToken, id);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers.etag).toBeUndefined();
    });

    it("só as secções das categorias concedidas (omitidas, nunca null); readerCalls com exatamente essas categorias", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { categories: ["MEDICATION", "EXAMS"] });
      const res = await proOpen(s.proToken, id);
      expect(res.status).toBe(200);
      const corpo = bodyOf(res);
      expect(corpo).toHaveProperty("medications");
      expect(corpo).toHaveProperty("examinations");
      for (const secao of SECCOES.filter((x) => x !== "medications" && x !== "examinations")) expect(corpo, secao).not.toHaveProperty(secao);
      expect(Object.values(corpo).includes(null)).toBe(false);
      expect(c.readerCalls).toEqual([["MEDICATION", "EXAMS"]]);
    });

    it("com todas as categorias HEALTH aparecem todas as secções", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { categories: ["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"] });
      const corpo = bodyOf(await proOpen(s.proToken, id));
      for (const secao of SECCOES) expect(corpo, secao).toHaveProperty(secao);
      expect(corpo).toMatchObject({ bloodType: "O_POS", allergies: [{ name: "Penicilina" }] });
    });

    it("ageYears presente mesmo com só MEDICATION", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { categories: ["MEDICATION"] });
      const corpo = bodyOf(await proOpen(s.proToken, id));
      expect(corpo).toMatchObject({ ageYears: IDADE_ESPERADA });
      expect(corpo).toHaveProperty("medications");
      for (const secao of SECCOES.filter((x) => x !== "medications")) expect(corpo, secao).not.toHaveProperty(secao);
    });

    it("sem viewOnce reabre-se até expiresAt (o instante exato já é recusado); cada abertura grava uma vista", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { categories: ["MEDICATION"] });
      for (let i = 1; i <= 3; i++) {
        c.h.clock.advance(MIN);
        expect((await proOpen(s.proToken, id)).status, `abertura ${String(i)}`).toBe(200);
      }
      const ultimaVista = at(3 * MIN);
      expect(await viewRows(id)).toEqual([{ view_no: 1, categories: ["MEDICATION"], viewed_at: at(MIN) }, { view_no: 2, categories: ["MEDICATION"], viewed_at: at(2 * MIN) }, { view_no: 3, categories: ["MEDICATION"], viewed_at: ultimaVista }]);
      expect(await shareRow(id)).toMatchObject({ status: "ACTIVE", view_count: 3, last_viewed_at: ultimaVista });

      c.h.clock.set(at(24 * HOUR - 1));
      expect((await proOpen(s.proToken, id)).status).toBe(200);
      c.h.clock.set(at(24 * HOUR));
      const expirada = await proOpen(s.proToken, id);
      expect(expirada.status).toBe(403);
      expect(bodyOf(expirada).code).toBe("SHARE_NOT_AVAILABLE");
    });

    it("a família vê as vistas (mais recente primeiro) com professionalName; auditoria SUCCESS sem rótulo, idade nem conteúdo", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED", label: LABEL });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { categories: ["MEDICATION", "EXAMS"] });
      for (let i = 0; i < 2; i++) {
        c.h.clock.advance(MIN);
        expect((await proOpen(s.proToken, id)).status).toBe(200);
      }
      const vistas = await famViews(s.u.token, s.fam, s.m, id);
      expect(vistas.status).toBe(200);
      expect(pageOf(vistas).items).toEqual([
        { viewNo: 2, viewedAt: at(2 * MIN).toISOString(), professionalName: NOME_PROFISSIONAL, categories: ["MEDICATION", "EXAMS"] },
        { viewNo: 1, viewedAt: at(MIN).toISOString(), professionalName: NOME_PROFISSIONAL, categories: ["MEDICATION", "EXAMS"] },
      ]);

      const auditoria = await proAudit(id);
      expect(auditoria).toHaveLength(2);
      expect(auditoria[0]).toEqual({
        result: "SUCCESS",
        actor_type: "PROFESSIONAL_ACCOUNT",
        actor_user_id: null,
        actor_professional_account_id: await accountIdOf(s.pro.professionalId),
        family_id: s.fam,
        subject_member_id: s.m,
        metadata: { viewNo: 1, viewOnce: false, categoryCount: 2 },
      });
      const todas = JSON.stringify(await c.h.pool.query("SELECT * FROM audit_logs"));
      expect(todas).not.toContain(LABEL);
      expect(todas).not.toContain("ageYears");
      expect(todas).not.toContain(NOME_MEMBRO);
      expect(LOGS.join("\n")).not.toContain(LABEL);
    });
  });

  describe("TC-MKT-128: recusas auditadas (sem vista, sem leitura, detalhe idêntico)", () => {
    interface Causa {
      reason: string;
      /** Membro bloqueado tem de ser sem conta: usa-se um dependente (CHECK da BD). */
      dependente?: boolean;
      /** Estado que provoca a recusa (depois da criação ACTIVE pela API). */
      preparar: (s: Scene, membro: string, bookingId: string, shareId: string) => Promise<void>;
    }

    const causas: Causa[] = [
      {
        reason: "EXPIRED",
        preparar: async () => {
          c.h.clock.advance(25 * HOUR);
          await Promise.resolve();
        },
      },
      {
        reason: "REVOKED",
        preparar: async (s, membro, _bookingId, shareId) => {
          expect((await famRevoke(s.u.token, s.fam, membro, shareId)).status).toBe(200);
          await Promise.resolve();
        },
      },
      {
        reason: "PROFESSIONAL_NOT_APPROVED",
        preparar: async (s) => {
          await suspender(s.pro.professionalId);
        },
      },
      {
        reason: "BOOKING_INACTIVE",
        preparar: async (_s, _membro, bookingId) => {
          await setBookingStatus(bookingId, "CANCELLED", at(HOUR));
        },
      },
      {
        reason: "MEMBER_BLOCKED",
        dependente: true,
        preparar: async (_s, membro) => {
          await bloquearMembro(membro);
        },
      },
    ];

    it("cada causa ⇒ 403 SHARE_NOT_AVAILABLE com detail idêntico, sem vista, sem leitura e com auditoria DENIED do motivo", async () => {
      const detalhes: unknown[] = [];
      for (const caso of causas) {
        c.h.clock.set(START);
        const s = await scene();
        const membro = caso.dependente ? await c.member(s.fam, { dependent: true, guardians: [s.m], name: "Dependente" }) : s.m;
        const bookingId = await bookingOf(s, { memberId: membro, status: "CONFIRMED" });
        const id = await createdShare(s.u.token, s.fam, membro, bookingId, { categories: ["MEDICATION"] });
        await caso.preparar(s, membro, bookingId, id);
        const antes = await shareRow(id);
        const lidas = c.readerCalls.length;

        const res = await proOpen(s.proToken, id);
        expect(res.status, caso.reason).toBe(403);
        expect(bodyOf(res).code, caso.reason).toBe("SHARE_NOT_AVAILABLE");
        detalhes.push(stripTransport(res.body));

        expect(await shareRow(id), caso.reason).toEqual(antes);
        expect(await viewRows(id), caso.reason).toHaveLength(0);
        expect(c.readerCalls.length, caso.reason).toBe(lidas);
        const auditoria = await proAudit(id);
        expect(auditoria, caso.reason).toHaveLength(1);
        expect(auditoria[0], caso.reason).toMatchObject({ result: "DENIED", actor_type: "PROFESSIONAL_ACCOUNT", family_id: s.fam, subject_member_id: membro, metadata: { reason: caso.reason } });
      }
      for (const d of detalhes) expect(d).toEqual(detalhes[0]);
    });

    it("consumida (visualização única já feita) ⇒ 403 SHARE_ALREADY_VIEWED com auditoria DENIED reason CONSUMED", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { viewOnce: true });
      expect((await proOpen(s.proToken, id)).status).toBe(200);
      const lidas = c.readerCalls.length;
      const res = await proOpen(s.proToken, id);
      expect(res.status).toBe(403);
      expect(bodyOf(res).code).toBe("SHARE_ALREADY_VIEWED");
      expect(c.readerCalls.length).toBe(lidas);
      expect((await shareRow(id)).view_count).toBe(1);
      expect((await proAudit(id)).at(-1)).toMatchObject({ result: "DENIED", metadata: { reason: "CONSUMED" } });
    });

    it("partilha de outro profissional ou inexistente ⇒ 404 sem auditoria DENIED", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      const outro = await c.professional({ name: "Outro" });
      const outroToken = await c.professionalToken(outro.professionalId);
      expect((await proOpen(outroToken, id)).status).toBe(404);
      expect((await proOpen(s.proToken, randomUUID())).status).toBe(404);
      expect(await proAudit(id)).toHaveLength(0);
    });
  });

  describe("TC-MKT-129: visualização única e corridas", () => {
    it("1.ª abertura 200 consome (CONSUMED, consumed_at, view_count 1); família vê CONSUMED; 2.ª ⇒ 403 SHARE_ALREADY_VIEWED", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { viewOnce: true });
      const primeira = await proOpen(s.proToken, id);
      expect(primeira.status).toBe(200);
      expect(bodyOf(primeira)).toMatchObject({ viewOnce: true, openedAt: START.toISOString() });
      expect(await shareRow(id)).toEqual({ status: "CONSUMED", view_count: 1, last_viewed_at: START, consumed_at: START });
      expect(bodyOf(await famGet(s.u.token, s.fam, s.m, id))).toMatchObject({ status: "CONSUMED", viewCount: 1 });

      const segunda = await proOpen(s.proToken, id);
      expect(segunda.status).toBe(403);
      expect(bodyOf(segunda).code).toBe("SHARE_ALREADY_VIEWED");
      expect(await viewRows(id)).toHaveLength(1);
    });

    it("15 aberturas em paralelo de uma visualização única ⇒ exatamente 1×200 e 14×403 SHARE_ALREADY_VIEWED; 1 vista", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { viewOnce: true });
      const respostas = await Promise.all(Array.from({ length: 15 }, () => proOpen(s.proToken, id)));
      const estados = respostas.map((r) => r.status).sort((a, b) => a - b);
      expect(estados.filter((x) => x === 200)).toHaveLength(1);
      expect(estados.filter((x) => x === 403)).toHaveLength(14);
      expect(respostas.filter((r) => r.status === 403).every((r) => bodyOf(r).code === "SHARE_ALREADY_VIEWED")).toBe(true);
      expect(await viewRows(id)).toHaveLength(1);
      expect(await shareRow(id)).toMatchObject({ status: "CONSUMED", view_count: 1 });
    });

    it("falha injetada na leitura ⇒ 500 e nada se consome (ACTIVE, view_count 0, sem vistas nem auditoria SUCCESS); depois a abertura funciona e consome", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId, { viewOnce: true });
      c.failReader.value = true;
      try {
        const falha = await proOpen(s.proToken, id);
        expect(falha.status).toBe(500);
        expect(bodyOf(falha).code).toBe("INTERNAL_ERROR");
      } finally {
        c.failReader.value = false;
      }
      expect(await shareRow(id)).toEqual({ status: "ACTIVE", view_count: 0, last_viewed_at: null, consumed_at: null });
      expect(await viewRows(id)).toHaveLength(0);
      expect((await proAudit(id)).filter((r) => r.result === "SUCCESS")).toHaveLength(0);

      const depois = await proOpen(s.proToken, id);
      expect(depois.status).toBe(200);
      expect(await shareRow(id)).toMatchObject({ status: "CONSUMED", view_count: 1 });
      expect(await viewRows(id)).toHaveLength(1);
    });

    it("revogar e abrir em paralelo ⇒ coerente: open ganhou (1 vista, REVOKED) ou open recusado (403, 0 vistas)", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      const [revogacao, abertura] = await Promise.all([famRevoke(s.u.token, s.fam, s.m, id), proOpen(s.proToken, id)]);
      expect(revogacao.status).toBe(200);
      const linha = await shareRow(id);
      expect(linha.status).toBe("REVOKED");
      const vistas = await viewRows(id);
      if (abertura.status === 200) {
        expect(vistas).toHaveLength(1);
        expect(linha.view_count).toBe(1);
      } else {
        expect(abertura.status).toBe(403);
        expect(bodyOf(abertura).code).toBe("SHARE_NOT_AVAILABLE");
        expect(vistas).toHaveLength(0);
        expect(linha.view_count).toBe(0);
      }
      expect(linha.view_count).toBe(vistas.length);
    });

    it("15 aberturas em paralelo de partilha NÃO viewOnce ⇒ 15×200 com view_no 1..15 únicos e view_count 15", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      const respostas = await Promise.all(Array.from({ length: 15 }, () => proOpen(s.proToken, id)));
      expect(respostas.map((r) => r.status)).toEqual(Array.from({ length: 15 }, () => 200));
      const vistas = await viewRows(id);
      expect(vistas.map((v) => v.view_no)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(await shareRow(id)).toMatchObject({ status: "ACTIVE", view_count: 15 });
    });
  });

  describe("TC-MKT-126 (limites) e BR-MKT-77", () => {
    it("30 aberturas por minuto por conta ⇒ a 31.ª 429 RATE_LIMITED com Retry-After 60", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      for (let i = 1; i <= 30; i++) {
        expect((await proOpen(s.proToken, id)).status, `abertura ${String(i)}`).toBe(200);
      }
      const bloqueada = await proOpen(s.proToken, id);
      expect(bloqueada.status).toBe(429);
      expect(bodyOf(bloqueada).code).toBe("RATE_LIMITED");
      expect(bloqueada.headers["retry-after"]).toBe("60");
      expect((await shareRow(id)).view_count).toBe(30);
    });

    it("120 aberturas por dia e por (conta, partilha) ⇒ a 121.ª 429 pelo limite diário (Retry-After acima de 1 h)", { timeout: 120_000 }, async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      // Lotes de 30 (limite por minuto) e um minuto de relógio entre lotes.
      for (let lote = 0; lote < 4; lote++) {
        for (let i = 0; i < 30; i++) {
          expect((await proOpen(s.proToken, id)).status, `lote ${String(lote)} abertura ${String(i)}`).toBe(200);
        }
        c.h.clock.advance(MIN);
      }
      const bloqueada = await proOpen(s.proToken, id);
      expect(bloqueada.status).toBe(429);
      expect(bodyOf(bloqueada).code).toBe("RATE_LIMITED");
      expect(Number(bloqueada.headers["retry-after"])).toBeGreaterThan(3600);
      expect((await shareRow(id)).view_count).toBe(120);
    });

    it("60 leituras por minuto (lista) ⇒ a 61.ª 429 RATE_LIMITED com Retry-After 60; passado 1 min volta a passar", async () => {
      const s = await scene();
      for (let i = 1; i <= 60; i++) {
        expect((await proList(s.proToken)).status, `leitura ${String(i)}`).toBe(200);
      }
      const bloqueada = await proList(s.proToken);
      expect(bloqueada.status).toBe(429);
      expect(bodyOf(bloqueada).code).toBe("RATE_LIMITED");
      expect(bloqueada.headers["retry-after"]).toBe("60");
      c.h.clock.advance(MIN + 1);
      expect((await proList(s.proToken)).status).toBe(200);
    });

    it("limitador indisponível ⇒ 503 com Retry-After em abrir e em listar (fecha, não deixa passar)", async () => {
      const s = await scene();
      const bookingId = await bookingOf(s, { status: "CONFIRMED" });
      const id = await createdShare(s.u.token, s.fam, s.m, bookingId);
      c.failRateLimiter.value = true;
      try {
        const aberta = await proOpen(s.proToken, id);
        expect(aberta.status).toBe(503);
        expect(bodyOf(aberta).code).toBe("SERVICE_UNAVAILABLE");
        expect(aberta.headers["retry-after"]).toBeDefined();
        const listada = await proList(s.proToken);
        expect(listada.status).toBe(503);
        expect(listada.headers["retry-after"]).toBeDefined();
      } finally {
        c.failRateLimiter.value = false;
      }
      expect((await shareRow(id)).view_count).toBe(0);
    });
  });
});

/** `account_id` do profissional (a auditoria grava a conta, não o profissional). */
async function accountIdOf(professionalId: string): Promise<string> {
  const { rows } = await c.h.pool.query<{ account_id: string }>("SELECT account_id FROM professionals WHERE id = $1", [professionalId]);
  return rows[0]?.account_id ?? "";
}
