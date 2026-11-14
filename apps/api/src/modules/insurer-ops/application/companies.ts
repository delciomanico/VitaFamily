// openapi listInsurerCompanies / createInsurerCompany / updateInsurerCompany (UC-SEG-01, BR-SEG-14/15).
import { ConflictError, ValidationError } from "../../../platform/errors/index.js";
import type { Page } from "../../../platform/page/index.js";
import { newId } from "../../../platform/ids/index.js";
import type { OpsActor } from "../domain/access.js";
import { parseCompanyInput, parseCompanyPatch, type Company, type CompanyStatus } from "../domain/company.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, notFound, toPage, toPageQuery, type PageInput } from "./support.js";

export function createListCompaniesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listCompanies(actor: OpsActor, query: PageInput & { status?: string | undefined }): Promise<Page<Company>> {
    const page = toPageQuery(query);
    if (query.status !== undefined && query.status !== "ACTIVE" && query.status !== "INACTIVE") {
      throw new ValidationError([{ field: "status", message: "ACTIVE ou INACTIVE" }], { detail: "Filtro inválido." });
    }
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      const rows = await deps.companies.list(trx, actor.insurerId, query.status === undefined ? {} : { status: query.status as CompanyStatus }, page);
      return toPage(rows, page, (c) => c);
    });
  };
}

export function createCreateCompanyUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function createCompany(actor: OpsActor, input: { name?: unknown; taxId?: unknown }, context: RequestContext): Promise<Company> {
    const parsed = parseCompanyInput(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      if (await deps.companies.findByTaxId(trx, actor.insurerId, parsed.taxId)) {
        throw new ConflictError({ detail: "Já existe uma empresa com este NIF." });
      }
      const company = await deps.companies.insert(trx, { id: newId(), insurerId: actor.insurerId, ...parsed, createdAt: deps.clock.now() });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_COMPANY_CREATE", resourceType: "InsurerCompany", resourceId: company.id }));
      return company;
    });
  };
}

export function createUpdateCompanyUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function updateCompany(actor: OpsActor, companyId: string, input: { name?: unknown; status?: unknown }, context: RequestContext): Promise<Company> {
    const patch = parseCompanyPatch(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      if (!(await deps.companies.findById(trx, actor.insurerId, companyId))) throw notFound();
      const company = await deps.companies.update(trx, actor.insurerId, companyId, patch, deps.clock.now());
      await deps.audit.record(
        trx,
        auditEvent(deps, actor, context, {
          action: "INSURER_COMPANY_UPDATE",
          resourceType: "InsurerCompany",
          resourceId: companyId,
          ...(patch.status === undefined ? {} : { metadata: { status: patch.status } }),
        }),
      );
      return company;
    });
  };
}
