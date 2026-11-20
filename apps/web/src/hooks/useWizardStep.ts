import { useCallback, useState } from 'react'

/** Passo atual de um assistente: `next`/`back` nunca saem do intervalo; `back` no primeiro passo chama `onExit`. */
export function useWizardStep(total: number, onExit: () => void) {
  const [step, setStep] = useState(0)
  const next = useCallback(() => setStep((current) => Math.min(current + 1, total - 1)), [total])
  const back = useCallback(() => {
    if (step === 0) onExit()
    else setStep((current) => current - 1)
  }, [step, onExit])
  return { step, next, back, last: step === total - 1 }
}
