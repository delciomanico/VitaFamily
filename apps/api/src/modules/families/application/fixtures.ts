// Fakes em memória das portas de `families` para testes de casos de uso. Não é ficheiro de teste
// (mesmo padrão de modules/users/application/fixtures.ts).
import type { Clock } from "../../../platform/clock/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Family } from "../domain/family.js";
import type { Guardianship } from "../domain/guardianship.js";
import type { Invitation, InvitationStatus } from "../domain/invitation.js";
import type { BloodType, FamilyMember, FamilyRole } from "../domain/member.js";
import { InMemoryRateLimiter } from "../domain/rate-limiter.js";
import type {
  AuditPort,
  FamiliesDeps,
  FamiliesRepository,
  GuardianshipsRepository,
  InvitationsRepository,
  Mailer,
  MemberChanges,
  MembersRepository,
  NewFamilyRecord,
  NewGuardianshipRecord,
  NewInvitationRecord,
  NewMemberRecord,
  SentEmail,
  UserLookup,
  UsersPort,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

export class FakeFamiliesRepository implements FamiliesRepository<FakeTrx> {
  readonly byId = new Map<string, Family>();

  async insert(_trx: FakeTrx, record: NewFamilyRecord): Promise<Family> {
    const family: Family = { id: record.id, name: record.name, createdBy: record.createdBy, createdAt: record.createdAt };
    this.byId.set(family.id, family);
    return Promise.resolve(family);
  }

  async findById(_trx: FakeTrx, familyId: string): Promise<Family | null> {
    return Promise.resolve(this.byId.get(familyId) ?? null);
  }

  async listForUser(_trx: FakeTrx, userId: string): Promise<Family[]> {
    return Promise.resolve([...this.byId.values()].filter((f) => f.createdBy === userId));
  }

  async countForUser(_trx: FakeTrx, userId: string): Promise<number> {
    const families = await this.listForUser(_trx, userId);
    return families.length;
  }

  async updateName(_trx: FakeTrx, familyId: string, name: string): Promise<Family> {
    const family = this.byId.get(familyId);
    if (!family) throw new Error("família inexistente no fake");
    const updated = { ...family, name };
    this.byId.set(familyId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, familyId: string): Promise<void> {
    this.byId.delete(familyId);
    return Promise.resolve();
  }

  seed(family: Family): void {
    this.byId.set(family.id, family);
  }
}

export class FakeMembersRepository implements MembersRepository<FakeTrx> {
  readonly byId = new Map<string, FamilyMember>();
  /** `blood_type` não faz parte do objeto `FamilyMember` em memória (mesmo critério do repositório
   * Kysely real: coluna própria, só exposta por `getBloodType`/`setBloodType`). */
  readonly bloodTypes = new Map<string, BloodType>();

  async insert(_trx: FakeTrx, record: NewMemberRecord): Promise<FamilyMember> {
    const member: FamilyMember = {
      id: record.id,
      familyId: record.familyId,
      name: record.name,
      birthDate: record.birthDate,
      isDependent: record.isDependent,
      status: "ACTIVE",
      createdAt: record.createdAt,
      ...(record.userId !== undefined ? { userId: record.userId } : {}),
      ...(record.role !== undefined ? { role: record.role } : {}),
    };
    this.byId.set(member.id, member);
    return Promise.resolve(member);
  }

  async findById(_trx: FakeTrx, familyId: string, memberId: string): Promise<FamilyMember | null> {
    const member = this.byId.get(memberId);
    return Promise.resolve(member?.familyId === familyId ? member : null);
  }

  async findByUserId(_trx: FakeTrx, familyId: string, userId: string): Promise<FamilyMember | null> {
    for (const member of this.byId.values()) {
      if (member.familyId === familyId && member.userId === userId) {
        return Promise.resolve(member);
      }
    }
    return Promise.resolve(null);
  }

  async listFamilyIdsForUser(_trx: FakeTrx, userId: string): Promise<{ familyId: string; role: FamilyRole }[]> {
    const out: { familyId: string; role: FamilyRole }[] = [];
    for (const member of this.byId.values()) {
      if (member.userId === userId && member.role) {
        out.push({ familyId: member.familyId, role: member.role });
      }
    }
    return Promise.resolve(out);
  }

  async listByFamily(_trx: FakeTrx, familyId: string): Promise<FamilyMember[]> {
    return Promise.resolve([...this.byId.values()].filter((m) => m.familyId === familyId));
  }

  async countByFamily(_trx: FakeTrx, familyId: string): Promise<number> {
    return (await this.listByFamily(_trx, familyId)).length;
  }

  async countActiveAdmins(_trx: FakeTrx, familyId: string): Promise<number> {
    const members = await this.listByFamily(_trx, familyId);
    return members.filter((m) => m.role === "FAMILY_ADMIN" && m.status === "ACTIVE").length;
  }

  async update(_trx: FakeTrx, familyId: string, memberId: string, changes: MemberChanges): Promise<FamilyMember> {
    const member = this.byId.get(memberId);
    if (member?.familyId !== familyId) throw new Error("membro inexistente no fake");
    const updated: FamilyMember = { ...member };
    if (changes.name !== undefined) updated.name = changes.name;
    if (changes.birthDate !== undefined) updated.birthDate = changes.birthDate;
    if (changes.isDependent !== undefined) updated.isDependent = changes.isDependent;
    if (changes.userId === null) delete updated.userId;
    else if (changes.userId !== undefined) updated.userId = changes.userId;
    if (changes.role === null) delete updated.role;
    else if (changes.role !== undefined) updated.role = changes.role;
    this.byId.set(memberId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, familyId: string, memberId: string): Promise<void> {
    const member = this.byId.get(memberId);
    if (member?.familyId === familyId) {
      this.byId.delete(memberId);
    }
    return Promise.resolve();
  }

  async getBloodType(_trx: FakeTrx, familyId: string, memberId: string): Promise<BloodType | null> {
    const member = this.byId.get(memberId);
    if (member?.familyId !== familyId) return Promise.resolve(null);
    return Promise.resolve(this.bloodTypes.get(memberId) ?? null);
  }

  async setBloodType(_trx: FakeTrx, familyId: string, memberId: string, bloodType: BloodType): Promise<BloodType> {
    const member = this.byId.get(memberId);
    if (member?.familyId !== familyId) throw new Error("membro inexistente no fake");
    this.bloodTypes.set(memberId, bloodType);
    return Promise.resolve(bloodType);
  }

  seed(member: FamilyMember): void {
    this.byId.set(member.id, member);
  }
}

export class FakeGuardianshipsRepository implements GuardianshipsRepository<FakeTrx> {
  readonly rows: Guardianship[] = [];

  async insert(_trx: FakeTrx, record: NewGuardianshipRecord): Promise<Guardianship> {
    const row: Guardianship = { ...record };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  async find(_trx: FakeTrx, familyId: string, dependentId: string, guardianId: string): Promise<Guardianship | null> {
    return Promise.resolve(
      this.rows.find((r) => r.familyId === familyId && r.dependentId === dependentId && r.guardianId === guardianId) ?? null,
    );
  }

  async listByDependent(_trx: FakeTrx, familyId: string, dependentId: string): Promise<Guardianship[]> {
    return Promise.resolve(this.rows.filter((r) => r.familyId === familyId && r.dependentId === dependentId));
  }

  async listByGuardian(_trx: FakeTrx, familyId: string, guardianId: string): Promise<Guardianship[]> {
    return Promise.resolve(this.rows.filter((r) => r.familyId === familyId && r.guardianId === guardianId));
  }

  async delete(_trx: FakeTrx, familyId: string, dependentId: string, guardianId: string): Promise<void> {
    const idx = this.rows.findIndex(
      (r) => r.familyId === familyId && r.dependentId === dependentId && r.guardianId === guardianId,
    );
    if (idx >= 0) this.rows.splice(idx, 1);
    return Promise.resolve();
  }

  async deleteAllForDependent(_trx: FakeTrx, familyId: string, dependentId: string): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      if (this.rows[i]?.familyId === familyId && this.rows[i]?.dependentId === dependentId) {
        this.rows.splice(i, 1);
      }
    }
    return Promise.resolve();
  }

  async setPrimary(_trx: FakeTrx, familyId: string, dependentId: string, guardianId: string): Promise<void> {
    for (const row of this.rows) {
      if (row.familyId === familyId && row.dependentId === dependentId) {
        row.isPrimary = row.guardianId === guardianId;
      }
    }
    return Promise.resolve();
  }
}

export class FakeInvitationsRepository implements InvitationsRepository<FakeTrx> {
  readonly byId = new Map<string, Invitation>();

  async insert(_trx: FakeTrx, record: NewInvitationRecord): Promise<Invitation> {
    const invitation: Invitation = {
      id: record.id,
      familyId: record.familyId,
      email: record.email,
      type: record.type,
      tokenHash: record.tokenHash,
      status: "PENDING",
      expiresAt: record.expiresAt,
      invitedBy: record.invitedBy,
      createdAt: record.createdAt,
      ...(record.memberId !== undefined ? { memberId: record.memberId } : {}),
    };
    this.byId.set(invitation.id, invitation);
    return Promise.resolve(invitation);
  }

  async findById(_trx: FakeTrx, familyId: string, invitationId: string): Promise<Invitation | null> {
    const invitation = this.byId.get(invitationId);
    return Promise.resolve(invitation?.familyId === familyId ? invitation : null);
  }

  async findByTokenHash(_trx: FakeTrx, tokenHash: string): Promise<Invitation | null> {
    for (const invitation of this.byId.values()) {
      if (invitation.tokenHash === tokenHash) return Promise.resolve(invitation);
    }
    return Promise.resolve(null);
  }

  async listByFamily(_trx: FakeTrx, familyId: string): Promise<Invitation[]> {
    return Promise.resolve([...this.byId.values()].filter((i) => i.familyId === familyId));
  }

  async countPending(_trx: FakeTrx, familyId: string): Promise<number> {
    const invitations = await this.listByFamily(_trx, familyId);
    return invitations.filter((i) => i.status === "PENDING").length;
  }

  async updateStatus(_trx: FakeTrx, id: string, status: InvitationStatus): Promise<void> {
    const invitation = this.byId.get(id);
    if (invitation) this.byId.set(id, { ...invitation, status });
    return Promise.resolve();
  }

  async markAccepted(_trx: FakeTrx, id: string, acceptedBy: string, acceptedAt: Date): Promise<void> {
    const invitation = this.byId.get(id);
    if (invitation) this.byId.set(id, { ...invitation, status: "ACCEPTED", acceptedBy, acceptedAt });
    return Promise.resolve();
  }

  seed(invitation: Invitation): void {
    this.byId.set(invitation.id, invitation);
  }
}

export class FakeUsersPort implements UsersPort<FakeTrx> {
  readonly byIdMap = new Map<string, UserLookup>();

  async byId(_trx: FakeTrx, id: string): Promise<UserLookup | null> {
    return Promise.resolve(this.byIdMap.get(id) ?? null);
  }

  async byEmail(_trx: FakeTrx, email: string): Promise<UserLookup | null> {
    for (const user of this.byIdMap.values()) {
      if (user.email === email) return Promise.resolve(user);
    }
    return Promise.resolve(null);
  }

  /** `timezone` por defeito (M6, `getEffectiveTimezone`) — testes de `families` anteriores a M6
   * não precisam de o indicar explicitamente. */
  seed(user: { id: string; email: string; name: string; birthDate: string; timezone?: string }): void {
    this.byIdMap.set(user.id, { timezone: "Europe/Lisbon", ...user });
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

export interface FamiliesFixtures {
  deps: FamiliesDeps<FakeTrx>;
  familiesRepo: FakeFamiliesRepository;
  membersRepo: FakeMembersRepository;
  guardianshipsRepo: FakeGuardianshipsRepository;
  invitationsRepo: FakeInvitationsRepository;
  usersPort: FakeUsersPort;
  audit: FakeAuditPort;
  mailer: FakeMailer;
}

export function createFamiliesFixtures(clock: Clock, appBaseUrl = "https://vitafamily.cassfrei.com"): FamiliesFixtures {
  const familiesRepo = new FakeFamiliesRepository();
  const membersRepo = new FakeMembersRepository();
  const guardianshipsRepo = new FakeGuardianshipsRepository();
  const invitationsRepo = new FakeInvitationsRepository();
  const usersPort = new FakeUsersPort();
  const audit = new FakeAuditPort();
  const mailer = new FakeMailer();
  const deps: FamiliesDeps<FakeTrx> = {
    familiesRepo,
    membersRepo,
    guardianshipsRepo,
    invitationsRepo,
    usersPort,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
    mailer,
    appBaseUrl,
    invitationRateLimiter: new InMemoryRateLimiter(clock),
  };
  return { deps, familiesRepo, membersRepo, guardianshipsRepo, invitationsRepo, usersPort, audit, mailer };
}
