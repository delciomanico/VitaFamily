// Raiz do módulo `families` (ADR-015/conventions.md §1): única API pública importável por outros
// módulos e pelo composition root (`main/api.ts`). M2 (plan.md): família, membros, dependentes,
// tutela, convites, limites, papéis — exceto fluxos de ciclo de vida (M9) e autorização por
// categoria de dados de saúde (`AccessPolicy`, M3). As verificações em `application/membership.ts`
// (`requireAdmin`, `assertCanActOnMember`, `assertCanManageGuardians`) são invariantes estruturais
// da própria entidade `FamilyMember`/`Guardianship` (authorization.md §4: ações estruturais —
// convites, papéis, tutela) e ficam aqui, não em `access`: `access` depende de `families`
// (modules.md §2) e nunca o inverso, pelo que não poderia substituir chamadas feitas por este
// módulo sem um ciclo. `AccessPolicy.can()` (M3) decide a matriz de categorias de dados de saúde
// (authorization.md §3) e a gestão de `SharingGrant` para os módulos de saúde (M4+), consultando
// as operações cruas abaixo (mesmo critério de `UsersModule.byId`/`byEmail`).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AuditModule } from "../audit/index.js";
import type { UsersModule } from "../users/index.js";
import type { FamilyMember } from "./domain/member.js";
import { createAcceptInvitationUseCase } from "./application/accept-invitation.js";
import { createAddGuardianUseCase } from "./application/add-guardian.js";
import { createCreateDependentAccountInvitationUseCase } from "./application/create-dependent-account-invitation.js";
import { createCreateFamilyUseCase } from "./application/create-family.js";
import { createCreateInvitationUseCase } from "./application/create-invitation.js";
import { createCreateMemberUseCase } from "./application/create-member.js";
import { createDeleteFamilyUseCase } from "./application/delete-family.js";
import {
  createFinalizeDependentAccountInvitationUseCase,
  type FinalizeDependentAccountInvitationInput,
} from "./application/finalize-dependent-account-invitation.js";
import { createGetFamilyUseCase } from "./application/get-family.js";
import { createGetMemberUseCase } from "./application/get-member.js";
import { createLeaveFamilyUseCase } from "./application/leave-family.js";
import { createListFamiliesUseCase } from "./application/list-families.js";
import { createListGuardiansUseCase } from "./application/list-guardians.js";
import { createListInvitationsUseCase } from "./application/list-invitations.js";
import { createListMembersUseCase } from "./application/list-members.js";
import { createLookupInvitationUseCase } from "./application/lookup-invitation.js";
import {
  createResolveDependentAccountInvitationUseCase,
  type ResolvedDependentAccountInvitation,
} from "./application/resolve-dependent-account-invitation.js";
import { InMemoryRateLimiter } from "./domain/rate-limiter.js";
import type { FamiliesDeps, Mailer, RequestContext } from "./application/ports.js";
import { createRemoveGuardianUseCase } from "./application/remove-guardian.js";
import { createRemoveMemberUseCase } from "./application/remove-member.js";
import { createRequestDependentExportUseCase } from "./application/request-dependent-export.js";
import { createRevokeInvitationUseCase } from "./application/revoke-invitation.js";
import { createSetDependentUseCase } from "./application/set-dependent.js";
import { createSetMemberRoleUseCase } from "./application/set-member-role.js";
import { createSetPrimaryGuardianUseCase } from "./application/set-primary-guardian.js";
import { createUpdateFamilyUseCase } from "./application/update-family.js";
import { createUpdateMemberUseCase } from "./application/update-member.js";
import {
  KyselyFamiliesRepository,
  KyselyGuardianshipsRepository,
  KyselyInvitationsRepository,
  KyselyMembersRepository,
} from "./infrastructure/repo.js";
import { createFamiliesRouter, type FamiliesController } from "./interface/router.js";

export type { Family } from "./domain/family.js";
export type { Guardianship } from "./domain/guardianship.js";
export type { Invitation, InvitationStatus, InvitationType } from "./domain/invitation.js";
export type { FamilyMember, FamilyRole, MemberStatus } from "./domain/member.js";
export type { Mailer, SentEmail } from "./application/ports.js";
export type { ResolvedDependentAccountInvitation } from "./application/resolve-dependent-account-invitation.js";
export type { FinalizeDependentAccountInvitationInput } from "./application/finalize-dependent-account-invitation.js";
export { SmtpMailer } from "./infrastructure/mailer-smtp.js";

export interface FamiliesModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  users: UsersModule;
  clock: Clock;
  mailer: Mailer;
  /** `APP_BASE_URL` (config) — link no e-mail de convite. */
  appBaseUrl: string;
}

