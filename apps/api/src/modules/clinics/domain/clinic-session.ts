// Sessão com refresh token rotativo do portal da clínica (ADR-020: equivalente a
// `auth/domain/session.ts`, mas para `clinic_accounts`/`clinic_sessions` — cadeia de rotações
// própria, independente das sessões de `User`). Duplicado deliberadamente (CLAUDE.md: "a separação
// de identidade é deliberada" — não importar nada de `modules/auth`).
export interface ClinicSession {
  id: string;
  clinicAccountId: string;
  refreshTokenHash: string;
  tokenChainId: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  revokedAt?: Date;
  lastUsedAt: Date;
  createdAt: Date;
}

export function isClinicSessionUsable(session: ClinicSession, now: Date): boolean {
  return !session.revokedAt && session.expiresAt.getTime() > now.getTime();
}
