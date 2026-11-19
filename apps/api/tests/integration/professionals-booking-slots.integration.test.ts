// Integração (PostgreSQL real) das reservas de horários do MK3 (BR-MKT-53, UC-MKT-27, TC-MKT-109/114): factos para marcar
// (`getBookingFacts`), reserva atómica (`reserveSlot`, incluindo 10 reservas concorrentes), libertação (`releaseSlot`), horários
// ocupados fora de `listBookableSlots` e de `slotStats`, única via de `paymentInstructions` (`readPaymentInstructions`) e veto de
// bloqueios sobre horários ocupados no portal (409 com contagem, sem ids, nada gravado; desativações mantêm o ocupado).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "../../src/platform/db/index.js";
import { PROFESSIONAL_API, START, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const DAY = 86_400_000;
const MEIA_HORA = 30 * 60_000;
const CANARY = "iban-canario-mk3-reservas";
const FORBIDDEN_KEYS = ["paymentInstructions", "payment_instructions", "email", "passwordHash", "validationStatus", "accountId"];
const WEEK = [1, 2, 3, 4, 5];
const SCHEDULE = `${PROFESSIONAL_API}/schedule-rules`;
const TIME_OFF = `${PROFESSIONAL_API}/time-off`;
const SLOTS = `${PROFESSIONAL_API}/slots`;
const OFFERS = `${PROFESSIONAL_API}/offers`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

type Status = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";
interface Prof {
  professionalId: string;
  email: string;
}
interface Oferta {
  id: string;
  specialtyId: string;
}
interface Membro {
  userId: string;
  familyId: string;
  memberId: string;
}
interface Reserva extends Membro {
  bookingId: string;
}
interface SlotApi {
  id: string;
  offerId: string;
  startsAt: string;
  endsAt: string;
  booked: boolean;
  bookingId: string | null;
}
interface Portal {
  professionalId: string;
  token: string;
  offerId: string;
  ruleId: string;
  slots: SlotApi[];
}

/** Elemento numa posição (erro explícito se faltar, para não ter `undefined` nos testes). */
function emPosicao<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`posição ${String(i)} em falta`);
  return x;
}

