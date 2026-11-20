/** Barra de progresso de um fluxo por passos, com “2 / 4” ao lado (configuração, marcar consulta). */
export function StepProgress({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-valuetext={`Passo ${step} de ${total}`}
        className="mx-auto flex w-full max-w-56 gap-1.5"
      >
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className={`h-2.5 flex-1 rounded-full transition-colors duration-300 ${index < step ? 'bg-primary' : 'bg-border'}`} />
        ))}
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums" aria-hidden>
        {step} / {total}
      </span>
    </>
  )
}
