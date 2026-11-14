// Identificação do beneficiário pela clínica, PARTILHADA pela elegibilidade e pela criação de pedidos (BR-SEG-18, BR-AUT-02):
// o mesmo rate limit (por conta e por IP; cada validação conta), o mesmo tratamento do QR (inválido/expirado/de outra seguradora
// ⇒ «não encontrado») e a mesma consulta anti-timing. A decisão de elegibilidade em si é de `coverage.ts` (BR-SEG-41).
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields, type AuditEvent } from "../../audit/index.js";
import type { ClinicOpsActor } from "../domain/access.js";
import { verifyCardQrToken } from "../domain/card-qr.js";
import type { EligibilityRequest } from "../domain/eligibility.js";
import { ELIGIBILITY_RATE_LIMITS } from "../domain/rate-limiter.js";
import type { EligibilityCandidate, EligibilityLookup, OpsDeps, RequestContext } from "./ports.js";

/** Id que nunca existe (`gen_random_uuid()` não o produz): consulta «de enchimento» para igualar o trabalho (BR-SEG-18). */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Mensagem única de «não encontrado»: igual para inexistente, inelegível, QR inválido ou ligação inativa (anti-enumeração). */
export const NOT_FOUND_DETAIL = "Recurso não encontrado.";
export const notFoundError = (): NotFoundError => new NotFoundError({ detail: NOT_FOUND_DETAIL });

export function eligibilityAudit<Trx>(
  deps: OpsDeps<Trx>,
  actor: ClinicOpsActor,
  insurerId: string,
  context: RequestContext,
  result: AuditEvent["result"],
  metadata: Record<string, string | number | boolean | null>,
): AuditEvent {
  return {
    occurredAt: deps.clock.now(),
    actorType: "CLINIC_ACCOUNT",
    actorClinicAccountId: actor.clinicAccountId,
    actorClinicId: actor.clinicId,
    action: "ELIGIBILITY_CHECK",
    resourceType: "Insurer",
    resourceId: insurerId,
    result,
    requestId: context.requestId,
    ...auditContextFields(context),
    // BR-SEG-15/18: nunca o nº de cartão, QR, documento nem o nome pesquisados; `insurerId` sempre.
    metadata: { insurerId, ...metadata },
  };
}

/**
 * Rate limit partilhado (BR-SEG-18): `null` = pode continuar (e a validação ficou contada); senão, ms até nova tentativa.
 * No máximo 1 registo de recusa por chave e janela (não inflar `audit_logs`).
 */
export async function consumeLookupRateLimit<Trx>(deps: OpsDeps<Trx>, trx: Trx, actor: ClinicOpsActor, insurerId: string, context: RequestContext): Promise<number | null> {
  const accountKey = `eligibility:account:${actor.clinicAccountId}`;
  const ipKey = context.ip === undefined ? null : `eligibility:ip:${context.ip}`;
  const byAccount = deps.rateLimiter.peek(accountKey, ELIGIBILITY_RATE_LIMITS.account);
  const byIp = ipKey === null ? { allowed: true, retryAfterMs: 0 } : deps.rateLimiter.peek(ipKey, ELIGIBILITY_RATE_LIMITS.ip);
  if (!byAccount.allowed || !byIp.allowed) {
    const blocked: [string, number][] = [];
    if (!byAccount.allowed) blocked.push([accountKey, ELIGIBILITY_RATE_LIMITS.account.windowMs]);
    if (ipKey !== null && !byIp.allowed) blocked.push([ipKey, ELIGIBILITY_RATE_LIMITS.ip.windowMs]);
    const fresh = blocked.map(([key, windowMs]) => deps.rateLimiter.shouldAuditDenial(key, windowMs));
    if (fresh.some(Boolean)) await deps.audit.record(trx, eligibilityAudit(deps, actor, insurerId, context, "DENIED", { reason: "RATE_LIMITED" }));
    return Math.max(byAccount.retryAfterMs, byIp.retryAfterMs);
  }
  deps.rateLimiter.record(accountKey, ELIGIBILITY_RATE_LIMITS.account);
  if (ipKey !== null) deps.rateLimiter.record(ipKey, ELIGIBILITY_RATE_LIMITS.ip);
  return null;
}

/** Beneficiário identificado (cartão, QR ou documento) na data `date`; `null` se inexistente, QR inválido ou cartão revogado. */
export async function findBeneficiary<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string, by: EligibilityRequest["by"], date: string): Promise<EligibilityCandidate | null> {
  let lookup: EligibilityLookup | null = null;
  let qrCardVersion: number | null = null;
  if (by.kind === "CARD") lookup = { kind: "CARD", cardNumber: by.cardNumber };
  else if (by.kind === "DOCUMENT") lookup = { kind: "DOCUMENT", type: by.type, number: by.number };
  else {
    // QR inválido/expirado/de outra seguradora ⇒ a mesma resposta «não encontrado» (BR-SEG-18).
    const claims = verifyCardQrToken(deps.claimCodeSecret, by.token, deps.clock.now());
    if (claims?.insurerId === insurerId) {
      lookup = { kind: "ID", beneficiaryId: claims.beneficiaryId };
      qrCardVersion = claims.cardVersion;
    }
  }
  // Anti-timing: um QR inválido/expirado/de outra seguradora faz a mesma consulta (a um id nulo, que nunca existe).
  const candidate = await deps.eligibility.find(trx, insurerId, lookup ?? { kind: "ID", beneficiaryId: NIL_UUID }, date);
  const revoked = candidate !== null && qrCardVersion !== null && candidate.cardVersion !== qrCardVersion;
  return revoked ? null : candidate;
}
