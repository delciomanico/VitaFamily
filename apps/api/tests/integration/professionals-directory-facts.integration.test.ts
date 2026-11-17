// Integração (PostgreSQL real) da extensão aditiva de `ProfessionalDirectory` para a descoberta (MK2 S2, TC-MKT-54, BR-MKT-19,
// modules.md nota 36(b)): `listApprovedFacts`/`getApprovedFacts` só devolvem `APPROVED` lidos em cada chamada, só ofertas ativas,
// estatísticas de horários dos 14 dias, nunca e-mail/`paymentInstructions`/credenciais/estado, e respeitam o teto de 1000.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { START, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const DAY = 86_400_000;
const CANARY_IBAN = "iban-canario-ao06-facts";
const FORBIDDEN_KEYS = ["paymentInstructions", "payment_instructions", "email", "passwordHash", "validationStatus", "statusReason", "credentials", "accountId", "storageKey"];

type Status = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";

describe("integração: ProfessionalDirectory — factos para descoberta (MK2 S2, TC-MKT-54)", () => {
  let h: ProfessionalsHarness;
  let specHealth: string;
  let specWellness: string;
  const emails: string[] = [];

  async function especialidade(category: "HEALTH" | "WELLNESS"): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>("INSERT INTO specialties (name, category, active) VALUES ($1, $2, true) RETURNING id", [`Esp ${randomUUID().slice(0, 8)}`, category]);
    return rows[0]?.id ?? "";
  }

  /** Profissional com estado e (se APPROVED) nome/cidade/aprovação; liga as especialidades dadas. */
  async function profissional(status: Status, specs: string[], approvedAt = new Date(START.getTime() - 100 * DAY)): Promise<string> {
    const { email, professionalId } = await h.registerVerified();
    emails.push(email);
    await h.pool.query(
      `UPDATE professionals SET validation_status = $2::professional_validation_status, display_name = $3, city = 'Luanda', bio = 'Bio publica', payment_instructions = $4,
         submitted_at = CASE WHEN $2 = 'DRAFT' THEN NULL ELSE now() END, approved_at = CASE WHEN $2 IN ('APPROVED', 'SUSPENDED') THEN $5::timestamptz ELSE NULL END WHERE id = $1`,
      [professionalId, status, `Nome ${status} ${professionalId.slice(0, 4)}`, CANARY_IBAN, approvedAt],
    );
    for (const s of specs) await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, s]);
    return professionalId;
  }

  async function oferta(professionalId: string, specialtyId: string, o: { method?: string; priceKz?: number; note?: string | null; active?: boolean } = {}): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>(
      "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz, note, active) VALUES ($1, $2, $3, 30, $4, $5, $6) RETURNING id",
      [professionalId, specialtyId, o.method ?? "IN_PERSON", o.priceKz ?? 5000, o.note ?? null, o.active ?? true],
    );
    return rows[0]?.id ?? "";
  }

  /** Horários de 30 min (consecutivos não se sobrepõem) a partir de `offsetMs` relativo a START; regra própria por oferta. */
  async function horarios(professionalId: string, offerId: string, offsetsMs: number[]): Promise<void> {
    const { rows } = await h.pool.query<{ id: string }>("INSERT INTO professional_schedule_rules (professional_id, offer_id, weekdays, start_time, end_time) VALUES ($1, $2, ARRAY[1,2,3,4,5]::smallint[], '09:00', '12:00') RETURNING id", [professionalId, offerId]);
    const ruleId = rows[0]?.id ?? "";
    for (const offset of offsetsMs) {
      const start = new Date(START.getTime() + offset);
      await h.pool.query("INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)", [professionalId, offerId, ruleId, start, new Date(start.getTime() + 30 * 60_000)]);
    }
  }

  const setStatus = (id: string, status: Status) =>
    h.pool.query("UPDATE professionals SET validation_status = $2::professional_validation_status, approved_at = COALESCE(approved_at, now()) WHERE id = $1", [id, status]);

  let a: string; // APPROVED, saúde, 1 oferta ativa + 1 inativa, horários variados
  let b: string; // APPROVED, bem-estar
  let c: string; // DRAFT
  let d: string; // SUSPENDED
  let offerA: string;
  let offerAInactive: string;

  beforeAll(async () => {
    h = await startProfessionalsHarness();
    specHealth = await especialidade("HEALTH");
    specWellness = await especialidade("WELLNESS");
    a = await profissional("APPROVED", [specHealth], new Date(START.getTime() - 400 * DAY));
    b = await profissional("APPROVED", [specWellness]);
    c = await profissional("DRAFT", [specHealth]);
    d = await profissional("SUSPENDED", [specHealth]);
    offerA = await oferta(a, specHealth, { priceKz: 5000, note: "nota publica" });
    offerAInactive = await oferta(a, specHealth, { method: "VIDEO", priceKz: 3000, active: false });
    await oferta(b, specWellness, { method: "CHAT", priceKz: 2000 });
    await oferta(c, specHealth);
    await oferta(d, specHealth);
    // 3 dentro dos 14 dias (a 1.ª é a mais próxima), 2 depois dos 14 dias, 1 no passado; 2 horários da oferta inativa.
    await horarios(a, offerA, [2 * DAY, 3 * DAY, 13 * DAY, 20 * DAY, 30 * DAY, -1 * DAY]);
    await horarios(a, offerAInactive, [4 * DAY, 5 * DAY]);
  }, 180_000);

  afterAll(async () => {
    await h.stop();
  });

  it("lista só APPROVED (DRAFT e SUSPENDED ausentes) com os campos públicos e approvedAt", async () => {
    const facts = await h.module.directory.listApprovedFacts({});
    const ids = facts.map((f) => f.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).not.toContain(c);
    expect(ids).not.toContain(d);
    const fa = facts.find((f) => f.id === a);
    expect(fa).toMatchObject({ city: "Luanda", bio: "Bio publica", approvedAt: new Date(START.getTime() - 400 * DAY) });
    expect(fa?.specialties.map((s) => ({ id: s.id, category: s.category }))).toEqual([{ id: specHealth, category: "HEALTH" }]);
    expect(ids).toEqual([...ids].sort());
  });

  it("filtra por especialidade e por categoria", async () => {
    expect((await h.module.directory.listApprovedFacts({ specialtyId: specHealth })).map((f) => f.id)).toEqual([a]);
    expect((await h.module.directory.listApprovedFacts({ specialtyId: specWellness })).map((f) => f.id)).toEqual([b]);
    const wellness = (await h.module.directory.listApprovedFacts({ category: "WELLNESS" })).map((f) => f.id);
    expect(wellness).toContain(b);
    expect(wellness).not.toContain(a);
  });

  it("só ofertas ativas; estatísticas só das ofertas ativas, só futuras, contagem dos 14 dias exata", async () => {
    const [fa] = await h.module.directory.getApprovedFacts([a]);
    expect(fa?.offers.map((o) => o.id)).toEqual([offerA]);
    expect(fa?.offers[0]).toEqual({ id: offerA, specialtyId: specHealth, method: "IN_PERSON", durationMinutes: 30, priceKz: 5000, note: "nota publica" });
    expect(fa?.slotStats).toHaveLength(1);
    expect(fa?.slotStats[0]).toEqual({ offerId: offerA, nextSlotAt: new Date(START.getTime() + 2 * DAY), countNext14Days: 3 });
    expect(fa?.slotStats.some((s) => s.offerId === offerAInactive)).toBe(false);
  });

  it("oferta sem horários não tem estatística; a de b também não", async () => {
    const [fb] = await h.module.directory.getApprovedFacts([b]);
    expect(fb?.offers).toHaveLength(1);
    expect(fb?.slotStats).toEqual([]);
  });

  it("nunca expõe e-mail, paymentInstructions, credenciais nem estado (chaves e valores canário)", async () => {
    const facts = [...(await h.module.directory.listApprovedFacts({})), ...(await h.module.directory.getApprovedFacts([a, b]))];
    const json = JSON.stringify(facts);
    for (const key of FORBIDDEN_KEYS) expect(json, `chave ${key}`).not.toContain(`"${key}"`);
    expect(json).not.toContain(CANARY_IBAN);
    for (const email of emails) expect(json).not.toContain(email);
    expect(Object.keys(facts[0] ?? {}).sort()).toEqual(["approvedAt", "bio", "city", "displayName", "id", "offers", "slotStats", "specialties"]);
  });

  it("getApprovedFacts: omite ids inexistentes/não APPROVED, ignora repetidos, ordena por id e aceita lista vazia", async () => {
    const facts = await h.module.directory.getApprovedFacts([b, c, d, randomUUID(), a, a]);
    expect(facts.map((f) => f.id)).toEqual([a, b].sort());
    expect(await h.module.directory.getApprovedFacts([])).toEqual([]);
    expect(await h.module.directory.getApprovedFacts([c, d])).toEqual([]);
  });

  it("sem cache: o estado lê-se em cada chamada (suspende => desaparece; reativa => volta)", async () => {
    await setStatus(b, "SUSPENDED");
    expect((await h.module.directory.getApprovedFacts([b])).length).toBe(0);
    expect((await h.module.directory.listApprovedFacts({ specialtyId: specWellness })).length).toBe(0);
    await setStatus(b, "APPROVED");
    expect((await h.module.directory.getApprovedFacts([b])).map((f) => f.id)).toEqual([b]);
  });

  it("desativar a oferta tira-a dos factos e das estatísticas na leitura seguinte", async () => {
    await h.pool.query("UPDATE professional_offers SET active = false WHERE id = $1", [offerA]);
    const [fa] = await h.module.directory.getApprovedFacts([a]);
    expect(fa?.offers).toEqual([]);
    expect(fa?.slotStats).toEqual([]);
    await h.pool.query("UPDATE professional_offers SET active = true WHERE id = $1", [offerA]);
  });

  it("teto de 1000 por pedido (BR-MKT-49) e os métodos de MK1 continuam a funcionar", async () => {
    await h.pool.query(
      `WITH acc AS (
         INSERT INTO professional_accounts (email, password_hash, terms_accepted_version, terms_accepted_at)
         SELECT 'bulk-' || g || '@teste.ao', 'x', 'v1', now() FROM generate_series(1, 1005) g RETURNING id)
       INSERT INTO professionals (account_id, display_name, city, validation_status, submitted_at, approved_at)
       SELECT id, 'Bulk', 'Luanda', 'APPROVED', now(), now() FROM acc`,
    );
    expect(await h.module.directory.listApprovedFacts({})).toHaveLength(1000);
    expect((await h.module.directory.listApproved({ limit: 5 })).length).toBe(5);
    expect(await h.module.directory.getApprovedProfile(a)).toMatchObject({ id: a, city: "Luanda" });
  });
});
