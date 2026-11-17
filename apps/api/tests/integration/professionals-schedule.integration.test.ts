/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Integração (PostgreSQL real + API real validada contra o openapi.yaml, pedidos E respostas) dos horários do profissional (MK1 S9):
// UC-MKT-09, BR-MKT-25/31, TC-MKT-25 (geração e idempotência), TC-MKT-26 (sobreposição, limite e rede da BD), TC-MKT-27 (bloqueios),
// TC-MKT-28 (regras fora de APPROVED e suspensão), TC-MKT-37 (locale Africa/Luanda). Os valores ESPERADOS são calculados aqui com
// aritmética simples de Date (Luanda = UTC+1 fixo), sem importar código de produção.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, PROFESSIONAL_API, START, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const SCHEDULE = `${PROFESSIONAL_API}/schedule-rules`;
const TIME_OFF = `${PROFESSIONAL_API}/time-off`;
const SLOTS = `${PROFESSIONAL_API}/slots`;
const OFFERS = `${PROFESSIONAL_API}/offers`;
const SUBMISSION = `${PROFESSIONAL_API}/submission`;
const ADMIN = `${API}/admin/professionals`;

const DAY_MS = 86_400_000;
/** Africa/Luanda é UTC+1 fixo (sem horário de verão): hora local = UTC + 1 h. */
const LUANDA_OFFSET_MS = 3_600_000;
const WEEK = [1, 2, 3, 4, 5];
const ZERO = { created: 0, unchanged: 0, removed: 0, skippedOverlap: 0, skippedTimeOff: 0 };
/** Janela de leitura cobre hoje (16/11) até hoje+56 (11/01) — 57 dias, ≤ 62. */
const FROM = "2026-11-16T00:00:00.000Z";
const TO = "2027-01-17T00:00:00.000Z";
/** Nº esperado para Seg–Sex 08:00–12:00 / 30 min com START = segunda 16/11 11:00 Luanda: 41 dias úteis na janela; hoje só 11:30 (1);
 * os outros 40 dias × 8 horários (08:00…11:30 locais) = 320; total 321. */
const EXPECTED_WEEK_COUNT = 321;

type Status = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";
type Category = "HEALTH" | "WELLNESS";
type CredentialKind = "IDENTITY" | "PROFESSIONAL_LICENSE";
interface Pro {
  email: string;
  accountId: string;
  professionalId: string;
  token: string;
}
interface Interval {
  start: Date;
  end: Date;
}
interface RuleSpec {
  weekdays: number[];
  startTime: string;
  endTime: string;
  durationMin: number;
  validFrom?: string | null;
  validUntil?: string | null;
}

// ---------------------------------------------------------------- cálculo independente dos valores esperados

/** Instante UTC de um dia civil de Luanda + `HH:mm` local (Luanda = UTC+1: subtrai-se 1 h; `00:00` cai no dia anterior às 23:00Z). */
function luandaInstant(day: string, hhmm: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d, hh - 1, mm));
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

/**
 * Inícios esperados (ISO, ordenados) de uma regra: dias civis de Luanda de hoje a hoje+56 (inclusive), nos dias da semana certos,
 * dentro da validade, horários consecutivos de `durationMin` que acabam até `endTime`, só os que começam depois de `now` e fora de `blocked`.
 */
