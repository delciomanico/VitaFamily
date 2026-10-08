// Portas do módulo `access` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir da API pública de `families`
// (modules.md §2: `access` depende de `families`). Genéricas em `Trx` para que esta camada nunca
// importe "kysely" (banido em domain/application, conventions.md §3.9) nem o tipo `FamilyMember`
// de `families` (decoupling — mesmo critério do `UserLookup` em `families/application/ports.ts`).
import type { AuditEvent } from "../../audit/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { DataCategory, SharingGrant } from "../domain/sharing-grant.js";

/** Subconjunto de `FamilyMember` (families) de que `access` precisa para resolver relações. */
export interface MemberFacts {
  id: string;
  familyId: string;
  name: string;
  isDependent: boolean;
  status: "ACTIVE" | "BLOCKED";
}

/**
 * Subconjunto da API pública de `families` que `access` consome pela raiz (modules.md §2).
 * authorization.md §2 passos 3/5: pertença do actor e relação `TUTOR_OF`.
 */
export interface FamiliesPort<Trx> {
  findMemberByUserId(trx: Trx, familyId: string, userId: string): Promise<MemberFacts | null>;
  findMemberById(trx: Trx, familyId: string, memberId: string): Promise<MemberFacts | null>;
  isGuardianOf(trx: Trx, familyId: string, dependentId: string, guardianId: string): Promise<boolean>;
}

export interface NewSharingGrantRecord {
  id: string;
  familyId: string;
  ownerMemberId: string;
  granteeMemberId?: string;
  category: DataCategory;
  grantedBy: string;
  createdAt: Date;
}

/** `sharing_grants` (schema.md §2) — propriedade exclusiva de `access` (conventions.md §3.5). */
export interface SharingGrantsRepository<Trx> {
  listByOwner(trx: Trx, familyId: string, ownerMemberId: string): Promise<SharingGrant[]>;
  /** "Partilhado comigo": concessões onde `granteeMemberId = granteeId` OU é nulo (toda a família). */
  listForGrantee(trx: Trx, familyId: string, granteeId: string): Promise<SharingGrant[]>;
  hasGrant(trx: Trx, familyId: string, ownerMemberId: string, granteeId: string, category: DataCategory): Promise<boolean>;
  /** BR-PRV-04: substitui atomicamente todas as concessões do dono (PUT idempotente). */
  replaceForOwner(trx: Trx, familyId: string, ownerMemberId: string, grants: NewSharingGrantRecord[]): Promise<SharingGrant[]>;
}

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface AccessDeps<Trx> {
  sharingGrantsRepo: SharingGrantsRepository<Trx>;
  familiesPort: FamiliesPort<Trx>;
  audit: AuditPort<Trx>;
  /** Ligação não transacional, para leituras que não escrevem (ex.: `getSharing`, `sharedWithMe`). */
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}
