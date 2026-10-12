// Regra pura de hierarquia do portal da clínica (BR-CLN-05, authorization.md §6.3): só o
// `CLINIC_ADMIN` administra os `CLINIC_MANAGER` da sua própria clínica — nunca o Platform Admin
// (que só cria/repõe a conta `CLINIC_ADMIN` raiz, Fase B), nunca outra clínica. Sem I/O: quem é o
// ator já vem decidido pelo `ClinicActorInfo` (ADR-020, resolvido no middleware); isto só valida a
// forma da ação sobre o estado já carregado.
import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import type { ClinicAccount, ClinicAccountRole } from "./clinic-account.js";

export interface ClinicStaffActor {
  clinicId: string;
  role: ClinicAccountRole;
}

/** BR-CLN-05: só `CLINIC_ADMIN` cria/lista/remove contas `CLINIC_MANAGER`. */
export function assertCanManageStaff(actor: ClinicStaffActor): void {
  if (actor.role !== "CLINIC_ADMIN") {
    throw new ForbiddenError({ detail: "Só o CLINIC_ADMIN gere Gestores da clínica." });
  }
}

/**
 * endpoints.md `removeClinicStaff`: só remove contas `CLINIC_MANAGER` da própria clínica (nunca a
 * `CLINIC_ADMIN` raiz, nunca de outra clínica — `NOT_FOUND`, sem enumeração do motivo,
 * authorization.md §6.1 passo 2). Devolve o alvo validado para quem chama continuar a operação.
 */
export function assertRemovableStaffTarget(actor: ClinicStaffActor, target: ClinicAccount | null): ClinicAccount {
  if (target?.clinicId !== actor.clinicId || target.role !== "CLINIC_MANAGER") {
    throw new NotFoundError({ detail: "Conta não encontrada." });
  }
  return target;
}
