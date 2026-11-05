// Sessão com refresh token rotativo do portal da seguradora (ADR-021): cadeia própria,
// independente de `sessions`/`clinic_sessions`.
export interface InsuranceSession {
  id: string;
  insuranceAccountId: string;
  refreshTokenHash: string;
  tokenChainId: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  revokedAt?: Date;
  lastUsedAt: Date;
  createdAt: Date;
}