function expectedStarts(rule: RuleSpec, now: Date, blocked: Interval[] = []): string[] {
  const out: string[] = [];
  const today = luandaDay(now);
  const durMs = rule.durationMin * 60_000;
  for (let i = 0; i <= 56; i++) {
    const day = addDay(today, i);
    if (!rule.weekdays.includes(weekdayOf(day))) continue;
    if (rule.validFrom && day < rule.validFrom) continue;
    if (rule.validUntil && day > rule.validUntil) continue;
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
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("integração: horários, bloqueios e GET /slots do profissional (MK1 S9)", () => {
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

  /** Liga ao profissional uma especialidade nova do catálogo; devolve o id. */
  async function linkSpecialty(professionalId: string, category: Category = "HEALTH"): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>("INSERT INTO specialties (name, category, active) VALUES ($1, $2, true) RETURNING id", [`Esp ${randomUUID()}`, category]);
    const id = rows[0]?.id ?? "";
    await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, id]);
    return id;
  }

  /** Credencial por SQL (estado de scan à escolha). */
  async function addCredential(professionalId: string, kind: CredentialKind, validUntil: string | null = null): Promise<void> {
    await h.pool.query(
      `INSERT INTO professional_credentials (professional_id, kind, valid_until, storage_key, content_type, size_bytes, scan_status)
       VALUES ($1, $2, $3, $4, 'application/pdf', 100, 'CLEAN')`,
      [professionalId, kind, validUntil, `prof-cred/${randomUUID()}`],
    );
  }

  /** Perfil completo para aprovar (nome, cidade, especialidade HEALTH, IDENTITY e PROFESSIONAL_LICENSE CLEAN); estado PENDING_REVIEW. */
  async function readyForReview(pro: Pro): Promise<void> {
    await h.pool.query("UPDATE professionals SET display_name = $2, city = 'Luanda' WHERE id = $1", [pro.professionalId, `Nome ${randomUUID()}`]);
    await linkSpecialty(pro.professionalId, "HEALTH");
    await addCredential(pro.professionalId, "IDENTITY");
    await addCredential(pro.professionalId, "PROFESSIONAL_LICENSE", "2027-12-31");
    await setState(pro.professionalId, "PENDING_REVIEW");
  }

  /** Decisão do admin (token de Platform Admin). */
  async function decide(professionalId: string, body: { decision: string; reason?: string }, expected = 200) {
    const res = await request(h.app).post(`${ADMIN}/${professionalId}/decisions`).set(auth(await h.adminToken())).send(body);
    expect(res.status).toBe(expected);
    return res;
  }

  /** Profissional registado e verificado (ainda DRAFT). */
  async function newPro(): Promise<Pro> {
    return h.newProfessional();
  }

  /** Profissional APPROVED por SQL (pré-condição): para testar regras/bloqueios sem passar pela aprovação. */
  async function newApproved(): Promise<Pro> {
    const pro = await newPro();
    await setState(pro.professionalId, "APPROVED");
    return pro;
  }

  /** Oferta de 30 min (ou a duração dada) com especialidade nova, ligada ao profissional; devolve o id. */
  async function makeOffer(pro: Pro, durationMinutes = 30, method = "IN_PERSON"): Promise<string> {
    const specialtyId = await linkSpecialty(pro.professionalId, "HEALTH");
    const res = await request(h.app).post(OFFERS).set(auth(pro.token)).send({ specialtyId, method, durationMinutes, priceKz: 5000, note: null }).expect(201);
    return res.body.id as string;
  }

  const ruleBody = (offerId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ offerId, weekdays: WEEK, startTime: "08:00", endTime: "12:00", ...extra });
  const createRule = (token: string, body: unknown) => request(h.app).post(SCHEDULE).set(auth(token)).send(body as object);
  const patchRule = (token: string, ruleId: string, body: unknown) => request(h.app).patch(`${SCHEDULE}/${ruleId}`).set(auth(token)).send(body as object);
  const listRules = (token: string, query = "") => request(h.app).get(`${SCHEDULE}${query}`).set(auth(token));
  const createTimeOff = (token: string, body: unknown) => request(h.app).post(TIME_OFF).set(auth(token)).send(body as object);
  const deleteTimeOff = (token: string, id: string) => request(h.app).delete(`${TIME_OFF}/${id}`).set(auth(token));
  const listTimeOff = (token: string, query: Record<string, string> = {}) => request(h.app).get(TIME_OFF).query(query).set(auth(token));
  const listSlots = (token: string, from: string, to: string) => request(h.app).get(SLOTS).query({ from, to }).set(auth(token));

  /** Horários via API (ordenados), na janela de leitura. */
  async function apiSlots(token: string, from = FROM, to = TO): Promise<{ id: string; offerId: string; startsAt: string; endsAt: string }[]> {
    const res = await listSlots(token, from, to).expect(200);
    return res.body as { id: string; offerId: string; startsAt: string; endsAt: string }[];
  }
  async function apiStarts(token: string, from = FROM, to = TO): Promise<string[]> {
    return (await apiSlots(token, from, to)).map((s) => s.startsAt);
  }

  async function count(sqlText: string, params: unknown[]): Promise<number> {
    const { rows } = await h.pool.query<{ n: number }>(sqlText, params);
    return rows[0]?.n ?? 0;
  }
  const slotRows = (professionalId: string) => count("SELECT count(*)::int AS n FROM professional_slots WHERE professional_id = $1", [professionalId]);
  const ruleRows = (professionalId: string) => count("SELECT count(*)::int AS n FROM professional_schedule_rules WHERE professional_id = $1", [professionalId]);
  const timeOffRows = (professionalId: string) => count("SELECT count(*)::int AS n FROM professional_time_off WHERE professional_id = $1", [professionalId]);

  /** Regra Seg–Sex 08:00–12:00 aprovada, com oferta de 30 min e a regra criada (321 horários). */
  async function approvedWithWeekRule(): Promise<{ pro: Pro; offerId: string; ruleId: string }> {
    const pro = await newApproved();
    const offerId = await makeOffer(pro);
    const res = await createRule(pro.token, ruleBody(offerId)).expect(201);
    return { pro, offerId, ruleId: res.body.rule.id as string };
  }

  /** Aprova via admin (PENDING_REVIEW → APPROVE), com perfil completo. */
  async function approveByAdmin(pro: Pro): Promise<void> {
    await readyForReview(pro);
    await decide(pro.professionalId, { decision: "APPROVE" });
  }

  /** Corpos inválidos de regra (422) com a descrição do caso. */
  const INVALID_RULE_BODIES: [string, Record<string, unknown>][] = [
    ["weekdays vazio", { weekdays: [] }],
    ["weekdays [0]", { weekdays: [0] }],
    ["weekdays [8]", { weekdays: [8] }],
    ["weekdays repetidos", { weekdays: [1, 1] }],
    ["8 elementos", { weekdays: [1, 2, 3, 4, 5, 6, 7, 1] }],
    ["startTime '8:00'", { startTime: "8:00" }],
    ["startTime '24:00'", { startTime: "24:00" }],
    ["endTime '12:60'", { endTime: "12:60" }],
    ["endTime '24:00'", { endTime: "24:00" }],
    ["endTime anterior a startTime", { startTime: "12:00", endTime: "08:00" }],
    ["endTime igual a startTime", { startTime: "08:00", endTime: "08:00" }],
    ["intervalo menor que a duração (20 min para oferta de 30)", { startTime: "08:00", endTime: "08:20" }],
    ["validFrom inexistente", { validFrom: "2026-02-31" }],
    ["validUntil inexistente", { validUntil: "2026-02-31" }],
    ["validUntil anterior a validFrom", { validFrom: "2026-12-10", validUntil: "2026-12-01" }],
    ["campo extra", { foo: 1 }],
    ["offerId ausente", { offerId: undefined }],
  ];

  // ---------------------------------------------------------------- (1) criação e geração

  describe("(1) criar regra e gerar horários (APPROVED)", () => {
    it("201 com {rule, generation}; gera os 321 horários esperados, nas horas certas em UTC, só nos dias certos, sem sobreposição", async () => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro);
      const expected = expectedStarts(BASE, START);
      expect(expected).toHaveLength(EXPECTED_WEEK_COUNT);

      const res = await createRule(pro.token, ruleBody(offerId)).expect(201);
      expect(res.body.rule).toMatchObject({ offerId, weekdays: WEEK, startTime: "08:00", endTime: "12:00", validFrom: null, validUntil: null, active: true });
      expect(res.body.generation).toEqual({ ...ZERO, created: EXPECTED_WEEK_COUNT });

      const slots = await apiSlots(pro.token);
      expect(slots.map((s) => s.startsAt)).toEqual(expected);
      expect(slots.every((s) => s.offerId === offerId)).toBe(true);
      // Primeiro horário: hoje só o das 11:30 locais (10:30Z), nunca no passado.
      expect(slots[0]?.startsAt).toBe("2026-11-16T10:30:00.000Z");
      expect(new Date(slots[0]?.startsAt ?? 0).getTime()).toBeGreaterThan(START.getTime());
      // Último horário da janela: segunda 11/01 às 11:30 locais.
      expect(slots.at(-1)?.startsAt).toBe("2027-01-11T10:30:00.000Z");
      // Horas locais 08:00..11:30 = 07:00Z..10:30Z; duração de 30 min; sem sobreposição.
      for (const s of slots) {
        const start = new Date(s.startsAt);
        expect(start.getUTCMinutes() % 30).toBe(0);
        expect(start.getUTCHours()).toBeGreaterThanOrEqual(7);
        expect(start.getUTCHours()).toBeLessThanOrEqual(10);
        expect(new Date(s.endsAt).getTime() - start.getTime()).toBe(30 * 60_000);
      }
      for (let i = 1; i < slots.length; i++) {
        expect(new Date(slots[i - 1]?.endsAt ?? 0).getTime()).toBeLessThanOrEqual(new Date(slots[i]?.startsAt ?? 0).getTime());
      }
      // Só dias úteis de Luanda: o dia civil de Luanda de cada horário é Seg–Sex.
      for (const s of slots) {
        expect(weekdayOf(luandaDay(new Date(s.startsAt)))).toBeLessThanOrEqual(5);
      }
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
    });

    it("virada de dia: regra 00:00–01:00 de terça gera 00:00 e 00:30 de Luanda = 23:00Z e 23:30Z da segunda", async () => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro);
      const rule: RuleSpec = { weekdays: [2], startTime: "00:00", endTime: "01:00", durationMin: 30 };
      const res = await createRule(pro.token, ruleBody(offerId, { weekdays: [2], startTime: "00:00", endTime: "01:00" })).expect(201);
      expect(res.body.generation.created).toBe(expectedStarts(rule, START).length);
      const starts = await apiStarts(pro.token);
      expect(starts).toEqual(expectedStarts(rule, START));
      expect(starts[0]).toBe("2026-11-16T23:00:00.000Z");
      expect(starts[1]).toBe("2026-11-16T23:30:00.000Z");
      // A segunda seguinte: 23/11 (dia civil de Luanda terça 24/11 às 00:00 = 23/11 23:00Z).
      expect(starts[2]).toBe("2026-11-23T23:00:00.000Z");
    });

    it("GET /slots: intervalo semiaberto [from, to) por starts_at", async () => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro);
      await createRule(pro.token, ruleBody(offerId)).expect(201);
      // 08:00 local = 07:00Z; 08:30 = 07:30Z: [07:00Z, 07:30Z) só tem o das 08:00.
      expect(await apiStarts(pro.token, "2026-11-17T07:00:00.000Z", "2026-11-17T07:30:00.000Z")).toEqual(["2026-11-17T07:00:00.000Z"]);
      // from = to ⇒ intervalo vazio ⇒ 422 (to tem de ser posterior a from).
      await listSlots(pro.token, "2026-11-17T07:00:00.000Z", "2026-11-17T07:00:00.000Z").expect(422);
    });
  });

  // ---------------------------------------------------------------- (2) estados antes de APPROVED, aprovação e LOCKED

  describe("(2) regras fora de APPROVED e estados bloqueados", () => {
    it.each(["DRAFT", "PENDING_REVIEW", "NEEDS_INFO"] as const)("%s: a regra é guardada, generation a zero e nenhum horário", async (status) => {
      const pro = await newPro();
      const offerId = await makeOffer(pro);
      await readyForReview(pro);
      await setState(pro.professionalId, status);
      const res = await createRule(pro.token, ruleBody(offerId)).expect(201);
      expect(res.body.generation).toEqual(ZERO);
      expect(await slotRows(pro.professionalId)).toBe(0);
      expect(await apiStarts(pro.token)).toEqual([]);
      const rules = await listRules(pro.token).expect(200);
      expect(rules.body).toHaveLength(1);
      expect(rules.body[0]).toMatchObject({ offerId, active: true });
    });

    it.each(["DRAFT", "PENDING_REVIEW", "NEEDS_INFO"] as const)("%s: ao ser APROVADO pelo admin nascem os 321 horários (mesma contagem)", async (status) => {
      const pro = await newPro();
      const offerId = await makeOffer(pro);
      await createRule(pro.token, ruleBody(offerId)).expect(201);
      await readyForReview(pro);
      if (status === "NEEDS_INFO") {
        await decide(pro.professionalId, { decision: "REQUEST_INFO", reason: "Falta uma foto legível." });
        await request(h.app).post(SUBMISSION).set(auth(pro.token)).expect(200);
      } else if (status === "DRAFT") {
        await setState(pro.professionalId, "DRAFT");
        await setState(pro.professionalId, "PENDING_REVIEW");
      }
      expect(await slotRows(pro.professionalId)).toBe(0);
      await decide(pro.professionalId, { decision: "APPROVE" });
      expect(await apiStarts(pro.token)).toEqual(expectedStarts(BASE, START));
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
    });

    it.each(["REJECTED", "SUSPENDED"] as const)("%s: criar/alterar regra e criar/apagar bloqueio ⇒ 409 PROFESSIONAL_LOCKED e nada muda; GET ⇒ 200", async (status) => {
      const { pro, offerId, ruleId } = await approvedWithWeekRule();
      const created = await createTimeOff(pro.token, { startsAt: "2026-11-25T00:00:00Z", endsAt: "2026-11-26T00:00:00Z" }).expect(201);
      await setState(pro.professionalId, status, "Motivo de teste.");
      const slotsBefore = await slotRows(pro.professionalId);
      const rulesBefore = await ruleRows(pro.professionalId);
      const timeOffBefore = await timeOffRows(pro.professionalId);

      const bodyOf = { startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-12-02T00:00:00Z" };
      const locked = await createRule(pro.token, ruleBody(offerId, { weekdays: [6] })).expect(409);
      expect(locked.body.code).toBe("PROFESSIONAL_LOCKED");
      expect((await patchRule(pro.token, ruleId, { endTime: "11:00" })).body.code).toBe("PROFESSIONAL_LOCKED");
      expect((await createTimeOff(pro.token, bodyOf)).body.code).toBe("PROFESSIONAL_LOCKED");
      expect((await deleteTimeOff(pro.token, created.body.id as string)).body.code).toBe("PROFESSIONAL_LOCKED");

      expect(await slotRows(pro.professionalId)).toBe(slotsBefore);
      expect(await ruleRows(pro.professionalId)).toBe(rulesBefore);
      expect(await timeOffRows(pro.professionalId)).toBe(timeOffBefore);
      await listRules(pro.token).expect(200);
      await listTimeOff(pro.token).expect(200);
      await listSlots(pro.token, FROM, TO).expect(200);
    });

    it("SUSPEND pelo admin não apaga os horários existentes; sem reativação nada se gera (nem após avançar 7 dias)", async () => {
      const pro = await newPro();
      await approveByAdmin(pro);
      const offerId = await makeOffer(pro);
      await createRule(pro.token, ruleBody(offerId)).expect(201);
      const before = await apiStarts(pro.token);
      expect(before).toHaveLength(EXPECTED_WEEK_COUNT);

      await decide(pro.professionalId, { decision: "SUSPEND", reason: "Suspensão de teste." });
      expect(await apiStarts(pro.token)).toEqual(before);

      h.clock.advance(7 * DAY_MS);
      const token = (await h.login(pro.email)).token;
      expect(await apiStarts(token, FROM, TO)).toEqual(before);
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
      // Alterar a regra é LOCKED: não há reconciliação que gere novos horários.
      const rule = (await listRules(token).expect(200)).body[0] as { id: string };
      expect((await patchRule(token, rule.id, { endTime: "13:00" })).body.code).toBe("PROFESSIONAL_LOCKED");
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
    });
  });

  // ---------------------------------------------------------------- (3) idempotência

  describe("(3) idempotência", () => {
    it("repetir a mesma regra ⇒ 409 CONFLICT e nada muda", async () => {
      const { pro, offerId } = await approvedWithWeekRule();
      const res = await createRule(pro.token, ruleBody(offerId)).expect(409);
      expect(res.body.code).toBe("CONFLICT");
      expect(await ruleRows(pro.professionalId)).toBe(1);
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
    });

    it("PATCH sem alterar valores (mesmos dias) ⇒ created 0 e unchanged = nº de horários", async () => {
      const { pro, ruleId } = await approvedWithWeekRule();
      const res = await patchRule(pro.token, ruleId, { weekdays: WEEK }).expect(200);
      expect(res.body.generation).toEqual({ ...ZERO, unchanged: EXPECTED_WEEK_COUNT });
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
    });

    it("reativar uma regra já ativa é no-op (created 0, unchanged = nº de horários)", async () => {
      const { pro, ruleId } = await approvedWithWeekRule();
      const res = await patchRule(pro.token, ruleId, { active: true }).expect(200);
      expect(res.body.generation).toEqual({ ...ZERO, unchanged: EXPECTED_WEEK_COUNT });
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
    });

    it("avançar 7 dias e PATCH no-op gera só os dias novos que entram na janela, sem duplicar", async () => {
      const { pro, ruleId } = await approvedWithWeekRule();
      const oldList = expectedStarts(BASE, START);
      h.clock.advance(7 * DAY_MS);
      const now2 = new Date(START.getTime() + 7 * DAY_MS);
      const newList = expectedStarts(BASE, now2);
      const created = newList.filter((s) => !oldList.includes(s)).length;
      const unchanged = newList.filter((s) => oldList.includes(s)).length;
      expect(created).toBe(40); // 12–15/01 (Ter–Sex) e 18/01 (Seg): 5 dias × 8 horários

      const token = (await h.login(pro.email)).token;
      const res = await patchRule(token, ruleId, { weekdays: WEEK }).expect(200);
      expect(res.body.generation).toEqual({ ...ZERO, created, unchanged });
      expect(await slotRows(pro.professionalId)).toBe(oldList.length + created);
      const dup = await count("SELECT (count(*) - count(DISTINCT (rule_id, starts_at)))::int AS n FROM professional_slots WHERE professional_id = $1", [pro.professionalId]);
      expect(dup).toBe(0);
    });

    // BR-MKT-25: o job diário `professionals.generate-slots` mantém a janela rolante de 8 semanas, mesmo sem escritas.
    // `to` = meia-noite de Luanda do dia hoje+57 (inclui o dia hoje+56 inteiro; o horário das 10:30Z de hoje+56 ficava fora com `+56 dias`).
    it("janela rolante: sem escritas, 30 dias depois o job gera horários até hoje+56 (inclusive)", async () => {
      const { pro } = await approvedWithWeekRule();
      h.clock.advance(30 * DAY_MS);
      const now2 = new Date(START.getTime() + 30 * DAY_MS);
      await h.jobs.generateSlots();
      const token = (await h.login(pro.email)).token;
      const lastDay = new Date(Date.parse(`${luandaDay(now2)}T00:00:00Z`) + 57 * DAY_MS - LUANDA_OFFSET_MS);
      // from exclusivo de `now` (um horário que começa exatamente agora está na BD e o GET inclui-o; ver relatório).
      const got = await apiStarts(token, new Date(now2.getTime() + 1).toISOString(), lastDay.toISOString());
      expect(got).toEqual(expectedStarts(BASE, now2));
    });

    it("suspender e reativar (aprovação de novo) não duplica os horários", async () => {
      const pro = await newPro();
      await approveByAdmin(pro);
      const offerId = await makeOffer(pro);
      await createRule(pro.token, ruleBody(offerId)).expect(201);
      await decide(pro.professionalId, { decision: "SUSPEND", reason: "Suspensão de teste." });
      await decide(pro.professionalId, { decision: "REACTIVATE" });
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
      expect(await apiStarts(pro.token)).toEqual(expectedStarts(BASE, START));
    });
  });

  // ---------------------------------------------------------------- (4) validações e 404

  describe("(4) validações (422) e ofertas alheias/inexistentes (404)", () => {
    it.each(INVALID_RULE_BODIES)("criar com %s ⇒ 422 e nada criado", async (_label, override) => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro);
      const body = { ...ruleBody(offerId), ...override };
      const res = await createRule(pro.token, body).expect(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(await ruleRows(pro.professionalId)).toBe(0);
      expect(await slotRows(pro.professionalId)).toBe(0);
    });

    it("duração de 60 min: 08:00–08:45 não cabe; 08:00–09:00 cabe (fronteira)", async () => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro, 60);
      await createRule(pro.token, ruleBody(offerId, { startTime: "08:00", endTime: "08:45" })).expect(422);
      await createRule(pro.token, ruleBody(offerId, { startTime: "08:00", endTime: "09:00", weekdays: [7] })).expect(201);
    });

    it("PATCH: offerId ⇒ 422; corpo vazio ⇒ 422; hora inválida ⇒ 422; a regra fica como estava", async () => {
      const { pro, offerId, ruleId } = await approvedWithWeekRule();
      expect((await patchRule(pro.token, ruleId, { offerId })).status).toBe(422);
      expect((await patchRule(pro.token, ruleId, {})).status).toBe(422);
      expect((await patchRule(pro.token, ruleId, { startTime: "24:00" })).status).toBe(422);
      expect((await patchRule(pro.token, ruleId, { endTime: "07:00" })).status).toBe(422);
      const rules = (await listRules(pro.token).expect(200)).body as { id: string; offerId: string; endTime: string }[];
      expect(rules).toEqual([expect.objectContaining({ id: ruleId, offerId, endTime: "12:00" })]);
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
    });

    it("oferta inexistente ⇒ 404 e nada criado", async () => {
      const pro = await newApproved();
      const res = await createRule(pro.token, ruleBody(randomUUID())).expect(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(await ruleRows(pro.professionalId)).toBe(0);
    });

    it("oferta de outro profissional ⇒ 404 e nada criado (também com o outro em REJECTED: 404 antes de LOCKED)", async () => {
      const owner = await newApproved();
      const foreignOffer = await makeOffer(owner);
      const intruder = await newApproved();
      await createRule(intruder.token, ruleBody(foreignOffer)).expect(404);
      expect(await ruleRows(intruder.professionalId)).toBe(0);
      await setState(intruder.professionalId, "REJECTED", "Teste.");
      const res = await createRule(intruder.token, ruleBody(foreignOffer)).expect(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(await ruleRows(intruder.professionalId)).toBe(0);
    });

    it("oferta inexistente em REJECTED ⇒ 404 (não 409)", async () => {
      const pro = await newApproved();
      await setState(pro.professionalId, "REJECTED", "Teste.");
      await createRule(pro.token, ruleBody(randomUUID())).expect(404);
    });

    it("validFrom/validUntil: só gera dentro da validade (dezembro de 2026)", async () => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro);
      const spec: RuleSpec = { ...BASE, validFrom: "2026-12-01", validUntil: "2026-12-31" };
      const res = await createRule(pro.token, ruleBody(offerId, { validFrom: "2026-12-01", validUntil: "2026-12-31" })).expect(201);
      expect(res.body.rule).toMatchObject({ validFrom: "2026-12-01", validUntil: "2026-12-31" });
      const starts = await apiStarts(pro.token);
      expect(starts).toEqual(expectedStarts(spec, START));
      expect(starts.length).toBeGreaterThan(0);
      expect(starts.every((s) => s >= "2026-11-30T23:00:00.000Z" && s < "2027-01-01T00:00:00.000Z")).toBe(true);
    });

    it("oferta INATIVA: criar regra é recusado (422; BR-MKT-25 «oferta ativa do profissional»)", async () => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro);
      await request(h.app).patch(`${OFFERS}/${offerId}`).set(auth(pro.token)).send({ active: false }).expect(200);
      const res = await createRule(pro.token, ruleBody(offerId));
      expect(res.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------- (5) sobreposição, validade e limite

  describe("(5) sobreposição, validade e limite de regras", () => {
    it("regra sobreposta (dia, horas e validade) de OUTRA oferta ⇒ 409 CONFLICT", async () => {
      const pro = await newApproved();
      const offerA = await makeOffer(pro, 30);
      const offerB = await makeOffer(pro, 30);
      await createRule(pro.token, ruleBody(offerA)).expect(201);
      const res = await createRule(pro.token, ruleBody(offerB, { weekdays: [3], startTime: "10:00", endTime: "11:00" })).expect(409);
      expect(res.body.code).toBe("CONFLICT");
      expect(await ruleRows(pro.professionalId)).toBe(1);
    });

    it("horas encostadas (12:00 fim e 12:00 início) são permitidas", async () => {
      const pro = await newApproved();
      const offerA = await makeOffer(pro, 30);
      const offerB = await makeOffer(pro, 30);
      await createRule(pro.token, ruleBody(offerA)).expect(201);
      await createRule(pro.token, ruleBody(offerB, { startTime: "12:00", endTime: "13:00" })).expect(201);
      expect(await ruleRows(pro.professionalId)).toBe(2);
    });

    it("validades disjuntas permitem; validade que toca o mesmo dia (30/11) ⇒ CONFLICT", async () => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro, 30);
      await createRule(pro.token, ruleBody(offerId, { validUntil: "2026-11-30" })).expect(201);
      await createRule(pro.token, ruleBody(offerId, { validFrom: "2026-12-01" })).expect(201);
      await createRule(pro.token, ruleBody(offerId, { validFrom: "2026-11-30" })).expect(409);
    });

    it("dias diferentes permitem a mesma hora", async () => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro, 30);
      await createRule(pro.token, ruleBody(offerId)).expect(201);
      await createRule(pro.token, ruleBody(offerId, { weekdays: [6, 7] })).expect(201);
      expect(await ruleRows(pro.professionalId)).toBe(2);
    });

    it("desativar a primeira permite a sobreposta; reativar a primeira com a sobreposta ativa ⇒ 409", async () => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro, 30);
      const first = await createRule(pro.token, ruleBody(offerId)).expect(201);
      const firstId = first.body.rule.id as string;
      await patchRule(pro.token, firstId, { active: false }).expect(200);
      const second = await createRule(pro.token, ruleBody(offerId, { startTime: "09:00", endTime: "10:00" })).expect(201);
      const reactivated = await patchRule(pro.token, firstId, { active: true }).expect(409);
      expect(reactivated.body.code).toBe("CONFLICT");
      expect(second.body.rule.active).toBe(true);
    });

    it("20 regras ativas sem sobreposição (7 dias × 3 faixas, 20 combinações) ok; a 21.ª ⇒ 409 LIMIT_EXCEEDED", async () => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro, 30);
      const bands: [string, string][] = [
        ["08:00", "09:00"],
        ["10:00", "11:00"],
        ["12:00", "13:00"],
      ];
      const combos: { weekdays: number[]; startTime: string; endTime: string }[] = [];
      for (let day = 1; day <= 7; day++) for (const [s, e] of bands) combos.push({ weekdays: [day], startTime: s, endTime: e });
      const ids: string[] = [];
      for (const combo of combos.slice(0, 20)) {
        const res = await createRule(pro.token, ruleBody(offerId, combo)).expect(201);
        ids.push(res.body.rule.id as string);
      }
      const over = await createRule(pro.token, ruleBody(offerId, combos[20])).expect(409);
      expect(over.body.code).toBe("LIMIT_EXCEEDED");
      expect(await ruleRows(pro.professionalId)).toBe(20);
      // Regra inativa não conta: desativa uma e a 21.ª entra.
      await patchRule(pro.token, ids[0] ?? "", { active: false }).expect(200);
      await createRule(pro.token, ruleBody(offerId, combos[20])).expect(201);
    });

    it("duas criações sobrepostas em paralelo ⇒ uma 201 e uma 409", async () => {
      const pro = await newApproved();
      const offerA = await makeOffer(pro, 30);
      const offerB = await makeOffer(pro, 60);
      const [a, b] = await Promise.all([
        createRule(pro.token, ruleBody(offerA, { weekdays: [1], startTime: "08:00", endTime: "10:00" })),
        createRule(pro.token, ruleBody(offerB, { weekdays: [1], startTime: "09:00", endTime: "10:00" })),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await ruleRows(pro.professionalId)).toBe(1);
    });
  });

  // ---------------------------------------------------------------- (6) desativar, alterar e oferta

  describe("(6) desativar/alterar regra e oferta reconciliam os horários", () => {
    it("desativar a regra remove os 321 horários futuros (removed = n); GET fica vazio; reativar repõe (created = n)", async () => {
      const { pro, ruleId } = await approvedWithWeekRule();
      const res = await patchRule(pro.token, ruleId, { active: false }).expect(200);
      expect(res.body.generation).toEqual({ ...ZERO, removed: EXPECTED_WEEK_COUNT });
      expect(await apiStarts(pro.token)).toEqual([]);
      expect(await slotRows(pro.professionalId)).toBe(0);

      const back = await patchRule(pro.token, ruleId, { active: true }).expect(200);
      expect(back.body.generation).toEqual({ ...ZERO, created: EXPECTED_WEEK_COUNT });
      expect(await apiStarts(pro.token)).toEqual(expectedStarts(BASE, START));
    });

    it("alterar a hora de fim (11:00) remove os que deixam de corresponder e mantém os restantes", async () => {
      const { pro, ruleId } = await approvedWithWeekRule();
      const before = expectedStarts(BASE, START);
      const after = expectedStarts({ ...BASE, endTime: "11:00" }, START);
      const res = await patchRule(pro.token, ruleId, { endTime: "11:00" }).expect(200);
      expect(res.body.generation).toEqual({ ...ZERO, removed: before.length - after.length, unchanged: after.length });
      expect(await apiStarts(pro.token)).toEqual(after);
    });

    it("alterar os dias (só Seg–Ter) remove os de Qua–Sex e não cria nada", async () => {
      const { pro, ruleId } = await approvedWithWeekRule();
      const before = expectedStarts(BASE, START);
      const after = expectedStarts({ ...BASE, weekdays: [1, 2] }, START);
      const res = await patchRule(pro.token, ruleId, { weekdays: [1, 2] }).expect(200);
      expect(res.body.generation).toEqual({ ...ZERO, removed: before.length - after.length, unchanged: after.length });
      expect(await apiStarts(pro.token)).toEqual(after);
    });

    it("desativar a OFERTA remove os horários futuros das suas regras; reativar repõe", async () => {
      const { pro, offerId } = await approvedWithWeekRule();
      await request(h.app).patch(`${OFFERS}/${offerId}`).set(auth(pro.token)).send({ active: false }).expect(200);
      expect(await apiStarts(pro.token)).toEqual([]);
      expect(await slotRows(pro.professionalId)).toBe(0);
      const rules = (await listRules(pro.token).expect(200)).body as { active: boolean }[];
      expect(rules[0]?.active).toBe(true);

      await request(h.app).patch(`${OFFERS}/${offerId}`).set(auth(pro.token)).send({ active: true }).expect(200);
      expect(await apiStarts(pro.token)).toEqual(expectedStarts(BASE, START));
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
    });
  });

  // ---------------------------------------------------------------- (7) bloqueios / férias

  describe("(7) bloqueios e férias (TC-MKT-27)", () => {
    // Quarta 18/11 00:00Z (01:00 local) até sexta 20/11 00:00Z: cobre Qua e Qui completos.
    const BLOCK: Interval = { start: new Date("2026-11-18T00:00:00Z"), end: new Date("2026-11-20T00:00:00Z") };
    const BLOCK_BODY = { startsAt: "2026-11-18T00:00:00Z", endsAt: "2026-11-20T00:00:00Z" };

    it("POST /time-off ⇒ 201; remove os horários do intervalo; a geração não os recria; reason null", async () => {
      const { pro, ruleId } = await approvedWithWeekRule();
      const before = expectedStarts(BASE, START);
      const after = expectedStarts(BASE, START, [BLOCK]);
      expect(before.length - after.length).toBe(16);

      const res = await createTimeOff(pro.token, BLOCK_BODY).expect(201);
      expect(res.body).toEqual({ id: expect.any(String), startsAt: "2026-11-18T00:00:00.000Z", endsAt: "2026-11-20T00:00:00.000Z", reason: null });
      expect(await apiStarts(pro.token)).toEqual(after);

      const patched = await patchRule(pro.token, ruleId, { weekdays: WEEK }).expect(200);
      expect(patched.body.generation).toEqual({ ...ZERO, unchanged: after.length, skippedTimeOff: before.length - after.length });
      expect(await apiStarts(pro.token)).toEqual(after);
    });

    it("GET /time-off por omissão só devolve os que terminam depois de agora; filtros from/to com fronteiras semiabertas", async () => {
      const pro = await newApproved();
      const created = await createTimeOff(pro.token, BLOCK_BODY).expect(201);
      const id = created.body.id as string;
      expect(((await listTimeOff(pro.token).expect(200)).body as { id: string }[]).map((t) => t.id)).toEqual([id]);
      // to = início do bloqueio: starts_at < to é falso ⇒ fora; to um segundo depois ⇒ dentro.
      expect(((await listTimeOff(pro.token, { to: "2026-11-18T00:00:00Z" }).expect(200)).body as unknown[]).length).toBe(0);
      expect(((await listTimeOff(pro.token, { to: "2026-11-18T00:00:01Z" }).expect(200)).body as unknown[]).length).toBe(1);
      // from = fim do bloqueio: ends_at > from é falso ⇒ fora.
      expect(((await listTimeOff(pro.token, { from: "2026-11-20T00:00:00Z" }).expect(200)).body as unknown[]).length).toBe(0);
      expect(((await listTimeOff(pro.token, { from: "2026-11-19T23:59:59Z" }).expect(200)).body as unknown[]).length).toBe(1);
    });

    it("GET /time-off por omissão esconde os que já terminaram (com o relógio avançado)", async () => {
      const pro = await newApproved();
      await createTimeOff(pro.token, { startsAt: "2026-11-17T00:00:00Z", endsAt: "2026-11-18T00:00:00Z" }).expect(201);
      h.clock.set(new Date("2026-11-19T10:00:00Z"));
      const token = (await h.login(pro.email)).token;
      expect(((await listTimeOff(token).expect(200)).body as unknown[]).length).toBe(0);
      expect(((await listTimeOff(token, { from: "2026-11-17T00:00:00Z" }).expect(200)).body as unknown[]).length).toBe(1);
    });

    it("DELETE ⇒ 204 e repõe os horários (removed = created); segunda reconciliação não duplica", async () => {
      const { pro, ruleId } = await approvedWithWeekRule();
      const created = await createTimeOff(pro.token, BLOCK_BODY).expect(201);
      await deleteTimeOff(pro.token, created.body.id as string).expect(204);
      expect(await apiStarts(pro.token)).toEqual(expectedStarts(BASE, START));
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
      const audit = await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PROFESSIONAL_TIME_OFF_DELETE' AND resource_id = $1 AND metadata->>'created' = '16'", [created.body.id]);
      expect(audit).toBe(1);

      const again = await patchRule(pro.token, ruleId, { weekdays: WEEK }).expect(200);
      expect(again.body.generation).toEqual({ ...ZERO, unchanged: EXPECTED_WEEK_COUNT });
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
    });

    it("DELETE de bloqueio alheio ou inexistente ⇒ 404 e nada muda", async () => {
      const owner = await newApproved();
      const created = await createTimeOff(owner.token, BLOCK_BODY).expect(201);
      const other = await newApproved();
      await deleteTimeOff(other.token, created.body.id as string).expect(404);
      await deleteTimeOff(owner.token, randomUUID()).expect(404);
      expect(await timeOffRows(owner.professionalId)).toBe(1);
    });

    it.each([
      ["fim igual ao início", { startsAt: "2026-11-20T00:00:00Z", endsAt: "2026-11-20T00:00:00Z" }],
      ["fim antes do início", { startsAt: "2026-11-21T00:00:00Z", endsAt: "2026-11-20T00:00:00Z" }],
      ["367 dias", { startsAt: "2026-11-20T00:00:00Z", endsAt: "2027-11-22T00:00:00Z" }],
      ["fim no passado (igual a agora)", { startsAt: "2026-11-15T00:00:00Z", endsAt: START.toISOString() }],
      ["data inexistente", { startsAt: "2026-02-31T00:00:00Z", endsAt: "2026-03-02T00:00:00Z" }],
      ["reason com 201 caracteres", { ...BLOCK_BODY, reason: "a".repeat(201) }],
    ])("validação 422: %s", async (_label, body) => {
      const pro = await newApproved();
      const res = await createTimeOff(pro.token, body).expect(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(await timeOffRows(pro.professionalId)).toBe(0);
    });

    it("limites aceites: 366 dias exatos e reason com 200 caracteres", async () => {
      const pro = await newApproved();
      const end = new Date(Date.parse("2026-11-20T00:00:00Z") + 366 * DAY_MS).toISOString();
      await createTimeOff(pro.token, { startsAt: "2026-11-20T00:00:00Z", endsAt: end, reason: "b".repeat(200) }).expect(201);
    });

    it("reason é aparada; '' e só espaços ⇒ null", async () => {
      const pro = await newApproved();
      const a = await createTimeOff(pro.token, { ...BLOCK_BODY, reason: "  Férias  " }).expect(201);
      const b = await createTimeOff(pro.token, { startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-12-02T00:00:00Z", reason: "" }).expect(201);
      const c = await createTimeOff(pro.token, { startsAt: "2026-12-03T00:00:00Z", endsAt: "2026-12-04T00:00:00Z", reason: "   " }).expect(201);
      expect(a.body.reason).toBe("Férias");
      expect(b.body.reason).toBeNull();
      expect(c.body.reason).toBeNull();
    });

    it("nota com canário: fora de audit_logs e das respostas de outros recursos; metadata só com contagens", async () => {
      const { pro } = await approvedWithWeekRule();
      const canary = "nota-canario-ferias-xyz";
      const created = await createTimeOff(pro.token, { ...BLOCK_BODY, reason: canary }).expect(201);
      expect(created.body.reason).toBe(canary); // o próprio recurso devolve a nota
      const rules = await listRules(pro.token).expect(200);
      const slots = await apiSlots(pro.token);
      const offers = await request(h.app).get(OFFERS).set(auth(pro.token)).expect(200);
      expect(JSON.stringify(rules.body)).not.toContain(canary);
      expect(JSON.stringify(slots)).not.toContain(canary);
      expect(JSON.stringify(offers.body)).not.toContain(canary);
      expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE metadata::text LIKE '%nota-canario%' OR resource_id::text LIKE '%nota-canario%'", [])).toBe(0);

      const rows = await h.pool.query<{ action: string; metadata: Record<string, unknown> }>(
        "SELECT action, metadata FROM audit_logs WHERE action IN ('PROFESSIONAL_TIME_OFF_CREATE','PROFESSIONAL_SCHEDULE_RULE_CREATE') AND actor_professional_account_id = $1",
        [pro.accountId],
      );
      expect(rows.rows.map((r) => r.action).sort()).toEqual(["PROFESSIONAL_SCHEDULE_RULE_CREATE", "PROFESSIONAL_TIME_OFF_CREATE"]);
      const timeOffMeta = rows.rows.find((r) => r.action === "PROFESSIONAL_TIME_OFF_CREATE")?.metadata ?? {};
      expect(Object.keys(timeOffMeta)).toEqual(["removed"]);
      expect(typeof timeOffMeta.removed).toBe("number");
      const ruleMeta = rows.rows.find((r) => r.action === "PROFESSIONAL_SCHEDULE_RULE_CREATE")?.metadata ?? {};
      expect(Object.keys(ruleMeta).sort()).toEqual(["created", "removed", "skippedOverlap", "skippedTimeOff"]);
      for (const value of Object.values(ruleMeta)) expect(typeof value).toBe("number");
    });

    it("auditoria PROFESSIONAL_SCHEDULE_RULE_UPDATE e TIME_OFF_DELETE existem com metadata só de flags/contagens", async () => {
      const { pro, ruleId } = await approvedWithWeekRule();
      const t = await createTimeOff(pro.token, { ...BLOCK_BODY, reason: "nota-secreta-2" }).expect(201);
      await deleteTimeOff(pro.token, t.body.id as string).expect(204);
      await patchRule(pro.token, ruleId, { active: false }).expect(200);
      const rows = await h.pool.query<{ action: string; metadata: Record<string, unknown> }>(
        "SELECT action, metadata FROM audit_logs WHERE actor_professional_account_id = $1 AND action IN ('PROFESSIONAL_TIME_OFF_DELETE','PROFESSIONAL_SCHEDULE_RULE_UPDATE')",
        [pro.accountId],
      );
      expect(rows.rows.map((r) => r.action).sort()).toEqual(["PROFESSIONAL_SCHEDULE_RULE_UPDATE", "PROFESSIONAL_TIME_OFF_DELETE"]);
      const update = rows.rows.find((r) => r.action === "PROFESSIONAL_SCHEDULE_RULE_UPDATE")?.metadata ?? {};
      expect(update.active).toBe(false);
      expect(update.removed).toBe(EXPECTED_WEEK_COUNT);
      expect(JSON.stringify(rows.rows)).not.toContain("nota-secreta-2");
    });
  });

  // ---------------------------------------------------------------- (8) GET /slots, isolamento e autenticação

  describe("(8) GET /slots: intervalo, isolamento e autenticação", () => {
    // Intervalos inválidos (to ≤ from, > 62 dias): 422 do caso de uso (o pedido chega à rota com formato correto).
    it.each([
      ["to igual a from", { from: "2026-11-16T00:00:00Z", to: "2026-11-16T00:00:00Z" }],
      ["to anterior a from", { from: "2026-11-17T00:00:00Z", to: "2026-11-16T00:00:00Z" }],
      ["63 dias", { from: "2026-11-16T00:00:00Z", to: "2027-01-18T00:00:00Z" }],
    ])("%s ⇒ 422", async (_label, query) => {
      const pro = await newApproved();
      const res = await listSlots(pro.token, query.from, query.to).expect(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    // Contradiz o openapi (/professional-portal/slots lista só 401 e 422 para from/to em falta ou inválidos): o validador de
    // parâmetros responde 400 MALFORMED_REQUEST (convenção de errors.md). Fica como it.fails até o dono decidir.
    it("from em falta ⇒ 400 MALFORMED_REQUEST (errors.md; declarado no contrato)", async () => {
      const pro = await newApproved();
      await request(h.app).get(SLOTS).query({ to: TO }).set(auth(pro.token)).expect(400);
    });
    it("data inválida (2026-13-01) ⇒ 422", async () => {
      const pro = await newApproved();
      await request(h.app).get(SLOTS).query({ from: "2026-13-01T00:00:00Z", to: TO }).set(auth(pro.token)).expect(422);
    });

    // Contradiz RFC 3986 (':' é válido na query) e o uso típico de clientes: pedido com ':' por codificar devolve 400.
    it("':' por codificar na query de um intervalo válido é aceite (200)", async () => {
      const pro = await newApproved();
      await request(h.app).get(`${SLOTS}?from=2026-11-16T07:00:00Z&to=2026-11-17T00:00:00Z`).set(auth(pro.token)).expect(200);
    });

    it("62 dias exatos ⇒ 200", async () => {
      const pro = await newApproved();
      await listSlots(pro.token, "2026-11-16T00:00:00Z", "2027-01-17T00:00:00Z").expect(200);
    });

    it("cada profissional só vê os seus horários (isolamento A/B) e não altera os do outro", async () => {
      const a = await approvedWithWeekRule();
      const b = await approvedWithWeekRule();
      const aSlots = await apiSlots(a.pro.token);
      const bSlots = await apiSlots(b.pro.token);
      expect(aSlots.every((s) => s.offerId === a.offerId)).toBe(true);
      expect(bSlots.every((s) => s.offerId === b.offerId)).toBe(true);
      expect(aSlots).toHaveLength(EXPECTED_WEEK_COUNT);
      await patchRule(b.pro.token, a.ruleId, { active: false }).expect(404);
      expect(await apiStarts(a.pro.token)).toHaveLength(EXPECTED_WEEK_COUNT);
    });

    it.each(["user", "clinic", "none"] as const)("token %s em todas as rotas novas ⇒ 401", async (kind) => {
      const { pro, ruleId } = await approvedWithWeekRule();
      const token = kind === "user" ? await h.userToken() : kind === "clinic" ? await h.clinicToken() : "";
      const headers = token ? auth(token) : {};
      await request(h.app).get(SCHEDULE).set(headers).expect(401);
      await request(h.app).post(SCHEDULE).set(headers).send(ruleBody(randomUUID())).expect(401);
      await request(h.app).patch(`${SCHEDULE}/${ruleId}`).set(headers).send({ active: false }).expect(401);
      await request(h.app).get(TIME_OFF).set(headers).expect(401);
      await request(h.app).post(TIME_OFF).set(headers).send({ startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-12-02T00:00:00Z" }).expect(401);
      await request(h.app).delete(`${TIME_OFF}/${randomUUID()}`).set(headers).expect(401);
      await request(h.app).get(SLOTS).set(headers).query({ from: FROM, to: TO }).expect(401);
      expect(await slotRows(pro.professionalId)).toBe(EXPECTED_WEEK_COUNT);
    });
  });

  // ---------------------------------------------------------------- (9) rede da BD (TC-MKT-26/28)

  describe("(9) rede da base de dados e geração com horários existentes", () => {
    it("slot manual que sobrepõe outro do mesmo profissional ⇒ exclusion violation 23P01; adjacente aceite", async () => {
      const { pro, offerId, ruleId } = await approvedWithWeekRule();
      const { rows } = await h.pool.query<{ starts_at: Date; ends_at: Date }>("SELECT starts_at, ends_at FROM professional_slots WHERE professional_id = $1 ORDER BY starts_at LIMIT 1", [pro.professionalId]);
      const first = rows[0];
      if (!first) throw new Error("sem horários");
      const insert = (start: string, end: string) =>
        h.pool.query("INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)", [pro.professionalId, offerId, ruleId, start, end]);
      // Começa 10 min depois do primeiro horário (08:00 locais): sobrepõe-no ⇒ 23P01.
      const inside = new Date(first.starts_at.getTime() + 10 * 60_000);
      await expect(insert(inside.toISOString(), new Date(inside.getTime() + 30 * 60_000).toISOString())).rejects.toMatchObject({ code: "23P01" });
      // Consecutivo e sem horário ao lado (25/11 12:00–12:30 locais, fora da regra): aceite.
      await insert("2026-11-25T11:00:00Z", "2026-11-25T11:30:00Z");
    });

    it("geração com um horário manual a meio de um intervalo: skippedOverlap > 0, sem erro 500, cria os restantes", async () => {
      const pro = await newApproved();
      const offerZero = await makeOffer(pro, 30);
      // Regra de domingo (dia diferente, sem sobreposição de regras) só para ter um rule_id válido para o horário manual.
      const r0 = await createRule(pro.token, ruleBody(offerZero, { weekdays: [7], startTime: "09:00", endTime: "10:00" })).expect(201);
      // Horário manual de segunda 23/11 08:15 locais (07:15Z) – 08:45 locais, a meio de 08:00–08:30 e 08:30–09:00 locais.
      await h.pool.query("INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)", [
        pro.professionalId,
        offerZero,
        r0.body.rule.id,
        "2026-11-23T07:15:00Z",
        "2026-11-23T07:45:00Z",
      ]);
      const offerWeek = await makeOffer(pro, 30);
      const res = await createRule(pro.token, ruleBody(offerWeek)).expect(201);
      expect(res.body.generation.skippedOverlap).toBe(2);
      expect(res.body.generation.created).toBe(EXPECTED_WEEK_COUNT - 2);
      const starts = await apiStarts(pro.token);
      expect(starts).not.toContain("2026-11-23T07:00:00.000Z");
      expect(starts).not.toContain("2026-11-23T07:30:00.000Z");
    });
  });

  // ---------------------------------------------------------------- (10) locale Africa/Luanda

  describe("(10) locale: horas de Luanda, instantes em UTC e dia da semana civil de Luanda", () => {
    it("08:00 de Luanda é 07:00Z (não 08:00Z de Lisboa nem 08:00Z de UTC) e os instantes vêm com Z", async () => {
      const pro = await newApproved();
      const offerId = await makeOffer(pro);
      await createRule(pro.token, ruleBody(offerId)).expect(201);
      const starts = await apiStarts(pro.token);
      expect(starts[1]).toBe("2026-11-17T07:00:00.000Z");
      expect(starts.every((s) => s.endsWith("Z"))).toBe(true);
    });

    it("com 23:30Z de segunda (= terça 00:30 em Luanda) a janela começa na terça: regra de terça 08–09 ⇒ 17/11 07:00Z", async () => {
      h.clock.set(new Date("2026-11-16T23:30:00Z"));
      const pro = await newApproved();
      const offerId = await makeOffer(pro);
      const rule: RuleSpec = { weekdays: [2], startTime: "08:00", endTime: "09:00", durationMin: 30 };
      await createRule(pro.token, ruleBody(offerId, { weekdays: [2], startTime: "08:00", endTime: "09:00" })).expect(201);
      const starts = await apiStarts(pro.token, "2026-11-16T00:00:00Z", "2027-01-17T00:00:00Z");
      expect(starts).toEqual(expectedStarts(rule, new Date("2026-11-16T23:30:00Z")));
      expect(starts[0]).toBe("2026-11-17T07:00:00.000Z");
    });

    it("regra de segunda 00:00–01:00 com relógio em 23:30Z de domingo: o domingo civil de Luanda já é segunda (sem horário no dia 15)", async () => {
      h.clock.set(new Date("2026-11-15T23:30:00Z")); // domingo 23:30Z = segunda 00:30 em Luanda
      const pro = await newApproved();
      const offerId = await makeOffer(pro);
      await createRule(pro.token, ruleBody(offerId, { weekdays: [1], startTime: "00:00", endTime: "01:00" })).expect(201);
      const starts = await apiStarts(pro.token, "2026-11-16T00:00:00Z", "2027-01-17T00:00:00Z");
      expect(starts).not.toContain("2026-11-15T23:00:00.000Z");
      expect(starts[0]).toBe("2026-11-22T23:00:00.000Z");
    });
  });
});
