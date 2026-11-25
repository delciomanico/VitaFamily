// Sessões do assistente (UC-AI-02/03/05; BR-AI-04/05/10/12/13). O servidor autoriza, verifica o consentimento e o papel em CADA pedido, monta o
// contexto minimizado, aplica limites e audita (sem conteúdo). NUNCA recebe sintomas, resposta nem chaves. O `sessionToken` é assinado e sem estado.
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { ageBandOf, buildGuardrails, buildSummaryContext, buildSymptomsContext, isAdult, GUARDRAILS_VERSION, type AiContext, type Guardrails } from "../domain/index.js";
import { parseProvider } from "./consents.js";
import { enforceAiRate } from "./rate-limit.js";
import type { ActorIdentity, AiAssistantDeps, AiOutcome, AiSessionKind, RequestContext } from "./ports.js";

export const SESSION_TTL_MS = 15 * 60_000;
const OUTCOMES: readonly AiOutcome[] = ["COMPLETED", "BLOCKED", "ALARM", "FAILED"];
const KINDS: readonly AiSessionKind[] = ["SUMMARY", "SYMPTOMS"];
/** Deduplicação do desfecho por `jti` (o primeiro prevalece): uma marca por token durante a sua vida. */
const OUTCOME_ONCE = { max: 1, windowMs: SESSION_TTL_MS + 60_000 } as const;

export interface CreateSessionInput {
  provider?: unknown;
  kind?: unknown;
  guardrailsVersion?: unknown;
  from?: unknown;
  to?: unknown;
  includeContext?: unknown;
}

export interface AiSessionView {
  sessionToken: string;
  expiresAt: string;
  guardrailsVersion: string;
  context: AiContext;
}

const invalid = (field: string, message: string): ValidationError => new ValidationError([{ field, message }], { detail: "Dados inválidos." });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function optionalDate(field: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw invalid(field, "Data inválida.");
  return value;
}

