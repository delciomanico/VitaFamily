// Portas da `application` de `ai-assistant` (ADR-016; modules.md nota 40). O módulo importa só `audit` e `platform`: acesso (`USE_AI_ASSISTANT`),
// dados do membro, Resumo de saúde, catálogo de especialidades e assinatura do token entram por portas ligadas em `main/api.ts`. NÃO há porta para
// um fornecedor de IA: a chamada ao fornecedor vive no dispositivo (BR-AI-01). Nada daqui guarda sintomas, contexto, respostas nem chaves.
import type { RateLimiter } from "../../../platform/rate-limit/async.js";
import type { AuditEvent } from "../../audit/index.js";
import type { AllowedSpecialty, SummaryFacts } from "../domain/index.js";

export interface Clock {
  now(): Date;
}

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export type AiProvider = "GEMINI" | "CLAUDE" | "OPENAI";
export const AI_PROVIDERS: readonly AiProvider[] = ["GEMINI", "CLAUDE", "OPENAI"];
export type AiSessionKind = "SUMMARY" | "SYMPTOMS";
export type AiOutcome = "COMPLETED" | "BLOCKED" | "ALARM" | "FAILED";

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

/** Ação `USE_AI_ASSISTANT` (só `SELF` adulto/`TUTOR_OF`; `main/api.ts` sobre `access`). Lança `NotFoundError`/`ForbiddenError`. */
export interface AiAccess<Trx> {
  assertCanUse(trx: Trx, input: { userId: string; platformAdmin: boolean; familyId: string; memberId: string }): Promise<{ relation: "SELF" | "TUTOR_OF" }>;
}

export interface AiMemberFacts {
  /** Data de nascimento (ISO), só para a faixa etária; nunca sai. */
  birthDate: string;
  active: boolean;
  /** Nomes das condições ATIVAS (só com `includeContext`). */
  activeConditions: string[];
}

export interface AiMembers<Trx> {
  facts(trx: Trx, familyId: string, memberId: string): Promise<AiMemberFacts | null>;
}

export interface AiSummarySource {
  /** Resumo de saúde do período já minimizado ao essencial (a montagem passa pelas leituras e pela `AccessPolicy` de `reports`). */
  facts(actor: ActorIdentity, familyId: string, memberId: string, query: { from?: string; to?: string }, context: RequestContext): Promise<{ from: string; facts: SummaryFacts }>;
}

/** Catálogo de especialidades `HEALTH` ativas (id e nome; `professionals`, ligado em `main/api.ts`). */
export interface AiSpecialties {
  listAllowed(): Promise<AllowedSpecialty[]>;
}

export interface AiTokenPayload {
  jti: string;
  userId: string;
  familyId: string;
  memberId: string;
  provider: AiProvider;
  kind: AiSessionKind;
  guardrailsVersion: string;
  /** Epoch ms. */
  expiresAtMs: number;
}

/** Assinatura/verificação do `sessionToken` (HMAC; sem estado no servidor). */
export interface AiTokenSigner {
  sign(payload: AiTokenPayload): string;
  /** `null` se assinatura inválida ou token malformado. A expiração verifica-se na `application`. */
  verify(token: string): AiTokenPayload | null;
}

export interface AiConsentRecord {
  id: string;
  userId: string;
  familyId: string;
  memberId: string;
  provider: AiProvider;
  consentVersion: string;
  grantedAt: Date;
  revokedAt: Date | null;
}

export interface AiConsentRepository<Trx> {
  /** Serializa consentimentos do mesmo (utilizador, membro, fornecedor): chaves ordenadas (bloqueio consultivo da transação). */
  acquireLocks(trx: Trx, keys: readonly string[]): Promise<void>;
  listByUserAndMember(trx: Trx, userId: string, memberId: string): Promise<AiConsentRecord[]>;
  findActive(trx: Trx, userId: string, memberId: string, provider: AiProvider): Promise<AiConsentRecord | null>;
  insert(trx: Trx, record: Omit<AiConsentRecord, "revokedAt">): Promise<void>;
  revoke(trx: Trx, id: string, at: Date): Promise<void>;
}

export interface AiAssistantDeps<Trx> {
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
  rateLimiter: RateLimiter;
  audit: AuditPort<Trx>;
  access: AiAccess<Trx>;
  members: AiMembers<Trx>;
  summary: AiSummarySource;
  specialties: AiSpecialties;
  signer: AiTokenSigner;
  consents: AiConsentRepository<Trx>;
  newId(): string;
}
