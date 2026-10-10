// Helper partilhado pelos casos de uso de leitura (audit.md §3: "sim qualquer leitura por quem não
// é o titular") — mesmo critério de `health-records`/`medications` `application/support.ts`.
import type { AccessContext } from "../../access/index.js";
import { auditContextFields, type AuditAction } from "../../audit/index.js";
import type { PrescriptionsDeps, RequestContext } from "./ports.js";

export async function auditViewIfNotSelf<Trx>(
  deps: PrescriptionsDeps<Trx>,
  trx: Trx,
  ctx: AccessContext,
  params: { userId: string; familyId: string; memberId: string; context: RequestContext },
): Promise<void> {
  if (ctx.relation === "SELF") {
    return;
  }
  const action: AuditAction = "HEALTH_VIEW";
  await deps.audit.record(trx, {
    occurredAt: deps.clock.now(),
    actorType: "USER",
    actorUserId: params.userId,
    action,
    resourceType: "Prescription",
    resourceId: params.memberId,
    familyId: params.familyId,
    subjectMemberId: params.memberId,
    result: "SUCCESS",
    requestId: params.context.requestId,
    ...auditContextFields(params.context),
  });
}
