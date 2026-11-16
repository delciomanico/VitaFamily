import type { ProfessionalValidationStatus } from "../domain/validation-status.js";

/** Resultado de login/refresh (`ProfessionalTokenResponse` + refresh para o cookie). */
export interface ProfessionalLoginResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  professionalId: string;
  validationStatus: ProfessionalValidationStatus;
}
