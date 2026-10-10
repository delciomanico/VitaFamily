// Helper partilhado pelos casos de uso de leitura (audit.md §3: "não se audita a leitura do
// titular sobre os seus próprios dados... mas sim qualquer leitura por quem não é o titular") —
// mesmo critério de `health-records/application/support.ts`.
import type { AccessContext } from "../../access/index.js";
import { auditContextFields, type AuditAction } from "../../audit/index.js";
import type { MedicationsDeps, RequestContext } from "./ports.js";

export interface ViewAuditParams {
  userId: string;
  familyId: string;
  memberId: string;
  resourceType: "MedicationPlan" | "DoseOccurrence" | "Prescription";
  context: RequestContext;
}

export async function auditViewIfNotSelf<Trx>(deps: MedicationsDeps<Trx>, trx: Trx, ctx: AccessContext, params: ViewAuditParams): Promise<void> {
  if (ctx.relation === "SELF") {
    return;
  }
  const action: AuditAction = "HEALTH_VIEW";
  await deps.audit.record(trx, {
    occurredAt: deps.clock.now(),
    actorType: "USER",
    actorUserId: params.userId,
    action,
    resourceType: params.resourceType,
    resourceId: params.memberId,
    familyId: params.familyId,
    subjectMemberId: params.memberId,
    result: "SUCCESS",
    requestId: params.context.requestId,
    ...auditContextFields(params.context),
  });
}
