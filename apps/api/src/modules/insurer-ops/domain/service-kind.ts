// Tipo de serviço da seguradora — `service_kind` (BR-SEG-39, ADR-033). `guideType`/`expenseType` são códigos de catálogos globais
// em dados (`guide_types`, `expense_types`): nenhum `switch` sobre os literais; um tipo novo é uma linha de dados.
import { ConflictError } from "../../../platform/errors/index.js";
import { fail, requireText, requireUuid } from "./validation.js";
import type { ServiceStatus } from "./service.js";

export interface ServiceKind {
  id: string;
  insurerId: string;
  code: string;
  name: string;
  guideType: string;
  expenseType: string;
  status: ServiceStatus;
  /** Serviços da seguradora ligados a este tipo (todos os estados). */
  servicesCount: number;
}

export interface CatalogTypes {
  guideTypes: { code: string }[];
  expenseTypes: { code: string; legacyCode: string }[];
}

export interface ServiceKindInput {
  code: string;
  name: string;
  guideType: string;
  expenseType: string;
}

const CATALOG_CODE = /^[A-Z][A-Z_]{1,29}$/;

function catalogCode(value: unknown, field: string): string {
  if (typeof value !== "string" || !CATALOG_CODE.test(value)) fail(field, "código em maiúsculas (ex.: SERVICES)");
  return value;
}

export function parseServiceKindInput(input: { code?: unknown; name?: unknown; guideType?: unknown; expenseType?: unknown }): ServiceKindInput {
  return { code: requireText(input.code, "code", 40), name: requireText(input.name, "name", 120), guideType: catalogCode(input.guideType, "guideType"), expenseType: catalogCode(input.expenseType, "expenseType") };
}

export interface ServiceKindPatch {
  name?: string;
  guideType?: string;
  expenseType?: string;
  status?: ServiceStatus;
}

/** BR-SEG-39: nome, guia, tipo de despesa e estado; o `code` não se altera. */
export function parseServiceKindPatch(input: { name?: unknown; guideType?: unknown; expenseType?: unknown; status?: unknown }): ServiceKindPatch {
  const patch: ServiceKindPatch = {};
  if (input.name !== undefined) patch.name = requireText(input.name, "name", 120);
  if (input.guideType !== undefined) patch.guideType = catalogCode(input.guideType, "guideType");
  if (input.expenseType !== undefined) patch.expenseType = catalogCode(input.expenseType, "expenseType");
  if (input.status !== undefined) {
    if (input.status !== "ACTIVE" && input.status !== "INACTIVE") fail("status", "ACTIVE ou INACTIVE");
    patch.status = input.status;
  }
  return patch;
}

/** `guideType`/`expenseType` têm de existir nos catálogos globais (senão `VALIDATION_ERROR`). */
export function assertKnownTypes(catalog: CatalogTypes, types: { guideType?: string; expenseType?: string }): void {
  if (types.guideType !== undefined && !catalog.guideTypes.some((g) => g.code === types.guideType)) fail("guideType", "tipo de guia desconhecido");
  if (types.expenseType !== undefined && !catalog.expenseTypes.some((e) => e.code === types.expenseType)) fail("expenseType", "tipo de despesa desconhecido");
}

/** BR-SEG-39: inativar um tipo com serviços ATIVOS ligados ⇒ `CONFLICT`. */
export function assertCanInactivate(activeServices: number): void {
  if (activeServices > 0) throw new ConflictError({ detail: "O tipo tem serviços ativos ligados; reclassifique-os antes de o inativar." });
}

/** Um tipo só se liga a serviços se for da própria seguradora e `ACTIVE` (o chamador passa `null` se não existir/for de outra). */
export function assertAssignable(kind: Pick<ServiceKind, "status"> | null, field: string): void {
  if (kind?.status !== "ACTIVE") fail(field, "tipo de serviço inexistente ou inativo");
}

/** Categoria comparada normalizada: trim, minúsculas, sem acentos (BR-SEG-39). Vazia ⇒ `""` (serviços sem categoria). */
export function normalizeCategory(category: string | null | undefined): string {
  return (category ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export interface ClassifyRequest {
  category: string | null;
  serviceKindId: string;
  onlyUnclassified: boolean;
}

export function parseClassifyRequest(input: { category?: unknown; serviceKindId?: unknown; onlyUnclassified?: unknown }): ClassifyRequest {
  let category: string | null = null;
  if (input.category !== undefined && input.category !== null) {
    if (typeof input.category !== "string") fail("category", "texto");
    if (input.category.length > 80) fail("category", "no máximo 80 caracteres");
    category = input.category;
  }
  if (input.onlyUnclassified !== undefined && typeof input.onlyUnclassified !== "boolean") fail("onlyUnclassified", "booleano");
  return { category, serviceKindId: requireUuid(input.serviceKindId, "serviceKindId"), onlyUnclassified: input.onlyUnclassified ?? true };
}

/** Ids dos serviços a reclassificar: mesma categoria normalizada e, com `onlyUnclassified`, só os ainda sem tipo. */
export function selectServicesToClassify(services: { id: string; category: string | null; serviceKindId: string | null }[], request: ClassifyRequest): string[] {
  const wanted = normalizeCategory(request.category);
  return services.filter((s) => normalizeCategory(s.category) === wanted && (!request.onlyUnclassified || s.serviceKindId === null)).map((s) => s.id);
}