export interface FamiliesModule {
  router: Router;
  // Operações cruas para o módulo `auth` chamar dentro da MESMA transação de `POST /auth/register`
  // (modules.md §3.7, UC-MEM-05/BR-MEM-12/13/17) — mesmo critério de `UsersModule.createAccount`.
  resolveDependentAccountInvitation: (
    trx: Kysely<Database>,
    token: string,
    email: string,
  ) => Promise<ResolvedDependentAccountInvitation>;
  finalizeDependentAccountInvitation: (
    trx: Kysely<Database>,
    input: FinalizeDependentAccountInvitationInput,
    context: RequestContext,
  ) => Promise<void>;
  // Operações cruas para o módulo `access` consumir pela raiz (modules.md §2: `access` depende de
  // `families`) — mesmo critério de `UsersModule.byId`/`byEmail`. `AccessPolicy.can()` (M3)
  // resolve pertença (authorization.md §2 passo 3) e a relação `TUTOR_OF` (passo 5) só por aqui;
  // nunca acede às tabelas `family_members`/`guardianships` diretamente (conventions.md §3.5).
  findMemberByUserId: (trx: Kysely<Database>, familyId: string, userId: string) => Promise<FamilyMember | null>;
  findMemberById: (trx: Kysely<Database>, familyId: string, memberId: string) => Promise<FamilyMember | null>;
  isGuardianOf: (trx: Kysely<Database>, familyId: string, dependentId: string, guardianId: string) => Promise<boolean>;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createFamiliesModule(deps: FamiliesModuleDeps): FamiliesModule {
  const familiesRepo = new KyselyFamiliesRepository();
  const membersRepo = new KyselyMembersRepository();
  const guardianshipsRepo = new KyselyGuardianshipsRepository();
  const invitationsRepo = new KyselyInvitationsRepository();

  const familiesDeps: FamiliesDeps<Kysely<Database>> = {
    familiesRepo,
    membersRepo,
    guardianshipsRepo,
    invitationsRepo,
    usersPort: {
      byId: deps.users.byId,
      byEmail: deps.users.byEmail,
    },
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    mailer: deps.mailer,
    appBaseUrl: deps.appBaseUrl,
    invitationRateLimiter: new InMemoryRateLimiter(deps.clock),
  };

  const controller: FamiliesController = {
    createFamily: createCreateFamilyUseCase(familiesDeps),
    listFamilies: createListFamiliesUseCase(familiesDeps),
    getFamily: createGetFamilyUseCase(familiesDeps),
    updateFamily: createUpdateFamilyUseCase(familiesDeps),
    deleteFamily: createDeleteFamilyUseCase(familiesDeps),
    leaveFamily: createLeaveFamilyUseCase(familiesDeps),

    listMembers: createListMembersUseCase(familiesDeps),
    createMember: createCreateMemberUseCase(familiesDeps),
    getMember: createGetMemberUseCase(familiesDeps),
    updateMember: createUpdateMemberUseCase(familiesDeps),
    removeMember: createRemoveMemberUseCase(familiesDeps),
    setMemberRole: createSetMemberRoleUseCase(familiesDeps),
    setDependent: createSetDependentUseCase(familiesDeps),

    listGuardians: createListGuardiansUseCase(familiesDeps),
    addGuardian: createAddGuardianUseCase(familiesDeps),
    removeGuardian: createRemoveGuardianUseCase(familiesDeps),
    setPrimaryGuardian: createSetPrimaryGuardianUseCase(familiesDeps),
    requestDependentExport: createRequestDependentExportUseCase(familiesDeps),

    listInvitations: createListInvitationsUseCase(familiesDeps),
    createInvitation: createCreateInvitationUseCase(familiesDeps),
    revokeInvitation: createRevokeInvitationUseCase(familiesDeps),
    createDependentAccountInvitation: createCreateDependentAccountInvitationUseCase(familiesDeps),
    lookupInvitation: createLookupInvitationUseCase(familiesDeps),
    acceptInvitation: createAcceptInvitationUseCase(familiesDeps),
  };

  return {
    router: createFamiliesRouter(controller),
    resolveDependentAccountInvitation: createResolveDependentAccountInvitationUseCase(familiesDeps),
    finalizeDependentAccountInvitation: createFinalizeDependentAccountInvitationUseCase(familiesDeps),
    findMemberByUserId: (trx, familyId, userId) => membersRepo.findByUserId(trx, familyId, userId),
    findMemberById: (trx, familyId, memberId) => membersRepo.findById(trx, familyId, memberId),
    isGuardianOf: async (trx, familyId, dependentId, guardianId) =>
      (await guardianshipsRepo.find(trx, familyId, dependentId, guardianId)) !== null,
  };
}
