/* eslint-disable @typescript-eslint/no-unsafe-member-access -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Integração (PostgreSQL real + API real validada contra o openapi.yaml) do leitor público `ProfessionalDirectory` (BR-MKT-19,
// TC-MKT-15, TC-MKT-16, TC-AZ-MKT-05, authorization.md §10.4), dos jobs diários `expire-credentials` (BR-MKT-21, TC-MKT-18), `generate-slots`
// (BR-MKT-25, janela rolante) e `cleanup` (TC-MKT-28). Os valores ESPERADOS são calculados aqui com aritmética de Date (Luanda = UTC+1
// fixo), sem importar código de produção. Nota: os IDs TC da lista de testes (`docs/09-testing/test-cases.md`) não coincidem com os nomes
// usados nas descrições de alguns blocos; ver o cabeçalho de cada bloco.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, PROFESSIONAL_API, START, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const SCHEDULE = `${PROFESSIONAL_API}/schedule-rules`;
const TIME_OFF = `${PROFESSIONAL_API}/time-off`;
const SLOTS = `${PROFESSIONAL_API}/slots`;
const SUBMISSION = `${PROFESSIONAL_API}/submission`;
const ME = `${PROFESSIONAL_API}/me`;
const ADMIN = `${API}/admin/professionals`;

const DAY_MS = 86_400_000;
/** Africa/Luanda é UTC+1 fixo (sem horário de verão). */
const LUANDA_OFFSET_MS = 3_600_000;
const WEEK = [1, 2, 3, 4, 5];
const CANARY_IBAN = "iban-canario-ao06";
const FORBIDDEN_KEYS = ["paymentInstructions", "email", "passwordHash", "validationStatus", "statusReason", "credentials", "accountId", "storageKey"];
const NON_APPROVED = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "REJECTED", "SUSPENDED"] as const;

type Status = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";
type Category = "HEALTH" | "WELLNESS";
type CredentialKind = "IDENTITY" | "PROFESSIONAL_LICENSE" | "CERTIFICATION";
type ScanStatus = "PENDING" | "CLEAN" | "INFECTED";
interface Pro {
  email: string;
  accountId: string;
  professionalId: string;
  token: string;
}
interface Spec {
  id: string;
  name: string;
  category: Category;
}
interface RuleSpec {
  weekdays: number[];
  startTime: string;
  endTime: string;
  durationMin: number;
}

// ---------------------------------------------------------------- cálculo independente dos valores esperados

