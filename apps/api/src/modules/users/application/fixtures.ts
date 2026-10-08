// Fakes em memória das portas de `users` para testes de casos de uso. Não é ficheiro de teste.
import type { Clock } from "../../../platform/clock/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { User } from "../domain/user.js";
import type { AuditPort, NewUserRecord, ProfileChanges, UsersDeps, UsersRepository } from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

export class FakeUsersRepository implements UsersRepository<FakeTrx> {
  readonly byId = new Map<string, User>();

  async insert(_trx: FakeTrx, record: NewUserRecord): Promise<User> {
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
    this.byId.set(user.id, user);
    return Promise.resolve(user);
  }

  async findByEmail(_trx: FakeTrx, email: string): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (user.email === email) {
        return Promise.resolve(user);
      }
    }
    return Promise.resolve(null);
  }

  async findById(_trx: FakeTrx, id: string): Promise<User | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  async updateProfile(_trx: FakeTrx, id: string, changes: ProfileChanges): Promise<User> {
    const user = this.byId.get(id);
    if (!user) {
      throw new Error("utilizador inexistente no fake");
    }
    const updated: User = { ...user, ...changes };
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }

  async updateTermsAcceptance(_trx: FakeTrx, id: string, version: string, acceptedAt: Date): Promise<User> {
    const user = this.byId.get(id);
    if (!user) {
      throw new Error("utilizador inexistente no fake");
    }
    const updated: User = { ...user, termsAcceptedVersion: version, termsAcceptedAt: acceptedAt };
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }

  async updateEmailVerified(_trx: FakeTrx, id: string, verifiedAt: Date): Promise<User> {
    const user = this.byId.get(id);
    if (!user) {
      throw new Error("utilizador inexistente no fake");
    }
    const updated: User = { ...user, status: "ACTIVE", emailVerifiedAt: verifiedAt };
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }

  async updatePasswordHash(_trx: FakeTrx, id: string, passwordHash: string): Promise<void> {
    const user = this.byId.get(id);
    if (user) {
      this.byId.set(id, { ...user, passwordHash });
    }
    return Promise.resolve();
  }

  seed(user: User): void {
    this.byId.set(user.id, user);
  }
}

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];

  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export interface UsersFixtures {
  deps: UsersDeps<FakeTrx>;
  usersRepo: FakeUsersRepository;
  audit: FakeAuditPort;
}

export function createUsersFixtures(clock: Clock, currentTermsVersion = "1.0.0"): UsersFixtures {
  const usersRepo = new FakeUsersRepository();
  const audit = new FakeAuditPort();
  const deps: UsersDeps<FakeTrx> = {
    usersRepo,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
    currentTermsVersion,
  };
  return { deps, usersRepo, audit };
}
