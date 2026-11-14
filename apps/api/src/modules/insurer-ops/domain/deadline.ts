// Prazos do pedido de autorização (BR-AUT-06/08/14): funções PURAS com o relógio injetado como argumento. Os VALORES
// (horas/dias) nunca vivem aqui: vêm de `resolvePolicySetting` (BR-SEG-40, TC-AUT-18). Sem imports fora de `domain/`.

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** BR-AUT-06: `decisionDueAt = agora + AUTHORIZATION_DECISION_HOURS` (informativo; nunca aprova por silêncio). */
export function calcularPrazoDecisao(now: Date, decisionHours: number): Date {
  return new Date(now.getTime() + decisionHours * MS_PER_HOUR);
}

/** BR-AUT-14: `infoExpiresAt = pedido de informação + INFO_REQUEST_EXPIRY_DAYS` (guardado ao entrar em `INFO_REQUESTED`). */
export function calcularLimiteInformacao(requestedAt: Date, expiryDays: number): Date {
  return new Date(requestedAt.getTime() + expiryDays * MS_PER_DAY);
}

/** BR-AUT-08: fim do prazo de recurso = decisão + APPEAL_REQUEST_DAYS. */
export function calcularLimiteRecurso(decidedAt: Date, appealDays: number): Date {
  return new Date(decidedAt.getTime() + appealDays * MS_PER_DAY);
}
