// Entidade pura `ClinicAccount` (schema.md §1, ADR-020/D18): conta do portal da clínica parceira,
// SEM qualquer ligação a `users`/`family_members` (ADR-020 — identidade deliberadamente separada).
// Sem I/O.

export type ClinicAccountRole = "CLINIC_ADMIN" | "CLINIC_MANAGER";
export type ClinicAccountStatus = "ACTIVE" | "SUSPENDED";

export interface ClinicAccount {
  id: string;
  clinicId: string;
  email: string;
  passwordHash: string;
  role: ClinicAccountRole;
  status: ClinicAccountStatus;
  /** Preenchido só na conta `CLINIC_ADMIN` raiz, criada/reposta pelo Platform Admin (BR-CLN-05). */
  createdByPlatformAdmin?: string;
  suspendedAt?: Date;
  createdAt: Date;
}
