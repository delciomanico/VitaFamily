// Casos de uso da descoberta (UC-MKT-13..16): pesquisa, perfil público, comparação e filtros. Só leitura, sem auditoria, sem registo de
// pesquisas (BR-MKT-32/46): NADA do pedido (q, city, ids…) é guardado nem enviado ao logger. Tudo em memória sobre os factos da coorte.
import { DomainError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { compareProfessionals as compareDomain, validateCompareIds } from "../domain/compare.js";
import { METHOD_ORDER, type ProfessionalFacts, type SpecialtyCategoryCode } from "../domain/facts.js";
import { decodeCursor, encodeCursor, normalizeText, paginate, searchProfessionals as searchDomain, sortHits, type SearchCriteria, type SearchSort } from "../domain/filters.js";
import { rankProfessionals, type OfferMethodCode, type RankingInput, type RankingResult } from "../domain/ranking.js";
import type { DiscoveryDeps, ProfessionalCatalogQuery } from "./ports.js";
import { getRankingRules } from "./rules.js";
import { offerView, rankingView, specialtyView, type OfferView, type RankingView, type SpecialtyView } from "./views.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const Q_MIN = 2;
const Q_MAX = 60;

export interface SearchInput extends SearchCriteria {
  sort?: SearchSort;
  limit?: number;
  cursor?: string;
}

export interface ProfessionalItemView {
  id: string;
  displayName: string;
  city: string;
  specialties: SpecialtyView[];
  matchingOffers: OfferView[];
  fromPriceKz: number;
  nextAvailableAt: Date | null;
  ranking: RankingView | null;
}

export interface ProfessionalProfileView {
  id: string;
  displayName: string;
  bio: string | null;
  city: string;
  specialties: SpecialtyView[];
  offers: OfferView[];
  nextAvailableAt: Date | null;
  /** `AAAA-MM-01` (primeiro dia do mês da primeira aprovação). */
  memberSince: string;
  ranking: RankingView | null;
}

/** Entrada do ranking de um profissional NA especialidade (só os campos permitidos de BR-MKT-37). */
export function toRankingInput(facts: ProfessionalFacts, specialtyId: string): RankingInput {
  return {
    professionalId: facts.id,
    bioLength: (facts.bio ?? "").trim().length,
    approvedAtMs: facts.approvedAt.getTime(),
    offers: facts.offers
      .filter((o) => o.specialtyId === specialtyId)
      .map((o) => ({
        method: o.method,
        priceKz: o.priceKz,
        hasNote: o.note !== null && o.note.trim().length > 0,
        slotsNext14Days: facts.slotStats.find((s) => s.offerId === o.id)?.countNext14Days ?? 0,
      })),
  };
}

function nextAvailable(facts: ProfessionalFacts, nowMs: number): Date | null {
  const times = facts.slotStats.map((s) => s.nextSlotAt).filter((d): d is Date => d !== null && d.getTime() > nowMs);
  return times.length === 0 ? null : new Date(Math.min(...times.map((d) => d.getTime())));
}

function validationError(field: string, message: string): ValidationError {
  return new ValidationError([{ field, message }], { detail: "Pedido inválido." });
}

export function createDiscoveryUseCases(deps: DiscoveryDeps) {
  const { catalog, clock } = deps;

  function rankingsOf(specialtyId: string, cohort: readonly ProfessionalFacts[], nowMs: number): Map<string, RankingResult> {
    return new Map(rankProfessionals(cohort.map((f) => toRankingInput(f, specialtyId)), nowMs).map((r) => [r.professionalId, r]));
  }

  return {
    /** UC-MKT-13: pesquisa com filtros de oferta na MESMA oferta, ordenação e cursor. */
    async searchProfessionals(input: SearchInput): Promise<{ items: ProfessionalItemView[]; nextCursor: string | null }> {
      const q = input.q?.trim();
      if (input.q !== undefined && (q === undefined || Array.from(q).length < Q_MIN || Array.from(q).length > Q_MAX)) throw validationError("q", "tem de ter entre 2 e 60 caracteres");
      if (input.minPriceKz !== undefined && input.maxPriceKz !== undefined && input.minPriceKz > input.maxPriceKz) throw validationError("minPriceKz", "não pode ser maior do que maxPriceKz");
      const sort: SearchSort = input.sort ?? (input.specialtyId ? "RANKING" : "NEXT_AVAILABLE");
      if (sort === "RANKING" && !input.specialtyId) throw validationError("sort", "RANKING exige specialtyId");
      const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      let cursor = null;
      if (input.cursor !== undefined) {
        cursor = decodeCursor(input.cursor, sort);
        if (!cursor) throw new DomainError("MALFORMED_REQUEST", { detail: "Cursor inválido." });
      }

      const now = clock.now();
      const nowMs = now.getTime();
      // Com especialidade a coorte é a da especialidade INTEIRA (o ranking não depende dos filtros do pedido, BR-MKT-36).
      const query: ProfessionalCatalogQuery = input.specialtyId ? { specialtyId: input.specialtyId } : input.category ? { category: input.category } : {};
      const cohort = await catalog.listApprovedFacts(query);
      const criteria: SearchCriteria = {
        ...(q !== undefined ? { q } : {}),
        ...(input.specialtyId !== undefined ? { specialtyId: input.specialtyId } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.method !== undefined ? { method: input.method } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.minPriceKz !== undefined ? { minPriceKz: input.minPriceKz } : {}),
        ...(input.maxPriceKz !== undefined ? { maxPriceKz: input.maxPriceKz } : {}),
        ...(input.availableWithinDays !== undefined ? { availableWithinDays: input.availableWithinDays } : {}),
      };
      const hits = searchDomain(cohort, criteria, nowMs);
      const rankings = input.specialtyId ? rankingsOf(input.specialtyId, cohort, nowMs) : new Map<string, RankingResult>();
      const page = paginate(sortHits(hits, sort, rankings), sort, limit, cursor);
      return {
        items: page.items.map(({ hit, ranking }) => ({
          id: hit.facts.id,
          displayName: hit.facts.displayName,
          city: hit.facts.city,
          specialties: hit.facts.specialties.map(specialtyView),
          matchingOffers: hit.matchingOffers.map(offerView),
          fromPriceKz: hit.fromPriceKz,
          nextAvailableAt: hit.nextAvailableAt,
          ranking: ranking ? rankingView(ranking) : null,
        })),
        nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      };
    },

    /** UC-MKT-14: perfil público; inexistente ou não `APPROVED` ⇒ `NOT_FOUND` (sem oráculo). */
    async getProfessionalProfile(professionalId: string, specialtyId?: string): Promise<ProfessionalProfileView> {
      const [facts] = await catalog.getApprovedFacts([professionalId]);
      if (facts?.id !== professionalId) throw new NotFoundError();
      const nowMs = clock.now().getTime();
      let ranking: RankingView | null = null;
      if (specialtyId !== undefined && facts.specialties.some((s) => s.id === specialtyId)) {
        const cohort = await catalog.listApprovedFacts({ specialtyId });
        const mine = rankingsOf(specialtyId, cohort, nowMs).get(professionalId);
        ranking = mine ? rankingView(mine) : null;
      }
      return {
        id: facts.id,
        displayName: facts.displayName,
        bio: facts.bio,
        city: facts.city,
        specialties: facts.specialties.map(specialtyView),
        offers: [...facts.offers].sort((a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method) || a.durationMinutes - b.durationMinutes || a.priceKz - b.priceKz || (a.id < b.id ? -1 : 1)).map(offerView),
        nextAvailableAt: nextAvailable(facts, nowMs),
        memberSince: `${String(facts.approvedAt.getUTCFullYear())}-${String(facts.approvedAt.getUTCMonth() + 1).padStart(2, "0")}-01`,
        ranking,
      };
    },

    /** UC-MKT-15: 2–3 ids distintos; qualquer id ausente/não `APPROVED` ⇒ `NOT_FOUND` do pedido inteiro; sem oferta na especialidade ⇒ 422. */
    async compareProfessionals(ids: readonly string[], specialtyId: string) {
      const idsError = validateCompareIds(ids);
      if (idsError) throw validationError("ids", idsError === "COUNT" ? "indique 2 a 3 profissionais" : "os profissionais têm de ser distintos");
      const found = await catalog.getApprovedFacts(ids);
      const byId = new Map(found.map((f) => [f.id, f]));
      const ordered = ids.map((id) => byId.get(id));
      if (ordered.some((f) => f === undefined)) throw new NotFoundError();
      const result = compareDomain(ordered as ProfessionalFacts[], specialtyId, clock.now().getTime());
      if (!result.ok) throw validationError("ids", "todos os profissionais precisam de uma oferta ativa na especialidade");
      const { comparison } = result;
      return {
        specialtyId: comparison.specialtyId,
        items: comparison.items.map((i) => ({ professionalId: i.professionalId, displayName: i.displayName, city: i.city, offers: i.offers.map(offerView), fromPriceKz: i.fromPriceKz, nextAvailableAt: i.nextAvailableAt })),
        priceSummary: comparison.priceSummary.map((p) => ({ method: p.method, minPriceKz: p.minPriceKz, maxPriceKz: p.maxPriceKz, cheapestProfessionalIds: [...p.cheapestProfessionalIds] })),
      };
    },

    /** UC-MKT-13 (filtros): especialidades ativas e cidades com ≥ 1 `APPROVED` com oferta ativa, com contagens; métodos existentes. */
    async getFilters() {
      const cohort = (await catalog.listApprovedFacts({})).filter((f) => f.offers.length > 0);
      const specialties = new Map<string, { id: string; name: string; category: SpecialtyCategoryCode; professionalCount: number }>();
      const cities = new Map<string, { spellings: Map<string, number>; professionalCount: number }>();
      const methods = new Set<OfferMethodCode>();
      for (const f of cohort) {
        for (const o of f.offers) methods.add(o.method);
        for (const specialtyId of new Set(f.offers.map((o) => o.specialtyId))) {
          const s = f.specialties.find((x) => x.id === specialtyId);
          if (!s || s.active === false) continue;
          const entry = specialties.get(s.id) ?? { id: s.id, name: s.name, category: s.category, professionalCount: 0 };
          entry.professionalCount += 1;
          specialties.set(s.id, entry);
        }
        const key = normalizeText(f.city);
        if (key.length === 0) continue;
        const entry = cities.get(key) ?? { spellings: new Map<string, number>(), professionalCount: 0 };
        const spelling = f.city.trim();
        entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? 0) + 1);
        entry.professionalCount += 1;
        cities.set(key, entry);
      }
      return {
        specialties: [...specialties.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-PT") || (a.id < b.id ? -1 : 1)),
        cities: [...cities.values()]
          .map((c) => ({ name: [...c.spellings.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "", professionalCount: c.professionalCount }))
          .sort((a, b) => b.professionalCount - a.professionalCount || a.name.localeCompare(b.name, "pt-PT")),
        methods: METHOD_ORDER.filter((m) => methods.has(m)),
      };
    },

    /** UC-MKT-16: texto estático versionado. */
    getRankingRules,
  };
}

export type DiscoveryUseCases = ReturnType<typeof createDiscoveryUseCases>;
