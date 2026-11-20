// Integração (PostgreSQL real, app real) do ciclo de vida de `record-sharing` (MK4 S8): TC-MKT-132 (retenção de 24 meses pela fronteira do
// relógio injetável, idempotência e auditoria), TC-MKT-131 (cascatas de apagamento e exportação do titular sem conteúdo nem rótulo) e UC-MKT-56
// (aviso genérico ao profissional, sem e-mail nem rótulo na falha). As partilhas terminadas entram por SQL (`INSERT`, porque o trigger só age em
// `UPDATE` e fixa `expires_at`/`created_at`). O relógio do harness fica em `START` e cada teste volta a ele (`beforeEach`).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "../../src/platform/errors/index.js";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Canário de PII (BR-MKT-75): nunca na exportação, em auditoria nem em logs. */
const LABEL = "canario-s8-partilha";
const LOGS: string[] = [];
/** Chaves exatas de uma partilha e de uma vista na exportação do titular (sem conteúdo, sem rótulo, sem ids de utilizador/autoria). */
const SHARE_KEYS = ["categories", "consumedAt", "createdAt", "expiresAt", "id", "professional", "revokedAt", "status", "validity", "viewOnce", "views"];
const VIEW_KEYS = ["categories", "viewNo", "viewedAt"];

type Json = Record<string, unknown>;
type Kind = "EXPIRADA" | "REVOGADA" | "CONSUMIDA";

let c: ConsultationsHarness;
let slotSeq = 0;

const at = (ms: number): Date => new Date(START.getTime() + ms);
/** Início de consulta único: horários do mesmo profissional não se sobrepõem. */
const nextStart = (): Date => at((10 + slotSeq++) * HOUR);
const sharesOf = (fam: string, m: string): string => `${API}/families/${fam}/members/${m}/record-shares`;
const authOf = (token: string | undefined): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
const bodyOf = (res: { body: unknown }): Json => res.body as Json;
const textOf = (v: unknown): string => {
  if (typeof v !== "string") throw new Error("esperado texto");
  return v;
};

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/** Fronteira de retenção como o job a calcula: `relógio − 24 meses` na BD (mesma aritmética de calendário). */
async function cutoff(): Promise<Date> {
  const { rows } = await c.h.pool.query<{ t: Date }>("SELECT ($1::timestamptz - make_interval(months => 24)) AS t", [c.h.clock.now()]);
  const t = rows[0]?.t;
  if (!t) throw new Error("fronteira sem resultado");
  return t;
}

const existe = (id: string): Promise<number> => count("SELECT count(*) AS n FROM record_shares WHERE id = $1", [id]);
const vistasDe = (ids: string[]): Promise<number> => count("SELECT count(*) AS n FROM record_share_views WHERE share_id = ANY($1::uuid[])", [ids]);

interface PurgeAudit {
  actor_type: string;
  result: string;
  family_id: string | null;
  resource_id: string | null;
  metadata: Json | null;
}

/** Auditorias do expurgo (`RECORD_SHARES_PURGED`), por ordem de inserção. */
async function purgeAudits(): Promise<PurgeAudit[]> {
  const { rows } = await c.h.pool.query<PurgeAudit>(
    "SELECT actor_type, result, family_id, resource_id, metadata FROM audit_logs WHERE action = 'RECORD_SHARES_PURGED' ORDER BY id",
  );
  return rows;
}

// ---- Pedidos HTTP (a família) ----

