import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Link2, Plus, Search, UserRound } from 'lucide-react'
import { WalkInBookingModal } from '@/components/clinic/WalkInBookingModal'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { clinicPatientsService } from '@/services/clinicPatients.service'
import type { ClinicPatient } from '@/types/clinic'
import { LinkPatientModal } from './LinkPatientModal'
import { PatientFormModal } from './PatientFormModal'
import { contactLine, sharingLabel } from './patientLabels'

const PAGE_SIZE = 25
const SEARCH_DELAY_MS = 250

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; items: ClinicPatient[]; nextCursor: string | null }

/**
 * Pacientes da clínica (UC-CLN-14, BR-CLN-17/22): lista paginada com pesquisa no registo da
 * própria clínica (nome, telefone ou e-mail), criar paciente de balcão e ligar um paciente Vita.
 */
export function ClinicPatientsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [creating, setCreating] = useState(false)
  const [linking, setLinking] = useState(false)
  const [bookEmail, setBookEmail] = useState<{ email: string; name: string } | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setTerm(q.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [q])

  const tooShort = term.length === 1
  useEffect(() => {
    if (tooShort) return
    let active = true
    setState({ status: 'loading' })
    clinicPatientsService.listPatients({ q: term || undefined, limit: PAGE_SIZE }).then(
      (page) => active && setState({ status: 'success', items: page.items, nextCursor: page.nextCursor }),
      () => active && setState({ status: 'error' }),
    )
    return () => {
      active = false
    }
  }, [term, tooShort, attempt])

  async function loadMore() {
    if (state.status !== 'success' || !state.nextCursor) return
    setLoadingMore(true)
    try {
      const page = await clinicPatientsService.listPatients({ q: term || undefined, limit: PAGE_SIZE, cursor: state.nextCursor })
      setState({ status: 'success', items: [...state.items, ...page.items], nextCursor: page.nextCursor })
    } catch (err) {
      toast.show(errorMessage(err), 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  const createButton = (
    <Button size="sm" onClick={() => setCreating(true)} icon={<Plus className="size-4" aria-hidden />}>
      Novo paciente
    </Button>
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pacientes</h1>
          <p className="text-sm text-muted">O registo da clínica, separado das contas Vita Family.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setLinking(true)} icon={<Link2 className="size-4" aria-hidden />}>
            Ligar paciente Vita
          </Button>
          {createButton}
        </div>
      </div>

      <div className="max-w-xl">
        <Input
          label="Pesquisar paciente"
          icon={Search}
          type="search"
          placeholder="Nome, telefone ou e-mail"
          autoComplete="off"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      {tooShort && <p className="text-sm text-muted">Escreva pelo menos 2 letras para pesquisar.</p>}
      {!tooShort && state.status === 'loading' && <LoadingState rows={4} />}
      {!tooShort && state.status === 'error' && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}
      {!tooShort && state.status === 'success' && state.items.length === 0 && (
        <EmptyState
          icon={UserRound}
          title={term ? 'Nenhum paciente encontrado.' : 'Ainda não há pacientes.'}
          description={
            term
              ? 'Confirme o nome, o telefone ou o e-mail. A pesquisa é só no registo da clínica.'
              : 'Crie o primeiro paciente ou ligue um paciente da Vita Family com o código dele.'
          }
          action={createButton}
        />
      )}
      {!tooShort && state.status === 'success' && state.items.length > 0 && (
        <>
          <Card className="divide-y divide-border py-1">
            {state.items.map((patient) => {
              const sharing = sharingLabel(patient)
              return (
                <Link
                  key={patient.id}
                  to={paths.clinicPatient(patient.id)}
                  className="flex items-center gap-3 py-3 transition-colors hover:bg-surface-muted/60"
                >
                  <Avatar name={patient.name} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{patient.name}</span>
                    <span className="block truncate text-sm text-muted">{contactLine(patient)}</span>
                  </span>
                  <Badge tone={sharing.tone} className="hidden sm:inline-flex">
                    {sharing.label}
                  </Badge>
                </Link>
              )
            })}
          </Card>
          {state.nextCursor && (
            <div className="flex justify-center">
              <Button variant="secondary" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
                Mostrar mais
              </Button>
            </div>
          )}
        </>
      )}

      {creating && (
        <PatientFormModal
          onClose={() => setCreating(false)}
          onSaved={(patient) => {
            setCreating(false)
            toast.show('Paciente criado.')
            navigate(paths.clinicPatient(patient.id))
          }}
        />
      )}
      {linking && (
        <LinkPatientModal
          onClose={() => setLinking(false)}
          onLinked={(patient) => {
            setLinking(false)
            toast.show('Paciente ligado.')
            navigate(paths.clinicPatient(patient.id))
          }}
          onBookWithEmail={(email, name) => {
            setLinking(false)
            setBookEmail({ email, name })
          }}
        />
      )}
      {bookEmail && (
        <WalkInBookingModal
          initialEmail={bookEmail}
          onClose={() => setBookEmail(null)}
          onBooked={() => {
            setBookEmail(null)
            toast.show('Consulta marcada e paciente ligado.')
            setAttempt((n) => n + 1)
          }}
        />
      )}
    </>
  )
}
