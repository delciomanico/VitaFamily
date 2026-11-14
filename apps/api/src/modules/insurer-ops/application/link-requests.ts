// openapi listInsurerLinkRequests / confirmInsurerLinkRequest / rejectInsurerLinkRequest (BR-SEG-20, state-machines.md
// «BeneficiaryLinkRequest»). O pedido nasce do lado do paciente (S6); aqui a seguradora decide. Nunca devolve ids do
// paciente: só o necessário para decidir.
import { ConflictError, ValidationError } from "../../../platform/errors/index.js";
import type { Page } from "../../../platform/page/index.js";
import type { OpsActor } from "../domain/access.js";
import { LINK_REQUEST_STATUSES, type LinkRequest, type LinkRequestStatus } from "../domain/link-request.js";
import { requireNote } from "../domain/validation.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, notFound, toPage, toPageQuery, type PageInput } from "./support.js";

export function createListLinkRequestsUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listLinkRequests(actor: OpsActor, query: PageInput & { status?: string | undefined }): Promise<Page<LinkRequest>> {
    const page = toPageQuery(query);
    const status = query.status ?? "PENDING";
    if (!(LINK_REQUEST_STATUSES as string[]).includes(status)) {
      throw new ValidationError([{ field: "status", message: "PENDING, CONFIRMED, REJECTED ou REVOKED" }], { detail: "Filtro inválido." });
    }
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      return toPage(await deps.linkRequests.list(trx, actor.insurerId, { status: status as LinkRequestStatus }, page), page, (r) => r);
    });
  };
}

/** `PENDING → CONFIRMED`: só então o paciente vê cartão e cobertura (liga o beneficiário ao membro). */
export function createConfirmLinkRequestUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function confirmLinkRequest(actor: OpsActor, linkRequestId: string, context: RequestContext): Promise<LinkRequest> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      const found = await deps.linkRequests.findById(trx, actor.insurerId, linkRequestId, true);
      if (!found) throw notFound();
      if (found.request.status !== "PENDING") throw new ConflictError({ detail: "O pedido já foi decidido." });
      const now = deps.clock.now();
      // Bloqueia o beneficiário e liga (FK composta a `family_members`); já ligado a outro membro ⇒ CONFLICT.
      const beneficiary = await deps.beneficiaries.findById(trx, actor.insurerId, found.request.beneficiaryId, true);
      if (!beneficiary) throw notFound();
      if (beneficiary.status === "CANCELLED") throw new ConflictError({ detail: "O beneficiário está cancelado." });
      if (beneficiary.linked) throw new ConflictError({ detail: "O beneficiário já tem uma ligação confirmada." });
      await deps.beneficiaries.link(trx, actor.insurerId, beneficiary.id, found.target, now);
      const decided = await deps.linkRequests.decide(trx, actor.insurerId, linkRequestId, { status: "CONFIRMED", note: null, accountId: actor.insuranceAccountId, decidedAt: now });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_LINK_DECIDE", resourceType: "InsurerLinkRequest", resourceId: linkRequestId, metadata: { decision: "CONFIRMED" } }));
      return decided;
    });
  };
}

/** `PENDING → REJECTED`, motivo obrigatório (só o necessário vai para a auditoria: a decisão, nunca o texto). */
export function createRejectLinkRequestUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function rejectLinkRequest(actor: OpsActor, linkRequestId: string, input: { note?: unknown }, context: RequestContext): Promise<LinkRequest> {
    const note = requireNote(input.note);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      const found = await deps.linkRequests.findById(trx, actor.insurerId, linkRequestId, true);
      if (!found) throw notFound();
      if (found.request.status !== "PENDING") throw new ConflictError({ detail: "O pedido já foi decidido." });
      const decided = await deps.linkRequests.decide(trx, actor.insurerId, linkRequestId, { status: "REJECTED", note, accountId: actor.insuranceAccountId, decidedAt: deps.clock.now() });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_LINK_DECIDE", resourceType: "InsurerLinkRequest", resourceId: linkRequestId, metadata: { decision: "REJECTED" } }));
      return decided;
    });
  };
}
