// Sessão com refresh token rotativo (entities.md "Session"; ADR-007). `tokenChainId` agrupa as
// rotações sucessivas de um mesmo login, para deteção de reutilização (AC-ACC-07).
export interface Session {
  id: string;
  userId: string;
  refreshTokenHash: string;
  tokenChainId: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  revokedAt?: Date;
  lastUsedAt: Date;
  createdAt: Date;
}

export function isSessionUsable(session: Session, now: Date): boolean {
  return !session.revokedAt && session.expiresAt.getTime() > now.getTime();
}
