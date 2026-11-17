// Filtros (mesma oferta ativa, TC-MKT-39), ordenações, cursor e comparação (BR-MKT-33/35).
import { describe, expect, it } from "vitest";
import { compareProfessionals, validateCompareIds } from "./compare.js";
import type { FactsOffer, ProfessionalFacts } from "./facts.js";
import { decodeCursor, encodeCursor, matchProfessional, paginate, searchProfessionals, sortHits } from "./filters.js";
import { rankProfessionals, type RankingInput } from "./ranking.js";

const NOW = Date.UTC(2026, 10, 17, 10, 0);
const DAY = 86_400_000;
const SPEC = "11111111-1111-4111-8111-111111111111";
const OTHER_SPEC = "22222222-2222-4222-8222-222222222222";

function offer(id: string, extra: Partial<FactsOffer> = {}): FactsOffer {
  return { id, specialtyId: SPEC, method: "IN_PERSON", durationMinutes: 30, priceKz: 5000, note: null, ...extra };
}

function pro(id: string, offers: FactsOffer[], extra: Partial<ProfessionalFacts> = {}, slots: Record<string, number | null> = {}): ProfessionalFacts {
  return {
    id,
    displayName: `Dra. ${id}`,
    city: "Luanda",
    bio: null,
    approvedAt: new Date(NOW - 100 * DAY),
    specialties: [
      { id: SPEC, name: "Cardiologia", category: "HEALTH" },
      { id: OTHER_SPEC, name: "Yoga", category: "WELLNESS" },
    ],
    offers,
    slotStats: Object.entries(slots).map(([offerId, days]) => ({ offerId, nextSlotAt: days === null ? null : new Date(NOW + days * DAY), countNext14Days: days === null ? 0 : 1 })),
    ...extra,
  };
}

