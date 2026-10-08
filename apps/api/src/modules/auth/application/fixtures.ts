// Fakes em memória das portas de `auth` para testes de casos de uso (conventions.md §4: "regras
// puras sem I/O em domain/application"). Não é um ficheiro de teste (sem `describe`/`it`) — só
// fixtures reutilizadas pelos `*.test.ts` deste módulo; `Trx` é só um marcador opaco (nenhuma
// biblioteca de I/O entra aqui).
import type { Clock } from "../../../platform/clock/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { NewUserRecord, User } from "../../users/index.js";
import type {
  AuditPort,
  AuthDeps,
  AuthToken,
  AuthTokenRepository,
  AuthTokenType,
  FamiliesPort,
  FinalizeDependentAccountInvitationInput,
  Mailer,
  NewAuthToken,
  NewSessionRecord,
  RequestContext,
  ResolvedDependentAccountInvitation,
  SentEmail,
  SessionRepository,
  UsersPort,
} from "./ports.js";
import type { Session } from "../domain/session.js";
import { InMemoryRateLimiter } from "../domain/rate-limiter.js";

/** Marcador opaco: os fakes não têm transações reais, só executam a função recebida. */
export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

export class FakeUsersPort implements UsersPort<FakeTrx> {
  readonly byIdMap = new Map<string, User>();

  constructor(private readonly clock: Clock) {}

  async createAccount(_trx: FakeTrx, record: NewUserRecord): Promise<User> {
    const user: User = {
      id: record.id,
      email: record.email,
      passwordHash: record.passwordHash,
      name: record.name,
      birthDate: record.birthDate,
      timezone: record.timezone,
      status: "PENDING_VERIFICATION",
      platformRole: "NONE",
      termsAcceptedVersion: record.termsAcceptedVersion,
      termsAcceptedAt: record.termsAcceptedAt,
      createdAt: record.createdAt,
    };
    this.byIdMap.set(user.id, user);
    return Promise.resolve(user);
  }

  async byEmail(_trx: FakeTrx, email: string): Promise<User | null> {
    for (const user of this.byIdMap.values()) {
      if (user.email === email) {
        return Promise.resolve(user);
      }
    }
    return Promise.resolve(null);
  }

  async byId(_trx: FakeTrx, id: string): Promise<User | null> {
    return Promise.resolve(this.byIdMap.get(id) ?? null);
  }

  async setEmailVerified(_trx: FakeTrx, id: string, verifiedAt: Date): Promise<User> {
    const user = this.byIdMap.get(id);
    if (!user) {
      throw new Error("utilizador inexistente no fake");
    }
    const updated: User = { ...user, status: "ACTIVE", emailVerifiedAt: verifiedAt };
    this.byIdMap.set(id, updated);
    return Promise.resolve(updated);
  }

  async setPasswordHash(_trx: FakeTrx, id: string, passwordHash: string): Promise<void> {
    const user = this.byIdMap.get(id);
    if (!user) {
      throw new Error("utilizador inexistente no fake");
    }
    this.byIdMap.set(id, { ...user, passwordHash });
    return Promise.resolve();
  }

  /** Atalho de preparação de fixtures (não faz parte da porta). */
  seed(user: User): void {
    this.byIdMap.set(user.id, user);
  }

  /** `ageInYears`/registo chamam `clock.now()`; exposto para quem monta o cenário. */
  now(): Date {
    return this.clock.now();
  }
}

export class FakeAuthTokenRepository implements AuthTokenRepository<FakeTrx> {
  readonly tokens = new Map<string, AuthToken>();

  async insert(_trx: FakeTrx, token: NewAuthToken): Promise<AuthToken> {
    const record: AuthToken = { ...token };
    this.tokens.set(record.id, record);
    return Promise.resolve(record);
  }

  async findValidByHash(
    _trx: FakeTrx,
    type: AuthTokenType,
    tokenHash: string,
    now: Date,
  ): Promise<AuthToken | null> {
    for (const token of this.tokens.values()) {
      if (
        token.type === type &&
        token.tokenHash === tokenHash &&
        !token.usedAt &&
        token.expiresAt.getTime() > now.getTime()
      ) {
        return Promise.resolve(token);
      }
    }
    return Promise.resolve(null);
  }

  async markUsed(_trx: FakeTrx, id: string, usedAt: Date): Promise<void> {
    const token = this.tokens.get(id);
    if (token) {
      this.tokens.set(id, { ...token, usedAt });
    }
    return Promise.resolve();
  }

  async invalidateAllForUser(
    _trx: FakeTrx,
    userId: string,
    type: AuthTokenType,
    now: Date,
  ): Promise<void> {
    for (const token of this.tokens.values()) {
      if (token.userId === userId && token.type === type && !token.usedAt) {
        this.tokens.set(token.id, { ...token, usedAt: now });
      }
    }
    return Promise.resolve();
  }
}

export class FakeSessionRepository implements SessionRepository<FakeTrx> {
  readonly sessions = new Map<string, Session>();