/** Instante UTC de um dia civil de Luanda + `HH:mm` local (subtrai-se 1 h). */
function luandaInstant(day: string, hhmm: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d, hh - 1, mm));
}
/** Início (00:00 locais) de um dia civil de Luanda, em UTC. */
function luandaMidnight(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - LUANDA_OFFSET_MS);
}
/** Dia civil de Luanda de um instante. */
function luandaDay(instant: Date): string {
  return new Date(instant.getTime() + LUANDA_OFFSET_MS).toISOString().slice(0, 10);
}
function addDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
/** ISO: 1 = segunda … 7 = domingo. */
function weekdayOf(day: string): number {
  const w = new Date(`${day}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Inícios esperados (ISO, ordenados) de uma regra na janela de 8 semanas (hoje de Luanda + 0..56), só os futuros e fora de bloqueios. */
function expectedStarts(rule: RuleSpec, now: Date, blocked: { start: Date; end: Date }[] = []): string[] {
  const out: string[] = [];
  const today = luandaDay(now);
  const durMs = rule.durationMin * 60_000;
  for (let i = 0; i <= 56; i++) {
    const day = addDay(today, i);
    if (!rule.weekdays.includes(weekdayOf(day))) continue;
    const endMs = luandaInstant(day, rule.endTime).getTime();
    for (let t = luandaInstant(day, rule.startTime).getTime(); t + durMs <= endMs; t += durMs) {
      if (t <= now.getTime()) continue;
      if (blocked.some((b) => t < b.end.getTime() && b.start.getTime() < t + durMs)) continue;
      out.push(new Date(t).toISOString());
    }
  }
  return out;
}

const BASE: RuleSpec = { weekdays: WEEK, startTime: "08:00", endTime: "12:00", durationMin: 30 };
const WEEKEND: RuleSpec = { weekdays: [6, 7], startTime: "08:00", endTime: "12:00", durationMin: 30 };
/** Fim (exclusivo) da janela de leitura de hoje+56 dias: meia-noite de Luanda do dia seguinte ao último. */
const windowEnd = (now: Date): Date => luandaMidnight(addDay(luandaDay(now), 57));

/** Chaves de um valor (recursivo). */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const cityTag = (label: string): string => `Cidade ${label} ${randomUUID().slice(0, 8)}`;
const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

describe("integração: ProfessionalDirectory, jobs expire-credentials / generate-slots / cleanup (MK1)", () => {
  let h: ProfessionalsHarness;

  beforeAll(async () => {
    h = await startProfessionalsHarness();
  });
  beforeEach(() => {
    h.clock.set(START);
  });
  afterAll(async () => {
    await h.stop();
  });

  // ---------------------------------------------------------------- helpers

  const dir = () => h.module.directory;

  async function count(sqlText: string, params: unknown[] = []): Promise<number> {
    const { rows } = await h.pool.query<{ n: number }>(sqlText, params);
    return rows[0]?.n ?? 0;
  }

  /** Força o estado de validação por SQL (pré-condição de teste; contorna a máquina de estados de propósito). */
  async function setState(professionalId: string, status: Status, reason: string | null = null): Promise<void> {
    await h.pool.query(
      `UPDATE professionals SET
         validation_status = $2::professional_validation_status,
         status_reason = $3,
         status_changed_at = now(),
         submitted_at = CASE WHEN $2::professional_validation_status = 'DRAFT' THEN NULL ELSE COALESCE(submitted_at, now()) END,
         approved_at = CASE WHEN $2::professional_validation_status = 'APPROVED' THEN COALESCE(approved_at, now()) ELSE NULL END,
         display_name = CASE WHEN $2::professional_validation_status = 'APPROVED' THEN COALESCE(display_name, 'Nome Aprovado') ELSE display_name END,
         city = CASE WHEN $2::professional_validation_status = 'APPROVED' THEN COALESCE(city, 'Luanda') ELSE city END,
         updated_at = now()
       WHERE id = $1`,
      [professionalId, status, reason],
    );
  }

  async function fillProfile(professionalId: string, city: string, name = `Nome ${randomUUID().slice(0, 8)}`): Promise<void> {
    await h.pool.query("UPDATE professionals SET display_name = $2, city = $3, bio = $4 WHERE id = $1", [professionalId, name, city, `Bio de ${name}`]);
  }

  /** Liga ao profissional uma especialidade nova do catálogo. */
  async function linkSpecialty(professionalId: string, category: Category = "HEALTH", name = `Esp ${randomUUID().slice(0, 8)}`): Promise<Spec> {
    const { rows } = await h.pool.query<{ id: string }>("INSERT INTO specialties (name, category, active) VALUES ($1, $2, true) RETURNING id", [name, category]);
    const id = rows[0]?.id ?? "";
    await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, id]);
    return { id, name, category };
  }

  async function insertOffer(
    professionalId: string,
    specialtyId: string,
    o: { method?: string; durationMinutes?: number; priceKz?: number; note?: string | null; active?: boolean } = {},
  ): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>(
      "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz, note, active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [professionalId, specialtyId, o.method ?? "IN_PERSON", o.durationMinutes ?? 30, o.priceKz ?? 5000, o.note === undefined ? null : o.note, o.active ?? true],
    );
    return rows[0]?.id ?? "";
  }

  async function addCredential(
    professionalId: string,
    kind: CredentialKind,
    opts: { validUntil?: string | null; scan?: ScanStatus; createdAt?: Date } = {},
  ): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>(
      `INSERT INTO professional_credentials (professional_id, kind, valid_until, storage_key, content_type, size_bytes, scan_status, created_at)
       VALUES ($1, $2, $3, $4, 'application/pdf', 100, $5, COALESCE($6::timestamptz, now())) RETURNING id`,
      [professionalId, kind, opts.validUntil ?? null, `prof-cred/canario-${randomUUID()}`, opts.scan ?? "CLEAN", opts.createdAt ?? null],
    );
    return rows[0]?.id ?? "";
  }

  /** Profissional registado, verificado, com perfil preenchido e especialidades; estado DRAFT (chamador escolhe o estado). */
  async function newPro(city: string, categories: Category[] = ["HEALTH"]): Promise<{ pro: Pro; specs: Spec[] }> {
    const pro = await h.newProfessional();
    await fillProfile(pro.professionalId, city);
    const specs: Spec[] = [];
    for (const c of categories) specs.push(await linkSpecialty(pro.professionalId, c));
    return { pro, specs };
  }

  /** Decisão do admin (token de Platform Admin). */
  async function decide(professionalId: string, body: { decision: string; reason?: string }): Promise<void> {
    await request(h.app).post(`${ADMIN}/${professionalId}/decisions`).set(auth(await h.adminToken())).send(body).expect(200);
  }

  /** Aprovação pelo admin: credenciais CLEAN válidas (HEALTH) e PENDING_REVIEW → APPROVE (fluxo real). */
  async function approveByAdmin(pro: Pro): Promise<void> {
    await addCredential(pro.professionalId, "IDENTITY", { validUntil: "2027-12-31" });
    await addCredential(pro.professionalId, "PROFESSIONAL_LICENSE", { validUntil: "2027-12-31" });
    await setState(pro.professionalId, "PENDING_REVIEW");
    await decide(pro.professionalId, { decision: "APPROVE" });
  }

  /** Profissional APPROVED por SQL (pré-condição) com perfil e especialidades. */
  async function approvedPro(city: string, categories: Category[] = ["HEALTH"]): Promise<{ pro: Pro; specs: Spec[] }> {
    const made = await newPro(city, categories);
    await setState(made.pro.professionalId, "APPROVED");
    return made;
  }

  /** Regra API (Seg–Sex 08:00–12:00) numa oferta nova de 30 min do profissional APPROVED; gera os horários. */
  async function bookablePro(city: string): Promise<{ pro: Pro; specId: string; offerId: string; ruleId: string }> {
    const { pro, specs } = await approvedPro(city);
    const specId = specs[0]?.id ?? "";
    const offerId = await insertOffer(pro.professionalId, specId, { durationMinutes: 30 });
    const res = await request(h.app).post(SCHEDULE).set(auth(pro.token)).send({ offerId, weekdays: WEEK, startTime: "08:00", endTime: "12:00" }).expect(201);
    return { pro, specId, offerId, ruleId: res.body.rule.id as string };
  }

  /** Insere `n` profissionais APPROVED na mesma cidade (SQL, rápido) e devolve os ids. */
  async function bulkApproved(n: number, city: string): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const acc = await h.pool.query<{ id: string }>(
        "INSERT INTO professional_accounts (email, password_hash, status, email_verified_at, terms_accepted_version, terms_accepted_at) VALUES ($1, 'x', 'ACTIVE', now(), '1.0', now()) RETURNING id",
        [`bulk-${randomUUID()}@exemplo.ao`],
      );
      const row = await h.pool.query<{ id: string }>(
        "INSERT INTO professionals (account_id, display_name, city, validation_status, submitted_at, approved_at) VALUES ($1, $2, $3, 'APPROVED', now(), now()) RETURNING id",
        [acc.rows[0]?.id ?? "", `Nome ${String(i).padStart(3, "0")}`, city],
      );
      ids.push(row.rows[0]?.id ?? "");
    }
    return ids;
  }

  const expiredCases = () => count("SELECT count(*)::int AS n FROM validation_cases WHERE action = 'EXPIRED'");
  const slotCount = (professionalId: string) => count("SELECT count(*)::int AS n FROM professional_slots WHERE professional_id = $1", [professionalId]);
  const totalSlots = () => count("SELECT count(*)::int AS n FROM professional_slots");
  const auditCount = (action: string) => count("SELECT count(*)::int AS n FROM audit_logs WHERE action = $1", [action]);
  async function statusOf(professionalId: string): Promise<{ validation_status: string; status_reason: string | null }> {
    const { rows } = await h.pool.query<{ validation_status: string; status_reason: string | null }>("SELECT validation_status, status_reason FROM professionals WHERE id = $1", [professionalId]);
    return rows[0] ?? { validation_status: "", status_reason: null };
  }
  async function slotStartsApi(token: string, from: Date, to: Date): Promise<string[]> {
    const res = await request(h.app).get(SLOTS).query({ from: from.toISOString(), to: to.toISOString() }).set(auth(token)).expect(200);
    return (res.body as { startsAt: string }[]).map((s) => s.startsAt);
  }

  // ================================================================ (1) leitor ProfessionalDirectory

  describe("(1) ProfessionalDirectory (TC-MKT-15, TC-MKT-16, TC-AZ-MKT-05, BR-MKT-19)", () => {
    it("APPROVED: getApprovedProfile devolve o perfil público exato (ofertas ativas com preço e nota; especialidades com categoria)", async () => {
      const city = cityTag("perfil");
      const { pro, specs } = await newPro(city, ["HEALTH", "WELLNESS"]);
      const [s1, s2] = [specs[0], specs[1]];
      if (!s1 || !s2) throw new Error("especialidades em falta");
      const o1 = await insertOffer(pro.professionalId, s1.id, { method: "IN_PERSON", durationMinutes: 30, priceKz: 5000, note: "Morada X" });
      const o2 = await insertOffer(pro.professionalId, s2.id, { method: "VIDEO", durationMinutes: 45, priceKz: 0, note: null });
      await insertOffer(pro.professionalId, s1.id, { method: "CHAT", durationMinutes: 15, priceKz: 100, note: "inativa", active: false });
      await setState(pro.professionalId, "APPROVED");

      const profile = await dir().getApprovedProfile(pro.professionalId);
      expect(profile).not.toBeNull();
      expect(Object.keys(profile ?? {}).sort()).toEqual(["bio", "city", "displayName", "id", "offers", "specialties"]);
      expect(profile?.id).toBe(pro.professionalId);
      expect(profile?.city).toBe(city);
      expect(profile?.bio).toMatch(/^Bio de /);
      expect([...(profile?.specialties ?? [])].sort(byId)).toEqual([s1, s2].sort(byId));
      const offers = [...(profile?.offers ?? [])].sort(byId);
      expect(offers).toEqual(
        [
          { id: o1, specialtyId: s1.id, method: "IN_PERSON", durationMinutes: 30, priceKz: 5000, note: "Morada X" },
          { id: o2, specialtyId: s2.id, method: "VIDEO", durationMinutes: 45, priceKz: 0, note: null },
        ].sort(byId),
      );
      // Oferta inativa nunca aparece (existe na BD).
      expect(await count("SELECT count(*)::int AS n FROM professional_offers WHERE professional_id = $1", [pro.professionalId])).toBe(3);
    });

    it.each([...NON_APPROVED])("%s: getApprovedProfile e listApproved ignoram o profissional; a resposta é igual à de id inexistente (null / [])", async (status) => {
      const city = cityTag(status);
      const { pro, specs } = await newPro(city);
      await insertOffer(pro.professionalId, specs[0]?.id ?? "", { active: true });
      await setState(pro.professionalId, status, status === "DRAFT" ? null : "Motivo de teste.");

      expect(await dir().getApprovedProfile(pro.professionalId)).toBeNull();
      expect(await dir().getApprovedProfile(randomUUID())).toBeNull();
      expect(await dir().listApproved({ city })).toEqual([]);
      expect(await dir().listBookableSlots(pro.professionalId, START, new Date(START.getTime() + DAY_MS))).toEqual([]);
    });

    it("o estado lê-se em CADA chamada (sem cache): pendente → aprova → lê; suspende → lê null; reativa → lê perfil", async () => {
      const city = cityTag("estado");
      const { pro } = await newPro(city);
      await setState(pro.professionalId, "PENDING_REVIEW");
      expect(await dir().getApprovedProfile(pro.professionalId)).toBeNull();

      await approveByAdmin(pro);
      expect((await dir().getApprovedProfile(pro.professionalId))?.id).toBe(pro.professionalId);
      expect((await dir().listApproved({ city })).map((p) => p.id)).toEqual([pro.professionalId]);

      await decide(pro.professionalId, { decision: "SUSPEND", reason: "Suspensão de teste." });
      expect(await dir().getApprovedProfile(pro.professionalId)).toBeNull();
      expect(await dir().listApproved({ city })).toEqual([]);

      await decide(pro.professionalId, { decision: "REACTIVATE" });
      expect((await dir().getApprovedProfile(pro.professionalId))?.id).toBe(pro.professionalId);
    });

    it("o objeto devolvido (perfil e listagem) não tem chaves proibidas, recursivamente, e não contém os canários", async () => {
      const city = cityTag("canario");
      const { pro, specs } = await newPro(city);
      await h.pool.query("UPDATE professionals SET payment_instructions = $2 WHERE id = $1", [pro.professionalId, CANARY_IBAN]);
      await insertOffer(pro.professionalId, specs[0]?.id ?? "", { note: "nota pública" });
      await addCredential(pro.professionalId, "IDENTITY", { validUntil: "2027-12-31" });
      await setState(pro.professionalId, "APPROVED");
      const storageKey = (await h.pool.query<{ storage_key: string }>("SELECT storage_key FROM professional_credentials WHERE professional_id = $1", [pro.professionalId])).rows[0]?.storage_key ?? "";
      expect(storageKey).toContain("canario");

      const profile = await dir().getApprovedProfile(pro.professionalId);
      const [listed] = await dir().listApproved({ city });
      expect(profile).not.toBeNull();
      expect(listed).toBeDefined();
      for (const value of [profile, listed]) {
        const keys = allKeys(value);
        for (const forbidden of FORBIDDEN_KEYS) expect(keys).not.toContain(forbidden);
        const json = JSON.stringify(value);
        expect(json).toContain("nota pública"); // o teste não é vácuo
        for (const canary of [CANARY_IBAN, pro.email, pro.accountId, storageKey]) expect(json).not.toContain(canary);
      }
    });

    it("listApproved só devolve APPROVED, ordenado por id; profissionais por aprovar nunca aparecem", async () => {
      const city = cityTag("lista");
      const approvedIds: string[] = [];
      for (let i = 0; i < 3; i++) approvedIds.push((await approvedPro(city)).pro.professionalId);
      for (const status of NON_APPROVED) {
        const { pro } = await newPro(city);
        await setState(pro.professionalId, status, status === "DRAFT" ? null : "Motivo.");
      }
      const listed = await dir().listApproved({ city });
      expect(listed.map((p) => p.id)).toEqual([...approvedIds].sort());
    });

    it("filtros: category, specialtyId e city (case-insensitive) combinam-se só com APPROVED", async () => {
      const city = cityTag("filtros");
      const a = await approvedPro(city, ["HEALTH"]);
      const b = await approvedPro(city, ["WELLNESS"]);
      const c = await approvedPro(city, ["HEALTH", "WELLNESS"]);
      const d = await newPro(city, ["HEALTH"]); // por aprovar: nunca aparece
      await setState(d.pro.professionalId, "PENDING_REVIEW");
      const ids = (list: { id: string }[]) => list.map((p) => p.id).sort();

      expect(ids(await dir().listApproved({ city }))).toEqual([a, b, c].map((x) => x.pro.professionalId).sort());
      expect(ids(await dir().listApproved({ city, category: "HEALTH" }))).toEqual([a.pro.professionalId, c.pro.professionalId].sort());
      expect(ids(await dir().listApproved({ city, category: "WELLNESS" }))).toEqual([b.pro.professionalId, c.pro.professionalId].sort());
      expect(ids(await dir().listApproved({ city, specialtyId: a.specs[0]?.id ?? "" }))).toEqual([a.pro.professionalId]);
      expect(ids(await dir().listApproved({ city: city.toUpperCase() }))).toEqual([a, b, c].map((x) => x.pro.professionalId).sort());
      expect(await dir().listApproved({ city: "Cidade inexistente" })).toEqual([]);
      expect(ids(await dir().listApproved({ city, category: "WELLNESS", specialtyId: c.specs[0]?.id ?? "" }))).toEqual([c.pro.professionalId]);
      expect(ids(await dir().listApproved({ city, category: "WELLNESS", specialtyId: a.specs[0]?.id ?? "" }))).toEqual([]);
    });

    it("limit (mínimo 1, máximo 100, omissão 20) e afterId: paginar com 50 sem repetir nem saltar", async () => {
      const city = cityTag("paginacao");
      const ids = await bulkApproved(105, city);
      expect((await dir().listApproved({ city, limit: 0 })).length).toBe(1);
      expect((await dir().listApproved({ city, limit: -5 })).length).toBe(1);
      expect((await dir().listApproved({ city })).length).toBe(20);
      expect((await dir().listApproved({ city, limit: 500 })).length).toBe(100);

      const all: string[] = [];
      let page = await dir().listApproved({ city, limit: 50 });
      while (page.length > 0) {
        all.push(...page.map((p) => p.id));
        const last = page.at(-1)?.id;
        if (!last) break;
        page = await dir().listApproved({ city, limit: 50, afterId: last });
      }
      expect(all).toEqual([...ids].sort());
      expect(new Set(all).size).toBe(105);
    });

    it("listBookableSlots: só horários futuros (starts_at > agora), intervalo [from, to), no formato esperado", async () => {
      const city = cityTag("slots");
      const { pro, offerId } = await bookablePro(city);
      const from = new Date("2026-11-16T00:00:00.000Z");
      const to = new Date("2026-11-20T00:00:00.000Z");
      const expected = expectedStarts(BASE, START).filter((s) => Date.parse(s) >= from.getTime() && Date.parse(s) < to.getTime());

      const slots = await dir().listBookableSlots(pro.professionalId, from, to);
      expect(slots.map((s) => s.startsAt.toISOString())).toEqual(expected);
      expect(slots.every((s) => s.offerId === offerId)).toBe(true);
      expect(slots.every((s) => s.endsAt.getTime() - s.startsAt.getTime() === 30 * 60_000)).toBe(true);
      expect(Object.keys(slots[0] ?? {}).sort()).toEqual(["endsAt", "id", "offerId", "startsAt"]);

      // Só futuros: entre 06:00Z e 12:00Z de hoje (agora = 10:00Z) só sobra o das 10:30Z (11:30 locais).
      const today = await dir().listBookableSlots(pro.professionalId, new Date("2026-11-16T06:00:00Z"), new Date("2026-11-16T12:00:00Z"));
      expect(today.map((s) => s.startsAt.toISOString())).toEqual(["2026-11-16T10:30:00.000Z"]);
    });

    it("listBookableSlots: to <= from ⇒ []; intervalo de 62 dias ⇒ devolve; 62 dias + 1 ms ou 63 dias ⇒ []", async () => {
      const city = cityTag("intervalo");
      const { pro } = await bookablePro(city);
      const p = pro.professionalId;
      const day = (n: number) => new Date(START.getTime() + n * DAY_MS);
      expect(await dir().listBookableSlots(p, START, START)).toEqual([]);
      expect(await dir().listBookableSlots(p, day(1), START)).toEqual([]);
      const exact = await dir().listBookableSlots(p, START, day(62));
      expect(exact.length).toBeGreaterThan(0);
      expect(exact.map((s) => s.startsAt.toISOString())).toEqual(expectedStarts(BASE, START).filter((s) => Date.parse(s) < day(62).getTime()));
      expect(await dir().listBookableSlots(p, START, new Date(day(62).getTime() + 1))).toEqual([]);
      expect(await dir().listBookableSlots(p, START, day(63))).toEqual([]);
    });

    it.each(["SUSPENDED", "PENDING_REVIEW", "NEEDS_INFO", "REJECTED", "DRAFT"] as const)(
      "%s: os horários continuam na BD mas listBookableSlots não os devolve; ao voltar a APPROVED reaparecem",
      async (status) => {
        const { pro } = await bookablePro(cityTag(status));
        const from = START;
        const to = new Date(START.getTime() + 60 * DAY_MS);
        expect((await dir().listBookableSlots(pro.professionalId, from, to)).length).toBeGreaterThan(0);
        const rows = await slotCount(pro.professionalId);
        expect(rows).toBeGreaterThan(0);

        await setState(pro.professionalId, status, status === "DRAFT" ? null : "Motivo.");
        expect(await dir().listBookableSlots(pro.professionalId, from, to)).toEqual([]);
        expect(await slotCount(pro.professionalId)).toBe(rows);

        await setState(pro.professionalId, "APPROVED");
        expect((await dir().listBookableSlots(pro.professionalId, from, to)).length).toBe(rows);
      },
    );

    it("só horários de ofertas ativas: desativar a oferta (UPDATE direto) faz os seus horários desaparecer", async () => {
      const city = cityTag("oferta");
      const { pro, specId, offerId: offerA } = await bookablePro(city);
      const offerB = await insertOffer(pro.professionalId, specId, { method: "VIDEO", durationMinutes: 30 });
      await request(h.app).post(SCHEDULE).set(auth(pro.token)).send({ offerId: offerB, weekdays: [6, 7], startTime: "08:00", endTime: "12:00" }).expect(201);
      const from = START;
      const to = new Date("2026-11-23T00:00:00Z");
      const before = await dir().listBookableSlots(pro.professionalId, from, to);
      expect(before.some((s) => s.offerId === offerA)).toBe(true);
      expect(before.some((s) => s.offerId === offerB)).toBe(true);

      await h.pool.query("UPDATE professional_offers SET active = false WHERE id = $1", [offerA]);
      const after = await dir().listBookableSlots(pro.professionalId, from, to);
      expect(after.some((s) => s.offerId === offerA)).toBe(false);
      expect(after.map((s) => s.startsAt.toISOString())).toEqual(expectedStarts(WEEKEND, START).filter((s) => Date.parse(s) < to.getTime()));
    });

    it("suspensão pelo admin retira o profissional do diretório e dos horários (sem apagar nada)", async () => {
      const city = cityTag("suspenso");
      const { pro } = await bookablePro(city);
      expect((await dir().listApproved({ city })).length).toBe(1);
      await decide(pro.professionalId, { decision: "SUSPEND", reason: "Suspensão de teste." });
      expect(await dir().getApprovedProfile(pro.professionalId)).toBeNull();
      expect(await dir().listBookableSlots(pro.professionalId, START, new Date("2026-11-20T00:00:00Z"))).toEqual([]);
      expect(await slotCount(pro.professionalId)).toBe(321);
    });

    it("não há rota para famílias: GET /professionals, /professionals/{id} e /specialties com token de User ⇒ 404", async () => {
      const token = await h.userToken();
      await request(h.app).get(`${API}/professionals`).set(auth(token)).expect(404);
      await request(h.app).get(`${API}/professionals/${randomUUID()}`).set(auth(token)).expect(404);
      await request(h.app).get(`${API}/specialties`).set(auth(token)).expect(404);
    });
  });

  // ================================================================ (2) expire-credentials

  describe("(2) job expire-credentials (TC-MKT-18 no doc de casos de teste; BR-MKT-21)", () => {
    /** Aprovado por SQL, com as credenciais dadas (pré-condição: a caducidade é o que se testa). */
    async function approvedWithCredentials(city: string, creds: { kind: CredentialKind; scan?: ScanStatus; validUntil?: string | null }[]): Promise<Pro> {
      const { pro } = await newPro(city);
      for (const c of creds) await addCredential(pro.professionalId, c.kind, { validUntil: c.validUntil ?? null, scan: c.scan ?? "CLEAN" });
      await setState(pro.professionalId, "APPROVED");
      return pro;
    }
    /** Corre o job e confirma que o nº devolvido = casos EXPIRED criados nesta execução. */
    async function expireRun(): Promise<number> {
      const before = await expiredCases();
      const res = await h.jobs.expireCredentials();
      expect(res.expired).toBe((await expiredCases()) - before);
      return res.expired;
    }

    it("IDENTITY CLEAN caducada (ontem) + LICENSE válida ⇒ NEEDS_INFO, ValidationCase EXPIRED (SYSTEM), auditoria, /me e diretório", async () => {
      const city = cityTag("caducada");
      const pro = await approvedWithCredentials(city, [
        { kind: "IDENTITY", validUntil: "2026-11-15" },
        { kind: "PROFESSIONAL_LICENSE", validUntil: "2027-12-31" },
      ]);
      expect(await expireRun()).toBe(1);

      expect(await statusOf(pro.professionalId)).toEqual({ validation_status: "NEEDS_INFO", status_reason: "Credencial caducada." });
      const cases = await h.pool.query<Record<string, unknown>>("SELECT action, from_status, to_status, actor, decided_by, reason FROM validation_cases WHERE professional_id = $1", [pro.professionalId]);
      expect(cases.rows).toEqual([{ action: "EXPIRED", from_status: "APPROVED", to_status: "NEEDS_INFO", actor: "SYSTEM", decided_by: null, reason: "Credencial caducada." }]);

      const audit = await h.pool.query<{ actor_type: string; metadata: Record<string, unknown>; result: string }>(
        "SELECT actor_type, metadata, result FROM audit_logs WHERE action = 'PROFESSIONAL_CREDENTIAL_EXPIRED' ORDER BY id DESC LIMIT 1",
      );
      expect(audit.rows[0]?.actor_type).toBe("SYSTEM");
      expect(audit.rows[0]?.result).toBe("SUCCESS");
      expect(audit.rows[0]?.metadata).toEqual({ count: 1 });
      const metaJson = JSON.stringify(audit.rows[0]?.metadata ?? {});
      expect(metaJson).not.toContain(pro.professionalId);
      expect(metaJson).not.toContain("Credencial caducada");

      const me = await request(h.app).get(ME).set(auth(pro.token)).expect(200);
      expect(me.body.validationStatus).toBe("NEEDS_INFO");
      expect(me.body.statusReason).toBe("Credencial caducada.");
      expect(me.body.requirements.missing).toContain("CREDENTIAL_EXPIRED");
      expect(me.body.requirements.canSubmit).toBe(false);

      expect(await dir().getApprovedProfile(pro.professionalId)).toBeNull();
    });

    it("valid_until = hoje (16/11, Luanda) NÃO caduca; credencial caducada com outra CLEAN válida do mesmo tipo NÃO muda", async () => {
      const today = await approvedWithCredentials(cityTag("hoje"), [
        { kind: "IDENTITY", validUntil: "2026-11-16" },
        { kind: "PROFESSIONAL_LICENSE", validUntil: "2027-12-31" },
      ]);
      const renewed = await approvedWithCredentials(cityTag("renovada"), [
        { kind: "IDENTITY", validUntil: "2026-11-15" },
        { kind: "IDENTITY", validUntil: "2027-12-31" },
        { kind: "PROFESSIONAL_LICENSE", validUntil: "2027-12-31" },
      ]);
      expect(await expireRun()).toBe(0);
      expect((await statusOf(today.professionalId)).validation_status).toBe("APPROVED");
      expect((await statusOf(renewed.professionalId)).validation_status).toBe("APPROVED");
      expect(await count("SELECT count(*)::int AS n FROM validation_cases WHERE professional_id = ANY($1::uuid[])", [[today.professionalId, renewed.professionalId]])).toBe(0);
    });

    it.each(["INFECTED", "PENDING"] as const)("credencial IDENTITY %s com valid_until passado NÃO é caducidade: APPROVED não muda", async (scan) => {
      const pro = await approvedWithCredentials(cityTag(scan), [
        { kind: "IDENTITY", scan, validUntil: "2026-01-01" },
        { kind: "PROFESSIONAL_LICENSE", validUntil: "2027-12-31" },
      ]);
      expect(await expireRun()).toBe(0);
      expect(await statusOf(pro.professionalId)).toEqual({ validation_status: "APPROVED", status_reason: null });
      expect(await count("SELECT count(*)::int AS n FROM validation_cases WHERE professional_id = $1", [pro.professionalId])).toBe(0);
    });

    it.each(["SUSPENDED", "PENDING_REVIEW"] as const)("%s com credencial caducada NÃO é tocado pelo job", async (status) => {
      const pro = await approvedWithCredentials(cityTag(status), [
        { kind: "IDENTITY", validUntil: "2026-11-15" },
        { kind: "PROFESSIONAL_LICENSE", validUntil: "2027-12-31" },
      ]);
      await setState(pro.professionalId, status, status === "SUSPENDED" ? "Motivo." : null);
      expect(await expireRun()).toBe(0);
      expect((await statusOf(pro.professionalId)).validation_status).toBe(status);
      expect(await count("SELECT count(*)::int AS n FROM validation_cases WHERE professional_id = $1", [pro.professionalId])).toBe(0);
    });

    it("idempotente: segunda execução devolve 0 e não cria um 2.º ValidationCase", async () => {
      const pro = await approvedWithCredentials(cityTag("idem"), [
        { kind: "IDENTITY", validUntil: "2026-11-15" },
        { kind: "PROFESSIONAL_LICENSE", validUntil: "2027-12-31" },
      ]);
      expect(await expireRun()).toBe(1);
      expect(await expireRun()).toBe(0);
      expect(await count("SELECT count(*)::int AS n FROM validation_cases WHERE professional_id = $1", [pro.professionalId])).toBe(1);
      expect((await statusOf(pro.professionalId)).validation_status).toBe("NEEDS_INFO");
    });

    it("relógio injetado em Luanda: 16/11 23:59 local ainda não caduca; 17/11 00:00 local (= 23:00Z de 16/11) caduca", async () => {
      const pro = await approvedWithCredentials(cityTag("virada"), [
        { kind: "IDENTITY", validUntil: "2026-11-16" },
        { kind: "PROFESSIONAL_LICENSE", validUntil: "2027-12-31" },
      ]);
      h.clock.set(new Date("2026-11-16T22:59:00Z"));
      expect(await expireRun()).toBe(0);
      expect((await statusOf(pro.professionalId)).validation_status).toBe("APPROVED");

      // Em UTC ainda é dia 16 às 23:00Z; em Luanda já é dia 17 às 00:00. Uma implementação em UTC só caducaria às 00:00Z de dia 17.
      h.clock.set(new Date("2026-11-16T23:00:00Z"));
      // (o profissional do teste «hoje» também caduca agora: não se conta aqui, só se verifica o estado deste)
      await h.jobs.expireCredentials();
      expect((await statusOf(pro.professionalId)).validation_status).toBe("NEEDS_INFO");
    });

    it("após caducar, o profissional carrega credencial nova (SQL) e volta a submeter ⇒ PENDING_REVIEW", async () => {
      const pro = await approvedWithCredentials(cityTag("resubmete"), [
        { kind: "IDENTITY", validUntil: "2026-11-15" },
        { kind: "PROFESSIONAL_LICENSE", validUntil: "2027-12-31" },
      ]);
      expect(await expireRun()).toBe(1);
      await addCredential(pro.professionalId, "IDENTITY", { validUntil: "2027-12-31" });
      const me = await request(h.app).get(ME).set(auth(pro.token)).expect(200);
      expect(me.body.requirements.missing).not.toContain("CREDENTIAL_EXPIRED");
      await request(h.app).post(SUBMISSION).set(auth(pro.token)).expect(200);
      expect((await statusOf(pro.professionalId)).validation_status).toBe("PENDING_REVIEW");
      expect(await dir().getApprovedProfile(pro.professionalId)).toBeNull();
    });

    it("falha num profissional não impede os restantes (falha simulada por trigger de BD na inserção do ValidationCase)", async () => {
      const city = cityTag("falha");
      const expiredCreds = [
        { kind: "IDENTITY" as const, validUntil: "2026-11-15" },
        { kind: "PROFESSIONAL_LICENSE" as const, validUntil: "2027-12-31" },
      ];
      const failing = await approvedWithCredentials(city, expiredCreds);
      const healthy = await approvedWithCredentials(city, expiredCreds);
      const fn = `falha_teste_${randomUUID().replace(/-/g, "")}`;
      await h.pool.query(
        `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
           IF NEW.professional_id = '${failing.professionalId}'::uuid THEN RAISE EXCEPTION 'falha simulada de teste'; END IF;
           RETURN NEW; END $$;
         CREATE TRIGGER ${fn}_t BEFORE INSERT ON validation_cases FOR EACH ROW EXECUTE FUNCTION ${fn}();`,
      );
      try {
        expect(await expireRun()).toBe(1);
        expect((await statusOf(failing.professionalId)).validation_status).toBe("APPROVED");
        expect((await statusOf(healthy.professionalId)).validation_status).toBe("NEEDS_INFO");
        const audit = await h.pool.query<{ metadata: { count: number } }>("SELECT metadata FROM audit_logs WHERE action = 'PROFESSIONAL_CREDENTIAL_EXPIRED' ORDER BY id DESC LIMIT 1");
        expect(audit.rows[0]?.metadata).toEqual({ count: 1 });
      } finally {
        await h.pool.query(`DROP TRIGGER IF EXISTS ${fn}_t ON validation_cases; DROP FUNCTION IF EXISTS ${fn}();`);
      }
      // Sem a falha simulada, a execução seguinte trata o que ficou para trás.
      expect(await expireRun()).toBe(1);
      expect((await statusOf(failing.professionalId)).validation_status).toBe("NEEDS_INFO");
    });
  });

  // ================================================================ (3) generate-slots: janela rolante

  describe("(3) job generate-slots: janela rolante sem escritas (TC-MKT-18 no doc de casos de teste; BR-MKT-25)", () => {
    it("avança 30 dias SEM escritas: o job cria só os dias que entram na janela, sem duplicar; a segunda execução cria 0", async () => {
      const city = cityTag("janela");
      const { pro } = await bookablePro(city);
      const oldStarts = expectedStarts(BASE, START);
      expect(await slotCount(pro.professionalId)).toBe(321);

      h.clock.advance(30 * DAY_MS);
      const now2 = new Date(START.getTime() + 30 * DAY_MS);
      const newStarts = expectedStarts(BASE, now2);
      const expectedCreated = newStarts.filter((s) => !oldStarts.includes(s)).length;
      // 12/01/2027 (ter.) … 10/02/2027 (qua.): 22 dias úteis × 8 horários.
      expect(expectedCreated).toBe(176);
      const activeProfessionals = await count(
        "SELECT count(*)::int AS n FROM professionals p WHERE p.validation_status = 'APPROVED' AND EXISTS (SELECT 1 FROM professional_schedule_rules r WHERE r.professional_id = p.id AND r.active)",
      );
      const totalBefore = await totalSlots();
      const auditBefore = await auditCount("PROFESSIONAL_SCHEDULE_GENERATE");

      const res = await h.jobs.generateSlots();
      expect(res.professionals).toBe(activeProfessionals);
      expect(await totalSlots()).toBe(totalBefore + res.created - res.removed);
      expect(await slotCount(pro.professionalId)).toBe(321 + expectedCreated);
      expect(await count("SELECT (count(*) - count(DISTINCT (rule_id, starts_at)))::int AS n FROM professional_slots WHERE professional_id = $1", [pro.professionalId])).toBe(0);

      const token = (await h.login(pro.email)).token;
      expect(await slotStartsApi(token, new Date(now2.getTime() + 1), windowEnd(now2))).toEqual(newStarts);

      // Auditoria: uma entrada SYSTEM por execução, só contagens.
      expect(await auditCount("PROFESSIONAL_SCHEDULE_GENERATE")).toBe(auditBefore + 1);
      const audit = await h.pool.query<{ actor_type: string; metadata: Record<string, unknown>; resource_id: string | null }>(
        "SELECT actor_type, metadata, resource_id FROM audit_logs WHERE action = 'PROFESSIONAL_SCHEDULE_GENERATE' ORDER BY id DESC LIMIT 1",
      );
      expect(audit.rows[0]?.actor_type).toBe("SYSTEM");
      expect(Object.keys(audit.rows[0]?.metadata ?? {}).sort()).toEqual(["created", "professionals", "removed", "skippedOverlap", "skippedTimeOff"]);
      expect(audit.rows[0]?.metadata).toMatchObject({ professionals: activeProfessionals, created: res.created, removed: res.removed });
      expect(JSON.stringify(audit.rows[0]?.metadata ?? {})).not.toContain(pro.professionalId);

      // Mesmo instante: nada a criar nem a remover em nenhum profissional.
      const again = await h.jobs.generateSlots();
      expect(again.created).toBe(0);
      expect(again.removed).toBe(0);
    });

    it.each(["DRAFT", "NEEDS_INFO", "SUSPENDED"] as const)("%s: o job não gera nem apaga horários (APPROVED é o único estado com geração)", async (status) => {
      const city = cityTag(`nao-${status}`);
      const { pro, specs } = await newPro(city);
      const offerId = await insertOffer(pro.professionalId, specs[0]?.id ?? "", { durationMinutes: 30 });
      if (status === "SUSPENDED") {
        await setState(pro.professionalId, "APPROVED");
        await request(h.app).post(SCHEDULE).set(auth(pro.token)).send({ offerId, weekdays: WEEK, startTime: "08:00", endTime: "12:00" }).expect(201);
        await setState(pro.professionalId, "SUSPENDED", "Motivo.");
      } else {
        await request(h.app).post(SCHEDULE).set(auth(pro.token)).send({ offerId, weekdays: WEEK, startTime: "08:00", endTime: "12:00" }).expect(201);
        await setState(pro.professionalId, status, status === "NEEDS_INFO" ? "Motivo." : null);
      }
      const before = await slotCount(pro.professionalId);
      expect(before).toBe(status === "SUSPENDED" ? 321 : 0);

      h.clock.advance(30 * DAY_MS);
      await h.jobs.generateSlots();
      expect(await slotCount(pro.professionalId)).toBe(before);
    });

    it("respeita bloqueios: horários no intervalo de férias não são gerados quando a janela avança", async () => {
      const city = cityTag("bloqueio");
      const { pro } = await bookablePro(city);
      const block = { start: new Date("2026-12-21T00:00:00Z"), end: new Date("2026-12-28T00:00:00Z") };
      await request(h.app).post(TIME_OFF).set(auth(pro.token)).send({ startsAt: block.start.toISOString(), endsAt: block.end.toISOString() }).expect(201);
      expect(await count("SELECT count(*)::int AS n FROM professional_slots WHERE professional_id = $1 AND starts_at >= $2 AND starts_at < $3", [pro.professionalId, block.start, block.end])).toBe(0);

      h.clock.advance(30 * DAY_MS);
      const now2 = new Date(START.getTime() + 30 * DAY_MS);
      await h.jobs.generateSlots();
      expect(await count("SELECT count(*)::int AS n FROM professional_slots WHERE professional_id = $1 AND starts_at >= $2 AND starts_at < $3", [pro.professionalId, block.start, block.end])).toBe(0);
      const token = (await h.login(pro.email)).token;
      expect(await slotStartsApi(token, new Date(now2.getTime() + 1), windowEnd(now2))).toEqual(expectedStarts(BASE, now2, [block]));
    });

    it("não gera para regra inativa (PATCH active=false) nem para oferta inativa (UPDATE direto); a oferta desativada perde os horários futuros", async () => {
      const city = cityTag("inativos");
      const { pro, specId, offerId: offerA } = await bookablePro(city);
      const offerB = await insertOffer(pro.professionalId, specId, { method: "VIDEO", durationMinutes: 30 });
      const ruleB = (await request(h.app).post(SCHEDULE).set(auth(pro.token)).send({ offerId: offerB, weekdays: [6], startTime: "08:00", endTime: "12:00" }).expect(201)).body.rule.id as string;
      const offerC = await insertOffer(pro.professionalId, specId, { method: "PHONE", durationMinutes: 30 });
      await request(h.app).post(SCHEDULE).set(auth(pro.token)).send({ offerId: offerC, weekdays: [7], startTime: "08:00", endTime: "12:00" }).expect(201);
      await request(h.app).patch(`${SCHEDULE}/${ruleB}`).set(auth(pro.token)).send({ active: false }).expect(200);
      await h.pool.query("UPDATE professional_offers SET active = false WHERE id = $1", [offerC]);
      expect(await count("SELECT count(*)::int AS n FROM professional_slots WHERE professional_id = $1 AND offer_id = $2", [pro.professionalId, offerB])).toBe(0);

      h.clock.advance(30 * DAY_MS);
      const now2 = new Date(START.getTime() + 30 * DAY_MS);
      await h.jobs.generateSlots();
      expect(await count("SELECT count(*)::int AS n FROM professional_slots WHERE professional_id = $1 AND offer_id = $2", [pro.professionalId, offerB])).toBe(0);
      // Oferta C desativada por SQL: os horários futuros são removidos pela reconciliação do job; os passados ficam (histórico).
      expect(await count("SELECT count(*)::int AS n FROM professional_slots WHERE professional_id = $1 AND offer_id = $2 AND starts_at > $3", [pro.professionalId, offerC, now2])).toBe(0);
      // A oferta A continua a gerar até ao fim da janela.
      expect(await count("SELECT count(*)::int AS n FROM professional_slots WHERE professional_id = $1 AND offer_id = $2 AND starts_at > $3", [pro.professionalId, offerA, now2])).toBe(
        expectedStarts(BASE, now2).length,
      );
    });
  });

  // ================================================================ (4) cleanup

  describe("(4) job cleanup (TC-MKT-28 no doc de casos de teste)", () => {
    const DAY = (n: number) => new Date(START.getTime() + n * DAY_MS);
    async function insertToken(accountId: string, expiresAt: Date, usedAt: Date | null): Promise<string> {
      const { rows } = await h.pool.query<{ id: string }>(
        "INSERT INTO professional_auth_tokens (account_id, type, token_hash, expires_at, used_at, created_at) VALUES ($1, 'PASSWORD_RESET', $2, $3, $4, $5) RETURNING id",
        [accountId, randomUUID(), expiresAt, usedAt, START],
      );
      return rows[0]?.id ?? "";
    }
    async function insertSession(accountId: string, expiresAt: Date, revokedAt: Date | null): Promise<string> {
      const { rows } = await h.pool.query<{ id: string }>(
        "INSERT INTO professional_sessions (account_id, refresh_token_hash, token_chain_id, expires_at, revoked_at, created_at, updated_at) VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $5) RETURNING id",
        [accountId, randomUUID(), expiresAt, revokedAt, START],
      );
      return rows[0]?.id ?? "";
    }
    const exists = async (table: "professional_auth_tokens" | "professional_sessions", id: string) => (await count(`SELECT count(*)::int AS n FROM ${table} WHERE id = $1`, [id])) === 1;

    it("apaga tokens e sessões expirados/usados há mais de 7 dias; mantém os recentes e as sessões revogadas ainda não expiradas", async () => {
      const { pro } = await newPro(cityTag("limpeza"));
      const tokenOldExpired = await insertToken(pro.accountId, DAY(-8), null);
      const tokenOldUsed = await insertToken(pro.accountId, DAY(1), DAY(-8));
      const tokenRecentExpired = await insertToken(pro.accountId, DAY(-1), null);
      const tokenRecentUsed = await insertToken(pro.accountId, DAY(1), DAY(-1));
      const tokenValid = await insertToken(pro.accountId, DAY(1), null);
      const sessOldExpired = await insertSession(pro.accountId, DAY(-8), null);
      const sessRecentExpired = await insertSession(pro.accountId, DAY(-6), null);
      const sessRevokedNotExpired = await insertSession(pro.accountId, DAY(30), DAY(-1));
      const tokensBefore = await count("SELECT count(*)::int AS n FROM professional_auth_tokens");
      const sessionsBefore = await count("SELECT count(*)::int AS n FROM professional_sessions");

      const res = await h.jobs.cleanup();
      expect(res.tokens).toBe(2);
      expect(res.sessions).toBe(1);
      expect(await count("SELECT count(*)::int AS n FROM professional_auth_tokens")).toBe(tokensBefore - res.tokens);
      expect(await count("SELECT count(*)::int AS n FROM professional_sessions")).toBe(sessionsBefore - res.sessions);

      expect(await exists("professional_auth_tokens", tokenOldExpired)).toBe(false);
      expect(await exists("professional_auth_tokens", tokenOldUsed)).toBe(false);
      expect(await exists("professional_auth_tokens", tokenRecentExpired)).toBe(true);
      expect(await exists("professional_auth_tokens", tokenRecentUsed)).toBe(true);
      expect(await exists("professional_auth_tokens", tokenValid)).toBe(true);
      expect(await exists("professional_sessions", sessOldExpired)).toBe(false);
      expect(await exists("professional_sessions", sessRecentExpired)).toBe(true);
      expect(await exists("professional_sessions", sessRevokedNotExpired)).toBe(true);
    });

    it("credencial PENDING criada há mais de 10 min é re-enfileirada (rescans > 0); a recente não; idempotente", async () => {
      const { pro } = await newPro(cityTag("antivirus"));
      const stale = await addCredential(pro.professionalId, "IDENTITY", { scan: "PENDING", createdAt: new Date(START.getTime() - 11 * 60_000) });
      const recent = await addCredential(pro.professionalId, "PROFESSIONAL_LICENSE", { scan: "PENDING", createdAt: new Date(START.getTime() - 2 * 60_000) });
      h.scanQueue.splice(0);

      const res = await h.jobs.cleanup();
      expect(res.rescans).toBeGreaterThan(0);
      expect(h.scanQueue).toContainEqual({ credentialId: stale });
      expect(h.scanQueue.map((j) => j.credentialId)).not.toContain(recent);
      // Não altera o estado da credencial: só volta a enfileirar.
      expect(await count("SELECT count(*)::int AS n FROM professional_credentials WHERE id = $1 AND scan_status = 'PENDING'", [stale])).toBe(1);

      h.scanQueue.splice(0);
      const again = await h.jobs.cleanup();
      expect(again.tokens).toBe(0);
      expect(again.sessions).toBe(0);
      expect(h.scanQueue).toContainEqual({ credentialId: stale });
    });
  });
});