describe("filtros: todos aplicados à MESMA oferta ativa (TC-MKT-39)", () => {
  const video = offer("o-video", { method: "VIDEO", priceKz: 9000 });
  const presencial = offer("o-pres", { method: "IN_PERSON", priceKz: 2000 });
  const p = pro("p1", [video, presencial]);

  it("vídeo + preço máximo barato não devolve o profissional (vídeo é caro, o barato é presencial)", () => {
    expect(matchProfessional(p, { method: "VIDEO", maxPriceKz: 3000 }, NOW)).toBeNull();
  });

  it("matchingOffers só tem ofertas que cumprem TODOS os filtros e fromPriceKz é o mínimo delas", () => {
    const hit = matchProfessional(p, { maxPriceKz: 10000, minPriceKz: 1000 }, NOW);
    expect(hit?.matchingOffers.map((o) => o.id)).toEqual(["o-pres", "o-video"]);
    expect(hit?.fromPriceKz).toBe(2000);
    expect(matchProfessional(p, { method: "VIDEO" }, NOW)?.fromPriceKz).toBe(9000);
    expect(matchProfessional(p, { method: "VIDEO" }, NOW)?.matchingOffers).toEqual([video]);
  });

  it("sem oferta ativa correspondente ⇒ ausente; sem ofertas ⇒ ausente", () => {
    expect(matchProfessional(p, { method: "CHAT" }, NOW)).toBeNull();
    expect(matchProfessional(pro("p2", []), {}, NOW)).toBeNull();
  });

  it("especialidade e categoria aplicam-se à mesma oferta (oferta de outra especialidade não conta)", () => {
    const mix = pro("p3", [offer("a", { priceKz: 1000 }), offer("b", { specialtyId: OTHER_SPEC, method: "VIDEO", priceKz: 8000 })]);
    expect(matchProfessional(mix, { specialtyId: SPEC, method: "VIDEO" }, NOW)).toBeNull();
    expect(matchProfessional(mix, { category: "WELLNESS", maxPriceKz: 2000 }, NOW)).toBeNull();
    expect(matchProfessional(mix, { category: "WELLNESS" }, NOW)?.matchingOffers.map((o) => o.id)).toEqual(["b"]);
    expect(matchProfessional(mix, { specialtyId: SPEC }, NOW)?.fromPriceKz).toBe(1000);
  });

  it("availableWithinDays olha para a mesma oferta: horário de outra oferta não serve", () => {
    const barata = offer("barata", { priceKz: 1000 });
    const cara = offer("cara", { priceKz: 9000, method: "VIDEO" });
    const q = pro("p4", [barata, cara], {}, { barata: 30, cara: 2 });
    expect(matchProfessional(q, { maxPriceKz: 1500, availableWithinDays: 7 }, NOW)).toBeNull();
    expect(matchProfessional(q, { availableWithinDays: 7 }, NOW)?.matchingOffers.map((o) => o.id)).toEqual(["cara"]);
    expect(matchProfessional(q, { availableWithinDays: 7 }, NOW)?.nextAvailableAt).toEqual(new Date(NOW + 2 * DAY));
    expect(matchProfessional(q, { availableWithinDays: 30 }, NOW)?.matchingOffers).toHaveLength(2);
  });

  it("availableWithinDays: fronteira (agora, agora + d dias] e horários passados/sem estatística não contam", () => {
    const o = offer("o");
    expect(matchProfessional(pro("a", [o], {}, { o: 7 }), { availableWithinDays: 7 }, NOW)).not.toBeNull();
    expect(matchProfessional(pro("a", [o], {}, { o: 7.0001 }), { availableWithinDays: 7 }, NOW)).toBeNull();
    expect(matchProfessional(pro("a", [o], {}, { o: 0 }), { availableWithinDays: 7 }, NOW)).toBeNull(); // exatamente agora: não é futuro
    expect(matchProfessional(pro("a", [o], {}, { o: -1 }), { availableWithinDays: 7 }, NOW)).toBeNull();
    expect(matchProfessional(pro("a", [o], {}, { o: null }), { availableWithinDays: 7 }, NOW)).toBeNull();
    expect(matchProfessional(pro("a", [o]), { availableWithinDays: 7 }, NOW)).toBeNull();
  });

  it("nextAvailableAt é nulo sem horários e é o primeiro entre as ofertas correspondentes", () => {
    expect(matchProfessional(pro("a", [offer("o")]), {}, NOW)?.nextAvailableAt).toBeNull();
    const q = pro("b", [offer("x"), offer("y", { method: "CHAT" })], {}, { x: 5, y: 3 });
    expect(matchProfessional(q, {}, NOW)?.nextAvailableAt).toEqual(new Date(NOW + 3 * DAY));
    expect(matchProfessional(q, { method: "IN_PERSON" }, NOW)?.nextAvailableAt).toEqual(new Date(NOW + 5 * DAY));
  });

  it("cidade: igualdade sem distinção de maiúsculas e espaços laterais; nome: contém, sem maiúsculas", () => {
    const q = pro("a", [offer("o")], { city: "Luanda", displayName: "Dra. Ana Silva" });
    expect(matchProfessional(q, { city: "  luanda " }, NOW)).not.toBeNull();
    expect(matchProfessional(q, { city: "Luand" }, NOW)).toBeNull();
    expect(matchProfessional(q, { q: "ANA sil" }, NOW)).not.toBeNull();
    expect(matchProfessional(q, { q: "joao" }, NOW)).toBeNull();
  });

  it("os filtros não mudam a pontuação do ranking (a coorte é a da especialidade)", () => {
    const cohort = [pro("a", [offer("a1", { priceKz: 1000 })], { city: "Luanda" }), pro("b", [offer("b1", { priceKz: 2000 })], { city: "Huambo" }), pro("c", [offer("c1", { priceKz: 3000 })], { city: "Luanda" })];
    const inputs: RankingInput[] = cohort.map((f) => ({ professionalId: f.id, bioLength: 0, approvedAtMs: f.approvedAt.getTime(), offers: f.offers.map((o) => ({ method: o.method, priceKz: o.priceKz, hasNote: false, slotsNext14Days: 0 })) }));
    const ranked = rankProfessionals(inputs, NOW);
    const map = new Map(ranked.map((r) => [r.professionalId, r]));
    const hits = searchProfessionals(cohort, { specialtyId: SPEC, city: "Luanda" }, NOW);
    expect(hits.map((h) => h.facts.id)).toEqual(["a", "c"]);
    for (const s of sortHits(hits, "RANKING", map)) expect(s.ranking?.score).toBe(map.get(s.hit.facts.id)?.score);
  });
});