  async insert(_trx: FakeTrx, record: NewSessionRecord): Promise<Session> {
    const session: Session = { ...record, lastUsedAt: record.createdAt };
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  async findByRefreshTokenHash(_trx: FakeTrx, refreshTokenHash: string): Promise<Session | null> {
    for (const session of this.sessions.values()) {
      if (session.refreshTokenHash === refreshTokenHash) {
        return Promise.resolve(session);
      }
    }
    return Promise.resolve(null);
  }

  async findById(_trx: FakeTrx, id: string): Promise<Session | null> {
    return Promise.resolve(this.sessions.get(id) ?? null);
  }

  async revoke(_trx: FakeTrx, id: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session && !session.revokedAt) {
      this.sessions.set(id, { ...session, revokedAt });
    }
    return Promise.resolve();
  }

  async revokeChain(_trx: FakeTrx, tokenChainId: string, revokedAt: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.tokenChainId === tokenChainId && !session.revokedAt) {
        this.sessions.set(session.id, { ...session, revokedAt });
      }
    }
    return Promise.resolve();
  }

  async revokeAllForUser(_trx: FakeTrx, userId: string, revokedAt: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        this.sessions.set(session.id, { ...session, revokedAt });
      }
    }
    return Promise.resolve();
  }

  async revokeAllForUserExcept(
    _trx: FakeTrx,
    userId: string,
    exceptSessionId: string,
    revokedAt: Date,
  ): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.id !== exceptSessionId && !session.revokedAt) {
        this.sessions.set(session.id, { ...session, revokedAt });
      }
    }
    return Promise.resolve();
  }
}

/** Convite `DEPENDENT_ACCOUNT` fabricado para os testes de `register.ts` (UC-MEM-05). */
export interface FakeDependentInvitation {
  token: string;
  invitationId: string;
  familyId: string;
  memberId: string;
  email: string;
  birthDate: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
}

/**
 * Fake de `families` (modules.md §3.7): não reimplementa as regras de `families` (já testadas em
 * `families/application/*.test.ts`) — só devolve/regista o que `register.ts` precisa, por token
 * previamente `seed`ado.
 */
export class FakeFamiliesPort implements FamiliesPort<FakeTrx> {
  readonly invitationsByToken = new Map<string, FakeDependentInvitation>();
  readonly finalized: FinalizeDependentAccountInvitationInput[] = [];

  async resolveDependentAccountInvitation(
    _trx: FakeTrx,
    token: string,
    email: string,
  ): Promise<ResolvedDependentAccountInvitation> {
    const invitation = this.invitationsByToken.get(token);
    if (invitation?.status !== "PENDING") {
      throw new DomainError(invitation?.status === "EXPIRED" ? "INVITATION_EXPIRED" : "INVITATION_INVALID", {
        detail: "Convite inválido.",
      });
    }
    if (invitation.email.toLowerCase() !== email.toLowerCase()) {
      throw new DomainError("INVITATION_EMAIL_MISMATCH", { detail: "O e-mail não coincide com o convite." });
    }
    return Promise.resolve({
      invitationId: invitation.invitationId,
      familyId: invitation.familyId,
      memberId: invitation.memberId,
      birthDate: invitation.birthDate,
    });
  }

  async finalizeDependentAccountInvitation(
    _trx: FakeTrx,
    input: FinalizeDependentAccountInvitationInput,
    _context: RequestContext,
  ): Promise<void> {
    this.finalized.push(input);
    for (const invitation of this.invitationsByToken.values()) {
      if (invitation.invitationId === input.invitationId) {
        invitation.status = "ACCEPTED";
      }
    }
    return Promise.resolve();
  }

  seed(invitation: FakeDependentInvitation): void {
    this.invitationsByToken.set(invitation.token, invitation);
  }
}

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];

  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export class FakeMailer implements Mailer {
  readonly sent: SentEmail[] = [];

  async send(email: SentEmail): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }
}

export interface AuthFixtures {
  deps: AuthDeps<FakeTrx>;
  usersPort: FakeUsersPort;
  families: FakeFamiliesPort;
  authTokenRepo: FakeAuthTokenRepository;
  sessionRepo: FakeSessionRepository;
  audit: FakeAuditPort;
  mailer: FakeMailer;
}

export function createAuthFixtures(clock: Clock): AuthFixtures {
  const usersPort = new FakeUsersPort(clock);
  const families = new FakeFamiliesPort();
  const authTokenRepo = new FakeAuthTokenRepository();
  const sessionRepo = new FakeSessionRepository();
  const audit = new FakeAuditPort();
  const mailer = new FakeMailer();

  const deps: AuthDeps<FakeTrx> = {
    usersPort,
    families,
    authTokenRepo,
    sessionRepo,
    audit,
    withTransaction: (fn) => fn(FAKE_TRX),
    db: FAKE_TRX,
    clock,
    mailer,
    rateLimiter: new InMemoryRateLimiter(clock),
    signingKeys: [{ kid: "test", secret: new TextEncoder().encode("a".repeat(32)) }],
    accessTtlSeconds: 900,
    refreshTtlMs: 30 * 24 * 60 * 60 * 1000,
    appBaseUrl: "https://vitafamily.cassfrei.com",
    currentTermsVersion: "1.0.0",
  };

  return { deps, usersPort, families, authTokenRepo, sessionRepo, audit, mailer };
}
