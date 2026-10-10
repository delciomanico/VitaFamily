// Portas do módulo `auth` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` ou injetadas pela raiz. Genéricas em `Trx` (nunca "kysely" em application).
import type { AuditEvent } from "../../audit/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { NewUserRecord, User } from "../../users/index.js";
import type { SigningKey } from "../domain/jwt.js";
import type { InMemoryRateLimiter } from "../domain/rate-limiter.js";
import type { Session } from "../domain/session.js";

export type AuthTokenType = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export interface AuthToken {
  id: string;
  userId: string;
  type: AuthTokenType;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
}

export interface NewAuthToken {
  id: string;
  userId: string;
  type: AuthTokenType;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface NewSessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  tokenChainId: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  createdAt: Date;
}

/** `auth_tokens` (verificação de e-mail / recuperação de palavra-passe). */
export interface AuthTokenRepository<Trx> {
  insert(trx: Trx, token: NewAuthToken): Promise<AuthToken>;
  findValidByHash(trx: Trx, type: AuthTokenType, tokenHash: string, now: Date): Promise<AuthToken | null>;
  /**
   * Como `findValidByHash`, mas restrito a `userId` (EMAIL_VERIFICATION usa um código de 6
   * dígitos, `domain/token.ts#generateVerificationCode`: sem esta restrição, duas contas podiam
   * calhar no mesmo código e uma verificar-se com o código da outra).
   */
  findValidForUser(
    trx: Trx,
    userId: string,
    type: AuthTokenType,
    tokenHash: string,
    now: Date,
  ): Promise<AuthToken | null>;
  markUsed(trx: Trx, id: string, usedAt: Date): Promise<void>;
  /** Invalida (marca como usados) todos os tokens não usados de `type` para `userId`. */
  invalidateAllForUser(trx: Trx, userId: string, type: AuthTokenType, now: Date): Promise<void>;
}

/** `sessions` (refresh token rotativo, ADR-007). */
export interface SessionRepository<Trx> {
  insert(trx: Trx, session: NewSessionRecord): Promise<Session>;
  findByRefreshTokenHash(trx: Trx, refreshTokenHash: string): Promise<Session | null>;
  findById(trx: Trx, id: string): Promise<Session | null>;
  revoke(trx: Trx, id: string, revokedAt: Date): Promise<void>;
  revokeChain(trx: Trx, tokenChainId: string, revokedAt: Date): Promise<void>;
  revokeAllForUser(trx: Trx, userId: string, revokedAt: Date): Promise<void>;
  revokeAllForUserExcept(trx: Trx, userId: string, exceptSessionId: string, revokedAt: Date): Promise<void>;
}

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

/** Subconjunto de `users` que `auth` chama pela raiz (CLAUDE.md M1 §3). */
export interface UsersPort<Trx> {
  createAccount(trx: Trx, record: NewUserRecord): Promise<User>;
  byEmail(trx: Trx, email: string): Promise<User | null>;
  byId(trx: Trx, id: string): Promise<User | null>;
  setEmailVerified(trx: Trx, id: string, verifiedAt: Date): Promise<User>;
  setPasswordHash(trx: Trx, id: string, passwordHash: string): Promise<void>;
}

export interface ResolvedDependentAccountInvitation {
  invitationId: string;
  familyId: string;
  memberId: string;
  /** BR-MEM-17: a data de nascimento do User é a do perfil. */
  birthDate: string;
}

export interface FinalizeDependentAccountInvitationInput {
  invitationId: string;
  familyId: string;
  memberId: string;
  userId: string;
}

/**
 * Subconjunto de `families` que `auth` chama pela raiz, na MESMA transação de `register`
 * (modules.md §3.7, UC-MEM-05/BR-MEM-12/13/17) — mesmo critério de `UsersPort`.
 */
export interface FamiliesPort<Trx> {
  resolveDependentAccountInvitation(
    trx: Trx,
    token: string,
    email: string,
  ): Promise<ResolvedDependentAccountInvitation>;
  finalizeDependentAccountInvitation(
    trx: Trx,
    input: FinalizeDependentAccountInvitationInput,
    context: RequestContext,
  ): Promise<void>;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

/** Porta de e-mail (sem esperar pelo módulo `notifications`, M8 — CLAUDE.md M1 §4). */
export interface Mailer {
  send(email: SentEmail): Promise<void>;
}

export interface AuthDeps<Trx> {
  usersPort: UsersPort<Trx>;
  families: FamiliesPort<Trx>;
  authTokenRepo: AuthTokenRepository<Trx>;
  sessionRepo: SessionRepository<Trx>;
  audit: AuditPort<Trx>;
  withTransaction: WithTransaction<Trx>;
  /** Ligação não transacional (leituras fora de escrita, ex.: resolver sessão no refresh). */
  db: Trx;
  clock: Clock;
  mailer: Mailer;
  rateLimiter: InMemoryRateLimiter;
  signingKeys: SigningKey[];
  accessTtlSeconds: number;
  refreshTtlMs: number;
  appBaseUrl: string;
  /** `TERMS_VERSION` (config), lida uma única vez na composition root (B6). */
  currentTermsVersion: string;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}
