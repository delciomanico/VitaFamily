// Filtros, ordenações e cursor da pesquisa (BR-MKT-33). Tudo em memória sobre os factos da coorte (teto 1000, BR-MKT-49). Os filtros de
// OFERTA (especialidade, categoria, método, preço, disponibilidade) aplicam-se à MESMA oferta ativa: o profissional só aparece se existir
// uma oferta que cumpra todos em conjunto (nunca «tem vídeo» numa oferta e «é barato» noutra). `city` e `q` filtram o profissional.
import { compareOffers, type FactsOffer, type ProfessionalFacts, type SpecialtyCategoryCode } from "./facts.js";
import type { OfferMethodCode, RankingResult } from "./ranking.js";

export type SearchSort = "RANKING" | "PRICE_ASC" | "PRICE_DESC" | "NEXT_AVAILABLE";

export interface SearchCriteria {
  /** 2–60 caracteres (validado na application); parte do nome, sem distinção de maiúsculas. */
  q?: string;
  specialtyId?: string;
  category?: SpecialtyCategoryCode;
  method?: OfferMethodCode;
  /** Igualdade sem distinção de maiúsculas e espaços laterais. */
  city?: string;
  minPriceKz?: number;
  maxPriceKz?: number;
  /** 1–56: a oferta tem um horário futuro em `(agora, agora + d dias]`. */
  availableWithinDays?: number;
}

export interface SearchHit {
  facts: ProfessionalFacts;
  /** Ofertas que cumprem TODOS os filtros de oferta (nunca vazio). */
  matchingOffers: FactsOffer[];
  /** Menor preço entre as ofertas que correspondem. */
  fromPriceKz: number;
  /** Primeiro horário futuro entre as ofertas correspondentes. */
  nextAvailableAt: Date | null;
}

const DAY_MS = 86_400_000;

export function normalizeText(text: string): string {
  return text.trim().toLocaleLowerCase("pt-PT");
}

function nextSlotOf(facts: ProfessionalFacts, offerId: string, nowMs: number): Date | null {
  const stat = facts.slotStats.find((s) => s.offerId === offerId);
  return stat?.nextSlotAt && stat.nextSlotAt.getTime() > nowMs ? stat.nextSlotAt : null;
}

/** A oferta cumpre todos os filtros de oferta em conjunto. */
export function offerMatches(facts: ProfessionalFacts, offer: FactsOffer, criteria: SearchCriteria, nowMs: number): boolean {
  if (criteria.specialtyId !== undefined && offer.specialtyId !== criteria.specialtyId) return false;
  if (criteria.category !== undefined) {
    const specialty = facts.specialties.find((s) => s.id === offer.specialtyId);
    if (specialty?.category !== criteria.category) return false;
  }
  if (criteria.method !== undefined && offer.method !== criteria.method) return false;
  if (criteria.minPriceKz !== undefined && offer.priceKz < criteria.minPriceKz) return false;
  if (criteria.maxPriceKz !== undefined && offer.priceKz > criteria.maxPriceKz) return false;
  if (criteria.availableWithinDays !== undefined) {
    const next = nextSlotOf(facts, offer.id, nowMs);
    if (next === null || next.getTime() > nowMs + criteria.availableWithinDays * DAY_MS) return false;
  }
  return true;
}

/** Aplica os filtros a um profissional; `null` se não aparece (filtro de profissional falha ou nenhuma oferta cumpre tudo). */
export function matchProfessional(facts: ProfessionalFacts, criteria: SearchCriteria, nowMs: number): SearchHit | null {
  if (criteria.city !== undefined && normalizeText(facts.city) !== normalizeText(criteria.city)) return null;
  if (criteria.q !== undefined && !normalizeText(facts.displayName).includes(normalizeText(criteria.q))) return null;
  const matchingOffers = facts.offers.filter((o) => offerMatches(facts, o, criteria, nowMs)).sort(compareOffers);
  if (matchingOffers.length === 0) return null;
  const nextTimes = matchingOffers.map((o) => nextSlotOf(facts, o.id, nowMs)).filter((d): d is Date => d !== null);
  return {
    facts,
    matchingOffers,
    fromPriceKz: Math.min(...matchingOffers.map((o) => o.priceKz)),
    nextAvailableAt: nextTimes.length === 0 ? null : new Date(Math.min(...nextTimes.map((d) => d.getTime()))),
  };
}