describe("ordenação, cursor e paginação", () => {
  const cohort = [
    pro("c", [offer("c1", { priceKz: 3000 })], {}, { c1: 1 }),
    pro("a", [offer("a1", { priceKz: 1000 })], {}, { a1: 5 }),
    pro("b", [offer("b1", { priceKz: 1000 })], {}, { b1: null }),
    pro("d", [offer("d1", { priceKz: 2000 })], {}, { d1: 5 }),
  ];
  const hits = searchProfessionals(cohort, {}, NOW);
  const ids = (sorted: ReturnType<typeof sortHits>) => sorted.map((s) => s.hit.facts.id);

  it("PRICE_ASC/PRICE_DESC com desempate por id", () => {
    expect(ids(sortHits(hits, "PRICE_ASC"))).toEqual(["a", "b", "d", "c"]);
    expect(ids(sortHits(hits, "PRICE_DESC"))).toEqual(["c", "d", "a", "b"]);
  });

  it("NEXT_AVAILABLE: mais cedo primeiro, nulos no fim, desempate por id", () => {
    expect(ids(sortHits(hits, "NEXT_AVAILABLE"))).toEqual(["c", "a", "d", "b"]);
  });

  it("RANKING exige a explicação; sem ela lança", () => {
    expect(() => sortHits(hits, "RANKING")).toThrow();
  });

  it("paginação por cursor percorre tudo sem repetir nem saltar, para cada ordenação", () => {
    for (const sort of ["PRICE_ASC", "PRICE_DESC", "NEXT_AVAILABLE"] as const) {
      const sorted = sortHits(hits, sort);
      const seen: string[] = [];
      let cursor = null as ReturnType<typeof decodeCursor>;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = paginate(sorted, sort, 3, cursor);
        seen.push(...page.items.map((i) => i.hit.facts.id));
        if (!page.nextCursor) break;
        cursor = decodeCursor(encodeCursor(page.nextCursor), sort);
        expect(cursor).not.toBeNull();
      }
      expect(seen).toEqual(ids(sorted));
    }
  });

  it("o cursor é estável se a coorte mudar: continua depois da posição, sem repetir", () => {
    const sorted = sortHits(hits, "PRICE_ASC");
    const first = paginate(sorted, "PRICE_ASC", 2, null);
    const cursor = decodeCursor(encodeCursor(first.nextCursor ?? { sort: "PRICE_ASC", key: { k: [0], id: "" } }), "PRICE_ASC");
    const semB = sortHits(searchProfessionals(cohort.filter((f) => f.id !== "a"), {}, NOW), "PRICE_ASC");
    expect(ids(sortHits(hits, "PRICE_ASC")).slice(0, 2)).toEqual(["a", "b"]);
    expect(ids(semB)).toEqual(["b", "d", "c"]);
    expect(paginate(semB, "PRICE_ASC", 5, cursor).items.map((i) => i.hit.facts.id)).toEqual(["d", "c"]);
  });

  it("cursores inválidos ou de outra ordenação ⇒ null", () => {
    const valid = encodeCursor({ sort: "PRICE_ASC", key: { k: [1000], id: "a" } });
    expect(decodeCursor(valid, "PRICE_ASC")).toEqual({ sort: "PRICE_ASC", key: { k: [1000], id: "a" } });
    expect(decodeCursor(valid, "PRICE_DESC")).toBeNull();
    for (const bad of ["", "%%%", "e30", Buffer.from("[1]").toString("base64url"), Buffer.from('{"s":"X","k":[1],"i":"a"}').toString("base64url"), Buffer.from('{"s":"PRICE_ASC","k":"1","i":"a"}').toString("base64url"), Buffer.from('{"s":"PRICE_ASC","k":[1],"i":""}').toString("base64url")]) {
      expect(decodeCursor(bad, "PRICE_ASC")).toBeNull();
    }
  });

  it("última página não tem nextCursor", () => {
    const sorted = sortHits(hits, "PRICE_ASC");
    expect(paginate(sorted, "PRICE_ASC", 4, null).nextCursor).toBeNull();
    expect(paginate(sorted, "PRICE_ASC", 3, null).nextCursor).not.toBeNull();
  });
});

