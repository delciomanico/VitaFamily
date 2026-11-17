import { useState } from 'react'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { ValidationStatusBadge } from '@/components/professional/ValidationStatusBadge'
import { Button } from '@/components/ui/Button'
import { Card, CardLink, Section } from '@/components/ui/Card'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/errors'
import { formatShortDate, formatWhen } from '@/lib/format'
import { requirementLabel, validationStatusHint } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'

/** Estado de validação do profissional (UC-MKT-12) e submissão para análise (UC-MKT-05). */
export function ProfessionalHomePage() {
  usePageTitle('Estado da validação')
  const toast = useToast()
  const { state, reload, profile, rights } = useProfessionalProfile()
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  if (state.status === 'loading') {
    return (
      <>
        <h1 className="text-xl font-semibold">Estado da validação</h1>
        <LoadingState rows={2} />
      </>
    )
  }

  if (state.status === 'error' || !profile || !rights) {
    return (
      <>
        <h1 className="text-xl font-semibold">Estado da validação</h1>
        <ErrorState onRetry={reload} />
      </>
    )
  }

  async function submit() {
    setFormError(null)
    setSubmitting(true)
    try {
      await professionalPortalService.submit()
      toast.show('Enviado para validação.')
      reload()
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Estado da validação</h1>

      <Card className="flex flex-col gap-3 p-5">
        <ValidationStatusBadge status={profile.validationStatus} />
        <p className="text-sm text-muted">{validationStatusHint[profile.validationStatus]}</p>

        {profile.statusReason && (
          <div className="rounded-md bg-surface-muted px-3.5 py-3 text-sm">
            <p className="font-medium">Motivo da equipa</p>
            <p className="mt-1 whitespace-pre-line">{profile.statusReason}</p>
          </div>
        )}

        {(profile.submittedAt || profile.approvedAt) && (
          <dl className="flex flex-col gap-1 text-sm">
            {profile.submittedAt && (
              <div className="flex gap-2">
                <dt className="text-muted">Submetido</dt>
                <dd>{formatWhen(profile.submittedAt)}</dd>
              </div>
            )}
            {profile.approvedAt && (
              <div className="flex gap-2">
                <dt className="text-muted">Aprovado</dt>
                <dd>{formatShortDate(profile.approvedAt)}</dd>
              </div>
            )}
          </dl>
        )}

        {rights.readOnly && (
          <LockedNotice>
            Perfil em modo só de leitura: pode consultar os seus dados, mas não os pode alterar nem submeter para validação.
          </LockedNotice>
        )}
      </Card>

      {rights.submit && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-semibold">O que falta</h2>
          {profile.requirements.missing.length > 0 ? (
            <ul className="list-disc ps-5 text-sm">
              {profile.requirements.missing.map((requirement) => (
                <li key={requirement}>{requirementLabel[requirement]}</li>
              ))}
            </ul>
          ) : (
            profile.requirements.canSubmit && <p className="text-sm">Tem tudo o que é necessário.</p>
          )}
          <FormError message={formError} />
          <div>
            <Button onClick={submit} loading={submitting} disabled={!profile.requirements.canSubmit}>
              Submeter para validação
            </Button>
          </div>
        </Card>
      )}

      <Section title="Atalhos">
        <div className="flex flex-col gap-3">
          <CardLink to={paths.professionalProfile}>
            <p className="font-medium">Perfil</p>
            <p className="text-sm text-muted">Nome, cidade, biografia e especialidades</p>
          </CardLink>
          <CardLink to={paths.professionalCredentials}>
            <p className="font-medium">Credenciais</p>
            <p className="text-sm text-muted">Documento de identificação e cédula profissional</p>
          </CardLink>
          <CardLink to={paths.professionalOffers}>
            <p className="font-medium">Serviços e preços</p>
            <p className="text-sm text-muted">Ofertas e preços em Kz</p>
          </CardLink>
          <CardLink to={paths.professionalSchedule}>
            <p className="font-medium">Horários</p>
            <p className="text-sm text-muted">Dias e horas de atendimento (hora de Luanda)</p>
          </CardLink>
        </div>
      </Section>
    </div>
  )
}
