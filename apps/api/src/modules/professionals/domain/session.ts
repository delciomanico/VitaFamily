// Sessão com refresh rotativo do portal do profissional (BR-MKT-29, ADR-020): cadeia própria, independente de `User` e de clínica.
export interface ProfessionalSession {
  id: string;
  accountId: string;
  refreshTokenHash: string;
  tokenChainId: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  revokedAt?: Date;
  lastUsedAt: Date;
  createdAt: Date;
}