export function createAiSessions<Trx>(deps: AiAssistantDeps<Trx>) {
  return {
    /** UC-AI-05: guardrails vigentes (a lista de especialidades lê-se do catálogo no momento). */
    async getGuardrails(): Promise<Guardrails> {
      return buildGuardrails(await deps.specialties.listAllowed());
    },

    async createSession(actor: ActorIdentity, familyId: string, memberId: string, input: CreateSessionInput, context: RequestContext): Promise<AiSessionView> {
      const provider = parseProvider(typeof input.provider === "string" ? input.provider : "");
      if (typeof input.kind !== "string" || !(KINDS as readonly string[]).includes(input.kind)) throw invalid("kind", "Tipo de análise inválido.");
      const kind = input.kind as AiSessionKind;
      if (typeof input.guardrailsVersion !== "string" || input.guardrailsVersion.length === 0) throw invalid("guardrailsVersion", "Versão dos guardrails em falta.");
      const from = optionalDate("from", input.from);
      const to = optionalDate("to", input.to);
      const includeContext = input.includeContext === true;
      if (input.includeContext !== undefined && typeof input.includeContext !== "boolean") throw invalid("includeContext", "Valor inválido.");

      await enforceAiRate(deps.rateLimiter, "session-hour", actor.userId);
      await enforceAiRate(deps.rateLimiter, "session-day", actor.userId);
      const at = deps.clock.now();

      // 1) Autorização, papel, consentimento e factos mínimos do membro (uma transação curta; nada de leituras externas lá dentro).
      const member = await deps.withTransaction(async (trx) => {
        await deps.access.assertCanUse(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
        const facts = await deps.members.facts(trx, familyId, memberId);
        if (!facts) throw new NotFoundError();
        if (!facts.active) throw new DomainError("MEMBER_BLOCKED", { detail: "Perfil bloqueado." });
        const consent = await deps.consents.findActive(trx, actor.userId, memberId, provider);
        if (consent?.familyId !== familyId) throw new DomainError("AI_CONSENT_REQUIRED", { detail: "Ative o assistente e aceite o consentimento." });
        return facts;
      });

      if (input.guardrailsVersion !== GUARDRAILS_VERSION) throw new ConflictError({ detail: "Os guardrails mudaram; recarregue-os." });
      const adult = isAdult(member.birthDate, at);
      if (kind === "SYMPTOMS" && includeContext && !adult) throw invalid("includeContext", "O contexto não está disponível para menores.");
      const ageBand = ageBandOf(member.birthDate, at);

      // 2) Contexto minimizado (Resumo de saúde por `reports`, que aplica a sua própria `AccessPolicy`; fora de qualquer transação).
      let aiContext: AiContext;
      if (kind === "SUMMARY") {
        const summary = await deps.summary.facts(actor, familyId, memberId, { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }, context);
        aiContext = buildSummaryContext(ageBand, summary.facts, summary.from);
      } else {
        aiContext = buildSymptomsContext(ageBand, { includeContext: includeContext && adult, conditions: includeContext && adult ? member.activeConditions : [] });
      }

      const expiresAtMs = at.getTime() + SESSION_TTL_MS;
      const sessionToken = deps.signer.sign({ jti: deps.newId(), userId: actor.userId, familyId, memberId, provider, kind, guardrailsVersion: GUARDRAILS_VERSION, expiresAtMs });

      await deps.withTransaction((trx) =>
        deps.audit.record(trx, {
          occurredAt: at,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "AI_SESSION_CREATE",
          resourceType: "AiSession",
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          // Só enums e contagens (BR-AI-12): nunca séries, sintomas, condições nem texto.
          metadata: { provider, kind, guardrailsVersion: GUARDRAILS_VERSION, includeContext: kind === "SYMPTOMS" ? includeContext && adult : false, seriesCount: aiContext.series?.length ?? 0 },
          ...auditContextFields(context),
        }),
      );
      return { sessionToken, expiresAt: new Date(expiresAtMs).toISOString(), guardrailsVersion: GUARDRAILS_VERSION, context: aiContext };
    },

    /** Melhor esforço e autodeclarado (BR-AI-12). Token inválido/expirado/alheio ⇒ `NOT_FOUND`; o primeiro desfecho de um token prevalece. */
    async reportOutcome(actor: ActorIdentity, familyId: string, memberId: string, input: { sessionToken?: unknown; outcome?: unknown }, context: RequestContext): Promise<void> {
      if (typeof input.sessionToken !== "string" || input.sessionToken.length === 0) throw invalid("sessionToken", "Token em falta.");
      if (typeof input.outcome !== "string" || !(OUTCOMES as readonly string[]).includes(input.outcome)) throw invalid("outcome", "Desfecho inválido.");
      const outcome = input.outcome as AiOutcome;
      const at = deps.clock.now();
      const payload = deps.signer.verify(input.sessionToken);
      if (payload?.userId !== actor.userId || payload.familyId !== familyId || payload.memberId !== memberId || payload.expiresAtMs <= at.getTime()) throw new NotFoundError();
      await enforceAiRate(deps.rateLimiter, "read", actor.userId);

      await deps.withTransaction(async (trx) => {
        await deps.access.assertCanUse(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
      }).catch((error: unknown) => {
        if (error instanceof ForbiddenError || error instanceof NotFoundError) throw new NotFoundError();
        throw error;
      });
      const first = await deps.rateLimiter.consume({ rule: "outcome-once", subject: payload.jti }, OUTCOME_ONCE);
      if (!first.allowed) return;
      await deps.withTransaction((trx) =>
        deps.audit.record(trx, {
          occurredAt: at,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "AI_SESSION_OUTCOME",
          resourceType: "AiSession",
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { provider: payload.provider, kind: payload.kind, guardrailsVersion: payload.guardrailsVersion, outcome },
          ...auditContextFields(context),
        }),
      );
    },
  };
}

export type AiSessions = ReturnType<typeof createAiSessions<unknown>>;
