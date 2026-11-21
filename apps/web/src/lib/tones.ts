/**
 * Cores de área da app móvel: cada zona tem a sua cor, usada só no «azulejo» do ícone e em blocos de cor.
 * As classes são literais (o Tailwind só gera o que encontra no código); `-ink` cumpre AA sobre `-soft`.
 */
export type Tone = 'brand' | 'health' | 'meds' | 'chat' | 'family' | 'attention'

export const toneTile: Record<Tone, string> = {
  brand: 'bg-primary-soft text-primary',
  health: 'bg-health-soft text-health-ink',
  meds: 'bg-meds-soft text-meds-ink',
  chat: 'bg-chat-soft text-chat-ink',
  family: 'bg-family-soft text-family-ink',
  attention: 'bg-warning-soft text-warning',
}

/** Bloco de cor inteiro (atalhos do Início): fundo suave e texto `-ink`. */
export const toneBlock: Record<Tone, string> = {
  brand: 'bg-surface text-primary shadow-card active:bg-primary-soft',
  health: 'bg-health-soft text-health-ink',
  meds: 'bg-meds-soft text-meds-ink',
  chat: 'bg-chat-soft text-chat-ink',
  family: 'bg-family-soft text-family-ink',
  attention: 'bg-warning-soft text-warning',
}

/** Contador: pastilha branca com o número na cor da área (≥ 4.5:1), legível sobre qualquer fundo da app. */
export const toneBadge: Record<Tone, string> = {
  brand: 'bg-[#fff] text-[#126883]',
  health: 'bg-[#fff] text-[#b3361f]',
  meds: 'bg-[#fff] text-[#5240b8]',
  chat: 'bg-[#fff] text-[#8f5400]',
  family: 'bg-[#fff] text-[#1b7444]',
  attention: 'bg-[#fff] text-[#9a5b00]',
}
