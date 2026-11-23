import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ButtonLink } from '@/components/ui/Button'

/** Linha plana de um par «rótulo — valor», com linha fina por baixo. */
export function StatRow({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <span className="flex min-w-0 flex-col">
        <span className="text-base">{label}</span>
        {hint && <span className="text-sm text-muted">{hint}</span>}
      </span>
      <span className="shrink-0 text-lg font-semibold tabular-nums">{value}</span>
    </div>
  )
}

/** Estado vazio plano: frase útil e, se houver, uma ação (nunca um cartão flutuante). */
export function EmptyNote({ title, description, actionLabel, to }: { title: string; description?: string; actionLabel?: string; to?: string }) {
  return (
    <div className="flex flex-col items-start gap-3 py-2">
      <div>
        <p className="text-base font-semibold">{title}</p>
        {description && <p className="text-base text-muted">{description}</p>}
      </div>
      {actionLabel && to && (
        <ButtonLink to={to} variant="soft" size="lg">
          {actionLabel}
        </ButtonLink>
      )}
    </div>
  )
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-semibold text-primary underline-offset-4 hover:underline">
      {children}
    </Link>
  )
}
