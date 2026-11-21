/**
 * Cores de área da app móvel: cada zona tem a sua cor, usada só no «azulejo» do ícone e em blocos de cor.
 * As classes são literais (o Tailwind só gera o que encontra no código); `-ink` cumpre AA sobre `-soft`.
 */
export type Tone = 'brand' | 'health' | 'meds' | 'chat' | 'family' | 'attention'

export const toneTile: Record<Tone, string> = {
  brand: 'on-light bg-[#e3f3f9] text-[#126883]',
  health: 'bg-health-soft text-health-ink',
  meds: 'bg-meds-soft text-meds-ink',
  chat: 'bg-chat-soft text-chat-ink',
  family: 'bg-family-soft text-family-ink',
  attention: 'bg-warning-soft text-warning',
}

/** Bloco de cor inteiro (atalhos do Início): fundo suave e texto `-ink`. */
export const toneBlock: Record<Tone, string> = {
  brand: 'on-light bg-[#e3f3f9] text-[#126883] active:bg-[#d3ebf4]',
  health: 'bg-health-soft text-health-ink',
  meds: 'bg-meds-soft text-meds-ink',
  chat: 'bg-chat-soft text-chat-ink',
  family: 'bg-family-soft text-family-ink',
  attention: 'bg-warning-soft text-warning',
}

/** Cor sólida do contador (texto branco por cima, ≥ 4.5:1). */
export const toneBadge: Record<Tone, string> = {
  brand: 'bg-[#126883]',
  health: 'bg-health-ink',
  meds: 'bg-meds-ink',
  chat: 'bg-chat-ink',
  family: 'bg-family-ink',
  attention: 'bg-warning',
}