const createOf = (token: string | undefined, fam: string, m: string, body: Json) => request(c.h.app).post(sharesOf(fam, m)).set(authOf(token)).send(body);

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
  revokedByUserId?: string | null;
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
       view_once, expires_at, status, revoked_at, revoked_by_user_id, consumed_at, view_count, last_viewed_at, created_by_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::specialty_category,$8::data_category[],$9::share_validity,$10,$11,$12::record_share_status,$13,$14,$15,$16,$17,$18,$19,$19)`,
    [
      id,
      p.familyId,
      p.memberId,
      p.professionalId,
      p.bookingId,
      p.label ?? LABEL,
      "HEALTH",
      p.categories ?? ["MEDICATION"],
      p.validity ?? "H24",
      p.viewOnce ?? false,
      p.expiresAt ?? new Date(createdAt.getTime() + DAY),
      p.status ?? "ACTIVE",
      p.revokedAt ?? null,
      p.revokedByUserId ?? null,
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

/** Linhas de `record_share_views` (só INSERT; os contadores da partilha são responsabilidade de quem chama). */
async function addViewRows(shareId: string, views: ViewSeed[]): Promise<void> {
  for (const v of views) {
    await c.h.pool.query("INSERT INTO record_share_views (share_id, view_no, viewed_at, categories) VALUES ($1,$2,$3,$4::data_category[])", [shareId, v.viewNo, v.viewedAt, v.categories]);
  }
}

/** Partilha por SQL com `n` vistas coerentes (linhas e contadores). */
async function seedComVistas(p: SeedShare, n: number, viewedAt: Date): Promise<string> {
  const id = await seedShare({ ...p, viewCount: n, lastViewedAt: n > 0 ? viewedAt : null });
  await addViewRows(
    id,
    Array.from({ length: n }, (_, i) => ({ viewNo: i + 1, viewedAt, categories: ["MEDICATION"] })),
  );
  return id;
}

/** Partilha terminada em `end` (expirada sem abrir, revogada ou consumida); `created_at` dois dias antes, dentro das CHECK. */
async function terminada(s: Scene, bookingId: string, end: Date, kind: Kind, views = 0): Promise<string> {
  const base = { familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId, createdAt: new Date(end.getTime() - 2 * DAY) };
  if (kind === "EXPIRADA") return seedComVistas({ ...base, expiresAt: end }, views, end);
  if (kind === "REVOGADA") return seedComVistas({ ...base, expiresAt: new Date(end.getTime() - DAY), status: "REVOKED", revokedAt: end }, views, end);
  return seedComVistas({ ...base, expiresAt: new Date(end.getTime() - DAY), status: "CONSUMED", viewOnce: true, consumedAt: end }, 1, end);
}

/** Vistas de uma partilha ACTIVE criada pela API: linhas em `record_share_views` e contadores em `record_shares` (UPDATE permitido em ACTIVE). */
async function addViews(shareId: string, views: ViewSeed[]): Promise<void> {
  await addViewRows(shareId, views);
  const last = views.at(-1);
  await c.h.pool.query("UPDATE record_shares SET view_count = $2, last_viewed_at = $3 WHERE id = $1", [shareId, views.length, last?.viewedAt ?? null]);
}

/** Partilha criada pela API (201) com o pedido dado; falha o teste se não for 201. */
async function createdShare(token: string, fam: string, m: string, bookingId: string, extra: Json = {}): Promise<string> {
  const res = await createOf(token, fam, m, { bookingId, categories: ["MEDICATION"], validity: "H24", ...extra });
  expect(res.status).toBe(201);
  return textOf(bodyOf(res).id);
}

// ---- Testes ----

describe("integração: ciclo de vida das partilhas de registos (MK4 S8)", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness({ logStream: LOGS });
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  beforeEach(() => {
    c.h.clock.set(START);
  });

  describe("TC-MKT-132: retenção de 24 meses pelo job de expurgo", () => {
    it("apaga só as partilhas com fim real anterior à fronteira, com as vistas em cascata, e devolve a contagem", async () => {
      const s = await scene();
      const b = await bookingOf(s, { status: "CONFIRMED" });
      const cut = await cutoff();
      const antes = new Date(cut.getTime() - DAY); // terminada há 24 meses + 1 dia
      const depois = new Date(cut.getTime() + DAY); // terminada há 24 meses − 1 dia

      const apagadas = [
        await terminada(s, b, antes, "EXPIRADA"), // ACTIVE expirada há mais de 24 meses (nunca aberta)
        await terminada(s, b, antes, "REVOGADA", 2),
        await terminada(s, b, antes, "CONSUMIDA"),
      ];
      const mantidas = [
        await terminada(s, b, depois, "EXPIRADA"),
        await terminada(s, b, depois, "REVOGADA", 2),
        await terminada(s, b, depois, "CONSUMIDA"),
      ];
      const ativa = await seedShare({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId: b }); // ACTIVE, expira amanhã

      expect(await vistasDe(apagadas)).toBe(3);
      expect(await vistasDe(mantidas)).toBe(3);

      const auditesAntes = (await purgeAudits()).length;
      const res = await c.shareMaintenance.purgeExpired();
      expect(res).toEqual({ count: apagadas.length });

      for (const id of apagadas) expect(await existe(id)).toBe(0);
      expect(await vistasDe(apagadas)).toBe(0);
      for (const id of mantidas) expect(await existe(id)).toBe(1);
      expect(await vistasDe(mantidas)).toBe(3);
      expect(await existe(ativa)).toBe(1);

      // Auditoria: uma linha SYSTEM só com a contagem, sem família nem ids de partilha.
      const auditesDepois = await purgeAudits();
      expect(auditesDepois).toHaveLength(auditesAntes + 1);
      const ultima = auditesDepois.at(-1);
      expect(ultima).toMatchObject({ actor_type: "SYSTEM", result: "SUCCESS", family_id: null, resource_id: null });
      expect(ultima?.metadata).toEqual({ count: apagadas.length });
      const json = JSON.stringify(ultima);
      for (const id of [...apagadas, ...mantidas, ativa, s.fam]) expect(json).not.toContain(id);

      // Idempotente: repetir não apaga nada e não audita de novo.
      expect(await c.shareMaintenance.purgeExpired()).toEqual({ count: 0 });
      expect(await purgeAudits()).toHaveLength(auditesAntes + 1);
    });

    it("sem nada a apagar devolve 0 e não audita", async () => {
      const auditesAntes = (await purgeAudits()).length;
      expect(await c.shareMaintenance.purgeExpired()).toEqual({ count: 0 });
      expect(await purgeAudits()).toHaveLength(auditesAntes);
    });

    it("o relógio injetável é a fronteira: a partilha 'terminada há 24 meses − 1 dia' sai quando o relógio avança 2 dias", async () => {
      const s = await scene();
      const b = await bookingOf(s, { status: "CONFIRMED" });
      const cut = await cutoff();
      const id = await terminada(s, b, new Date(cut.getTime() + DAY), "EXPIRADA");
      expect(await existe(id)).toBe(1);

      await c.shareMaintenance.purgeExpired();
      expect(await existe(id)).toBe(1);

      c.h.clock.advance(2 * DAY);
      await c.shareMaintenance.purgeExpired();
      expect(await existe(id)).toBe(0);
    });
  });

  describe("TC-MKT-131: cascatas de apagamento", () => {
    it("apagar o membro apaga as partilhas dele e as vistas; as do titular ficam", async () => {
      const s = await scene();
      const d = await c.member(s.fam, { dependent: true, guardians: [s.m], name: "Filho" });
      const bd = await bookingOf(s, { memberId: d, status: "CONFIRMED" });
      const bs = await bookingOf(s, { status: "CONFIRMED" });
      const sd = await seedComVistas({ familyId: s.fam, memberId: d, professionalId: s.pro.professionalId, bookingId: bd }, 2, START);
      const ss = await seedComVistas({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId: bs }, 1, START);

      await c.h.pool.query("DELETE FROM family_members WHERE id = $1", [d]);

      expect(await existe(sd)).toBe(0);
      expect(await vistasDe([sd])).toBe(0);
      expect(await existe(ss)).toBe(1);
      expect(await vistasDe([ss])).toBe(1);
    });

    it("apagar a família apaga as partilhas e vistas dela; as de outra família ficam", async () => {
      const s = await scene();
      const outra = await scene("Dra. Outra");
      const b = await bookingOf(s, { status: "CONFIRMED" });
      const bo = await bookingOf(outra, { status: "CONFIRMED" });
      const sa = await seedComVistas({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId: b }, 1, START);
      const so = await seedComVistas({ familyId: outra.fam, memberId: outra.m, professionalId: outra.pro.professionalId, bookingId: bo }, 1, START);

      await c.h.pool.query("DELETE FROM families WHERE id = $1", [s.fam]);

      expect(await existe(sa)).toBe(0);
      expect(await vistasDe([sa])).toBe(0);
      expect(await existe(so)).toBe(1);
      expect(await vistasDe([so])).toBe(1);
    });

    it("apagar o profissional apaga as partilhas dele e as vistas; as de outro profissional ficam", async () => {
      const s = await scene();
      const outro = await scene("Dra. Outra");
      const b = await bookingOf(s, { status: "CONFIRMED" });
      const bo = await bookingOf(outro, { status: "CONFIRMED" });
      const sp = await seedComVistas({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId: b }, 1, START);
      const so = await seedComVistas({ familyId: outro.fam, memberId: outro.m, professionalId: outro.pro.professionalId, bookingId: bo }, 1, START);

      await c.h.pool.query("DELETE FROM professionals WHERE id = $1", [s.pro.professionalId]);

      expect(await existe(sp)).toBe(0);
      expect(await vistasDe([sp])).toBe(0);
      expect(await existe(so)).toBe(1);
      expect(await vistasDe([so])).toBe(1);
    });

    it("apagar a marcação apaga as partilhas e vistas; o horário fica livre (slot sem marcação)", async () => {
      const s = await scene();
      const b = await bookingOf(s, { status: "CONFIRMED" });
      const sid = await seedComVistas({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId: b }, 1, START);
      const { rows } = await c.h.pool.query<{ id: string }>("SELECT id FROM professional_slots WHERE booking_id = $1", [b]);
      const slotId = rows[0]?.id;
      expect(slotId).toBeDefined();

      await c.h.pool.query("DELETE FROM bookings WHERE id = $1", [b]);

      expect(await existe(sid)).toBe(0);
      expect(await vistasDe([sid])).toBe(0);
      const depois = await c.h.pool.query<{ booking_id: string | null }>("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId]);
      expect(depois.rows).toEqual([{ booking_id: null }]);
    });

    it("apagar o utilizador mantém a partilha com created_by_user_id e revoked_by_user_id a NULL", async () => {
      const s = await scene();
      const b = await bookingOf(s, { status: "CONFIRMED" });
      const ex = await c.user("ex-utilizador");
      const sid = await seedShare({
        familyId: s.fam,
        memberId: s.m,
        professionalId: s.pro.professionalId,
        bookingId: b,
        status: "REVOKED",
        revokedAt: START,
        createdByUserId: ex.id,
        revokedByUserId: ex.id,
      });

      await c.h.pool.query("DELETE FROM users WHERE id = $1", [ex.id]);

      const { rows } = await c.h.pool.query<{ created_by_user_id: string | null; revoked_by_user_id: string | null; status: string }>(
        "SELECT created_by_user_id, revoked_by_user_id, status FROM record_shares WHERE id = $1",
        [sid],
      );
      expect(rows).toEqual([{ created_by_user_id: null, revoked_by_user_id: null, status: "REVOKED" }]);
    });
  });

  describe("TC-MKT-131: exportação do titular (fonte recordShares)", () => {
    it("SELF recebe partilhas e vistas sem conteúdo, sem rótulo e sem ids de utilizador, autoria ou profissional", async () => {
      const s = await scene();
      const b = await bookingOf(s, { status: "CONFIRMED", label: LABEL });
      const id = await createdShare(s.u.token, s.fam, s.m, b);
      await addViews(id, [{ viewNo: 1, viewedAt: at(HOUR), categories: ["MEDICATION"] }]);
      // O canário entra de facto na BD (o rótulo existe), para a ausência na exportação ter significado.
      const { rows } = await c.h.pool.query<{ participant_label: string }>("SELECT participant_label FROM record_shares WHERE id = $1", [id]);
      expect(rows[0]?.participant_label).toBe(LABEL);

      const out = await c.exportRecordShares({ userId: s.u.id, platformAdmin: false }, s.fam, s.m);

      expect(out).toHaveLength(1);
      const share = out[0];
      expect(Object.keys(share ?? {}).sort()).toEqual([...SHARE_KEYS].sort());
      expect(share).toMatchObject({
        id,
        professional: "Dra. Partilha",
        categories: ["MEDICATION"],
        validity: "H24",
        viewOnce: false,
        status: "ACTIVE",
        expiresAt: at(DAY).toISOString(),
        revokedAt: null,
        consumedAt: null,
        createdAt: START.toISOString(),
      });
      const views = share?.views as Json[] | undefined;
      expect(views).toEqual([{ viewNo: 1, viewedAt: at(HOUR).toISOString(), categories: ["MEDICATION"] }]);
      expect(Object.keys(views?.[0] ?? {}).sort()).toEqual([...VIEW_KEYS].sort());

      const json = JSON.stringify(out);
      expect(json).not.toContain(LABEL);
      expect(json).not.toContain("participantLabel");
      for (const pii of [s.u.id, s.pro.professionalId, s.m, s.fam, b]) expect(json).not.toContain(pii);
    });

    it("membro sem partilhas devolve []", async () => {
      const s = await scene();
      expect(await c.exportRecordShares({ userId: s.u.id, platformAdmin: false }, s.fam, s.m)).toEqual([]);
    });

    it("tutor de dependente sem partilhas devolve [] (TUTOR_OF é autorizado)", async () => {
      const s = await scene();
      const d = await c.member(s.fam, { dependent: true, guardians: [s.m], name: "Sem partilhas" });
      expect(await c.exportRecordShares({ userId: s.u.id, platformAdmin: false }, s.fam, d)).toEqual([]);
    });

    it("DEPENDENT_SELF é negado com ForbiddenError (a partilha é do titular/tutor)", async () => {
      const s = await scene();
      const dep = await c.user("dependente", { birth: "2012-01-01" });
      const d = await c.member(s.fam, { dependent: true, userId: dep.id, guardians: [s.m], name: "Dependente" });
      const b = await bookingOf(s, { memberId: d, status: "CONFIRMED" });
      await seedShare({ familyId: s.fam, memberId: d, professionalId: s.pro.professionalId, bookingId: b });

      await expect(c.exportRecordShares({ userId: dep.id, platformAdmin: false }, s.fam, d)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("outro adulto com SharingGrant de MEDICATION é negado com ForbiddenError", async () => {
      const s = await scene();
      const outro = await c.user("outro");
      const mOutro = await c.member(s.fam, { userId: outro.id, role: "FAMILY_MEMBER", name: "Outro" });
      await c.sharing(s.fam, s.m, mOutro, "MEDICATION");
      const b = await bookingOf(s, { status: "CONFIRMED" });
      await seedShare({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId: b });

      await expect(c.exportRecordShares({ userId: outro.id, platformAdmin: false }, s.fam, s.m)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("UC-MKT-56: aviso genérico ao profissional", () => {
    it("notifyNewShare envia 1 e-mail ao e-mail da conta do profissional e devolve SENT", async () => {
      const s = await scene();
      const b = await bookingOf(s, { status: "CONFIRMED" });
      const sid = await seedShare({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId: b });
      const antes = c.shareMails.length;

      const res = await c.shareMaintenance.notifyNewShare({ professionalId: s.pro.professionalId, shareId: sid });

      expect(res).toBe("SENT");
      expect(c.shareMails.slice(antes)).toEqual([s.pro.email]);
    });

    it("profissional sem conta devolve SKIPPED e não envia e-mail", async () => {
      const s = await scene();
      const b = await bookingOf(s, { status: "CONFIRMED" });
      const sid = await seedShare({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId: b });
      const antes = c.shareMails.length;

      const res = await c.shareMaintenance.notifyNewShare({ professionalId: randomUUID(), shareId: sid });

      expect(res).toBe("SKIPPED");
      expect(c.shareMails).toHaveLength(antes);
    });

    it("falha do envio rejeita com 'share_notice_failed' sem o e-mail na mensagem nem na causa", async () => {
      const s = await scene();
      const b = await bookingOf(s, { status: "CONFIRMED" });
      const sid = await seedShare({ familyId: s.fam, memberId: s.m, professionalId: s.pro.professionalId, bookingId: b });
      let erro: unknown;
      c.failShareMail.value = true;
      try {
        await c.shareMaintenance.notifyNewShare({ professionalId: s.pro.professionalId, shareId: sid });
      } catch (e) {
        erro = e;
      } finally {
        c.failShareMail.value = false;
      }

      expect(erro).toBeInstanceOf(Error);
      const err = erro as Error;
      expect(err.message).toBe("share_notice_failed");
      expect(err.cause).toBeUndefined();
      expect(err.message).not.toContain(s.pro.email);
      expect(err.stack ?? "").not.toContain(s.pro.email);
    });

    it("criar a partilha pela API enfileira exatamente 1 aviso com {professionalId, shareId}", async () => {
      const s = await scene();
      const b = await bookingOf(s, { status: "CONFIRMED", label: LABEL });
      const antes = c.shareNoticeCalls.length;

      const id = await createdShare(s.u.token, s.fam, s.m, b);

      expect(c.shareNoticeCalls.slice(antes)).toEqual([{ professionalId: s.pro.professionalId, shareId: id }]);
    });
  });
});
