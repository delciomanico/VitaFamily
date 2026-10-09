// Portas do módulo `families` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou injetadas pela raiz. Genéricas em `Trx` para que esta camada
// nunca importe "kysely" (banido em domain/application, conventions.md §3.9).
import type { AuditEvent } from "../../audit/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { Family } from "../domain/family.js";
import type { Guardianship } from "../domain/guardianship.js";
import type { Invitation, InvitationStatus, InvitationType } from "../domain/invitation.js";
import type { BloodType, FamilyMember, FamilyRole } from "../domain/member.js";
import type { InMemoryRateLimiter } from "../domain/rate-limiter.js";

export interface NewFamilyRecord {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
}

export interface NewMemberRecord {
  id: string;
  familyId: string;
  userId?: string;
  name: string;
  birthDate: string;
  role?: FamilyRole;
  isDependent: boolean;
  createdAt: Date;
}

/** `null` remove explicitamente o campo (ex.: `role: null` ao desmarcar Admin sem conta). */
export interface MemberChanges {
  userId?: string | null;
  name?: string;
  birthDate?: string;
  role?: FamilyRole | null;
  isDependent?: boolean;
}

export interface NewGuardianshipRecord {
  familyId: string;
  dependentId: string;
  guardianId: string;
  isPrimary: boolean;
  createdAt: Date;
}

export interface NewInvitationRecord {
  id: string;
  familyId: string;
  email: string;
  type: InvitationType;
  memberId?: string;
  tokenHash: string;
  expiresAt: Date;
  invitedBy: string;
  createdAt: Date;
}

/** `families` (schema.md §2). */
export interface FamiliesRepository<Trx> {
  insert(trx: Trx, record: NewFamilyRecord): Promise<Family>;
  findById(trx: Trx, familyId: string): Promise<Family | null>;
  listForUser(trx: Trx, userId: string): Promise<Family[]>;
  countForUser(trx: Trx, userId: string): Promise<number>;
  updateName(trx: Trx, familyId: string, name: string): Promise<Family>;
  delete(trx: Trx, familyId: string): Promise<void>;
}

/**
 * `family_members` — conventions.md §3.4: toda consulta exige `familyId` (nunca "por id" sozinho),
 * para o isolamento entre famílias ser impossível de contornar por acidente (ADR-008, AC-ISO-01).
 */
export interface MembersRepository<Trx> {
  insert(trx: Trx, record: NewMemberRecord): Promise<FamilyMember>;
  findById(trx: Trx, familyId: string, memberId: string): Promise<FamilyMember | null>;
  findByUserId(trx: Trx, familyId: string, userId: string): Promise<FamilyMember | null>;
  /** Família(s) de que `userId` é membro — só para `listFamilies`/"myRole" (FR-FAM-02). */
  listFamilyIdsForUser(trx: Trx, userId: string): Promise<{ familyId: string; role: FamilyRole }[]>;
  listByFamily(trx: Trx, familyId: string): Promise<FamilyMember[]>;
  countByFamily(trx: Trx, familyId: string): Promise<number>;
  countActiveAdmins(trx: Trx, familyId: string): Promise<number>;
  update(trx: Trx, familyId: string, memberId: string, changes: MemberChanges): Promise<FamilyMember>;
  delete(trx: Trx, familyId: string, memberId: string): Promise<void>;
  /** FR-HP-01 (modules.md §3 nota 9): `health-records` consome estas duas pela raiz; a autorização
   * (categoria ALLERGIES) já foi decidida por `access.policy.can()` antes de chegar aqui. */
  getBloodType(trx: Trx, familyId: string, memberId: string): Promise<BloodType | null>;
  setBloodType(trx: Trx, familyId: string, memberId: string, bloodType: BloodType): Promise<BloodType>;
}

/** `guardianships` (schema.md §2: FK composta + único parcial `is_primary`). */
export interface GuardianshipsRepository<Trx> {
  insert(trx: Trx, record: NewGuardianshipRecord): Promise<Guardianship>;
  find(trx: Trx, familyId: string, dependentId: string, guardianId: string): Promise<Guardianship | null>;
  listByDependent(trx: Trx, familyId: string, dependentId: string): Promise<Guardianship[]>;
  listByGuardian(trx: Trx, familyId: string, guardianId: string): Promise<Guardianship[]>;
  delete(trx: Trx, familyId: string, dependentId: string, guardianId: string): Promise<void>;
  deleteAllForDependent(trx: Trx, familyId: string, dependentId: string): Promise<void>;
  /** Atómico: `isPrimary=false` em todos os outros tutores do dependente, `true` neste. */
  setPrimary(trx: Trx, familyId: string, dependentId: string, guardianId: string): Promise<void>;
}

/** `invitations` (schema.md §2). */
export interface InvitationsRepository<Trx> {
  insert(trx: Trx, record: NewInvitationRecord): Promise<Invitation>;
  findById(trx: Trx, familyId: string, invitationId: string): Promise<Invitation | null>;
  findByTokenHash(trx: Trx, tokenHash: string): Promise<Invitation | null>;
  listByFamily(trx: Trx, familyId: string): Promise<Invitation[]>;
  countPending(trx: Trx, familyId: string): Promise<number>;
  updateStatus(trx: Trx, id: string, status: InvitationStatus): Promise<void>;
  markAccepted(trx: Trx, id: string, acceptedBy: string, acceptedAt: Date): Promise<void>;
}

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

export interface UserLookup {
  id: string;
  email: string;
  name: string;
  birthDate: string;
}

/** Subconjunto de `users` que `families` chama pela raiz (modules.md: `families` depende de `users`). */
export interface UsersPort<Trx> {
  byId(trx: Trx, id: string): Promise<UserLookup | null>;
  byEmail(trx: Trx, email: string): Promise<UserLookup | null>;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

/** Porta de e-mail (sem esperar pelo módulo `notifications`, M8 — mesmo critério de `auth`). */
export interface Mailer {
  send(email: SentEmail): Promise<void>;
}

export interface FamiliesDeps<Trx> {
  familiesRepo: FamiliesRepository<Trx>;
  membersRepo: MembersRepository<Trx>;
  guardianshipsRepo: GuardianshipsRepository<Trx>;
  invitationsRepo: InvitationsRepository<Trx>;
  usersPort: UsersPort<Trx>;
  audit: AuditPort<Trx>;
  /** Ligação não transacional, para leituras que não escrevem (ex.: `listFamilies`). */
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
  mailer: Mailer;
  /** Para o link no e-mail de convite (`APP_BASE_URL`). */
  appBaseUrl: string;
  invitationRateLimiter: InMemoryRateLimiter;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}
