// Fakes em memória das portas de `access` para testes de casos de uso (mesmo padrão de
// `modules/families/application/fixtures.ts`). Não é ficheiro de teste.
import type { Clock } from "../../../platform/clock/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { DataCategory, SharingGrant } from "../domain/sharing-grant.js";
import type {
  AccessDeps,
  AuditPort,
  FamiliesPort,
  MemberFacts,
  NewSharingGrantRecord,
  SharingGrantsRepository,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

/** Membro "seedado" com conta ligada por omissão (FamilyMember sem conta nunca é actor). */
export interface SeedMember extends MemberFacts {
  userId?: string;
}

export class FakeFamiliesPort implements FamiliesPort<FakeTrx> {
  readonly members = new Map<string, SeedMember>();
  readonly guardianships = new Set<string>();

  async findMemberByUserId(_trx: FakeTrx, familyId: string, userId: string): Promise<MemberFacts | null> {
    for (const member of this.members.values()) {
      if (member.familyId === familyId && member.userId === userId) {
        return Promise.resolve(member);
      }
    }
    return Promise.resolve(null);
  }

  async findMemberById(_trx: FakeTrx, familyId: string, memberId: string): Promise<MemberFacts | null> {
    const member = this.members.get(memberId);
    return Promise.resolve(member?.familyId === familyId ? member : null);
  }

  async isGuardianOf(_trx: FakeTrx, _familyId: string, dependentId: string, guardianId: string): Promise<boolean> {
    return Promise.resolve(this.guardianships.has(`${dependentId}:${guardianId}`));
  }

  seedMember(member: SeedMember): void {
    this.members.set(member.id, member);
  }

  seedGuardianship(dependentId: string, guardianId: string): void {
    this.guardianships.add(`${dependentId}:${guardianId}`);
  }
}

export class FakeSharingGrantsRepository implements SharingGrantsRepository<FakeTrx> {
  readonly rows: SharingGrant[] = [];

  async listByOwner(_trx: FakeTrx, familyId: string, ownerMemberId: string): Promise<SharingGrant[]> {
    return Promise.resolve(this.rows.filter((r) => r.familyId === familyId && r.ownerMemberId === ownerMemberId));
  }

  async listForGrantee(_trx: FakeTrx, familyId: string, granteeId: string): Promise<SharingGrant[]> {
    return Promise.resolve(
      this.rows.filter(
        (r) => r.familyId === familyId && (r.granteeMemberId === granteeId || r.granteeMemberId === undefined),
      ),
    );
  }

  async hasGrant(
    _trx: FakeTrx,
    familyId: string,
    ownerMemberId: string,
    granteeId: string,
    category: DataCategory,
  ): Promise<boolean> {
    return Promise.resolve(
      this.rows.some(
        (r) =>
          r.familyId === familyId &&
          r.ownerMemberId === ownerMemberId &&
          r.category === category &&
          (r.granteeMemberId === granteeId || r.granteeMemberId === undefined),
      ),
    );
  }

  async replaceForOwner(
    _trx: FakeTrx,
    familyId: string,
    ownerMemberId: string,
    grants: NewSharingGrantRecord[],
  ): Promise<SharingGrant[]> {
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      if (this.rows[i]?.familyId === familyId && this.rows[i]?.ownerMemberId === ownerMemberId) {
        this.rows.splice(i, 1);
      }
    }
    const inserted = grants.map((grant) => {
      const row: SharingGrant = {
        id: grant.id,
        familyId: grant.familyId,
        ownerMemberId: grant.ownerMemberId,
        category: grant.category,
        grantedBy: grant.grantedBy,
        createdAt: grant.createdAt,
        ...(grant.granteeMemberId !== undefined ? { granteeMemberId: grant.granteeMemberId } : {}),
      };
      this.rows.push(row);
      return row;
    });
    return Promise.resolve(inserted);
  }

  seed(grant: SharingGrant): void {
    this.rows.push(grant);
  }
}

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];

  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export interface AccessFixtures {
  deps: AccessDeps<FakeTrx>;
  familiesPort: FakeFamiliesPort;
  sharingGrantsRepo: FakeSharingGrantsRepository;
  audit: FakeAuditPort;
}

export function createAccessFixtures(clock: Clock): AccessFixtures {
  const familiesPort = new FakeFamiliesPort();
  const sharingGrantsRepo = new FakeSharingGrantsRepository();
  const audit = new FakeAuditPort();
  const deps: AccessDeps<FakeTrx> = {
    sharingGrantsRepo,
    familiesPort,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, familiesPort, sharingGrantsRepo, audit };
}
