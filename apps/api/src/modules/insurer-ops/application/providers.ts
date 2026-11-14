// openapi listInsurerPartnerClinics / listInsurerProviders / createInsurerProvider / setInsurerProviderStatus (UC-SEG-09 mínimo,
// BR-SEG-18, authorization.md §8.2b/§8.4). Só INSURANCE_ADMIN escreve; a lista de clínicas parceiras é só dele e devolve `id` e
// `name` (BR-SEG-14, ADR-005). Sem auditoria da listagem e `q` nunca em logs/auditoria.
import { ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { DEFAULT_PAGE_LIMIT, parsePageParams, type Page } from "../../../platform/page/index.js";
import type { OpsActor } from "../domain/access.js";
import { parseProviderInput, parseProviderStatus, parseProviderStatusFilter, type InsurerProvider } from "../domain/provider.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, notFound, toPage, toPageQuery, type PageInput } from "./support.js";

export interface PartnerClinic {
  id: string;
  name: string;
}

function encodeNameCursor(value: { name: string; id: string }): string {
  return Buffer.from(JSON.stringify({ n: value.name, i: value.id }), "utf8").toString("base64url");
}

function decodeNameCursor(cursor: string): { name: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { n?: unknown; i?: unknown };
    if (typeof parsed.n === "string" && typeof parsed.i === "string" && /^[0-9a-f-]{36}$/i.test(parsed.i)) return { name: parsed.n, id: parsed.i };
    throw new Error("forma inválida");
  } catch (cause) {
    throw new ValidationError([{ field: "cursor", message: "inválido" }], { detail: "Cursor de paginação inválido.", cause });
  }
}

export function createListPartnerClinicsUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listPartnerClinics(actor: OpsActor, query: PageInput & { q?: string | undefined }): Promise<Page<PartnerClinic>> {
    const { limit, cursor } = parsePageParams(query.limit === undefined ? undefined : String(query.limit), query.cursor);
    const after = cursor === undefined ? undefined : decodeNameCursor(cursor);
    const q = query.q?.trim();
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      const rows = await deps.partnerClinics.list(trx, { limit: limit || DEFAULT_PAGE_LIMIT, ...(q ? { q } : {}), ...(after ? { after } : {}) });
      const items = rows.slice(0, limit).map((c) => ({ id: c.id, name: c.name }));
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > limit && last ? encodeNameCursor(last) : null };
    });
  };
}

export function createListProvidersUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listProviders(actor: OpsActor, query: PageInput & { status?: string | undefined }): Promise<Page<InsurerProvider>> {
    const page = toPageQuery(query);
    const status = parseProviderStatusFilter(query.status);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      const rows = await deps.providers.list(trx, actor.insurerId, status ? { status } : {}, page);
      return toPage(rows, page, (p) => p);
    });
  };
}

export function createCreateProviderUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function createProvider(actor: OpsActor, input: { clinicId?: unknown }, context: RequestContext): Promise<InsurerProvider> {
    const { clinicId } = parseProviderInput(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      // Inexistente, não parceira ou inativa ⇒ o mesmo NOT_FOUND (sem distinguir).
      const clinic = await deps.partnerClinics.find(trx, clinicId);
      if (!clinic) throw notFound();
      const provider = await deps.providers.insert(trx, { id: newId(), insurerId: actor.insurerId, clinicId, name: clinic.name, createdAt: deps.clock.now() });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_PROVIDER_CREATE", resourceType: "InsurerProvider", resourceId: provider.id, metadata: { clinicId } }));
      return provider;
    });
  };
}

export function createSetProviderStatusUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function setProviderStatus(actor: OpsActor, providerId: string, input: { status?: unknown }, context: RequestContext): Promise<InsurerProvider> {
    const next = parseProviderStatus(input.status);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      const current = await deps.providers.findById(trx, actor.insurerId, providerId, true);
      if (!current) throw notFound();
      const updated = await deps.providers.setStatus(trx, actor.insurerId, providerId, next, deps.clock.now());
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_PROVIDER_STATUS", resourceType: "InsurerProvider", resourceId: providerId, metadata: { from: current.status, to: next } }));
      return updated;
    });
  };
}
