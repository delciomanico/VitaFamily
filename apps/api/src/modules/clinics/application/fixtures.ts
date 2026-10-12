// Fakes em memória das portas de `clinics` (mesmo padrão de `prescriptions`/`health-records`
// `application/fixtures.ts`). Não é ficheiro de teste.
import type { Clock } from "../../../platform/clock/index.js";
import type { Logger } from "../../../platform/logger/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Clinic, ClinicStatus } from "../domain/clinic.js";
import type { ClinicAccount, ClinicAccountStatus } from "../domain/clinic-account.js";
import { ClinicInMemoryRateLimiter } from "../domain/clinic-rate-limiter.js";
import type { ClinicSession } from "../domain/clinic-session.js";
import type {
  AccessPort,
  AuditPort,
  ClinicAccountCredentialsReset,
  ClinicAccountRepository,
  ClinicChanges,
  ClinicListFilter,
  ClinicMailer,
  ClinicSentEmail,
  ClinicSessionRepository,
  ClinicsDeps,
  ClinicsRepository,
  MembershipFacts,
  NewClinicAccountRecord,
  NewClinicRecord,
  NewClinicSessionRecord,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

export class FakeAccessPort implements AccessPort<FakeTrx> {
  readonly membersByFamily = new Map<string, MembershipFacts>();

  async getMembershipFacts(_trx: FakeTrx, familyId: string, userId: string): Promise<MembershipFacts | null> {
    return Promise.resolve(this.membersByFamily.get(`${familyId}|${userId}`) ?? null);
  }

  seed(familyId: string, userId: string, facts: MembershipFacts): void {
    this.membersByFamily.set(`${familyId}|${userId}`, facts);
  }
}

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];

  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export class FakeClinicsRepository implements ClinicsRepository<FakeTrx> {
  readonly byId = new Map<string, Clinic>();

  async insert(_trx: FakeTrx, record: NewClinicRecord): Promise<Clinic> {
    const clinic: Clinic = {
      id: record.id,
      type: record.type,
      name: record.name,
      status: "ACTIVE",
      createdAt: record.createdAt,
      ...(record.familyId !== undefined ? { familyId: record.familyId } : {}),
      ...(record.address !== undefined ? { address: record.address } : {}),
      ...(record.phone !== undefined ? { phone: record.phone } : {}),
      ...(record.email !== undefined ? { email: record.email } : {}),
      ...(record.createdBy !== undefined ? { createdBy: record.createdBy } : {}),
    };
    this.byId.set(clinic.id, clinic);
    return Promise.resolve(clinic);
  }

  async findById(_trx: FakeTrx, clinicId: string): Promise<Clinic | null> {
    return Promise.resolve(this.byId.get(clinicId) ?? null);
  }

  async listVisibleToFamily(_trx: FakeTrx, familyId: string, filter: ClinicListFilter): Promise<Clinic[]> {
    return Promise.resolve(
      [...this.byId.values()].filter(
        (clinic) => (clinic.type === "PARTNER" || clinic.familyId === familyId) && (!filter.status || clinic.status === filter.status),
      ),
    );
  }

  async listPartners(_trx: FakeTrx, filter: ClinicListFilter): Promise<Clinic[]> {
    return Promise.resolve([...this.byId.values()].filter((clinic) => clinic.type === "PARTNER" && (!filter.status || clinic.status === filter.status)));
  }

  async countPrivateByFamily(_trx: FakeTrx, familyId: string): Promise<number> {
    return Promise.resolve([...this.byId.values()].filter((clinic) => clinic.type === "PRIVATE" && clinic.familyId === familyId).length);
  }

  async update(_trx: FakeTrx, clinicId: string, changes: ClinicChanges): Promise<Clinic> {
    const clinic = this.requireClinic(clinicId);
    const updated: Clinic = { ...clinic };
    if (changes.name !== undefined) updated.name = changes.name;
    if (changes.address === null) delete updated.address;
    else if (changes.address !== undefined) updated.address = changes.address;
    if (changes.phone === null) delete updated.phone;
    else if (changes.phone !== undefined) updated.phone = changes.phone;
    if (changes.email === null) delete updated.email;
    else if (changes.email !== undefined) updated.email = changes.email;
    this.byId.set(clinicId, updated);
    return Promise.resolve(updated);
  }

  async updateStatus(_trx: FakeTrx, clinicId: string, status: ClinicStatus): Promise<Clinic> {
    const clinic = this.requireClinic(clinicId);
    const updated: Clinic = { ...clinic, status };
    this.byId.set(clinicId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, clinicId: string): Promise<void> {
    this.byId.delete(clinicId);
    return Promise.resolve();
  }

  private requireClinic(clinicId: string): Clinic {
    const clinic = this.byId.get(clinicId);
    if (!clinic) {
      throw new Error("clínica inexistente no fake");
    }
    return clinic;
  }

  seed(clinic: Clinic): void {
    this.byId.set(clinic.id, clinic);
  }
}

// --- Portal da clínica (D17/D18, ADR-020) ---

export class FakeClinicAccountRepository implements ClinicAccountRepository<FakeTrx> {
  readonly byId = new Map<string, ClinicAccount>();

  async insert(_trx: FakeTrx, record: NewClinicAccountRecord): Promise<ClinicAccount> {
    const account: ClinicAccount = {
      id: record.id,
      clinicId: record.clinicId,
      email: record.email,
      passwordHash: record.passwordHash,
      role: record.role,
      status: "ACTIVE",
      createdAt: record.createdAt,
      ...(record.createdByPlatformAdmin !== undefined ? { createdByPlatformAdmin: record.createdByPlatformAdmin } : {}),
    };
    this.byId.set(account.id, account);
    return Promise.resolve(account);
  }

  async findById(_trx: FakeTrx, id: string): Promise<ClinicAccount | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  async findByEmail(_trx: FakeTrx, email: string): Promise<ClinicAccount | null> {
    for (const account of this.byId.values()) {
      if (account.email === email) {
        return Promise.resolve(account);
      }
    }
    return Promise.resolve(null);
  }

  async findActiveAdminByClinic(_trx: FakeTrx, clinicId: string): Promise<ClinicAccount | null> {
    for (const account of this.byId.values()) {
      if (account.clinicId === clinicId && account.role === "CLINIC_ADMIN" && account.status === "ACTIVE") {
        return Promise.resolve(account);
      }
    }
    return Promise.resolve(null);
  }

  async resetCredentials(_trx: FakeTrx, id: string, changes: ClinicAccountCredentialsReset, _now: Date): Promise<ClinicAccount> {
    const account = this.byId.get(id);
    if (!account) {
      throw new Error("conta de clínica inexistente no fake");
    }
    const updated: ClinicAccount = { ...account, email: changes.email, passwordHash: changes.passwordHash };
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }

  async updateStatus(_trx: FakeTrx, id: string, status: ClinicAccountStatus, now: Date): Promise<ClinicAccount> {
    const account = this.byId.get(id);
    if (!account) {
      throw new Error("conta de clínica inexistente no fake");
    }
    const updated: ClinicAccount = { ...account, status, ...(status === "SUSPENDED" ? { suspendedAt: now } : {}) };
    if (status !== "SUSPENDED") {
      delete updated.suspendedAt;
    }
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }

  seed(account: ClinicAccount): void {
    this.byId.set(account.id, account);
  }
}

export class FakeClinicSessionRepository implements ClinicSessionRepository<FakeTrx> {
  readonly sessions = new Map<string, ClinicSession>();

  async insert(_trx: FakeTrx, record: NewClinicSessionRecord): Promise<ClinicSession> {
    const session: ClinicSession = { ...record, lastUsedAt: record.createdAt };
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  async findByRefreshTokenHash(_trx: FakeTrx, refreshTokenHash: string): Promise<ClinicSession | null> {
    for (const session of this.sessions.values()) {
      if (session.refreshTokenHash === refreshTokenHash) {
        return Promise.resolve(session);
      }
    }
    return Promise.resolve(null);
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
}

export class FakeClinicMailer implements ClinicMailer {
  readonly sent: ClinicSentEmail[] = [];

  async send(email: ClinicSentEmail): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }
}

/** Só a parte do `pino.Logger` usada por `send-clinic-mail.ts`. */
export class FakeClinicLogger {
  readonly warnings: { obj: unknown; msg: string }[] = [];

  warn(obj: unknown, msg: string): void {
    this.warnings.push({ obj, msg });
  }
}

export interface ClinicsFixtures {
  deps: ClinicsDeps<FakeTrx>;
  clinicsRepo: FakeClinicsRepository;
  access: FakeAccessPort;
  audit: FakeAuditPort;
  clinicAccountRepo: FakeClinicAccountRepository;
  clinicSessionRepo: FakeClinicSessionRepository;
  clinicMailer: FakeClinicMailer;
  clinicLogger: FakeClinicLogger;
}

export function createClinicsFixtures(clock: Clock): ClinicsFixtures {
  const clinicsRepo = new FakeClinicsRepository();
  const access = new FakeAccessPort();
  const audit = new FakeAuditPort();
  const clinicAccountRepo = new FakeClinicAccountRepository();
  const clinicSessionRepo = new FakeClinicSessionRepository();
  const clinicMailer = new FakeClinicMailer();
  const clinicLogger = new FakeClinicLogger();
  const deps: ClinicsDeps<FakeTrx> = {
    clinicsRepo,
    access,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
    clinicAccountRepo,
    clinicSessionRepo,
    clinicMailer,
    logger: clinicLogger as unknown as Logger,
    clinicRateLimiter: new ClinicInMemoryRateLimiter(clock),
    clinicSigningKeys: [{ kid: "test", secret: new TextEncoder().encode("a".repeat(32)) }],
    clinicAccessTtlSeconds: 900,
    clinicRefreshTtlMs: 30 * 24 * 60 * 60 * 1000,
  };
  return { deps, clinicsRepo, access, audit, clinicAccountRepo, clinicSessionRepo, clinicMailer, clinicLogger };
}
