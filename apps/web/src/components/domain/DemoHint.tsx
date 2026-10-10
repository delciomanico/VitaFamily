import { FlaskConical } from 'lucide-react'
import { DEMO_INVITATION_CODE } from '@/mocks/data/families'
import { DEMO_CLINIC_EMAIL, DEMO_EMAIL, DEMO_PASSWORD, DEMO_VERIFICATION_CODE } from '@/mocks/data/users'

/*
 * Ajuda do modo de demonstração. É o ÚNICO componente que lê dados mock diretamente
 * e deve ser removido quando a API real substituir os mocks.
 */

type Kind = 'login' | 'verification' | 'invitation'

const content: Record<Kind, string[]> = {
  login: [`Família: ${DEMO_EMAIL}`, `Clínica: ${DEMO_CLINIC_EMAIL}`, `Palavra-passe: ${DEMO_PASSWORD}`],
  verification: [`Use o código ${DEMO_VERIFICATION_CODE}`],
  invitation: [`Use o código ${DEMO_INVITATION_CODE}`],
}

interface DemoHintProps {
  kind: Kind
  /** Preenche o formulário com os dados de demonstração. */
  onFill?: () => void
  /** Várias contas para preencher (ex.: Família e Clínica no login). */
  fillOptions?: Array<{ label: string; onFill: () => void }>
}

export function DemoHint({ kind, onFill, fillOptions }: DemoHintProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border-strong px-3.5 py-3 text-sm">
      <FlaskConical className="size-4 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Modo demonstração</p>
        {content[kind].map((line) => (
          <p key={line} className="break-words text-muted">
            {line}
          </p>
        ))}
      </div>
      {onFill && (
        <button type="button" onClick={onFill} className="shrink-0 font-medium text-primary hover:underline">
          Preencher
        </button>
      )}
      {fillOptions && (
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {fillOptions.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={option.onFill}
              aria-label={`Preencher conta ${option.label.toLowerCase()}`}
              className="font-medium text-primary hover:underline"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export const demoCredentials = { email: DEMO_EMAIL, password: DEMO_PASSWORD }
/** Gestor da clínica parceira de demonstração (portal da clínica, D17). */
export const demoClinicCredentials = { email: DEMO_CLINIC_EMAIL, password: DEMO_PASSWORD }
export const demoInvitationCode = DEMO_INVITATION_CODE
