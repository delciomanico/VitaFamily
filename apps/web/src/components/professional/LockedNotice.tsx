import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'

/** Aviso de campos/ações bloqueados (PROFESSIONAL_LOCKED, OP-59/OP-62): `role="note"` para leitores de ecrã. */
export function LockedNotice({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-md bg-surface-muted px-3.5 py-3 text-sm text-muted">
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}
