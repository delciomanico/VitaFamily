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

export interface DiscoveryClock {
  now(): Date;
}

export interface DiscoveryDeps {
  catalog: ProfessionalCatalog;
  clock: DiscoveryClock;
}