describe("comparação de 2 a 3 profissionais (BR-MKT-35)", () => {
  const a = pro("a", [offer("a1", { priceKz: 4000 }), offer("a2", { method: "VIDEO", priceKz: 3000 })], {}, { a1: 4, a2: 6 });
  const b = pro("b", [offer("b1", { priceKz: 4000 }), offer("b2", { method: "VIDEO", priceKz: 5000 }), offer("bx", { specialtyId: OTHER_SPEC, priceKz: 1 })]);
  const c = pro("c", [offer("c1", { method: "CHAT", priceKz: 1000 })], {}, { c1: 2 });

  it("ids: 2–3 e sem repetidos", () => {
    expect(validateCompareIds(["a"])).toBe("COUNT");
    expect(validateCompareIds(["a", "b", "c", "d"])).toBe("COUNT");
    expect(validateCompareIds(["a", "a"])).toBe("DUPLICATE");
    expect(validateCompareIds(["a", "b"])).toBeNull();
    expect(validateCompareIds(["a", "b", "c"])).toBeNull();
  });

  it("itens com ofertas só da especialidade, por método/duração; fromPriceKz e nextAvailableAt", () => {
    const r = compareProfessionals([a, b], SPEC, NOW);
    if (!r.ok) throw new Error("esperava ok");
    expect(r.comparison.specialtyId).toBe(SPEC);
    expect(r.comparison.items.map((i) => i.professionalId)).toEqual(["a", "b"]);
    expect(r.comparison.items[1]?.offers.map((o) => o.id)).toEqual(["b1", "b2"]);
    expect(r.comparison.items[0]).toMatchObject({ fromPriceKz: 3000, nextAvailableAt: new Date(NOW + 4 * DAY) });
    expect(r.comparison.items[1]?.nextAvailableAt).toBeNull();
  });

  it("resumo por método: mínimo, máximo e TODOS os mais baratos (empates incluídos)", () => {
    const r = compareProfessionals([a, b, c], SPEC, NOW);
    if (!r.ok) throw new Error("esperava ok");
    expect(r.comparison.priceSummary).toEqual([
      { method: "IN_PERSON", minPriceKz: 4000, maxPriceKz: 4000, cheapestProfessionalIds: ["a", "b"] },
      { method: "VIDEO", minPriceKz: 3000, maxPriceKz: 5000, cheapestProfessionalIds: ["a"] },
      { method: "CHAT", minPriceKz: 1000, maxPriceKz: 1000, cheapestProfessionalIds: ["c"] },
    ]);
  });

  it("profissional sem oferta ativa na especialidade ⇒ NO_OFFER (com o id); contagem/duplicados ⇒ erros de ids", () => {
    expect(compareProfessionals([a, pro("z", [offer("z1", { specialtyId: OTHER_SPEC })])], SPEC, NOW)).toEqual({ ok: false, error: "NO_OFFER", professionalId: "z" });
    expect(compareProfessionals([a], SPEC, NOW)).toEqual({ ok: false, error: "COUNT" });
    expect(compareProfessionals([a, a], SPEC, NOW)).toEqual({ ok: false, error: "DUPLICATE" });
  });

  it("não inclui pontuação do ranking nem contactos", () => {
    const r = compareProfessionals([a, b], SPEC, NOW);
    if (!r.ok) throw new Error("esperava ok");
    const json = JSON.stringify(r.comparison);
    for (const k of ["score", "signals", "reasons", "email", "paymentInstructions", "bio"]) expect(json).not.toContain(`"${k}"`);
  });
});
