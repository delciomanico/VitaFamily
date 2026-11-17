// Casos de uso da descoberta (UC-MKT-13..15 e filtros) sobre um catálogo falso em memória e um relógio fixo. Sem BD, sem rede.
import { describe, expect, it } from "vitest";
import { DomainError, NotFoundError } from "../../../platform/errors/index.js";
import type { FactsOffer, ProfessionalFacts } from "../domain/facts.js";
import type { OfferMethodCode } from "../domain/ranking.js";
import { createDiscoveryUseCases } from "./discovery.js";
import type { ProfessionalCatalog, ProfessionalCatalogQuery } from "./ports.js";

const NOW = Date.UTC(2026, 10, 17, 10, 0);
const DAY = 86_400_000;
const SPEC = "11111111-1111-4111-8111-111111111111";
const OTHER_SPEC = "22222222-2222-4222-8222-222222222222";
const INACTIVE_SPEC = "33333333-3333-4333-8333-333333333333";
const PILATES = "44444444-4444-4444-8444-444444444444";

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

/** Catálogo falso: filtra por especialidade/categoria (nas especialidades do profissional); `getApprovedFacts` devolve os ids presentes, por ordem de id. */
function fakeCatalog(list: ProfessionalFacts[]): ProfessionalCatalog {
  return {
    listApprovedFacts(query: ProfessionalCatalogQuery) {
      return Promise.resolve(
        list.filter(
          (f) =>
            (query.specialtyId === undefined || f.specialties.some((s) => s.id === query.specialtyId)) &&
            (query.category === undefined || f.specialties.some((s) => s.category === query.category)),
        ),
      );
    },
    getApprovedFacts(ids: readonly string[]) {
      return Promise.resolve(list.filter((f) => ids.includes(f.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
    },
  };
}

const clock = { now: () => new Date(NOW) };

function useCases(list: ProfessionalFacts[]) {
  return createDiscoveryUseCases({ catalog: fakeCatalog(list), clock });
}

/** N profissionais, cada um com uma oferta presencial na especialidade SPEC e preço crescente. */
function cohortOf(n: number): ProfessionalFacts[] {
  return Array.from({ length: n }, (_, i) => pro(`p${String(i + 1).padStart(2, "0")}`, [offer(`o${String(i + 1).padStart(2, "0")}`, { priceKz: 1000 * (i + 1) })]));
}

describe("getFilters (UC-MKT-13)", () => {
  it("só especialidades ativas com pelo menos um profissional com oferta ativa, com contagens corretas", async () => {
    const inactive = { id: INACTIVE_SPEC, name: "Inativa", category: "HEALTH" as const, active: false };
    const pilates = { id: PILATES, name: "Pilates", category: "WELLNESS" as const };
    const list = [
      pro("a", [offer("a1"), offer("a2", { specialtyId: OTHER_SPEC, method: "VIDEO" })], { specialties: [{ id: SPEC, name: "Cardiologia", category: "HEALTH" }, { id: OTHER_SPEC, name: "Yoga", category: "WELLNESS" }] }),
      pro("b", [offer("b1")], { specialties: [{ id: SPEC, name: "Cardiologia", category: "HEALTH" }, pilates] }),
      // Pilates aparece nas especialidades de "b" mas sem nenhuma oferta: não entra.
      pro("c",[offer("c1", { specialtyId: INACTIVE_SPEC })], { specialties: [inactive] }),
      // Oferta numa especialidade inativa: a especialidade não aparece.
      pro("d", [offer("d1", { specialtyId: OTHER_SPEC, method: "CHAT" })], { specialties: [{ id: OTHER_SPEC, name: "Yoga", category: "WELLNESS" }, inactive] }),
    ];
    const filters = await useCases(list).getFilters();
    expect(filters.specialties).toEqual([
      { id: SPEC, name: "Cardiologia", category: "HEALTH", professionalCount: 2 },
      { id: OTHER_SPEC, name: "Yoga", category: "WELLNESS", professionalCount: 2 },
    ]);
  });

  it("especialidade com ativo false fica de fora mesmo que tenha oferta ativa", async () => {
    const list = [pro("c", [offer("c1", { specialtyId: INACTIVE_SPEC })], { specialties: [{ id: INACTIVE_SPEC, name: "Inativa", category: "HEALTH", active: false }] })];
    const filters = await useCases(list).getFilters();
    expect(filters.specialties).toEqual([]);
  });

  it("cidades agrupadas sem distinção de maiúsculas e espaços, com a grafia mais frequente e a contagem", async () => {
    const list = [
      pro("l1", [offer("l1o")], { city: "Luanda" }),
      pro("l2", [offer("l2o")], { city: "luanda " }),
      pro("l3", [offer("l3o")], { city: "Luanda" }),
      pro("l4", [offer("l4o")], { city: "LUANDA" }),
      pro("b1", [offer("b1o")], { city: "BENGUELA" }),
      pro("b2", [offer("b2o")], { city: " BENGUELA " }),
      pro("b3", [offer("b3o")], { city: "Benguela" }),
    ];
    const filters = await useCases(list).getFilters();
    expect(filters.cities).toEqual([
      { name: "Luanda", professionalCount: 4 },
      { name: "BENGUELA", professionalCount: 3 },
    ]);
  });

  it("profissionais sem ofertas não contam (nem para especialidades, nem para cidades)", async () => {
    const list = [pro("sem", [], { city: "Huambo" }), pro("com", [offer("com1")], { city: "Luanda" })];
    const filters = await useCases(list).getFilters();
    expect(filters.cities).toEqual([{ name: "Luanda", professionalCount: 1 }]);
    expect(filters.specialties).toEqual([{ id: SPEC, name: "Cardiologia", category: "HEALTH", professionalCount: 1 }]);
  });

  it("métodos pela ordem IN_PERSON, VIDEO, CHAT, PHONE e só os existentes", async () => {
    const list = [
      pro("a", [offer("a1", { method: "PHONE" }), offer("a2", { method: "IN_PERSON" })]),
      pro("b", [offer("b1", { method: "CHAT" })]),
    ];
    expect((await useCases(list).getFilters()).methods).toEqual(["IN_PERSON", "CHAT", "PHONE"]);

    const todos: OfferMethodCode[] = ["PHONE", "CHAT", "VIDEO", "IN_PERSON"];
    const all = todos.map((m, i) => pro(`m${String(i)}`, [offer(`mo${String(i)}`, { method: m })]));
    expect((await useCases(all).getFilters()).methods).toEqual(["IN_PERSON", "VIDEO", "CHAT", "PHONE"]);
  });
});

describe("searchProfessionals (UC-MKT-13)", () => {
  const cohort = cohortOf(5);
  const uc = useCases(cohort);

  it("q com 1 caráter ou 61 é rejeitado com VALIDATION_ERROR", async () => {
    await expect(uc.searchProfessionals({ q: "a" })).rejects.toBeInstanceOf(DomainError);
    await expect(uc.searchProfessionals({ q: "a" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(uc.searchProfessionals({ q: "a".repeat(61) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("minPriceKz maior que maxPriceKz é VALIDATION_ERROR", async () => {
    await expect(uc.searchProfessionals({ minPriceKz: 5000, maxPriceKz: 1000 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("sort RANKING sem specialtyId é VALIDATION_ERROR", async () => {
    await expect(uc.searchProfessionals({ sort: "RANKING" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("cursor inválido é MALFORMED_REQUEST", async () => {
    await expect(uc.searchProfessionals({ cursor: "isto-nao-e-um-cursor" })).rejects.toMatchObject({ code: "MALFORMED_REQUEST" });
  });

  it("cursor emitido para outra ordenação é MALFORMED_REQUEST", async () => {
    const primeira = await uc.searchProfessionals({ limit: 2 });
    expect(primeira.nextCursor).not.toBeNull();
    // Cursor de NEXT_AVAILABLE (sem especialidade) usado com RANKING (com especialidade).
    await expect(uc.searchProfessionals({ specialtyId: SPEC, cursor: primeira.nextCursor ?? undefined })).rejects.toMatchObject({ code: "MALFORMED_REQUEST" });

    const ranking = await uc.searchProfessionals({ specialtyId: SPEC, limit: 2 });
    expect(ranking.nextCursor).not.toBeNull();
    // Cursor de RANKING usado com NEXT_AVAILABLE (sem especialidade).
    await expect(uc.searchProfessionals({ sort: "NEXT_AVAILABLE", cursor: ranking.nextCursor ?? undefined })).rejects.toMatchObject({ code: "MALFORMED_REQUEST" });
  });

  it("sem specialtyId, a omissão de sort é NEXT_AVAILABLE e ranking é null", async () => {
    const omitido = await uc.searchProfessionals({});
    const explicito = await uc.searchProfessionals({ sort: "NEXT_AVAILABLE" });
    expect(omitido).toEqual(explicito);
    for (const item of omitido.items) expect(item.ranking).toBeNull();
  });

  it("com specialtyId, a omissão de sort é RANKING e cada item traz ranking com score/signals/reasons/version/label sem approvedAtMs", async () => {
    const omitido = await uc.searchProfessionals({ specialtyId: SPEC });
    const explicito = await uc.searchProfessionals({ specialtyId: SPEC, sort: "RANKING" });
    expect(omitido).toEqual(explicito);
    expect(omitido.items.length).toBe(5);
    for (const item of omitido.items) {
      expect(item.ranking).not.toBeNull();
      for (const chave of ["score", "signals", "reasons", "version", "label"]) expect(item.ranking).toHaveProperty(chave);
      expect(typeof item.ranking?.score).toBe("number");
      expect(Array.isArray(item.ranking?.reasons)).toBe(true);
      expect(item.ranking).not.toHaveProperty("approvedAtMs");
      expect(item.ranking?.signals).not.toHaveProperty("approvedAtMs");
    }
  });

  it("paginação por cursor com limit=2 percorre todos os itens sem repetir nem perder (RANKING)", async () => {
    await expectFullPagination({ specialtyId: SPEC, limit: 2 });
  });

  it("paginação por cursor com limit=2 percorre todos os itens sem repetir nem perder (NEXT_AVAILABLE)", async () => {
    await expectFullPagination({ limit: 2 });
  });

  it("limit acima de 50 é limitado a 50", async () => {
    const grande = useCases(cohortOf(55));
    const page = await grande.searchProfessionals({ limit: 100 });
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
  });

  async function expectFullPagination(input: { specialtyId?: string; limit: number }) {
    const vistos: string[] = [];
    let cursor: string | undefined;
    for (let guarda = 0; guarda < 20; guarda += 1) {
      const page = await uc.searchProfessionals({ ...input, ...(cursor ? { cursor } : {}) });
      vistos.push(...page.items.map((i) => i.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(vistos).toHaveLength(cohort.length);
    expect(new Set(vistos).size).toBe(cohort.length);
    expect([...vistos].sort()).toEqual(cohort.map((f) => f.id).sort());
  }
});

describe("getProfessionalProfile (UC-MKT-14)", () => {
  const aprovado = pro("ana", [offer("ana-1", { priceKz: 4000 })], { approvedAt: new Date(Date.UTC(2026, 2, 15, 23, 59)) }, { "ana-1": 1 });
  const outro = pro("bruno", [offer("bruno-1", { priceKz: 2000 })], { specialties: [{ id: OTHER_SPEC, name: "Yoga", category: "WELLNESS" }] });
  const uc = useCases([aprovado, outro]);

  it("id ausente ⇒ NotFoundError com code NOT_FOUND", async () => {
    await expect(uc.getProfessionalProfile("nao-existe")).rejects.toBeInstanceOf(NotFoundError);
    await expect(uc.getProfessionalProfile("nao-existe")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("com specialtyId de especialidade que o profissional não tem ⇒ ranking null", async () => {
    const perfil = await uc.getProfessionalProfile("ana", OTHER_SPEC);
    expect(perfil.ranking).toBeNull();
  });

  it("com specialtyId de especialidade que o profissional tem ⇒ ranking presente", async () => {
    const perfil = await uc.getProfessionalProfile("ana", SPEC);
    expect(perfil.ranking).not.toBeNull();
    expect(perfil.ranking?.version).toBe("v1");
    expect(typeof perfil.ranking?.score).toBe("number");
  });

  it("sem specialtyId ⇒ ranking null", async () => {
    expect((await uc.getProfessionalProfile("ana")).ranking).toBeNull();
  });

  it("memberSince é AAAA-MM-01 do mês (UTC) da aprovação", async () => {
    expect((await uc.getProfessionalProfile("ana")).memberSince).toBe("2026-03-01");
  });

  it("o resultado não tem as chaves email, paymentInstructions nem validationStatus", async () => {
    const perfil = await uc.getProfessionalProfile("ana", SPEC);
    expect(perfil).not.toHaveProperty("email");
    expect(perfil).not.toHaveProperty("paymentInstructions");
    expect(perfil).not.toHaveProperty("validationStatus");
  });
});

describe("compareProfessionals (UC-MKT-15)", () => {
  const p1 = pro("p1", [offer("p1-o", { priceKz: 3000 })]);
  const p2 = pro("p2", [offer("p2-o", { priceKz: 1000 })]);
  const p3 = pro("p3", [offer("p3-o", { priceKz: 2000 })]);
  const semOferta = pro("p4", [offer("p4-o", { specialtyId: OTHER_SPEC, method: "VIDEO" })]);
  const uc = useCases([p1, p2, p3, semOferta]);

  it("com 1 id ou 4 ids é VALIDATION_ERROR", async () => {
    await expect(uc.compareProfessionals(["p1"], SPEC)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(uc.compareProfessionals(["p1", "p2", "p3", "p4"], SPEC)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("ids repetidos são VALIDATION_ERROR", async () => {
    await expect(uc.compareProfessionals(["p1", "p1"], SPEC)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("um id ausente ⇒ NOT_FOUND do pedido inteiro", async () => {
    await expect(uc.compareProfessionals(["p1", "nao-existe"], SPEC)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("profissional sem oferta na especialidade ⇒ VALIDATION_ERROR", async () => {
    await expect(uc.compareProfessionals(["p1", "p4"], SPEC)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("caso feliz respeita a ordem do pedido", async () => {
    const resultado = await uc.compareProfessionals(["p3", "p1"], SPEC);
    expect(resultado.items.map((i) => i.professionalId)).toEqual(["p3", "p1"]);
    expect(resultado.specialtyId).toBe(SPEC);
  });
});
