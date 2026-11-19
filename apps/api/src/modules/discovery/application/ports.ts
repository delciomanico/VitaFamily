// Portas da `application` de `discovery` (ADR-016; modules.md nota 36(a)). `ProfessionalCatalog` é a ÚNICA forma de `discovery` ler
// profissionais: ligada em `main/api.ts` à raiz `ProfessionalDirectory` (só `APPROVED`, só dados públicos, lido em cada chamada, BR-MKT-19/32).
// `discovery` não importa `professionals`; o adaptador é estrutural.
import type { ProfessionalFacts, SpecialtyCategoryCode } from "../domain/facts.js";

export interface ProfessionalCatalogQuery {
  specialtyId?: string;
  category?: SpecialtyCategoryCode;
}

export interface ProfessionalCatalog {
  /** Coorte `APPROVED` (opcionalmente de uma especialidade/categoria), por id, com o teto técnico da fonte (BR-MKT-49). */
  listApprovedFacts(query: ProfessionalCatalogQuery): Promise<ProfessionalFacts[]>;
  /** Só os ids `APPROVED` (ausentes/não aprovados omitidos). */
  getApprovedFacts(ids: readonly string[]): Promise<ProfessionalFacts[]>;
}

/** Agregação de avaliações verificadas de um profissional (BR-MKT-61): sem textos, sem ids de família. `sum` é a soma das notas 1–5. */
export interface ReviewAggregate {
  professionalId: string;
  count: number;
  sum: number;
}

/** Porta das avaliações (implementada por `consultations` na S10; calculada no pedido). Ausentes = sem avaliações. */
export interface ReviewStats {
  /** Agregação por profissional das avaliações das marcações de ofertas da especialidade (toda a coorte). */
  forSpecialty(specialtyId: string): Promise<ReviewAggregate[]>;
  /** Agregação total (todas as especialidades) dos profissionais indicados, para `reviewSummary`. */
  forProfessionals(professionalIds: readonly string[]): Promise<ReviewAggregate[]>;
}

/** Enquanto `consultations` não liga a porta: sem avaliações (sinal neutro 0,5, «Novo», `reviewSummary` a zero). */
export const EMPTY_REVIEW_STATS: ReviewStats = {
  forSpecialty: () => Promise.resolve([]),
  forProfessionals: () => Promise.resolve([]),
};

export interface DiscoveryClock {
  now(): Date;
}

export interface DiscoveryDeps {
  catalog: ProfessionalCatalog;
  clock: DiscoveryClock;
  /** Opcional até à S10 (sem ela, `EMPTY_REVIEW_STATS`). */
  reviewStats?: ReviewStats;
}
