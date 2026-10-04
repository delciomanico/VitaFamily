/** Barra de progresso de um fluxo por passos, com “2 / 4” ao lado (configuração, marcar consulta). */
export function StepProgress({ step, total, label }: { step: number; total: number; label: string }) {
  const percent = Math.round((step / total) * 100)
  return (
    <>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-valuetext={`Passo ${step} de ${total}`}
        className="mx-auto h-2 w-full max-w-48 overflow-hidden rounded-full bg-surface-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums" aria-hidden>
        {step} / {total}
      </span>
    </>
  )
}
