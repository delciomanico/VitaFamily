// Entidades puras do espaço de identidade do profissional (BR-MKT-13): SEM ligação a `users`, `family_members` nem `clinic_accounts`.
import type { ProfessionalValidationStatus } from "./validation-status.js";

export type ProfessionalAccountStatus = "PENDING_VERIFICATION" | "ACTIVE";

export interface ProfessionalAccount {
  id: string;
  email: string;
  passwordHash: string;
  status: ProfessionalAccountStatus;
  emailVerifiedAt?: Date;
  termsAcceptedVersion: string;
  createdAt: Date;
}

/** Referência mínima ao perfil, para o token e o login (o estado de validação lê-se da BD por pedido, BR-MKT-29). */
export interface ProfessionalRef {
  id: string;
  accountId: string;
  validationStatus: ProfessionalValidationStatus;
}
