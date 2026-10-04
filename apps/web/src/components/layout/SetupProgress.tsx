interface SetupProgressProps {
  step: number
  total: number
}

/** Indicador “Passo X de Y” da configuração inicial. */
export function SetupProgress({ step, total }: SetupProgressProps) {
  const percent = Math.round((step / total) * 100)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-muted">
        Passo {step} de {total}
      </p>
      <div
        role="progressbar"
        aria-label="Progresso da configuração"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
