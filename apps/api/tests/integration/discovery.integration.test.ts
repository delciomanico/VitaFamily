// Integração (PostgreSQL real, app real com validação de respostas) das rotas `/marketplace/*` (MK2 S4): TC-MKT-38, 40..43, 49..52, 76 e
// TC-AZ-MKT-09/16. A descoberta é ligada como em `main/api.ts` (porta `ProfessionalCatalog` sobre `ProfessionalDirectory`).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDiscoveryModule } from "../../src/modules/discovery/index.js";
import { API, START, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const DAY = 86_400_000;
const CANARY = "canario-pesquisa-xyz";
const FORBIDDEN_KEYS = ["paymentInstructions", "payment_instructions", "email", "passwordHash", "validationStatus", "statusReason", "credentials", "accountId", "storageKey", "conversationCount"];
type Status = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe("integração: descoberta /marketplace/* (MK2 S4)", () => {
  let h: ProfessionalsHarness;
  let token: string;
  const logs: string[] = [];
  let spec: string;
  let spec2: string;
  let a: string; // Luanda, VIDEO 8000, horários
  let b: string; // luanda ` ` (grafia diferente), IN_PERSON 5000
  let c: string; // Benguela, CHAT 3000
  let draft: string;
  let suspended: string;

  const get = (path: string, t: string | null = token) => {
    const r = request(h.app).get(`${API}${path}`);
    return t ? r.set("Authorization", `Bearer ${t}`) : r;
  };

  async function especialidade(name: string, category: "HEALTH" | "WELLNESS" = "HEALTH", active = true): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>("INSERT INTO specialties (name, category, active) VALUES ($1, $2, $3) RETURNING id", [`${name} ${randomUUID().slice(0, 6)}`, category, active]);
    return rows[0]?.id ?? "";
  }
  async function profissional(status: Status, name: string, city: string, specs: string[], approvedDaysAgo = 100): Promise<string> {
    const { professionalId } = await h.registerVerified();
    await h.pool.query(
      `UPDATE professionals SET validation_status = $2::professional_validation_status, display_name = $3, city = $4, bio = 'Bio publica', payment_instructions = 'iban-canario-ao06',
         submitted_at = CASE WHEN $2 = 'DRAFT' THEN NULL ELSE now() END, approved_at = CASE WHEN $2 IN ('APPROVED', 'SUSPENDED') THEN $5::timestamptz ELSE NULL END WHERE id = $1`,
      [professionalId, status, name, city, new Date(START.getTime() - approvedDaysAgo * DAY)],
    );
    for (const s of specs) await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, s]);
    return professionalId;
  }
  async function oferta(pid: string, sid: string, method: string, priceKz: number, active = true): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>("INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz, note, active) VALUES ($1, $2, $3, 30, $4, NULL, $5) RETURNING id", [pid, sid, method, priceKz, active]);
    return rows[0]?.id ?? "";
  }
  async function horario(pid: string, offerId: string, offsetMs: number): Promise<void> {
    const { rows } = await h.pool.query<{ id: string }>("INSERT INTO professional_schedule_rules (professional_id, offer_id, weekdays, start_time, end_time) VALUES ($1, $2, ARRAY[1,2,3,4,5]::smallint[], '09:00', '12:00') RETURNING id", [pid, offerId]);
    const start = new Date(START.getTime() + offsetMs);
    await h.pool.query("INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)", [pid, offerId, rows[0]?.id, start, new Date(start.getTime() + 30 * 60_000)]);
  }

  beforeAll(async () => {
    h = await startProfessionalsHarness({}, ({ module, clock }) => [createDiscoveryModule({ clock, catalog: { listApprovedFacts: (q) => module.directory.listApprovedFacts(q), getApprovedFacts: (ids) => module.directory.getApprovedFacts(ids) } }).router], { logStream: logs });
    token = await h.userToken();
    spec = await especialidade("Cardio");
    spec2 = await especialidade("Yoga", "WELLNESS");
    a = await profissional("APPROVED", "Ana Silva", "Luanda", [spec], 300);
    b = await profissional("APPROVED", "Bruno Costa", " luanda ", [spec], 50);
    c = await profissional("APPROVED", "Carla Dias", "Benguela", [spec, spec2], 10);
    draft = await profissional("DRAFT", "Rascunho", "Luanda", [spec]);
    suspended = await profissional("SUSPENDED", "Suspenso", "Luanda", [spec]);
    const offerA = await oferta(a, spec, "VIDEO", 8000);
    await oferta(a, spec, "IN_PERSON", 12000, false);
    await oferta(b, spec, "IN_PERSON", 5000);
    await oferta(c, spec, "CHAT", 3000);
    await oferta(c, spec2, "PHONE", 2000);
    await oferta(draft, spec, "VIDEO", 1000);
    await oferta(suspended, spec, "VIDEO", 1000);
    await horario(a, offerA, 2 * DAY);
  }, 180_000);

  afterAll(async () => {
    await h.stop();
  });

  it("TC-MKT-38/40: pesquisa só devolve APPROVED, só dados públicos; filtros combinam em AND", async () => {
    const res = await get("/marketplace/professionals");
    expect(res.status).toBe(200);
    const ids = (res.body as { items: { id: string }[] }).items.map((i) => i.id);
    expect(ids.sort()).toEqual([a, b, c].sort());
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(suspended);
    for (const key of FORBIDDEN_KEYS) expect(keysDeep(res.body).has(key)).toBe(false);
    const city = await get("/marketplace/professionals?city=LUANDA");
    expect((city.body as { items: { id: string }[] }).items.map((i) => i.id).sort()).toEqual([a, b].sort());
    const price = await get(`/marketplace/professionals?specialtyId=${spec}&method=IN_PERSON&maxPriceKz=6000`);
    expect((price.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([b]);
    // a oferta inativa de `a` (IN_PERSON) nunca corresponde
    const inactive = await get("/marketplace/professionals?method=IN_PERSON&city=Luanda&minPriceKz=10000");
    expect((inactive.body as { items: unknown[] }).items).toEqual([]);
    const avail = await get("/marketplace/professionals?availableWithinDays=3");
    expect((avail.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([a]);
  });

  it("TC-MKT-43: ordenações, ranking com specialtyId e 422 de RANKING sem specialtyId", async () => {
    const ranked = await get(`/marketplace/professionals?specialtyId=${spec}`);
    expect(ranked.status).toBe(200);
    const items = (ranked.body as { items: { ranking: { score: number; version: string } }[] }).items;
    expect(items[0]?.ranking.version).toBe("v1");
    const scores = items.map((i) => i.ranking.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    const asc = await get(`/marketplace/professionals?sort=PRICE_ASC`);
    expect((asc.body as { items: { fromPriceKz: number }[] }).items.map((i) => i.fromPriceKz)).toEqual([2000, 5000, 8000]);
    expect((await get("/marketplace/professionals?sort=RANKING")).status).toBe(422);
    expect((await get("/marketplace/professionals?minPriceKz=9&maxPriceKz=1")).status).toBe(422);
    const first = await get("/marketplace/professionals?sort=PRICE_ASC&limit=2");
    const cursor = (first.body as { nextCursor: string }).nextCursor;
    const second = await get(`/marketplace/professionals?sort=PRICE_ASC&limit=2&cursor=${cursor}`);
    expect((second.body as { items: unknown[]; nextCursor: null }).items.length).toBe(1);
    expect((second.body as { nextCursor: null }).nextCursor).toBeNull();
  });

  it("TC-MKT-51: parâmetro desconhecido e cursor inválido ⇒ 400; sem token / token de profissional / de clínica ⇒ 401", async () => {
    expect((await get("/marketplace/professionals?foo=1")).status).toBe(400);
    expect((await get("/marketplace/professionals?cursor=lixo")).status).toBe(400);
    for (const path of ["/marketplace/professionals", "/marketplace/filters", "/marketplace/ranking-rules", `/marketplace/professionals/${a}`, `/marketplace/professionals/compare?ids=${a},${b}&specialtyId=${spec}`]) {
      expect((await get(path, null)).status).toBe(401);
      const pro = await h.newProfessional();
      expect((await get(path, pro.token)).status).toBe(401);
      expect((await get(path, await h.clinicToken())).status).toBe(401);
    }
  });

  it("TC-MKT-41/40/AZ-16: perfil público sem chaves proibidas; não-APPROVED e inexistente indistinguíveis (404)", async () => {
    const ok = await get(`/marketplace/professionals/${a}?specialtyId=${spec}`);
    expect(ok.status).toBe(200);
    for (const key of FORBIDDEN_KEYS) expect(keysDeep(ok.body).has(key)).toBe(false);
    const body = ok.body as { memberSince: string; ranking: unknown; offers: unknown[] };
    expect(body.memberSince).toMatch(/^\d{4}-\d{2}-01$/);
    expect(body.ranking).not.toBeNull();
    expect(body.offers).toHaveLength(1); // a oferta inativa não aparece
    expect(((await get(`/marketplace/professionals/${a}?specialtyId=${spec2}`)).body as { ranking: unknown }).ranking).toBeNull();
    const missing = await get(`/marketplace/professionals/${randomUUID()}`);
    for (const id of [draft, suspended]) {
      const r = await get(`/marketplace/professionals/${id}`);
      expect(r.status).toBe(404);
      expect({ ...r.body, instance: undefined, requestId: undefined }).toEqual({ ...missing.body, instance: undefined, requestId: undefined });
    }
    // suspender reflete-se no pedido seguinte (sem cache)
    await h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [b]);
    expect((await get(`/marketplace/professionals/${b}`)).status).toBe(404);
    await h.pool.query("UPDATE professionals SET validation_status = 'APPROVED' WHERE id = $1", [b]);
    expect((await get(`/marketplace/professionals/${b}`)).status).toBe(200);
  });

  it("TC-MKT-42/AZ-16: comparação 2–3, 422 de contagem/repetidos/sem oferta, 404 do pedido inteiro", async () => {
    const ok = await get(`/marketplace/professionals/compare?ids=${a},${b}&specialtyId=${spec}`);
    expect(ok.status).toBe(200);
    const body = ok.body as { items: { professionalId: string }[]; priceSummary: { method: string; cheapestProfessionalIds: string[] }[] };
    expect(body.items.map((i) => i.professionalId)).toEqual([a, b]);
    expect(body.priceSummary.map((p) => p.method)).toEqual(["IN_PERSON", "VIDEO"]);
    expect((await get(`/marketplace/professionals/compare?ids=${a}&specialtyId=${spec}`)).status).toBe(422);
    expect((await get(`/marketplace/professionals/compare?ids=${a},${a}&specialtyId=${spec}`)).status).toBe(422);
    expect((await get(`/marketplace/professionals/compare?ids=${a},${b},${c},${draft}&specialtyId=${spec}`)).status).toBe(422);
    expect((await get(`/marketplace/professionals/compare?ids=${a},${b}&specialtyId=${spec2}`)).status).toBe(422);
    expect((await get(`/marketplace/professionals/compare?ids=${a},${draft}&specialtyId=${spec}`)).status).toBe(404);
    expect((await get(`/marketplace/professionals/compare?ids=${a},${randomUUID()}&specialtyId=${spec}`)).status).toBe(404);
  });

  it("TC-MKT-50/76: filtros disponíveis (especialidades ativas, cidades agrupadas, métodos) e ranking-rules estático", async () => {
    const inactive = await especialidade("Inativa", "HEALTH", false);
    await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [a, inactive]);
    await oferta(a, inactive, "CHAT", 1500);
    const res = await get("/marketplace/filters");
    expect(res.status).toBe(200);
    const body = res.body as { specialties: { id: string; professionalCount: number }[]; cities: { name: string; professionalCount: number }[]; methods: string[] };
    expect(body.specialties.map((s) => s.id).sort()).toEqual([spec, spec2].sort());
    expect(body.specialties.find((s) => s.id === spec)?.professionalCount).toBe(3);
    expect(body.cities.find((x) => x.name.trim().toLowerCase() === "luanda")?.professionalCount).toBe(2);
    expect(body.methods).toEqual(["IN_PERSON", "VIDEO", "CHAT", "PHONE"]);
    const rules = await get("/marketplace/ranking-rules");
    expect(rules.status).toBe(200);
    const r = rules.body as { version: string; signals: { weightPercent: number }[]; statement: string };
    expect(r.version).toBe("v1");
    expect(r.signals.reduce((s, x) => s + x.weightPercent, 0)).toBe(100);
    expect(r.statement).toMatch(/nunca influenciam/);
    const listing = (await get("/marketplace/professionals")).body as { items: { matchingOffers: { priceKz: number }[] }[] };
    for (const price of listing.items) for (const o of price.matchingOffers) expect(Number.isInteger(o.priceKz)).toBe(true);
  });

  it("TC-MKT-52: sem tabela de pesquisas nem auditoria; canário em q/city/specialtyId ausente dos logs e dos erros", async () => {
    logs.length = 0;
    const before = await h.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_logs");
    const r1 = await get(`/marketplace/professionals?q=${CANARY}&city=${CANARY}`);
    const r2 = await get(`/marketplace/professionals?specialtyId=${CANARY}`); // 400 do validador
    const r3 = await get(`/marketplace/professionals/${CANARY}`);
    for (const r of [r1, r2, r3]) expect(JSON.stringify(r.body)).not.toContain(CANARY);
    expect(logs.join("")).not.toContain(CANARY);
    const after = await h.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_logs");
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    const tables = await h.pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE '%search%' OR table_name LIKE '%query%')");
    expect(tables.rows).toEqual([]);
  });

  it("TC-MKT-51: o 61.º pedido no minuto ⇒ 429 com Retry-After (por utilizador)", async () => {
    let last = 0;
    let retry: string | undefined;
    for (let i = 0; i < 70; i += 1) {
      const r = await get("/marketplace/ranking-rules");
      last = r.status;
      if (r.status === 429) {
        retry = r.headers["retry-after"];
        break;
      }
    }
    expect(last).toBe(429);
    expect(Number(retry)).toBeGreaterThan(0);
  });
});
