// Helpers partilhados pelos casos de uso de leitura (audit.md §3: "não se audita a leitura do
// titular sobre os seus próprios dados... mas sim qualquer leitura por quem não é o titular").
import type { AccessContext } from "../../access/index.js";
import { auditContextFields, type AuditAction } from "../../audit/index.js";
import type { HealthRecordsDeps, RequestContext } from "./ports.js";

export interface ViewAuditParams {
  userId: string;
  familyId: string;
  memberId: string;
  resourceType: "Allergy" | "Condition" | "BloodType";
  context: RequestContext;
}

/** `ctx.relation === "SELF"` é o titular a ver os seus próprios dados — nunca auditado. */
export async function auditViewIfNotSelf<Trx>(
  deps: HealthRecordsDeps<Trx>,
  trx: Trx,
  ctx: AccessContext,
  params: ViewAuditParams,
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
    resourceType: params.resourceType,
    resourceId: params.memberId,
    familyId: params.familyId,
    subjectMemberId: params.memberId,
    result: "SUCCESS",
    requestId: params.context.requestId,
    ...auditContextFields(params.context),
  });
}
