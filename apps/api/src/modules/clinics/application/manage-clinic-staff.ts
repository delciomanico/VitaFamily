// Hierarquia de contas do portal (BR-CLN-05, D18, authorization.md §6.3): só o `CLINIC_ADMIN` da
// própria clínica cria/lista/remove os seus `CLINIC_MANAGER` — nunca o Platform Admin (Fase B: só
// cria/repõe a conta `CLINIC_ADMIN` raiz), nunca outra clínica. endpoints.md
// listClinicStaff/createClinicStaff/removeClinicStaff.
import { newId } from "../../../platform/ids/index.js";
import { ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { generateInitialClinicPassword, hashClinicPassword } from "../domain/clinic-account-password.js";
import type { ClinicAccount } from "../domain/clinic-account.js";
import { assertCanManageStaff, assertRemovableStaffTarget } from "../domain/clinic-staff-hierarchy.js";
import { trySendClinicMail } from "./send-clinic-mail.js";
import type { ClinicPortalActor, ClinicsDeps, RequestContext } from "./ports.js";

export interface CreateClinicStaffInput {
  email: string;
}

/** `POST /clinic-portal/staff` (ClinicStaffInput): a conta criada é sempre `CLINIC_MANAGER`
 * (BR-CLN-05); palavra-passe gerada pelo servidor, enviada só por e-mail (nunca na resposta). */
export function createCreateClinicStaffUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function createClinicStaff(actor: ClinicPortalActor, input: CreateClinicStaffInput, context: RequestContext): Promise<ClinicAccount> {
    assertCanManageStaff(actor);
    const email = input.email.trim().toLowerCase();

    const { account, password } = await deps.withTransaction(async (trx) => {
      const existing = await deps.clinicAccountRepo.findByEmail(trx, email);
      if (existing) {
        throw new ValidationError([{ field: "email", message: "já está em uso" }], {
          detail: "E-mail já associado a outra conta do portal.",
        });
      }

      const now = deps.clock.now();
      const generatedPassword = generateInitialClinicPassword();
      const passwordHash = await hashClinicPassword(generatedPassword);
      const newAccount = await deps.clinicAccountRepo.insert(trx, {
        id: newId(),
        clinicId: actor.clinicId,
        email,
        passwordHash,
        role: "CLINIC_MANAGER",
        createdAt: now,
      });

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "CLINIC_STAFF_CREATE",
        resourceType: "ClinicAccount",
        resourceId: newAccount.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return { account: newAccount, password: generatedPassword };
    });

    // Best effort (send-clinic-mail.ts): a conta já está gravada; uma falha do SMTP não pode
    // transformar isto num 500 (mesmo critério de `adminCreateOrResetClinicRootAccount`).
    await trySendClinicMail(deps.clinicMailer, deps.logger, {
      to: account.email,
      subject: "Acesso ao Portal da Clínica Vita Family",
      text: `A sua palavra-passe de acesso ao Portal da Clínica é: ${password}`,
    });

    return account;
  };
}

/** `GET /clinic-portal/staff`: nunca lista a conta `CLINIC_ADMIN` de outra clínica — nem a própria,
 * só `CLINIC_MANAGER` (endpoints.md). */
export function createListClinicStaffUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function listClinicStaff(actor: ClinicPortalActor): Promise<ClinicAccount[]> {
    assertCanManageStaff(actor);
    return deps.withTransaction((trx) => deps.clinicAccountRepo.listByClinic(trx, actor.clinicId, "CLINIC_MANAGER"));
  };
}

/** `DELETE /clinic-portal/staff/{clinicAccountId}`: só remove `CLINIC_MANAGER` da própria clínica. */
export function createRemoveClinicStaffUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function removeClinicStaff(actor: ClinicPortalActor, clinicAccountId: string, context: RequestContext): Promise<void> {
    assertCanManageStaff(actor);

    await deps.withTransaction(async (trx) => {
      const target = await deps.clinicAccountRepo.findById(trx, clinicAccountId);
      assertRemovableStaffTarget(actor, target);

      await deps.clinicAccountRepo.delete(trx, clinicAccountId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "CLINIC_STAFF_REMOVE",
        resourceType: "ClinicAccount",
        resourceId: clinicAccountId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