export function searchProfessionals(cohort: readonly ProfessionalFacts[], criteria: SearchCriteria, nowMs: number): SearchHit[] {
  return cohort.flatMap((facts) => {
    const hit = matchProfessional(facts, criteria, nowMs);
    return hit ? [hit] : [];
  });
}

// ------------------------------------------------------------------ ordenação e cursor

/** Chave de ordenação (tuplo de números; `null` = «no fim») + id para desempate total. */
export interface SortKey {
  k: (number | null)[];
  id: string;
}

/** Chave de um resultado para um `sort`; `RANKING` exige a explicação do ranking do profissional. */
export function sortKeyOf(sort: SearchSort, hit: SearchHit, ranking: RankingResult | undefined): SortKey {
  const id = hit.facts.id;
  switch (sort) {
    case "PRICE_ASC":
      return { k: [hit.fromPriceKz], id };
    case "PRICE_DESC":
      return { k: [-hit.fromPriceKz], id };
    case "NEXT_AVAILABLE":
      return { k: [hit.nextAvailableAt ? hit.nextAvailableAt.getTime() : null], id };
    case "RANKING": {
      if (!ranking) throw new Error("RANKING exige a explicação do ranking do profissional");
      return { k: [-ranking.score, -ranking.signals.availability, ranking.approvedAtMs], id };
    }
  }
}

export function compareSortKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < Math.max(a.k.length, b.k.length); i += 1) {
    const x = a.k[i] ?? null;
    const y = b.k[i] ?? null;
    if (x === y) continue;
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface SortedHit {
  hit: SearchHit;
  key: SortKey;
  ranking?: RankingResult;
}

/** Ordena (total e determinístico). `rankings` indexa por id (só obrigatório com `RANKING`). */
export function sortHits(hits: readonly SearchHit[], sort: SearchSort, rankings: ReadonlyMap<string, RankingResult> = new Map()): SortedHit[] {
  return hits
    .map((hit): SortedHit => {
      const ranking = rankings.get(hit.facts.id);
      return { hit, key: sortKeyOf(sort, hit, ranking), ...(ranking ? { ranking } : {}) };
    })
    .sort((a, b) => compareSortKeys(a.key, b.key));
}

export interface Cursor {
  sort: SearchSort;
  key: SortKey;
}

const SORTS: readonly SearchSort[] = ["RANKING", "PRICE_ASC", "PRICE_DESC", "NEXT_AVAILABLE"];

/** Cursor opaco (base64url de JSON). */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ s: cursor.sort, k: cursor.key.k, i: cursor.key.id }), "utf8").toString("base64url");
}

/** `null` se o cursor é inválido ou foi emitido para outra ordenação (a application devolve `400 MALFORMED_REQUEST`). */
export function decodeCursor(raw: string, expectedSort: SearchSort): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { s, k, i } = parsed as { s?: unknown; k?: unknown; i?: unknown };
    if (typeof s !== "string" || !SORTS.includes(s as SearchSort) || s !== expectedSort) return null;
    if (typeof i !== "string" || i.length === 0 || i.length > 64) return null;
    if (!Array.isArray(k) || k.length === 0 || k.length > 3 || !k.every((x) => x === null || (typeof x === "number" && Number.isFinite(x)))) return null;
    return { sort: s, key: { k: k as (number | null)[], id: i } };
  } catch {
    return null;
  }
}

/** Página por *keyset*: os `limit` resultados estritamente depois do cursor (estável mesmo que a coorte mude entre pedidos). */
export function paginate(sorted: readonly SortedHit[], sort: SearchSort, limit: number, cursor: Cursor | null): { items: SortedHit[]; nextCursor: Cursor | null } {
  const after = cursor ? sorted.filter((s) => compareSortKeys(s.key, cursor.key) > 0) : sorted;
  const items = after.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: after.length > limit && last ? { sort, key: last.key } : null };
}
