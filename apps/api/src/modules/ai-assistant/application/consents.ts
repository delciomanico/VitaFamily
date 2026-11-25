// Consentimentos do assistente (UC-AI-01/04; BR-AI-03/04/16). Só metadados: nunca chaves, tokens nem dados de saúde. Autorização `USE_AI_ASSISTANT`
// (`SELF` adulto/`TUTOR_OF`); a revogação não exige tutela atual (o utilizador pode sempre retirar o SEU consentimento, BR-AI-04/16).
import { ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { enforceAiRate } from "./rate-limit.js";
import { AI_PROVIDERS, type ActorIdentity, type AiAssistantDeps, type AiConsentRecord, type AiProvider, type RequestContext } from "./ports.js";

export interface AiConsentView {
  provider: AiProvider;
  consentVersion: string;
  grantedAt: string;
  revokedAt: string | null;
}

const toView = (r: AiConsentRecord): AiConsentView => ({ provider: r.provider, consentVersion: r.consentVersion, grantedAt: r.grantedAt.toISOString(), revokedAt: r.revokedAt?.toISOString() ?? null });

const invalid = (field: string, message: string): ValidationError => new ValidationError([{ field, message }], { detail: "Dados inválidos." });

export function parseProvider(value: string): AiProvider {
  if (!(AI_PROVIDERS as readonly string[]).includes(value)) throw invalid("provider", "Fornecedor desconhecido.");
  return value as AiProvider;
}

export function createAiConsents<Trx>(deps: AiAssistantDeps<Trx>) {
  return {
    /** Um por fornecedor: o ativo, ou o último revogado. */
    async list(actor: ActorIdentity, familyId: string, memberId: string): Promise<AiConsentView[]> {
      await enforceAiRate(deps.rateLimiter, "read", actor.userId);
      return deps.withTransaction(async (trx) => {
        await deps.access.assertCanUse(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
        const all = await deps.consents.listByUserAndMember(trx, actor.userId, memberId);
        const out: AiConsentView[] = [];
        for (const provider of AI_PROVIDERS) {
          const mine = all.filter((c) => c.provider === provider && c.familyId === familyId);
          const chosen = mine.find((c) => c.revokedAt === null) ?? [...mine].sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime())[0];
          if (chosen) out.push(toView(chosen));
        }
        return out;
      });
    },

    /** Idempotente: já ativo na mesma versão ⇒ devolve-o; versão nova ⇒ revoga o anterior e cria linha nova. */
    async grant(actor: ActorIdentity, familyId: string, memberId: string, providerRaw: string, input: { consentVersion?: unknown }, context: RequestContext): Promise<AiConsentView> {
      const provider = parseProvider(providerRaw);
      const version = typeof input.consentVersion === "string" ? input.consentVersion.trim() : "";
      if (version.length < 1 || version.length > 20) throw invalid("consentVersion", "Versão do consentimento inválida.");
      await enforceAiRate(deps.rateLimiter, "consent-hour", actor.userId);
      const at = deps.clock.now();
      return deps.withTransaction(async (trx) => {
        await deps.access.assertCanUse(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
        await deps.consents.acquireLocks(trx, [`ai-consent:${actor.userId}:${memberId}:${provider}`]);
        const current = await deps.consents.findActive(trx, actor.userId, memberId, provider);
        if (current?.consentVersion === version && current.familyId === familyId) return toView(current);
        if (current) await deps.consents.revoke(trx, current.id, at);
        const record = { id: deps.newId(), userId: actor.userId, familyId, memberId, provider, consentVersion: version, grantedAt: at };
        await deps.consents.insert(trx, record);
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "AI_CONSENT_GRANT",
          resourceType: "AiConsent",
          resourceId: record.id,
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { provider, consentVersion: version },
          ...auditContextFields(context),
        });
        return toView({ ...record, revokedAt: null });
      });
    },

    /** Idempotente (sem consentimento ativo ⇒ nada). Não exige tutela atual. */
    async revoke(actor: ActorIdentity, familyId: string, memberId: string, providerRaw: string, context: RequestContext): Promise<void> {
      const provider = parseProvider(providerRaw);
      await enforceAiRate(deps.rateLimiter, "consent-hour", actor.userId);
      const at = deps.clock.now();
      await deps.withTransaction(async (trx) => {
        await deps.consents.acquireLocks(trx, [`ai-consent:${actor.userId}:${memberId}:${provider}`]);
        const current = await deps.consents.findActive(trx, actor.userId, memberId, provider);
        if (current?.familyId !== familyId) return;
        await deps.consents.revoke(trx, current.id, at);
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "AI_CONSENT_REVOKE",
          resourceType: "AiConsent",
          resourceId: current.id,
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { provider, consentVersion: current.consentVersion },
          ...auditContextFields(context),
        });
      });
    },
  };
}

export type AiConsents = ReturnType<typeof createAiConsents<unknown>>;