describe("integração: reservas de horários, veto de bloqueios e única via de paymentInstructions (MK3, BR-MKT-53, TC-MKT-109/114)", () => {
  let h: ProfessionalsHarness;

  beforeAll(async () => {
    h = await startProfessionalsHarness();
  }, 180_000);
  beforeEach(() => {
    h.clock.set(START);
  });
  afterAll(async () => {
    await h.stop();
  });

  // ---------------------------------------------------------------- helpers

  async function count(sqlText: string, params: unknown[]): Promise<number> {
    const { rows } = await h.pool.query<{ n: number }>(sqlText, params);
    return rows[0]?.n ?? 0;
  }
  const totalSlots = (professionalId: string) => count("SELECT count(*)::int AS n FROM professional_slots WHERE professional_id = $1", [professionalId]);
  const livresDb = (professionalId: string) => count("SELECT count(*)::int AS n FROM professional_slots WHERE professional_id = $1 AND booking_id IS NULL", [professionalId]);
  const timeOffRows = (professionalId: string) => count("SELECT count(*)::int AS n FROM professional_time_off WHERE professional_id = $1", [professionalId]);

  /** Utilizador, família e membro (FAMILY_ADMIN) por SQL: dono das marcações de teste. */
  async function membro(): Promise<Membro> {
    const userId = randomUUID();
    await h.pool.query(
      "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1, $2, 'x', 'U', '1980-01-01', 'Europe/Lisbon', 'v1', now())",
      [userId, `u-${userId}@teste.pt`],
    );
    const familyId = randomUUID();
    const memberId = randomUUID();
    await h.pool.query("INSERT INTO families (id, name) VALUES ($1, 'F')", [familyId]);
    await h.pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1, $2, $3, 'M', '1990-01-01', 'FAMILY_ADMIN')", [
      memberId,
      familyId,
      userId,
    ]);
    return { userId, familyId, memberId };
  }

  async function especialidade(category: "HEALTH" | "WELLNESS" = "HEALTH"): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>("INSERT INTO specialties (name, category, active) VALUES ($1, $2, true) RETURNING id", [
      `Esp ${randomUUID()}`,
      category,
    ]);
    return rows[0]?.id ?? "";
  }

  /** Profissional registado e verificado, com o estado dado (por SQL, pré-condição) e o texto de pagamento indicado. */
  async function profissional(status: Status, pagamento: string | null = null): Promise<Prof> {
    const { email, professionalId } = await h.registerVerified();
    await h.pool.query(
      `UPDATE professionals SET validation_status = $2::professional_validation_status, display_name = $3, city = 'Luanda', payment_instructions = $4,
         submitted_at = CASE WHEN $2 = 'DRAFT' THEN NULL ELSE now() END, approved_at = CASE WHEN $2 IN ('APPROVED', 'SUSPENDED') THEN now() ELSE NULL END
       WHERE id = $1`,
      [professionalId, status, `Nome ${status} ${professionalId.slice(0, 8)}`, pagamento],
    );
    return { professionalId, email };
  }

  /** Oferta ativa de 30 min, IN_PERSON, 5000 Kz, com especialidade nova (ligada ao profissional). */
  async function oferta(professionalId: string, o: { active?: boolean } = {}): Promise<Oferta> {
    const specialtyId = await especialidade();
    await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, specialtyId]);
    const { rows } = await h.pool.query<{ id: string }>(
      "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz, active) VALUES ($1, $2, 'IN_PERSON', 30, 5000, $3) RETURNING id",
      [professionalId, specialtyId, o.active ?? true],
    );
    return { id: rows[0]?.id ?? "", specialtyId };
  }

  /** Horários de 30 min a partir de `offsetMs` relativo a START, numa regra própria da oferta; devolve os ids por ordem. */
  async function horarios(professionalId: string, offerId: string, offsetsMs: number[]): Promise<string[]> {
    const { rows } = await h.pool.query<{ id: string }>(
      "INSERT INTO professional_schedule_rules (professional_id, offer_id, weekdays, start_time, end_time) VALUES ($1, $2, ARRAY[1,2,3,4,5]::smallint[], '09:00', '12:00') RETURNING id",
      [professionalId, offerId],
    );
    const ruleId = rows[0]?.id ?? "";
    const ids: string[] = [];
    for (const offset of offsetsMs) {
      const start = new Date(START.getTime() + offset);
      const r = await h.pool.query<{ id: string }>(
        "INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [professionalId, offerId, ruleId, start, new Date(start.getTime() + MEIA_HORA)],
      );
      ids.push(r.rows[0]?.id ?? "");
    }
    return ids;
  }

  /**
   * Marcação por SQL (sem a app), com os campos copiados da oferta e do horário. `REQUESTED` com `slotId` ocupa o horário:
   * primeiro a marcação (com `slot_id`), depois o `booking_id` do horário (FK diferida). `CANCELLED` sem `slotId` serve de alvo
   * de reserva (satisfaz os CHECKs de estado/horário). Cada marcação tem membro próprio (evita a exclusão de sobreposição).
   */
  async function marcar(offerId: string, slotId: string | null, status: "REQUESTED" | "CANCELLED" = "REQUESTED"): Promise<Reserva> {
    const m = await membro();
    const { rows: ofertaRows } = await h.pool.query<{ professional_id: string; specialty_id: string; method: string; duration_minutes: number; price_kz: number }>(
      "SELECT professional_id, specialty_id, method, duration_minutes, price_kz FROM professional_offers WHERE id = $1",
      [offerId],
    );
    const o = ofertaRows[0];
    if (!o) throw new Error("oferta inexistente");
    const { rows: horaRows } = slotId
      ? await h.pool.query<{ starts_at: Date; ends_at: Date }>("SELECT starts_at, ends_at FROM professional_slots WHERE id = $1", [slotId])
      : { rows: [] };
    const inicio = horaRows[0]?.starts_at ?? START;
    const fim = horaRows[0]?.ends_at ?? new Date(START.getTime() + MEIA_HORA);
    const bookingId = randomUUID();
    const cancelada = status === "CANCELLED";
    await h.pool.query(
      `INSERT INTO bookings (id, family_id, member_id, professional_id, offer_id, specialty_id, method, duration_minutes, price_kz,
         starts_at, ends_at, slot_id, status, payment_status, participant_label, cancelled_by, cancelled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'AWAITING_PROOF', 'Ana', $14, $15)`,
      [
        bookingId,
        m.familyId,
        m.memberId,
        o.professional_id,
        offerId,
        o.specialty_id,
        o.method,
        o.duration_minutes,
        o.price_kz,
        inicio,
        fim,
        cancelada ? null : slotId,
        status,
        cancelada ? "FAMILY" : null,
        cancelada ? new Date() : null,
      ],
    );
    if (slotId && !cancelada) await h.pool.query("UPDATE professional_slots SET booking_id = $1 WHERE id = $2", [bookingId, slotId]);
    return { ...m, bookingId };
  }

  /** Reserva atómica na sua própria transação (como o caso de uso de marcação). */
  const reservar = (bookingId: string, slotId: string, offerId: string, minStart: Date = START) =>
    withTransaction(h.db, (trx) => h.module.directory.reserveSlot(trx, { bookingId, slotId, offerId, minStart }));
  const libertar = (bookingId: string) => withTransaction(h.db, (trx) => h.module.directory.releaseSlot(trx, bookingId));
  const bookingDoSlot = async (slotId: string): Promise<string | null> =>
    (await h.pool.query<{ booking_id: string | null }>("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]?.booking_id ?? null;

  /** Profissional APPROVED com oferta de 30 min e regra Seg–Sex 08:00–12:00 criada pela API (horários gerados), pelo portal. */
  async function portalComRegra(): Promise<Portal> {
    const { professionalId, token } = await h.newProfessional();
    await h.pool.query(
      "UPDATE professionals SET validation_status = 'APPROVED', display_name = 'Nome Portal', city = 'Luanda', submitted_at = COALESCE(submitted_at, now()), approved_at = now() WHERE id = $1",
      [professionalId],
    );
    const specialtyId = await especialidade();
    await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, specialtyId]);
    const offer = await request(h.app).post(OFFERS).set(auth(token)).send({ specialtyId, method: "IN_PERSON", durationMinutes: 30, priceKz: 5000, note: null }).expect(201);
    const offerId = (offer.body as { id: string }).id;
    const rule = await request(h.app).post(SCHEDULE).set(auth(token)).send({ offerId, weekdays: WEEK, startTime: "08:00", endTime: "12:00" }).expect(201);
    const ruleId = (rule.body as { rule: { id: string } }).rule.id;
    return { professionalId, token, offerId, ruleId, slots: await apiSlots(token) };
  }

  async function apiSlots(token: string): Promise<SlotApi[]> {
    const res = await request(h.app)
      .get(SLOTS)
      .query({ from: START.toISOString(), to: new Date(START.getTime() + 7 * DAY).toISOString() })
      .set(auth(token))
      .expect(200);
    return res.body as SlotApi[];
  }

  // ---------------------------------------------------------------- (1) getBookingFacts (UC-MKT-27, TC-MKT-109)

  describe("(1) getBookingFacts: factos de oferta e horário para marcar", () => {
    it("oferta ativa, profissional APPROVED e horário livre: factos corretos e booked=false", async () => {
      const pro = await profissional("APPROVED", CANARY);
      const o = await oferta(pro.professionalId);
      const [s0 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY]);
      const facts = await h.module.directory.getBookingFacts(o.id, s0);
      expect(facts).toMatchObject({
        professionalId: pro.professionalId,
        city: "Luanda",
        offer: { id: o.id, specialtyId: o.specialtyId, method: "IN_PERSON", durationMinutes: 30, priceKz: 5000 },
        slot: { id: s0, offerId: o.id, startsAt: new Date(START.getTime() + 2 * DAY), endsAt: new Date(START.getTime() + 2 * DAY + MEIA_HORA), booked: false },
      });
      expect(facts?.displayName).toMatch(/^Nome APPROVED /);
    });

    it("slot de outra oferta do mesmo profissional: slot.offerId é a outra oferta (o chamador recusa com 422)", async () => {
      const pro = await profissional("APPROVED");
      const a = await oferta(pro.professionalId);
      const b = await oferta(pro.professionalId);
      const [sb = ""] = await horarios(pro.professionalId, b.id, [2 * DAY]);
      const facts = await h.module.directory.getBookingFacts(a.id, sb);
      expect(facts?.slot).not.toBeNull();
      expect(facts?.slot?.id).toBe(sb);
      expect(facts?.slot?.offerId).toBe(b.id);
      expect(facts?.slot?.offerId).not.toBe(a.id);
    });

    it("horário inexistente: slot null (oferta continua devolvida)", async () => {
      const pro = await profissional("APPROVED");
      const o = await oferta(pro.professionalId);
      const facts = await h.module.directory.getBookingFacts(o.id, randomUUID());
      expect(facts).not.toBeNull();
      expect(facts?.slot).toBeNull();
    });

    it("horário de OUTRO profissional: slot null", async () => {
      const pro = await profissional("APPROVED");
      const outro = await profissional("APPROVED");
      const o = await oferta(pro.professionalId);
      const oOutro = await oferta(outro.professionalId);
      const [sOutro = ""] = await horarios(outro.professionalId, oOutro.id, [2 * DAY]);
      const facts = await h.module.directory.getBookingFacts(o.id, sOutro);
      expect(facts).not.toBeNull();
      expect(facts?.slot).toBeNull();
    });

    it("oferta inativa: null (mesmo com horário livre)", async () => {
      const pro = await profissional("APPROVED");
      const inativa = await oferta(pro.professionalId, { active: false });
      const [s0 = ""] = await horarios(pro.professionalId, inativa.id, [2 * DAY]);
      expect(await h.module.directory.getBookingFacts(inativa.id, s0)).toBeNull();
    });

    it.each(["SUSPENDED", "DRAFT"] as const)("profissional %s: null (oferta e horário existem)", async (status) => {
      const pro = await profissional(status);
      const o = await oferta(pro.professionalId);
      const [s0 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY]);
      expect(await h.module.directory.getBookingFacts(o.id, s0)).toBeNull();
    });

    it("horário ocupado: booked=true; o vizinho livre continua booked=false", async () => {
      const pro = await profissional("APPROVED");
      const o = await oferta(pro.professionalId);
      const [s0 = "", s1 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY, 3 * DAY]);
      await marcar(o.id, s1);
      expect((await h.module.directory.getBookingFacts(o.id, s1))?.slot?.booked).toBe(true);
      expect((await h.module.directory.getBookingFacts(o.id, s0))?.slot?.booked).toBe(false);
    });

    it("sem chaves proibidas nem valores canário (e-mail, paymentInstructions, validationStatus)", async () => {
      const pro = await profissional("APPROVED", CANARY);
      const o = await oferta(pro.professionalId);
      const [s0 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY]);
      const json = JSON.stringify(await h.module.directory.getBookingFacts(o.id, s0));
      for (const key of FORBIDDEN_KEYS) expect(json, `chave ${key}`).not.toContain(`"${key}"`);
      expect(json).not.toContain(CANARY);
      expect(json).not.toContain(pro.email);
    });
  });

  // ---------------------------------------------------------------- (2) reserveSlot (BR-MKT-53)

  describe("(2) reserveSlot: reserva atómica do horário", () => {
    it("horário livre: true e booking_id preenchido com a marcação", async () => {
      const pro = await profissional("APPROVED");
      const o = await oferta(pro.professionalId);
      const [s0 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY]);
      const alvo = await marcar(o.id, null, "CANCELLED");
      expect(await reservar(alvo.bookingId, s0, o.id)).toBe(true);
      expect(await bookingDoSlot(s0)).toBe(alvo.bookingId);
    });

    it("segunda reserva do mesmo horário: false e o dono continua a ser a primeira marcação", async () => {
      const pro = await profissional("APPROVED");
      const o = await oferta(pro.professionalId);
      const [s0 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY]);
      const primeira = await marcar(o.id, null, "CANCELLED");
      const segunda = await marcar(o.id, null, "CANCELLED");
      expect(await reservar(primeira.bookingId, s0, o.id)).toBe(true);
      expect(await reservar(segunda.bookingId, s0, o.id)).toBe(false);
      expect(await bookingDoSlot(s0)).toBe(primeira.bookingId);
    });

    it("offerId que não é a oferta do horário: false e horário livre", async () => {
      const pro = await profissional("APPROVED");
      const a = await oferta(pro.professionalId);
      const b = await oferta(pro.professionalId);
      const [sa = ""] = await horarios(pro.professionalId, a.id, [2 * DAY]);
      const alvo = await marcar(a.id, null, "CANCELLED");
      expect(await reservar(alvo.bookingId, sa, b.id)).toBe(false);
      expect(await bookingDoSlot(sa)).toBeNull();
    });

    it("starts_at anterior ao minStart: false; igual ao minStart: true (fronteira inclusiva)", async () => {
      const pro = await profissional("APPROVED");
      const o = await oferta(pro.professionalId);
      const [s0 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY]);
      const alvo = await marcar(o.id, null, "CANCELLED");
      expect(await reservar(alvo.bookingId, s0, o.id, new Date(START.getTime() + 3 * DAY))).toBe(false);
      expect(await bookingDoSlot(s0)).toBeNull();
      expect(await reservar(alvo.bookingId, s0, o.id, new Date(START.getTime() + 2 * DAY))).toBe(true);
    });

    it("oferta inativa: false", async () => {
      const pro = await profissional("APPROVED");
      const inativa = await oferta(pro.professionalId, { active: false });
      const [s0 = ""] = await horarios(pro.professionalId, inativa.id, [2 * DAY]);
      const alvo = await marcar(inativa.id, null, "CANCELLED");
      expect(await reservar(alvo.bookingId, s0, inativa.id)).toBe(false);
      expect(await bookingDoSlot(s0)).toBeNull();
    });

    it.each(["DRAFT", "SUSPENDED"] as const)("profissional %s (não APPROVED): false", async (status) => {
      const pro = await profissional(status);
      const o = await oferta(pro.professionalId);
      const [s0 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY]);
      const alvo = await marcar(o.id, null, "CANCELLED");
      expect(await reservar(alvo.bookingId, s0, o.id)).toBe(false);
      expect(await bookingDoSlot(s0)).toBeNull();
    });

    it("corrida: 10 reservas concorrentes do mesmo horário (cada uma na sua transação) => exatamente 1 true e 9 false", async () => {
      const pro = await profissional("APPROVED");
      const o = await oferta(pro.professionalId);
      const [s0 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY]);
      const alvos: string[] = [];
      for (let i = 0; i < 10; i++) alvos.push((await marcar(o.id, null, "CANCELLED")).bookingId);
      const resultados = await Promise.all(alvos.map((bookingId) => reservar(bookingId, s0, o.id)));
      expect(resultados.filter((r) => r)).toHaveLength(1);
      expect(resultados.filter((r) => !r)).toHaveLength(9);
      const dono = await bookingDoSlot(s0);
      expect(dono).not.toBeNull();
      expect(alvos).toContain(dono);
    });
  });

  // ---------------------------------------------------------------- (3) releaseSlot (TC-MKT-114)

  describe("(3) releaseSlot: libertação do horário ocupado", () => {
    it("liberta e devolve true; repetido false; o horário volta a aparecer em listBookableSlots", async () => {
      const pro = await profissional("APPROVED");
      const o = await oferta(pro.professionalId);
      const [s0 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY]);
      const alvo = await marcar(o.id, null, "CANCELLED");
      expect(await reservar(alvo.bookingId, s0, o.id)).toBe(true);
      expect((await h.module.directory.listBookableSlots(pro.professionalId, START, new Date(START.getTime() + 7 * DAY))).map((s) => s.id)).not.toContain(s0);

      expect(await libertar(alvo.bookingId)).toBe(true);
      expect(await bookingDoSlot(s0)).toBeNull();
      expect(await libertar(alvo.bookingId)).toBe(false);
      expect((await h.module.directory.listBookableSlots(pro.professionalId, START, new Date(START.getTime() + 7 * DAY))).map((s) => s.id)).toContain(s0);
    });

    it("depois de libertar, o horário volta a contar em slotStats", async () => {
      const pro = await profissional("APPROVED");
      const o = await oferta(pro.professionalId);
      const [s0 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY]);
      const alvo = await marcar(o.id, null, "CANCELLED");
      await reservar(alvo.bookingId, s0, o.id);
      const [ocupado] = await h.module.directory.getApprovedFacts([pro.professionalId]);
      expect(ocupado?.slotStats.find((s) => s.offerId === o.id)?.countNext14Days ?? 0).toBe(0);

      await libertar(alvo.bookingId);
      const [livre] = await h.module.directory.getApprovedFacts([pro.professionalId]);
      expect(livre?.slotStats).toEqual([{ offerId: o.id, nextSlotAt: new Date(START.getTime() + 2 * DAY), countNext14Days: 1 }]);
    });
  });

  // ---------------------------------------------------------------- (4) TC-MKT-114: ocupados fora das estatísticas

  describe("(4) TC-MKT-114: horários ocupados excluídos de slotStats e de listBookableSlots", () => {
    it("com 1 de 2 horários ocupados: countNext14Days e nextSlotAt excluem o ocupado", async () => {
      const pro = await profissional("APPROVED");
      const o = await oferta(pro.professionalId);
      const [s0 = "", s1 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY, 3 * DAY]);
      await marcar(o.id, s0);
      const [fact] = await h.module.directory.getApprovedFacts([pro.professionalId]);
      expect(fact?.slotStats).toEqual([{ offerId: o.id, nextSlotAt: new Date(START.getTime() + 3 * DAY), countNext14Days: 1 }]);
      const livres = await h.module.directory.listBookableSlots(pro.professionalId, START, new Date(START.getTime() + 7 * DAY));
      expect(livres.map((s) => s.id)).toEqual([s1]);
    });

    it("com todos os horários ocupados: sem próximo horário (count 0, nextSlotAt null) e lista vazia", async () => {
      const pro = await profissional("APPROVED");
      const o = await oferta(pro.professionalId);
      const ids = await horarios(pro.professionalId, o.id, [2 * DAY, 3 * DAY]);
      for (const id of ids) await marcar(o.id, id);
      const [fact] = await h.module.directory.getApprovedFacts([pro.professionalId]);
      // Sem horários livres a estatística pode não ter linha para a oferta: ausente equivale a count 0 e nextSlotAt null.
      const stat = fact?.slotStats.find((s) => s.offerId === o.id);
      expect(stat?.countNext14Days ?? 0).toBe(0);
      expect(stat?.nextSlotAt ?? null).toBeNull();
      expect(await h.module.directory.listBookableSlots(pro.professionalId, START, new Date(START.getTime() + 7 * DAY))).toEqual([]);
    });
  });

  // ---------------------------------------------------------------- (5) readPaymentInstructions (BR-MKT-26/56)

  describe("(5) readPaymentInstructions: única via de paymentInstructions", () => {
    it("devolve o texto do profissional", async () => {
      const pro = await profissional("APPROVED", CANARY);
      expect(await h.module.directory.readPaymentInstructions(pro.professionalId)).toBe(CANARY);
    });

    it("null se o texto é nulo, só espaços ou o profissional não existe", async () => {
      const semTexto = await profissional("APPROVED", null);
      const soEspacos = await profissional("APPROVED", "   ");
      expect(await h.module.directory.readPaymentInstructions(semTexto.professionalId)).toBeNull();
      expect(await h.module.directory.readPaymentInstructions(soEspacos.professionalId)).toBeNull();
      expect(await h.module.directory.readPaymentInstructions(randomUUID())).toBeNull();
    });

    it("nenhuma outra via de leitura devolve o texto canário (perfil, listagens, factos, marcação e conversas)", async () => {
      const pro = await profissional("APPROVED", CANARY);
      const o = await oferta(pro.professionalId);
      const [s0 = ""] = await horarios(pro.professionalId, o.id, [2 * DAY]);
      const dir = h.module.directory;
      const perfil = await dir.getApprovedProfile(pro.professionalId);
      expect(perfil).not.toBeNull();
      expect(await dir.getApprovedFacts([pro.professionalId])).toHaveLength(1);
      expect(await dir.readPaymentInstructions(pro.professionalId)).toBe(CANARY);

      const todas = [
        perfil,
        await dir.listApproved({ limit: 100 }),
        await dir.listApprovedFacts({}),
        await dir.getApprovedFacts([pro.professionalId]),
        await dir.getBookingFacts(o.id, s0),
        await dir.getConversationIdentities([pro.professionalId]),
      ];
      for (const x of todas) expect(JSON.stringify(x)).not.toContain(CANARY);
    });
  });

  // ---------------------------------------------------------------- (6) portal: veto de bloqueios e desativações (TC-MKT-109)

  describe("(6) portal: bloqueios sobre horários ocupados e desativações", () => {
    it("GET /slots devolve booked=true e bookingId no ocupado; os restantes booked=false e bookingId null", async () => {
      const p = await portalComRegra();
      const alvo = emPosicao(p.slots, 0);
      const reserva = await marcar(p.offerId, alvo.id);
      const depois = await apiSlots(p.token);
      expect(depois).toHaveLength(p.slots.length);
      expect(depois.find((s) => s.id === alvo.id)).toMatchObject({ booked: true, bookingId: reserva.bookingId });
      expect(depois.filter((s) => s.id !== alvo.id).every((s) => !s.booked && s.bookingId === null)).toBe(true);
    }, 30_000);

    it("bloqueio que cobre um horário ocupado ⇒ 409 CONFLICT, detail só com a contagem (sem ids) e nada gravado", async () => {
      const p = await portalComRegra();
      const [s0, s1, s2] = [emPosicao(p.slots, 0), emPosicao(p.slots, 1), emPosicao(p.slots, 2)];
      const reserva = await marcar(p.offerId, s1.id);
      const totalAntes = await totalSlots(p.professionalId);
      const livresAntes = await livresDb(p.professionalId);

      const res = await request(h.app)
        .post(TIME_OFF)
        .set(auth(p.token))
        .send({ startsAt: s0.startsAt, endsAt: s2.endsAt })
        .expect(409);
      const erro = res.body as { code: string; detail: string };
      expect(erro.code).toBe("CONFLICT");
      expect(erro.detail).toMatch(/\b1 horário/);
      const json = JSON.stringify(res.body);
      for (const id of [p.professionalId, reserva.bookingId, reserva.familyId, reserva.memberId, reserva.userId, s0.id, s1.id, s2.id]) {
        expect(json, `detail sem id ${id}`).not.toContain(id);
      }

      expect(await timeOffRows(p.professionalId)).toBe(0);
      expect(await totalSlots(p.professionalId)).toBe(totalAntes);
      expect(await livresDb(p.professionalId)).toBe(livresAntes);
      expect((await apiSlots(p.token)).find((s) => s.id === s1.id)?.booked).toBe(true);
    }, 30_000);

    it("bloqueio só sobre horários livres ⇒ 201 como antes; o ocupado fica e o livre sai", async () => {
      const p = await portalComRegra();
      const ocupado = emPosicao(p.slots, 0);
      const livre = emPosicao(p.slots, 3);
      await marcar(p.offerId, ocupado.id);
      await request(h.app).post(TIME_OFF).set(auth(p.token)).send({ startsAt: livre.startsAt, endsAt: livre.endsAt }).expect(201);
      const depois = await apiSlots(p.token);
      expect(depois.some((s) => s.id === livre.id)).toBe(false);
      expect(depois.find((s) => s.id === ocupado.id)?.booked).toBe(true);
    }, 30_000);

    it("desativar a regra (PATCH active=false) mantém o horário ocupado e remove os livres", async () => {
      const p = await portalComRegra();
      const ocupado = emPosicao(p.slots, 1);
      await marcar(p.offerId, ocupado.id);
      const totalAntes = await totalSlots(p.professionalId);
      const res = await request(h.app).patch(`${SCHEDULE}/${p.ruleId}`).set(auth(p.token)).send({ active: false }).expect(200);
      expect((res.body as { generation: unknown }).generation).toMatchObject({ removed: totalAntes - 1 });
      const depois = await apiSlots(p.token);
      expect(depois.map((s) => s.id)).toEqual([ocupado.id]);
      expect(depois[0]?.booked).toBe(true);
      expect(await totalSlots(p.professionalId)).toBe(1);
    }, 30_000);

    it("desativar a oferta (PATCH active=false) mantém o horário ocupado e remove os livres", async () => {
      const p = await portalComRegra();
      const ocupado = emPosicao(p.slots, 2);
      await marcar(p.offerId, ocupado.id);
      await request(h.app).patch(`${OFFERS}/${p.offerId}`).set(auth(p.token)).send({ active: false }).expect(200);
      const depois = await apiSlots(p.token);
      expect(depois.map((s) => s.id)).toEqual([ocupado.id]);
      expect(depois[0]?.booked).toBe(true);
      expect(await totalSlots(p.professionalId)).toBe(1);
    }, 30_000);

    it("apagar o bloqueio (regenera) repõe os livres e mantém o horário ocupado", async () => {
      const p = await portalComRegra();
      const ocupado = emPosicao(p.slots, 1);
      const livre = emPosicao(p.slots, 3);
      await marcar(p.offerId, ocupado.id);
      const totalAntes = await totalSlots(p.professionalId);
      const criado = await request(h.app).post(TIME_OFF).set(auth(p.token)).send({ startsAt: livre.startsAt, endsAt: livre.endsAt }).expect(201);
      expect((await apiSlots(p.token)).some((s) => s.id === livre.id)).toBe(false);
      await request(h.app)
        .delete(`${TIME_OFF}/${(criado.body as { id: string }).id}`)
        .set(auth(p.token))
        .expect(204);
      const depois = await apiSlots(p.token);
      // A regeneração pode recriar o horário livre com outro id: compara-se o instante.
      expect(depois.some((s) => s.startsAt === livre.startsAt)).toBe(true);
      expect(depois.find((s) => s.id === ocupado.id)).toMatchObject({ booked: true });
      expect(await totalSlots(p.professionalId)).toBe(totalAntes);
    }, 30_000);
  });
});
