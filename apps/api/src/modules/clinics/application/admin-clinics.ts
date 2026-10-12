// openapi.yaml `adminListClinics`/`adminCreateClinic`/`adminUpdateClinic`/`adminSetClinicStatus`:
// "Autorização: PLATFORM_ADMIN." UC-ADM-03/CLN-01/R8. Sem `familyId` (clínicas parceiras são
// globais); a verificação de `platformAdmin` é direta (mesmo critério de
// `access/application/policy.ts` passo 2, mas ao contrário: aqui o Platform Admin é EXIGIDO, não
// proibido — este endpoint nunca lida com dados de saúde). Não existe módulo `admin` ainda (M9,
// `plan.md` §4); por isso estas rotas ficam em `clinics` e são montadas diretamente em
// `main/api.ts` sob `/admin/clinics` (modules.md: "clinics… inclui a gestão de parceiras, exposta
// pelo admin através da API de clinics").
import { newId } from "../../../platform/ids/index.js";
import { ForbiddenError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidClinicName, type Clinic, type ClinicStatus } from "../domain/clinic.js";
import type { ClinicAccount } from "../domain/clinic-account.js";
import { generateInitialClinicPassword, hashClinicPassword } from "../domain/clinic-account-password.js";
import { trySendClinicMail } from "./send-clinic-mail.js";
import type { ActorIdentity, ClinicChanges, ClinicsDeps, NewClinicRecord, RequestContext } from "./ports.js";
import { requirePartnerClinic } from "./support.js";

function requirePlatformAdmin(actor: ActorIdentity): void {
  if (!actor.platformAdmin) {
    throw new ForbiddenError({ detail: "Só o Platform Admin gere clínicas parceiras." });
  }
}

export interface AdminClinicListQuery {
  status?: string;
}

function parseStatus(status?: string): ClinicStatus | undefined {
  return status === "ACTIVE" || status === "ARCHIVED" ? status : undefined;
}

export function createAdminListClinicsUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function adminListClinics(actor: ActorIdentity, query: AdminClinicListQuery): Promise<Clinic[]> {
    requirePlatformAdmin(actor);
    const status = parseStatus(query.status);
    return deps.withTransaction((trx) => deps.clinicsRepo.listPartners(trx, { ...(status ? { status } : {}) }));
  };
}

export interface AdminCreateClinicInput {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export function createAdminCreateClinicUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function adminCreateClinic(actor: ActorIdentity, input: AdminCreateClinicInput, context: RequestContext): Promise<Clinic> {
    requirePlatformAdmin(actor);
    const name = assertValidClinicName(input.name);

    return deps.withTransaction(async (trx) => {
      const now = deps.clock.now();
      const record: NewClinicRecord = {
        id: newId(),
        type: "PARTNER",
        name,
        createdBy: actor.userId,
        createdAt: now,
        ...(input.address ? { address: input.address } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.email ? { email: input.email } : {}),
      };
      const clinic = await deps.clinicsRepo.insert(trx, record);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_CLINIC_CREATE",
        resourceType: "Clinic",
        resourceId: clinic.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return clinic;
    });
  };
}

export interface AdminUpdateClinicInput {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export function createAdminUpdateClinicUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function adminUpdateClinic(actor: ActorIdentity, clinicId: string, input: AdminUpdateClinicInput, context: RequestContext): Promise<Clinic> {
    requirePlatformAdmin(actor);

    return deps.withTransaction(async (trx) => {
      await requirePartnerClinic(deps, trx, clinicId);

      const changes: ClinicChanges = {};
      if (input.name !== undefined && input.name !== null) {
        changes.name = assertValidClinicName(input.name);
      }
      if (input.address !== undefined) changes.address = input.address;
      if (input.phone !== undefined) changes.phone = input.phone;
      if (input.email !== undefined) changes.email = input.email;

      const updated = await deps.clinicsRepo.update(trx, clinicId, changes);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_CLINIC_UPDATE",
        resourceType: "Clinic",
        resourceId: clinicId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return updated;
    });
  };
}

export interface AdminClinicRootAccountInput {
  email: string;
}

/**
 * `POST /admin/clinics/{clinicId}/root-account` (endpoints.md "adminCreateOrResetClinicRootAccount",
 * BR-CLN-05, D18): única via do Platform Admin para o portal da clínica — cria a conta
 * `CLINIC_ADMIN` raiz (primeira vez) ou repõe-lhe as credenciais (reset), nunca cria uma segunda
 * (idempotente por clínica, UNIQUE parcial `(clinic_id) WHERE role='CLINIC_ADMIN' AND
 * status='ACTIVE'`, schema.md). A palavra-passe é sempre gerada pelo servidor e só sai por e-mail
 * (nunca no corpo da resposta, openapi.yaml `ClinicRootAccountRequest`).
 */
export function createAdminClinicRootAccountUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function adminCreateOrResetClinicRootAccount(
    actor: ActorIdentity,
    clinicId: string,
    input: AdminClinicRootAccountInput,
    context: RequestContext,
  ): Promise<ClinicAccount> {
    requirePlatformAdmin(actor);
    const email = input.email.trim().toLowerCase();

    const { account, password } = await deps.withTransaction(async (trx) => {
      await requirePartnerClinic(deps, trx, clinicId);

      const existingByEmail = await deps.clinicAccountRepo.findByEmail(trx, email);
      const existingAdmin = await deps.clinicAccountRepo.findActiveAdminByClinic(trx, clinicId);
      if (existingByEmail && existingByEmail.id !== existingAdmin?.id) {
        throw new ValidationError([{ field: "email", message: "já está em uso" }], {
          detail: "E-mail já associado a outra conta do portal.",
        });
      }

      const now = deps.clock.now();
      const generatedPassword = generateInitialClinicPassword();
      const passwordHash = await hashClinicPassword(generatedPassword);

      const resultAccount = existingAdmin
        ? await deps.clinicAccountRepo.resetCredentials(trx, existingAdmin.id, { email, passwordHash }, now)
        : await deps.clinicAccountRepo.insert(trx, {
            id: newId(),
            clinicId,
            email,
            passwordHash,
            role: "CLINIC_ADMIN",
            createdByPlatformAdmin: actor.userId,
            createdAt: now,
          });

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_CLINIC_ROOT_ACCOUNT_CREATE",
        resourceType: "ClinicAccount",
        resourceId: resultAccount.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return { account: resultAccount, password: generatedPassword };
    });

    // Best effort (send-clinic-mail.ts): a conta/credencial já está gravada; uma falha do SMTP não
    // pode transformar isto num 500 — o Platform Admin pode repetir o pedido (idempotente).
    await trySendClinicMail(deps.clinicMailer, deps.logger, {
      to: account.email,
      subject: "Acesso ao Portal da Clínica Vita Family",
      text: `A sua palavra-passe de acesso ao Portal da Clínica é: ${password}`,
    });

    return account;
  };
}

export interface AdminSetClinicStatusInput {
  status: ClinicStatus;
}

export function createAdminSetClinicStatusUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function adminSetClinicStatus(actor: ActorIdentity, clinicId: string, input: AdminSetClinicStatusInput, context: RequestContext): Promise<Clinic> {
    requirePlatformAdmin(actor);

    return deps.withTransaction(async (trx) => {
      await requirePartnerClinic(deps, trx, clinicId);
      const updated = await deps.clinicsRepo.updateStatus(trx, clinicId, input.status);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_CLINIC_STATUS",
        resourceType: "Clinic",
        resourceId: clinicId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { status: input.status },
      });

      return updated;
    });
  };
}
