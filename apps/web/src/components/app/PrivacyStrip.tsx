import { useId, useState } from 'react'
import { ChevronDown, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Faixa discreta de privacidade da conversa: o aviso fixo (BR-MKT-46) fica sempre visível numa linha;
 * «Saber mais» recolhe/expande a explicação.
 */
export function PrivacyStrip({ warning }: { warning: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="shrink-0 border-b border-border bg-primary-soft px-4 py-2 text-primary">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 text-xs leading-5">{warning}</p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-12 shrink-0 items-center gap-1 rounded-full px-2 text-sm font-medium"
        >
          Saber mais
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </div>
      {open && (
        <p id={id} className="pb-2 ps-7 text-sm leading-5 text-foreground">
          As mensagens podem ter dados de saúde: ficam só entre si e a família. A Vita Family só vê uma mensagem se alguém a denunciar (e as 2 anteriores). Para partilhar registos, use a partilha com prazo.
        </p>
      )}
    </div>
  )
}
